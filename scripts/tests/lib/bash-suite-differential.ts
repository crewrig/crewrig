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
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareLegs,
  type DiffCase,
  type DiffResult,
  type Layout,
  type SideCtx,
} from "./differential-compare.ts";
import { makeSandbox, RECORD_DIR, type Side } from "./differential-sandbox.ts";
import { createScratchRemote, type ScratchRemote, writeStubGh } from "./scratch-remote.ts";

export type { DiffCase, DiffResult, Leg, SideCtx } from "./differential-compare.ts";
export { compareLegs } from "./differential-compare.ts";

const HERE = fileURLToPath(import.meta.url);

export interface Differential {
  readonly root: string;
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
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "differential-")));
  const a = makeSandbox(path.join(root, "shell"));
  const b = makeSandbox(path.join(root, "ts"));
  const scratch = {
    shell: createScratchRemote(root, "shell-scratch"),
    ts: createScratchRemote(root, "ts-scratch"),
  };
  const layout: Layout = {
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
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
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
 * record file: one JSON line per call.
 */
export function installWrapper(d: Differential, name: string): string {
  const shellRel = `scripts/${name}.sh`;
  const original = path.join(d.a, shellRel);
  fs.renameSync(original, `${original}.shell`);
  const record = path.join(d.root, "diff-record.jsonl");
  fs.writeFileSync(record, "");
  const cfgDir = path.join(d.a, RECORD_DIR);
  fs.mkdirSync(cfgDir, { recursive: true });
  const cfg = {
    a: d.a,
    b: d.b,
    record,
    name,
    tsCommand: d.layout.tsCommand,
    scratch: d.layout.scratch,
  };
  fs.writeFileSync(path.join(cfgDir, `${name}.json`), JSON.stringify(cfg));
  const wrapper = `#!/usr/bin/env bash\nexec node "${HERE}" "$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)/../${RECORD_DIR}/${name}.json" "$@"\n`;
  fs.writeFileSync(original, wrapper, { mode: 0o755 });
  return record;
}

// Wrapper entry: node bash-suite-differential.ts <config.json> [args...]
if (import.meta.main) {
  const cfg = JSON.parse(fs.readFileSync(process.argv[2] ?? "", "utf8")) as {
    a: string;
    b: string;
    record: string;
    name: string;
    tsCommand: string[];
    scratch: Record<Side, ScratchRemote>;
  };
  const shellRel = `scripts/${cfg.name}.sh`;
  const cwd = process.cwd();
  const inside = cwd === cfg.a || cwd.startsWith(cfg.a + path.sep);
  const stdin = process.stdin.isTTY ? "" : fs.readFileSync(0).toString("latin1");
  const res = compareLegs(
    {
      a: cfg.a,
      b: cfg.b,
      scratch: cfg.scratch,
      shellFile: `${shellRel}.shell`,
      tsFile: shellRel.replace(/\.sh$/, ".ts"),
      tsCommand: cfg.tsCommand,
      exclude: [shellRel, `${shellRel}.shell`],
      record: cfg.record,
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
