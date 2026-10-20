// comment-size.ts — plan and verdict comment size guard (spec 0275 R-E1, R-E2).
//
// Usage: evaluateCommentSize(bytes) / evaluateCommentSizeOfFile(path) -> { code, stdout, stderr }
// Budget 12288 bytes (12 KB, UTF-8). A size greater than the budget fails; exactly
// the budget passes. Bytes are the UTF-8 length of the content, never a character count.
// Exit codes: 0 within budget, 1 over budget or unreadable input.
// This is an author-side tool: CI cannot read forge comments, so it checks files only.

import { readFileSync, statSync } from "node:fs";

export const BUDGET = 12288;

export interface SizeOutcome {
  code: 0 | 1;
  stdout: string;
  stderr: string;
}

function reason(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return "No such file or directory";
  if (code === "EACCES") return "Permission denied";
  if (code === "EISDIR") return "Is a directory";
  return err instanceof Error ? err.message : String(err);
}

export function evaluateCommentSize(content: Uint8Array | string): SizeOutcome {
  const size = typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.length;
  if (size > BUDGET) {
    return {
      code: 1,
      stdout: "",
      stderr:
        `ERROR: comment is ${size} bytes — over the ${BUDGET}-byte budget.\n` +
        "Move bulk (long evidence, command output) to a linked artifact and keep a reference.\n",
    };
  }
  return { code: 0, stdout: `OK: ${size} bytes (budget: ${BUDGET} bytes)\n`, stderr: "" };
}

/** `file` is a path, or `-` / undefined for stdin (read by the caller via readStdin). */
export function evaluateCommentSizeOfFile(file: string): SizeOutcome {
  let bytes: Buffer;
  try {
    if (statSync(file).isDirectory())
      throw Object.assign(new Error("Is a directory"), { code: "EISDIR" });
    bytes = readFileSync(file);
  } catch (err) {
    return { code: 1, stdout: "", stderr: `Error: ${file}: ${reason(err)}\n` };
  }
  return evaluateCommentSize(bytes);
}

export function evaluateStdin(): SizeOutcome {
  try {
    return evaluateCommentSize(readFileSync(0));
  } catch (err) {
    return { code: 1, stdout: "", stderr: `Error: stdin: ${reason(err)}\n` };
  }
}
