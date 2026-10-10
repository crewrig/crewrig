// tls-env.ts — read `~/.crewrig/tls-env.sh` without executing it (spec 0247
// R16, decision Q4).
//
// The file is written by scripts/lib/tls-delegation.sh (`printf 'export
// NAME=%q\n'`). The shell hooks sourced it with `.`; a TypeScript hook must
// not spawn a shell, and must not run whatever else the file may hold, so it
// is parsed against exactly the format that writer produces:
//   - comment lines starting with `#`, and blank lines;
//   - `export NAME=VALUE`, `NAME` matching `[A-Za-z_][A-Za-z0-9_]*`, `VALUE`
//     a word Bash's `printf %q` produces: plain characters, backslash escapes,
//     `$'…'` strings and `''`;
//   - LF or CRLF line endings.
// The file is parsed as bytes, not as UTF-8 text: Bash 3.2 (the macOS
// `/bin/bash`) under a UTF-8 locale writes a non-ASCII character as a `$'…'`
// string that mixes raw bytes with octal escapes (`€` becomes `$'` 0xE2
// `\202` 0xAC `'`), which is not valid UTF-8 until it is decoded.
// All or nothing: one line outside that format and the reader yields no
// variable at all, and names the file and the first such line, so the caller
// can report it. Nothing is ever evaluated.
//
// This module is the cross-step contract with row F1 (#1335): spec 0256
// decision D1 kept this format, so the reader is unchanged and the writer
// (`writeTlsEnv`, with `quoteWord` from tls-env-quote.ts) lives beside it. The
// writer reads its own file back and fails when this reader rejects it.
//
// Standard library only: this file and tls-env-quote.ts are bundled together
// into the service trust wrapper (see service/launcher/bundle.ts).

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { quoteWord } from "./tls-env-quote.ts";

export { quoteWord };

export type TlsEnvResult =
  | { readonly kind: "absent" }
  | { readonly kind: "ok"; readonly vars: Readonly<Record<string, string>> }
  | { readonly kind: "malformed"; readonly file: string; readonly line: number }
  | { readonly kind: "unreadable"; readonly file: string };

