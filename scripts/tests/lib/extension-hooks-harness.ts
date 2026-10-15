// extension-hooks-harness.ts — the shared harness of the example-hook oracle (spec 0258 R16, R20,
// R28, R29): the stdin corpus, the deviation tag table, the subject runners (the shell twin under
// `LC_ALL=C`, the TypeScript entry under plain `node`) and the golden store. A golden is the shell's
// standard output for a case; a large case stores a digest line instead of the bytes.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
export const GOLDENS = path.join(REPO, "scripts", "tests", "fixtures", "extension-hooks");

/** The three hooks: the entry and the shell twin that the oracle runs before the shell is deleted. */
export const HOOKS = [
  "extensions/core/hello-world/hooks/prompt-logger",
  "extensions/core/hello-world/hooks/shell-logger",
  "extension-skeleton/hook/hooks/logger",
] as const;

export interface Case {
  readonly name: string;
  readonly input: Buffer;
  /** Stored as a digest line in place of the bytes. */
  readonly big?: boolean;
}

const b = (text: string): Buffer => Buffer.from(text, "utf8");

export const CASES: readonly Case[] = [
  { name: "empty", input: b("") },
  { name: "no-trailing-lf", input: b('{"a":1}') },
  { name: "blanks-around", input: b('  \t{"a":1} \t\n') },
  { name: "crlf", input: b('{"a":1}\r\n') },
  { name: "cr-among-blanks", input: b("  x \r \n") },
  { name: "backslash", input: b("a\\\\b\n") },
  { name: "trailing-backslash", input: b("abc\\\nnext\n") },
  { name: "long-100k", input: b(`${"x".repeat(100_000)}\n`), big: true },
  { name: "several-lines", input: b("l1\nl2\nl3\n") },
  { name: "leading-lf", input: b("\nfoo\n") },
  { name: "blank-only", input: b(" \t \t\n") },
  { name: "blank-only-no-lf", input: b("  \t ") },
  { name: "word-n", input: b("-n\n") },
  { name: "word-e-lower", input: b("-e\n") },
  { name: "word-e-upper", input: b("-E\n") },
  { name: "word-ne", input: b("-ne\n") },
  { name: "word-dash-x", input: b("-x\n") },
  // "é" is two bytes, 0xC3 0xA9: the first ends the first 64 KB chunk, the second begins the next.
  { name: "multibyte-chunk-boundary", input: b(`${"a".repeat(65_535)}é\n`), big: true },
];

// Case names never differ by case alone: the goldens live on case-insensitive volumes too.

/** Deviation (i): the shell's `echo` takes the word as options; the entry writes it literally. */
export const DEVIATIONS: Readonly<Record<string, { letter: string; entry: Buffer }>> = {
  "word-n": { letter: "i", entry: b("-n\n") },
  "word-e-lower": { letter: "i", entry: b("-e\n") },
  "word-e-upper": { letter: "i", entry: b("-E\n") },
  "word-ne": { letter: "i", entry: b("-ne\n") },
};

export interface Result {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly status: number | null;
}

/** How standard input is given: a pipe, a closed descriptor, or a non-blocking FIFO that has no data (EAGAIN). */
export type Feed =
  | { readonly kind: "pipe"; readonly data: Buffer }
  | { readonly kind: "closed" }
  | { readonly kind: "eagain"; readonly data: Buffer };

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C" };
  for (const key of ["NODE_TEST_CONTEXT", "NODE_OPTIONS", "CI"]) delete env[key];
  return env;
}

function spawn(command: string, args: readonly string[], feed: Feed, cwd: string): Result {
  const options = { cwd, env: childEnv(), timeout: 10_000, maxBuffer: 16 * 1024 * 1024 };
  if (feed.kind === "pipe") {
    return finish(spawnSync(command, [...args], { ...options, input: feed.data }));
  }
  if (feed.kind === "closed") {
    // `<&-` closes descriptor 0 before the exec.
    return finish(spawnSync("/bin/sh", ["-c", 'exec "$@" <&-', "sh", command, ...args], options));
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-fifo-"));
  try {
    const fifo = path.join(dir, "stdin");
    const made = spawnSync("mkfifo", [fifo]);
    if (made.status !== 0) throw new Error("mkfifo failed");
    const reader = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const writer = fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
    try {
      if (feed.data.length > 0) fs.writeSync(writer, feed.data);
      // The writer stays open: a read after the data returns EAGAIN, not end of input. libuv clears
      // O_NONBLOCK on the stdio of every child it starts, so perl sets it again just before the exec.
      const flag = "fcntl(STDIN, F_SETFL, O_NONBLOCK) or die; exec @ARGV or die";
      const argv = ["-MFcntl", "-e", flag, "--", command, ...args];
      return finish(spawnSync("perl", argv, { ...options, stdio: [reader, "pipe", "pipe"] }));
    } finally {
      fs.closeSync(reader);
      fs.closeSync(writer);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function finish(done: ReturnType<typeof spawnSync>): Result {
  if (done.error) throw done.error;
  return {
    stdout: Buffer.from(done.stdout),
    stderr: Buffer.from(done.stderr),
    status: done.status,
  };
}

/** The TypeScript entry, run as the hook command line does: plain `node <file>`, no flag. */
export function runEntry(hook: string, feed: Feed, entryPath?: string): Result {
  return spawn(process.execPath, [entryPath ?? path.join(REPO, `${hook}.ts`)], feed, REPO);
}

/** The shell twin, `LC_ALL=C bash <file>`; meaningful only on Linux (bash 5.2). */
export function runShell(hook: string, feed: Feed): Result {
  return spawn("bash", [path.join(REPO, `${hook}.sh`)], feed, REPO);
}

export const onLinux = process.platform === "linux";
export const hasShellTwin = (hook: string): boolean => fs.existsSync(path.join(REPO, `${hook}.sh`));

const digest = (data: Buffer): string =>
  `sha256:${createHash("sha256").update(data).digest("hex")} bytes:${data.length}\n`;

/** What a golden stores for a result: the bytes, or a digest line for a large case. */
export function goldenForm(item: Case, stdout: Buffer): Buffer {
  return item.big ? b(digest(stdout)) : stdout;
}

export function readGolden(item: Case): Buffer {
  return fs.readFileSync(path.join(GOLDENS, `${item.name}.golden`));
}

export function writeGolden(item: Case, stdout: Buffer): void {
  fs.mkdirSync(GOLDENS, { recursive: true });
  fs.writeFileSync(path.join(GOLDENS, `${item.name}.golden`), goldenForm(item, stdout));
}
