#!/usr/bin/env node
/**
 * Dev helper: render one stored session log to Markdown without the Host.
 *
 * usage: node scripts/render-cli.mjs <session.vN.jsonl[.zstd]> [out.md]
 *        flags: --system  --reasoning  --meta
 */
import fs from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { parseSessionLog, renderSessionMarkdown } from "../lib/markdown.js";

const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

/** The store writes a concatenated multi-frame zstd stream; decode every frame. */
function decodeZstd(buf) {
  const starts = [];
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) {
      starts.push(i);
    }
  }
  if (starts.length <= 1) return zstdDecompressSync(buf).toString("utf8");
  let text = "";
  for (let k = 0; k < starts.length; k += 1) {
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length;
    try {
      text += zstdDecompressSync(buf.subarray(starts[k], end)).toString("utf8");
    } catch {
      // A false frame boundary inside compressed data: the next slice absorbs it.
    }
  }
  return text;
}

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const [input, output] = argv.filter((a) => !a.startsWith("--"));

if (!input) {
  console.error("usage: node scripts/render-cli.mjs <session.vN.jsonl[.zstd]> [out.md]");
  process.exit(2);
}

const raw = fs.readFileSync(input);
const text = input.endsWith(".zstd") ? decodeZstd(raw) : raw.toString("utf8");
const { header, events } = parseSessionLog(text);
const markdown = renderSessionMarkdown(header, events, {
  includeSystem: flags.has("--system"),
  includeReasoning: flags.has("--reasoning"),
  includeMeta: flags.has("--meta"),
});

if (output) {
  fs.writeFileSync(output, markdown, "utf8");
  console.log(`wrote ${output} (${markdown.length} chars, ${events.length} events)`);
} else {
  process.stdout.write(markdown);
}