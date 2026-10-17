/**
 * Session trajectory -> Markdown.
 *
 * Pure rendering: one session header plus its validated V4 events in, one
 * Markdown document out. No I/O and no service access, so the same code runs
 * inside the Host route, inside the CLI helper, and in tests.
 */

const DEFAULT_TOOL_RESULT_LIMIT = 4000;
const DEFAULT_TEXT_LIMIT = 20000;

function pad(n, w = 2) {
  return String(n).padStart(w, "0");
}

/** Local wall-clock timestamp with an explicit UTC offset. */
export function formatTime(ms) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return String(ms ?? "");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Longest backtick run in `text`, so a fence never closes early. */
function fenceFor(text) {
  let max = 0;
  for (const run of String(text).match(/`+/g) ?? []) max = Math.max(max, run.length);
  return "`".repeat(Math.max(3, max + 1));
}

export function codeBlock(text, lang = "") {
  const body = String(text ?? "");
  const fence = fenceFor(body);
  return `${fence}${lang}\n${body}\n${fence}`;
}

function clip(text, limit) {
  const s = String(text ?? "");
  if (!Number.isFinite(limit) || limit <= 0 || s.length <= limit) return s;
  return `${s.slice(0, limit)}\n\n… [truncated ${s.length - limit} of ${s.length} characters]`;
}

function inline(text) {
  return String(text ?? "").replace(/\r\n?/g, "\n").trim();
}

function esc(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function prettyJson(value) {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function collectText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (b && typeof b === "object" && typeof b.text === "string" ? b.text : ""))
    .filter((s) => s !== "")
    .join("\n\n");
}

function findFailure(stream) {
  if (!Array.isArray(stream)) return null;
  for (const record of stream) {
    const reason = record?.chunk?.reason;
    if (reason?.kind === "error") return reason.failure?.message ?? "unknown error";
  }
  return null;
}

function renderBlocks(content, o, lines) {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block === null || typeof block !== "object") continue;
    switch (block.type) {
      case "text": {
        const text = inline(block.text);
        if (text !== "") lines.push(clip(text, o.textLimit), "");
        break;
      }
      case "reasoning":
      case "thinking": {
        if (!o.includeReasoning) break;
        const text = inline(block.text ?? block.reasoning);
        if (text !== "") {
          lines.push("<details>", "<summary>Reasoning</summary>", "", clip(text, o.textLimit), "", "</details>", "");
        }
        break;
      }
      case "tool-call": {
        lines.push(`**Tool call — \`${block.name ?? "unknown"}\`**`, "");
        lines.push(codeBlock(prettyJson(block.arguments), "json"), "");
        break;
      }
      case "image": {
        const ref = block.attachment ?? {};
        lines.push(`![image](media/${ref.attachmentId ?? "unknown"})`, "");
        break;
      }
      case "file": {
        const ref = block.attachment ?? {};
        const name = ref.name ?? ref.attachmentId ?? "unknown";
        lines.push(`[file: ${name}](files/${ref.attachmentId ?? "unknown"})`, "");
        break;
      }
      default: {
        if (o.includeUnknownBlocks) lines.push(codeBlock(prettyJson(block), "json"), "");
      }
    }
  }
}

/** Parse canonical session-log JSONL text into its header and event list. */
export function parseSessionLog(text) {
  let header = null;
  const events = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row?.type === "session") header = row;
    else events.push(row);
  }
  return { header: header ?? {}, events };
}

/**
 * Render one session trajectory as Markdown.
 *
 * @param header - the session header line (id, createdAt, cwd, agentPreset, ...).
 * @param events - validated events in seq order.
 * @param options - rendering switches; see the defaults below.
 * @returns the Markdown document, ending with a newline.
 */
