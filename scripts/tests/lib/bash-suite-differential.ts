// bash-suite-differential.ts — runs a Bash script and its TypeScript twin in TWO isolated
// sandboxes (shell copy, TS copy) with identical argv, stdin and environment, and compares
// stdout, stderr, status AND the state left behind (spec 0262 req 21, PLAN v4 F1).
//
// Two entry points:
//   * runDifferential / createDifferential: in-process, one case at a time (see DiffCase).
//   * installWrapper: replaces scripts/<name>.sh of a sandbox by a wrapper (original kept at
//     scripts/<name>.sh.shell) so an UNCHANGED Bash suite drives both implementations. The
//     wrapper runs shell in copy A and `node scripts/<name>.ts` in the mirrored copy B, exits with
//     the shell's result and appends a JSON line per call to the diff record file.
// Windows: the shell legs need bash; callers skip on win32.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareLegs,
  type DiffCase,
  type DiffResult,
  type Layout,
  type SideCtx,
} from "./differential-compare.ts";
import { assertInside, assertRoot, createRoot } from "./differential-guard.ts";
import { makeSandbox, RECORD_DIR, type Side } from "./differential-sandbox.ts";
import { createScratchRemote, type ScratchRemote, writeStubGh } from "./scratch-remote.ts";

export type { DiffCase, DiffResult, Leg, SideCtx } from "./differential-compare.ts";
export { compareLegs } from "./differential-compare.ts";

const HERE = fileURLToPath(import.meta.url);

export interface Differential {
  readonly root: string;
  /** The root's own temp directory: give it to a suite as TMPDIR (see `tmpEnv`). */
  readonly tmp: string;
  readonly a: string;
  readonly b: string;
  readonly ctx: Record<Side, SideCtx>;
  readonly layout: Layout;
  run(c: DiffCase): DiffResult;
  cleanup(): void;
}

