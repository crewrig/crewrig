// comments.ts — comment and message-string masks of the en-GB -> en-US sweep
// (shell/YAML/TOML `#` tails, echo/printf-style messages, Python docstrings).
// Regex translations are tabulated in the header of mask.ts.

import { COMPARE_HINT_RE, DQ_STRING_RE, MSG_CALL_RE, SHELL_EXPANSION_RE } from "./mask.ts";
import { isSpace, pyLstrip, splitLinesKeep } from "./pystr.ts";

/** Sweep `#` comment tails (quote-aware) and, optionally, message strings. */
export function hashCommentMask(text: string, allowMessageStrings: boolean): Uint8Array {
  const mask = new Uint8Array(text.length);
  let pos = 0;
  for (const line of splitLinesKeep(text)) {
    const start = pos;
    pos += line.length;
    const body = line.replace(/\n$/, "");
    const cstart = shellCommentStart(body);
    if (cstart !== null) for (let i = cstart + 1; i < body.length; i += 1) mask[start + i] = 1;
    if (allowMessageStrings) {
      for (const [a, b] of messageStringSpans(body))
        for (let i = a; i < b; i += 1) mask[start + i] = 1;
    }
  }
  return mask;
}

/** Index of the `#` that begins a comment, or null (quote-state-aware). */
export function shellCommentStart(line: string): number | null {
  if (pyLstrip(line).startsWith("#!")) return null;
  let inS = false;
  let inD = false;
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i] as string;
    if (c === "\\" && i + 1 < n) {
      i += 2;
      continue;
    }
    if (inS) {
      if (c === "'") inS = false;
      i += 1;
      continue;
    }
    if (inD) {
      if (c === '"') inD = false;
      i += 1;
      continue;
    }
    if (c === "'") {
      inS = true;
      i += 1;
      continue;
    }
    if (c === '"') {
      inD = true;
      i += 1;
      continue;
    }
    if (c === "#") {
      if (i === 0 || isSpace(line[i - 1] as string)) return i;
      i += 1;
      continue;
    }
    i += 1;
  }
  return null;
}

/** Spans of double-quoted message arguments that interpolate no shell code. */
export function messageStringSpans(line: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  if (COMPARE_HINT_RE.test(line)) return spans;
  if (!MSG_CALL_RE.test(line)) return spans;
  for (const mt of line.matchAll(DQ_STRING_RE)) {
    const content = mt[1] as string;
    if (SHELL_EXPANSION_RE.test(content)) continue;
    const a = mt.index + 1;
    spans.push([a, a + content.length]);
  }
  return spans;
}

/** Sweep `#` comments and triple-quoted docstrings; never code or short strings. */
export function pythonMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);
  const n = text.length;
  let i = 0;
  let inS = false;
  let inD = false;
  let triple: string | null = null;
  while (i < n) {
    const c = text[i] as string;
    const three = text.slice(i, i + 3);
    if (triple) {
      if (three === triple) {
        triple = null;
        i += 3;
        continue;
      }
      mask[i] = 1;
      i += 1;
      continue;
    }
    if (inS) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "'") inS = false;
      i += 1;
      continue;
    }
    if (inD) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') inD = false;
      i += 1;
      continue;
    }
    if (three === '"""' || three === "'''") {
      triple = three;
      i += 3;
      continue;
    }
    if (c === "'") {
      inS = true;
      i += 1;
      continue;
    }
    if (c === '"') {
      inD = true;
      i += 1;
      continue;
    }
    if (c === "#") {
      let j = i;
      while (j < n && text[j] !== "\n") {
        mask[j] = 1;
        j += 1;
      }
      i = j;
      continue;
    }
    i += 1;
  }
  return mask;
}
