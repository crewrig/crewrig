// component-twins-harness.ts — drives the shell libraries (scripts/lib/common.sh and
// scripts/lib/component-resolve.sh) and their TypeScript twins over the same sandbox, for the
// conformance suites of spec 0255 (row F2). POSIX only by design: it spawns `bash`, and it
// retires with the shell libraries (row J4).
//
// Each side gets its OWN sandbox built from the same layout, so a prune on one side cannot
// hide a difference on the other. Both sides report `{ status, stdout, stderr }`, the sandbox
// path is the only thing normalised, and the tree left on disk is compared too.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The suites skip on Windows: they spawn `bash`. */
export const SKIP: string | false =
  process.platform === "win32" ? "spawns bash: Linux and macOS only" : false;

/** What one side of a case produced. */
export interface Side {
  status: number;
  stdout: string;
  stderr: string;
  /** Every path left under the sandbox, sorted, relative to it. */
  tree: string[];
}

/** A sandbox layout: `path` to content; a path ending in `/` is a directory. */
export type Layout = Readonly<Record<string, string>>;

const made: string[] = [];
export const cleanup = (): void => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
};

/** Build `layout` in a fresh real-path directory; `package.json` keeps `node` quiet on `.ts` stubs. */
export function sandbox(layout: Layout): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "twins-conf-")));
  made.push(dir);
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  for (const [rel, content] of Object.entries(layout)) {
    const target = path.join(dir, rel);
    if (rel.endsWith("/")) fs.mkdirSync(target, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }
  return dir;
}

/** Dangling or not, every entry below `dir` (a link is listed, not followed). */
function listTree(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
    const sub = path.posix.join(rel, name);
    out.push(sub);
    if (fs.lstatSync(path.join(dir, sub)).isDirectory()) out.push(...listTree(dir, sub));
  }
  return out;
}

const scrub = (text: string, sb: string): string => text.replaceAll(sb, "<SB>");

/** The shell side: `body` runs after both libraries are sourced, `$SB` is the sandbox. */
export function runShell(layout: Layout, body: string, env: Record<string, string> = {}): Side {
  const sb = sandbox(layout);
  const script = [
    "set +e",
    'INSTALL_MODE="copy"',
    `SB=${JSON.stringify(sb)}`,
    'REPO_DIR="$SB"',
    `. ${JSON.stringify(path.join(REPO, "scripts/lib/common.sh"))}`,
    `. ${JSON.stringify(path.join(REPO, "scripts/lib/component-resolve.sh"))}`,
    'dump() { echo "$#"; local l; for l in "$@"; do echo "[$l]"; done; }',
    'rec() { echo "install $1"; case "$1" in *fail*) return 7 ;; esac; return 0; }',
    body,
  ].join("\n");
  const res = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    cwd: sb,
    env: { ...process.env, ...env, LC_ALL: "C", HOME: sb },
  });
  return {
    status: res.status ?? -1,
    stdout: scrub(res.stdout, sb),
    stderr: scrub(res.stderr, sb),
    tree: listTree(sb),
  };
}

/** What a twin callback writes to: both streams are collected whole. */
export interface Streams {
  readonly sb: string;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

/** The twin side: `fn` returns the status; `env` is set on this process for the child stubs. */
export function runTwin(
  layout: Layout,
  fn: (s: Streams) => number,
  env: Record<string, string> = {},
): Side {
  const sb = sandbox(layout);
  const [out, err] = [[] as string[], [] as string[]];
  const before = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    const status = fn({ sb, out: (t) => void out.push(t), err: (t) => void err.push(t) });
    return {
      status,
      stdout: scrub(out.join(""), sb),
      stderr: scrub(err.join(""), sb),
      tree: listTree(sb),
    };
  } finally {
    for (const [k, v] of Object.entries(before))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
}

/** `dump` of the shell, for the twin: the count then each item in brackets. */
export const dump = (items: readonly string[]): string =>
  `${items.length}\n${items.map((i) => `[${i}]\n`).join("")}`;

/** Assert the twin equals the shell on every observable; a difference names the field. */
export function same(shell: Side, twin: Side): void {
  assert.deepEqual(
    { status: twin.status, stdout: twin.stdout, stderr: twin.stderr, tree: twin.tree },
    { status: shell.status, stdout: shell.stdout, stderr: shell.stderr, tree: shell.tree },
  );
}

/** A `build-components` stub pair: the shell runs the `.sh`, the twin spawns the `.ts`. */
export const STUBS: Layout = {
  "scripts/build-components.sh": [
    'D="$(cd "$(dirname "$0")/.." && pwd -P)"',
    'echo "stub-out: $*"; echo "stub-err" >&2',
    '[ -n "$STUB_POPULATE" ] && mkdir -p "$D/$STUB_POPULATE"',
    'exit "${STUB_STATUS:-0}"',
    "",
  ].join("\n"),
  "scripts/build-components.ts": [
    'import fs from "node:fs";',
    'import path from "node:path";',
    'const d = path.resolve(import.meta.dirname, "..");',
    "console.log(`stub-out: ${process.argv.slice(2).join(' ')}`);",
    "console.error('stub-err');",
    "const p = process.env['STUB_POPULATE'];",
    "if (p) fs.mkdirSync(path.join(d, p), { recursive: true });",
    "process.exit(Number(process.env['STUB_STATUS'] ?? 0));",
    "",
  ].join("\n"),
};