/** Two isolated sandboxes plus a scratch remote/HOME/bin per side; `setup` runs once per side. */
export function createDifferential(
  c: DiffCase,
  opts: { setup?: (ctx: SideCtx) => void; stubGh?: boolean; record?: string } = {},
): Differential {
  const root = createRoot();
  const a = makeSandbox(root, path.join(root, "shell"));
  const b = makeSandbox(root, path.join(root, "ts"));
  const scratch = {
    shell: createScratchRemote(root, "shell-scratch"),
    ts: createScratchRemote(root, "ts-scratch"),
  };
  const layout: Layout = {
    root,
    a,
    b,
    scratch,
    shellFile: c.script,
    tsFile: c.tsScript ?? c.script.replace(/\.sh$/, ".ts"),
    tsCommand: c.tsCommand ?? ["node"],
    exclude: [c.script, `${c.script}.shell`],
    ...(opts.record ? { record: opts.record } : {}),
  };
  const ctx = {
    shell: { side: "shell", root: a, scratch: scratch.shell },
    ts: { side: "ts", root: b, scratch: scratch.ts },
  } as const;
  for (const side of ["shell", "ts"] as const) {
    if (opts.stubGh) writeStubGh(scratch[side].bin);
    opts.setup?.(ctx[side]);
  }
  return {
    root,
    tmp: path.join(root, "tmp"),
    a,
    b,
    ctx,
    layout,
    run: (next) =>
      compareLegs(
        {
          ...layout,
          exclude: [next.script, `${next.script}.shell`],
          shellFile: next.script,
          tsFile: next.tsScript ?? next.script.replace(/\.sh$/, ".ts"),
        },
        next,
      ),
    cleanup: () => {
      assertRoot(root);
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/** One-shot convenience: build, run once, tear down. */
export function runDifferential(
  c: DiffCase & { setup?: (ctx: SideCtx) => void; stubGh?: boolean },
): DiffResult {
  const d = createDifferential(c, {
    ...(c.setup ? { setup: c.setup } : {}),
    ...(c.stubGh ? { stubGh: true } : {}),
  });
  try {
    return d.run(c);
  } finally {
    d.cleanup();
  }
}

/**
 * Install the wrapper at `<d.a>/scripts/<name>.sh`, keeping the original bytes at
 * `scripts/<name>.sh.shell`. An unchanged Bash suite that runs the script from `d.a` then drives
 * the shell in `d.a` and the TS twin in `d.b` (mirrored before each call). Returns the diff
 * record file: one JSON line per call. `compareState: false` = pure-checker mode (no per-call
 * mirror nor tree digests; see DiffCase.compareState).
 */
export function installWrapper(
  d: Differential,
  name: string,
  opts: { compareState?: boolean } = {},
): string {
  const shellRel = `scripts/${name}.sh`;
  const original = path.join(d.a, shellRel);
  assertInside(d.root, original);
  fs.renameSync(original, `${original}.shell`);
  const record = path.join(d.root, "diff-record.jsonl");
  assertInside(d.root, record);
  fs.writeFileSync(record, "");
  const cfgDir = path.join(d.a, RECORD_DIR);
  fs.mkdirSync(cfgDir, { recursive: true });
  const cfg = {
    root: d.root,
    a: d.a,
    b: d.b,
    record,
    name,
    tsCommand: d.layout.tsCommand,
    scratch: d.layout.scratch,
    compareState: opts.compareState !== false,
  };
  fs.writeFileSync(path.join(cfgDir, `${name}.json`), JSON.stringify(cfg));
  const wrapper = `#!/usr/bin/env bash\nexec node "${HERE}" "$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)/../${RECORD_DIR}/${name}.json" "$@"\n`;
  fs.writeFileSync(original, wrapper, { mode: 0o755 });
  return record;
}

export const LOCK_TIMEOUT_MS = 120_000;

/**
 * Take the call lock (a directory) inside `root`, waiting at most `timeoutMs`. A lock already
 * older than the timeout when first met is stale and is removed (only ever inside `root`); a
 * fresh one that outlasts the wait fails with an error naming the lock path.
 */
export function acquireLock(root: string, lock: string, timeoutMs = LOCK_TIMEOUT_MS): void {
  assertRoot(root);
  assertInside(root, lock);
  const deadline = Date.now() + timeoutMs;
  let checkedStale = false;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    if (!checkedStale) {
      checkedStale = true;
      const st = fs.statSync(lock, { throwIfNoEntry: false });
      if (st !== undefined && Date.now() - st.mtimeMs > timeoutMs) {
        fs.rmSync(lock, { recursive: true, force: true });
        continue;
      }
    }
    if (Date.now() >= deadline)
      throw new Error(`timed out after ${timeoutMs} ms waiting for the lock ${lock}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
}

// Wrapper entry: node bash-suite-differential.ts <config.json> [args...]
if (import.meta.main) {
  const cfg = JSON.parse(fs.readFileSync(process.argv[2] ?? "", "utf8")) as {
    root: string;
    a: string;
    b: string;
    record: string;
    name: string;
    tsCommand: string[];
    scratch: Record<Side, ScratchRemote>;
    compareState?: boolean;
  };
  assertRoot(cfg.root);
  assertInside(cfg.root, cfg.a);
  assertInside(cfg.root, cfg.b);
  assertInside(cfg.root, cfg.record);
  const shellRel = `scripts/${cfg.name}.sh`;
  const cwd = process.cwd();
  const inside = cwd === cfg.a || cwd.startsWith(cfg.a + path.sep);
  const stdin = process.stdin.isTTY ? "" : fs.readFileSync(0).toString("latin1");
  // Calls are serialised: shared-repository isolation rewinds state, so two overlapping calls
  // (a suite's "concurrent sessions" cases) would corrupt each other. They run one after the other.
  const lock = `${cfg.record}.lock`;
  acquireLock(cfg.root, lock);
  process.on("exit", () => fs.rmSync(lock, { recursive: true, force: true }));
  const res = compareLegs(
    {
      root: cfg.root,
      a: cfg.a,
      b: cfg.b,
      scratch: cfg.scratch,
      shellFile: `${shellRel}.shell`,
      tsFile: shellRel.replace(/\.sh$/, ".ts"),
      tsCommand: cfg.tsCommand,
      exclude: [shellRel, `${shellRel}.shell`],
      record: cfg.record,
      compareState: cfg.compareState !== false,
    },
    {
      script: shellRel,
      args: process.argv.slice(3),
      stdin,
      cwd: inside ? path.relative(cfg.a, cwd) : ".",
    },
    true,
  );
  process.stdout.write(Buffer.from(res.shell.stdout, "latin1"));
  process.stderr.write(Buffer.from(res.shell.stderr, "latin1"));
  process.exitCode = res.shell.status ?? 1;
}
