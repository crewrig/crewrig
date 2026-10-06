// stop-summary.ts — the summary of a `Stop` entry (spec 0247 R11), as
// hooks/mempalace-transcript.sh:205-207 built it:
//
//   tail -n 20 "$TRANSCRIPT_PATH" | jq -r 'select(.type=="PLANNER_RESPONSE"
//     or .type=="ASSISTANT_RESPONSE" or .type=="RESPONSE")
//     | .content // (.tool_calls[].name // empty)' | tail -n 5 | tr '\n' ' '
//     | head -c 500
//
// The tail is read backwards in fixed chunks, so a 50 MB transcript costs one
// or two reads (budget R19(c)). A line that does not parse is skipped where
// `jq` ended the shell with status 5, and a selected object, array or boolean
// is skipped where `jq -r` printed it (R30).
//
// Standard library only.

import fs from "node:fs";

import { utf8Cut } from "./fields.ts";

const TAIL_LINES = 20;
const KEEP_LINES = 5;
const MAX_BYTES = 500;
const CHUNK = 64 * 1024;
const RESPONSE_TYPES = new Set(["PLANNER_RESPONSE", "ASSISTANT_RESPONSE", "RESPONSE"]);

function countNewlines(buffer: Buffer, end: number): number {
  let count = 0;
  for (let i = 0; i < end; i += 1) if (buffer[i] === 0x0a) count += 1;
  return count;
}

/** The last `count` lines of a file, as `tail -n` gives them (a final line without a line feed counts). */
export function tailLines(file: string, count: number): string[] {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    let start = size;
    let buffer = Buffer.alloc(0);
    // Read until the buffer holds `count` line feeds before its last byte, so
    // `count` whole lines are known, or the file is exhausted.
    while (start > 0) {
      const length = Math.min(CHUNK, start);
      start -= length;
      const chunk = Buffer.alloc(length);
      fs.readSync(fd, chunk, 0, length, start);
      buffer = Buffer.concat([chunk, buffer]);
      if (countNewlines(buffer, buffer.length - 1) >= count) break;
    }
    let text = buffer.toString("utf8");
    if (text.endsWith("\n")) text = text.slice(0, -1);
    if (text === "" && buffer.length === 0) return [];
    const lines = text.split("\n");
    // A buffer that starts mid-file starts mid-line: drop that partial line.
    if (start > 0) lines.shift();
    return lines.slice(-count);
  } finally {
    fs.closeSync(fd);
  }
}

/** `jq -r` of one selected value, or `undefined` when R11 skips it. */
function render(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  return undefined;
}

/** The lines `jq -r` printed for one transcript record. */
export function recordLines(line: string): string[] {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return [];
  }
  if (typeof record !== "object" || record === null || Array.isArray(record)) return [];
  const fields = record as Record<string, unknown>;
  if (typeof fields["type"] !== "string" || !RESPONSE_TYPES.has(fields["type"])) return [];

  const outputs: string[] = [];
  const content = fields["content"];
  if (content !== undefined && content !== null && content !== false) {
    const text = render(content);
    if (text !== undefined) outputs.push(text);
  } else {
    const calls = fields["tool_calls"];
    const items = Array.isArray(calls)
      ? calls
      : typeof calls === "object" && calls !== null
        ? Object.values(calls)
        : [];
    for (const call of items) {
      if (typeof call !== "object" || call === null || Array.isArray(call)) continue;
      const name = (call as Record<string, unknown>)["name"];
      if (name === undefined || name === null || name === false) continue;
      const text = render(name);
      if (text !== undefined) outputs.push(text);
    }
  }
  // `jq -r` prints a string's own line feeds, so each one starts a new line.
  return outputs.flatMap((text) => text.split("\n"));
}

/** The summary for a transcript path; `""` when there is none. */
export function stopSummary(transcriptPath: string | undefined): string {
  if (transcriptPath === undefined) return "";
  try {
    if (!fs.statSync(transcriptPath).isFile()) return "";
  } catch {
    return "";
  }
  let lines: string[];
  try {
    lines = tailLines(transcriptPath, TAIL_LINES);
  } catch {
    return "";
  }
  const printed = lines.flatMap(recordLines).slice(-KEEP_LINES);
  return utf8Cut(printed.map((line) => `${line} `).join(""), MAX_BYTES);
}