/** The trust file under a home directory. */
export function tlsEnvPath(home: string): string {
  return path.join(home, ".crewrig", "tls-env.sh");
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// A character `printf %q` never leaves unescaped in a word: whitespace, quotes,
// the backslash, `$`, the backquote and every other shell metacharacter.
const SPECIAL = new Set([..." \t\n\r\v\f'\"\\$`;&|<>()*?[]{}!"]);
const SIMPLE_ESCAPES: Readonly<Record<string, number>> = {
  a: 0x07,
  b: 0x08,
  e: 0x1b,
  E: 0x1b,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
  "\\": 0x5c,
  "'": 0x27,
  '"': 0x22,
  "?": 0x3f,
};

// A word is held as a "binary" string: one character per byte of the file
// (Latin-1 decoding), so a raw byte is pushed as itself.
function pushByte(bytes: number[], ch: string): void {
  bytes.push(ch.charCodeAt(0) & 0xff);
}

/** A code point named by a `\u`/`\U` escape, encoded as UTF-8. */
function pushCodePoint(bytes: number[], code: number): void {
  for (const byte of Buffer.from(String.fromCodePoint(code), "utf8")) bytes.push(byte);
}

/** Decode the body of a `$'…'` string from `start` (just past `$'`); returns the index past the closing quote, or -1. */
function decodeAnsiC(word: string, start: number, bytes: number[]): number {
  let i = start;
  while (i < word.length) {
    const ch = word[i] as string;
    if (ch === "'") return i + 1;
    if (ch !== "\\") {
      pushByte(bytes, ch);
      i += 1;
      continue;
    }
    const next = word[i + 1];
    if (next === undefined) return -1;
    const simple = SIMPLE_ESCAPES[next];
    if (simple !== undefined) {
      bytes.push(simple);
      i += 2;
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(word.slice(i + 1));
    if (octal !== null) {
      bytes.push(parseInt(octal[0], 8) & 0xff);
      i += 1 + octal[0].length;
      continue;
    }
    const hex = /^x([0-9A-Fa-f]{1,2})/.exec(word.slice(i + 1));
    if (hex !== null) {
      bytes.push(parseInt(hex[1] as string, 16));
      i += 1 + hex[0].length;
      continue;
    }
    const unicode = /^(?:u([0-9A-Fa-f]{1,4})|U([0-9A-Fa-f]{1,8}))/.exec(word.slice(i + 1));
    if (unicode !== null) {
      const code = parseInt((unicode[1] ?? unicode[2]) as string, 16);
      if (code > 0x10ffff) return -1;
      pushCodePoint(bytes, code);
      i += 1 + unicode[0].length;
      continue;
    }
    const control = /^c(.)/.exec(word.slice(i + 1));
    if (control !== null) {
      bytes.push((control[1] as string).charCodeAt(0) & 0x1f);
      i += 3;
      continue;
    }
    return -1;
  }
  return -1;
}

/** The value a `printf %q` word stands for, or `undefined` when the word is outside that format. */
export function decodeQuotedWord(word: string): string | undefined {
  return decodeBinaryWord(Buffer.from(word, "utf8").toString("latin1"));
}

/** `decodeQuotedWord` over a binary string (one character per byte). */
function decodeBinaryWord(word: string): string | undefined {
  if (word === "") return undefined;
  // A leading `#` or `~` is always escaped by `printf %q`: unescaped, the shell
  // would read a comment or expand a home directory.
  if (word.startsWith("#") || word.startsWith("~")) return undefined;
  const bytes: number[] = [];
  let i = 0;
  while (i < word.length) {
    const ch = word[i] as string;
    if (ch === "\\") {
      const next = word[i + 1];
      if (next === undefined || next === "\n") return undefined;
      pushByte(bytes, next);
      i += 2;
    } else if (ch === "$" && word[i + 1] === "'") {
      const end = decodeAnsiC(word, i + 2, bytes);
      if (end === -1) return undefined;
      i = end;
    } else if (ch === "'" && word[i + 1] === "'") {
      i += 2;
    } else if (SPECIAL.has(ch) || ch.charCodeAt(0) < 0x20 || ch === "\u007f") {
      return undefined;
    } else {
      pushByte(bytes, ch);
      i += 1;
    }
  }
  // `printf %q` never writes a NUL byte, and no environment value can carry one
  // (security review S3): the file is then malformed, not half-applied.
  if (bytes.includes(0)) return undefined;
  return Buffer.from(bytes).toString("utf8");
}

/**
 * Parse a trust file — its bytes, or its text (encoded as UTF-8): the
 * variables, or the 1-based number of the first line outside the format.
 */
export function parseTlsEnv(
  content: string | Buffer,
): { vars: Record<string, string> } | { line: number } {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  const vars: Record<string, string> = {};
  const lines = bytes.toString("latin1").split("\n");
  // A final line feed ends the last line; it does not open an empty one.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index] as string;
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line.trim() === "" || line.startsWith("#")) continue;
    const match = /^export ([^=\s]+)=(.+)$/.exec(line);
    if (match === null) return { line: index + 1 };
    const name = match[1] as string;
    if (!NAME.test(name)) return { line: index + 1 };
    const value = decodeBinaryWord(match[2] as string);
    if (value === undefined) return { line: index + 1 };
    vars[name] = value;
  }
  return { vars };
}

/** Read the trust file under `home`, never executing it. */
export function readTlsEnv(home: string): TlsEnvResult {
  const file = tlsEnvPath(home);
  let text: Buffer;
  try {
    text = fs.readFileSync(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { kind: "absent" };
    return { kind: "unreadable", file };
  }
  const parsed = parseTlsEnv(text);
  if ("line" in parsed) return { kind: "malformed", file, line: parsed.line };
  return { kind: "ok", vars: parsed.vars };
}

const TLS_VARIABLES: readonly string[] = [
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
  "PIP_CERT",
  "GIT_SSL_CAINFO",
  "CURL_CA_BUNDLE",
];

/** The exact content of the trust file for `bundle` (what scripts/lib/tls-delegation.sh writes). */
function tlsEnvContent(file: string, bundle: string): string {
  const word = quoteWord(bundle);
  return [
    "# crewrig custom root-CA / native-TLS delegation (spec 0084)",
    "# Per-user, machine-local. Written only on your explicit consent.",
    `# Remove in one action:  rm ${file}`,
    ...TLS_VARIABLES.map((name) => `export ${name}=${word}`),
    "export UV_SYSTEM_CERTS=true",
    "",
  ].join("\n");
}

/**
 * Write `<home>/.crewrig/tls-env.sh` delegating trust to `bundle`: LF bytes, a
 * temporary file next to the target renamed onto it (its mode is the process
 * umask, as the shell's `>` redirection gives it; no chmod), the temporary file
 * removed on failure. The file is then read back; one the reader rejects throws.
 */
export function writeTlsEnv(home: string, bundle: string): { path: string; content: string } {
  const file = tlsEnvPath(home);
  const content = tlsEnvContent(file, bundle);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${randomBytes(6).toString("hex")}`;
  try {
    fs.writeFileSync(tmp, Buffer.from(content, "utf8"), { flag: "wx" });
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
  const back = readTlsEnv(home);
  if (back.kind !== "ok") {
    throw new Error(`tls-env: wrote ${file} but the reader rejects it (${back.kind})`);
  }
  return { path: file, content };
}