export function renderSessionMarkdown(header, events, options = {}) {
  const o = {
    title: undefined,
    includeReasoning: false,
    includeSystem: false,
    includeMeta: false,
    includeUnknownBlocks: false,
    toolResultLimit: DEFAULT_TOOL_RESULT_LIMIT,
    textLimit: DEFAULT_TEXT_LIMIT,
    ...options,
  };
  const list = Array.isArray(events) ? events : [];
  const id = header?.id ?? "session";

  let title = o.title;
  if (!title) {
    for (const ev of list) {
      if (ev?.type !== "session/title") continue;
      const value = ev.data?.title ?? ev.data?.value;
      if (typeof value === "string" && value.trim() !== "") title = value.trim();
    }
  }
  if (!title) title = header?.title || id;

  const lines = [];
  lines.push(`# ${title}`, "");
  lines.push("| Field | Value |", "| --- | --- |");
  lines.push(`| Session | \`${esc(id)}\` |`);
  if (header?.createdAt) lines.push(`| Created | ${esc(formatTime(header.createdAt))} |`);
  if (header?.cwd) lines.push(`| Workspace | \`${esc(header.cwd)}\` |`);
  if (header?.agentPreset) lines.push(`| Agent preset | \`${esc(header.agentPreset)}\` |`);
  if (header?.parentSession) lines.push(`| Parent session | \`${esc(header.parentSession)}\` |`);
  lines.push(`| Events | ${list.length} |`);
  lines.push("", "---", "");

  let turn = null;
  for (const ev of list) {
    const type = ev?.type;
    const data = ev?.data ?? {};
    const evTurn = Number.isInteger(data.turn) ? data.turn : null;
    if (evTurn !== null && evTurn !== turn) {
      turn = evTurn;
      lines.push(`## Turn ${turn}`, "");
    }

    switch (type) {
      case "user/message": {
        const kind = data.source?.kind;
        const label = kind === undefined || kind === "user" ? "User" : `User (${kind})`;
        lines.push(`### ${label}`, "");
        renderBlocks(data.content, o, lines);
        break;
      }
      case "assistant/message": {
        lines.push("### Assistant", "");
        renderBlocks(data.message?.content, o, lines);
        const usage = data.usage;
        if (usage && (usage.inputTokens || usage.outputTokens)) {
          lines.push(`<sub>tokens — in ${usage.inputTokens ?? 0} / out ${usage.outputTokens ?? 0}</sub>`, "");
        }
        break;
      }
      case "tool/result": {
        const message = data.message ?? {};
        const callId = message.toolCallId ?? data.toolCallId ?? "";
        const isError = message.isError === true;
        const body = clip(collectText(message.content), o.toolResultLimit);
        const summary = `Tool result${isError ? " (error)" : ""}${callId ? ` — \`${callId}\`` : ""}`;
        lines.push(`<details><summary>${summary}</summary>`, "", codeBlock(body), "", "</details>", "");
        break;
      }
      case "system/message": {
        if (!o.includeSystem) break;
        lines.push("### System", "");
        renderBlocks(data.message?.content ?? data.content, o, lines);
        break;
      }
      case "agent/inbox/spliced": {
        // Delivery plumbing: the durable record is the user/message event that
        // follows, so this is opt-in to avoid rendering every prompt twice.
        if (!o.includeInbox) break;
        const inserted = Array.isArray(data.inserted) ? data.inserted : [];
        if (inserted.length === 0) break;
        lines.push("### Inbox", "");
        for (const message of inserted) {
          if (message?.source?.kind) lines.push(`<sub>source: ${esc(message.source.kind)}</sub>`, "");
          renderBlocks(message?.content, o, lines);
        }
        break;
      }
      case "compaction/summary": {
        const summary = collectText(data.summary) || collectText(data.rawOutput);
        if (summary.trim() === "") break;
        lines.push("> **Compaction summary**", ">");
        for (const line of summary.split("\n")) lines.push(`> ${line}`);
        lines.push("");
        break;
      }
      case "assistant/attempt": {
        const failure = findFailure(data.stream);
        if (failure) lines.push(`> **Model attempt failed:** ${failure}`, "");
        break;
      }
      case "turn/end": {
        const error = data.error ?? data.failure ?? (data.reason?.kind === "error" ? data.reason : null);
        if (error) {
          const text = typeof error === "string" ? error : error.message ?? prettyJson(error);
          lines.push(`> **Turn ended with error:** ${text}`, "");
        }
        break;
      }
      case "command/run": {
        if (!o.includeMeta) break;
        lines.push(`> command: \`/${String(data.name ?? "").trim()}${data.args ?? ""}\``, "");
        break;
      }
      case "session/title": {
        if (!o.includeMeta) break;
        lines.push(`> title: ${esc(data.title ?? data.value ?? "")}`, "");
        break;
      }
      default:
        break;
    }
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}