/**
 * Host half: authenticated Markdown export route for one Session trajectory.
 *
 * The Session's logical log is read through the persistence read handle — the
 * same authoritative path the shipped ZIP exporter uses — and rendered by the
 * pure renderer in ./lib/markdown.js. The response is text/markdown, so the
 * browser saves it directly; no Host path is written or returned.
 */
import { renderSessionMarkdown } from "./lib/markdown.js";
import z from '@deepseek-ai/schemastery';

export const name = "session-md-export";
export const inject = ["connection"];
export const Config = z.object({
  includeReasoning: z.boolean().default(false),
  includeSystem: z.boolean().default(false),
  includeMeta: z.boolean().default(false),
  includeInbox: z.boolean().default(false),
  toolResultLimit: z.number().step(1).min(100).max(1000000).default(4000),
  textLimit: z.number().step(1).min(100).max(1000000).default(20000),
}).i18n({zh:{includeReasoning:'默认包含思考过程',includeSystem:'默认包含系统提示',includeMeta:'默认包含元信息',includeInbox:'默认包含收件箱消息',toolResultLimit:'每条工具结果的字符上限',textLimit:'每条文本的字符上限'}});

/** Absolute registration path; the browser half addresses it document-relative. */
export const SESSION_MD_EXPORT_PATH = "/api/plugins/dsh-session-md-export/export";

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Collapse an untrusted value into one safe filename segment. */
function safeSegment(value) {
  const cleaned = String(value ?? "").toWellFormed().normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu, "_");
  return Array.from(cleaned).slice(0, 80).join("").trim().replace(/[. ]+$/u, "");
}

/** One safe download filename: the Session title when it has one, else the id. */
function markdownFilename(sessionId, title) {
  return `dsh-session-${safeSegment(title) || safeSegment(sessionId) || "session"}.md`;
}

function truthy(value) {
  return value === "1" || value === "true";
}

/** Query switches; every one defaults to the reading-oriented rendering. */
export function renderOptions(url, config = {}) {
  const query = url.searchParams;
  const options = {
    includeReasoning: query.has('reasoning') ? truthy(query.get('reasoning')) : config.includeReasoning === true,
    includeSystem: query.has('system') ? truthy(query.get('system')) : config.includeSystem === true,
    includeMeta: query.has('meta') ? truthy(query.get('meta')) : config.includeMeta === true,
    includeInbox: query.has('inbox') ? truthy(query.get('inbox')) : config.includeInbox === true,
    toolResultLimit: config.toolResultLimit ?? 4000,
    textLimit: config.textLimit ?? 20000,
  };
  const limit = Number(query.get("toolResultLimit"));
  if (Number.isFinite(limit) && limit > 0) options.toolResultLimit = limit;
  return options;
}

/** Flush a live Session so the export observes its latest committed events. */
async function flushLive(ctx, sessionId) {
  const sessions = ctx.get("sessions");
  if (sessions === undefined) return;
  const session = sessions.get(sessionId);
  if (session === undefined) return;
  await sessions.flush(session);
}

/** Read one Session's header and committed events through a persistence handle. */
async function readSession(ctx, sessionId, signal) {
  const persistence = ctx.get("sessionPersistence");
  if (persistence === undefined) throw new Error("session persistence is unavailable");
  await flushLive(ctx, sessionId);
  signal?.throwIfAborted();
  const handle = await persistence.open(sessionId, "read", { signal });
  try {
    const { events } = await handle.read(0, undefined, { signal });
    return { header: handle.header, events };
  } finally {
    await handle.close();
  }
}

/** The last persisted Session title, when one was generated. */
function firstTitle(events) {
  let title;
  for (const event of events ?? []) {
    if (event?.type !== "session/title") continue;
    const value = event.data?.title ?? event.data?.value;
    if (typeof value === "string" && value.trim() !== "") title = value.trim();
  }
  return title;
}

/** Answer one Markdown export request. */
export async function sessionMarkdownResponse(ctx, request, config = {}) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  if (sessionId === null || sessionId === "") {
    return new Response("missing sessionId query parameter", { status: 400 });
  }
  let log;
  try {
    log = await readSession(ctx, sessionId, request.signal);
  } catch (error) {
    request.signal.throwIfAborted();
    const notFound = error?.name === "SessionPersistenceNotFoundError";
    return new Response(
      notFound ? "session not found" : `session markdown export failed: ${messageOf(error)}`,
      { status: notFound ? 404 : 500 },
    );
  }
  const markdown = renderSessionMarkdown(log.header, log.events, renderOptions(url, config));
  const filename = markdownFilename(sessionId, firstTitle(log.events) ?? log.header?.title);
  // HTTP headers are byte strings. RFC 8187 carries the actual Unicode name;
  // older clients receive a safe ASCII fallback based on the Session id.
  const fallback = markdownFilename(sessionId).replace(/[^A-Za-z0-9_.-]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
    },
  });
}

/**
 * Register the Web-only Markdown export route. HEAD answers the same status and
 * headers as GET so the browser half can preflight before starting a download.
 */
export function apply(ctx, config = {}) {
  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: SESSION_MD_EXPORT_PATH,
      methods: ["GET", "HEAD"],
      requestBody: "buffered",
      fetch: async (request) => {
        const response = await sessionMarkdownResponse(ctx, request, typeof config.get === 'function' ? config.get() : config);
        if (request.method === "GET") return response;
        await response.body?.cancel();
        return new Response(null, { status: response.status, headers: response.headers });
      },
    }),
  );
}
