// pystr.ts — Python `str` semantics the sweep engine relies on, rebuilt for
// JavaScript so the TypeScript twin of scripts/lib/en_us_sweep.py is byte-identical.
//
// Python and JavaScript disagree on what whitespace is (`\s`, `str.strip`,
// `str.isspace`) and on which characters end a line (`str.splitlines`).

import fs from "node:fs";

/** Body of a regex character class: Python `str.isspace()` / Unicode `\s`. */
export const PYWS =
  "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
/** Body of a regex character class: Python Unicode `\w` (alphanumeric or `_`). */
export const PYW = "\\p{L}\\p{N}_";

const WS_RE = new RegExp(`^[${PYWS}]$`, "u");

/** Python `str.isspace()` on a single character. */
export function isSpace(c: string): boolean {
  return WS_RE.test(c);
}

/** Python `str.strip()` with no argument. */
export function pyStrip(s: string): string {
  return pyRstrip(pyLstrip(s));
}

/** Python `str.lstrip()` with no argument. */
export function pyLstrip(s: string): string {
  let i = 0;
  while (i < s.length && isSpace(s[i] as string)) i += 1;
  return s.slice(i);
}

/** Python `str.rstrip()` with no argument. */
export function pyRstrip(s: string): string {
  let j = s.length;
  while (j > 0 && isSpace(s[j - 1] as string)) j -= 1;
  return s.slice(0, j);
}

/** Python `str.split()` with no argument. */
export function pySplit(s: string): string[] {
  return pyStrip(s) === "" ? [] : pyStrip(s).split(new RegExp(`[${PYWS}]+`, "u"));
}

/** Python `str.strip("\n")`. */
export function stripNewlines(s: string): string {
  return s.replace(/^\n+/, "").replace(/\n+$/, "");
}

const LINE_BREAK = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/gu;

/** Python `str.splitlines(keepends=True)`. */
export function splitLinesKeep(text: string): string[] {
  const out: string[] = [];
  let last = 0;
  for (const m of text.matchAll(LINE_BREAK)) {
    const end = (m.index as number) + m[0].length;
    out.push(text.slice(last, end));
    last = end;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Lines of a text-mode Python file object: split after each `\n`, keeping it. */
export function fileLines(text: string): string[] {
  const out: string[] = [];
  let last = 0;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", last)) {
    out.push(text.slice(last, i + 1));
    last = i + 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Python `open(path, encoding="utf-8").read()`: strict UTF-8, universal newlines. */
export function readText(path: string): string {
  const raw = fs.readFileSync(path);
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  return text.replace(/\r\n?/g, "\n");
}

/** Python `repr()` of a string, for the `malformed map line` message. */
export function pyRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = "";
  for (const c of s) {
    if (c === "\\") out += "\\\\";
    else if (c === quote) out += `\\${c}`;
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "\t") out += "\\t";
    else if (/[\p{Cc}\p{Cs}]/u.test(c) || (isSpace(c) && c !== " ")) {
      const cp = c.codePointAt(0) as number;
      out +=
        cp < 0x100
          ? `\\x${cp.toString(16).padStart(2, "0")}`
          : `\\u${cp.toString(16).padStart(4, "0")}`;
    } else out += c;
  }
  return quote + out + quote;
}

/** Escape a literal for a JavaScript `u`-flag regex (Python `re.escape` stand-in). */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
