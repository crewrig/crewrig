// setup-golden-run.ts — run one golden case in a fresh sandbox and capture its observable result
// (spec 0256 requirement 7, plan v2 step A5). The shell setups only ever run through
// `createSetupSandbox(...).run(...)`: HOME and USERPROFILE point into the sandbox, PATH is the
// sandbox `bin` (stubs first, then the real tools a case names).

import fs from "node:fs";
import path from "node:path";

import type { Cli, GoldenCase } from "./setup-golden-types.ts";
import type { FzfRecord } from "./setup-stubs.ts";
import { installStubs } from "./setup-stubs.ts";
import {
  baseStubs,
  commonTools,
  seedMempalaceVenv,
  startChromaHeartbeat,
} from "./setup-golden-common.ts";
import { createSetupSandbox } from "./setup-sandbox.ts";
import type { Leg } from "./setup-sandbox.ts";
import { bakCountOf, normalize, snapshot, treeOf } from "./setup-golden-tree.ts";
import type { TreeEntry } from "./setup-golden-tree.ts";

/** Everything a golden fixture stores for one case on one leg; text is already placeholdered. */
export interface CaseResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly tree: readonly TreeEntry[];
  /** `.bak.<STAMP>` files per backed-up target. */
  readonly bakCount: Readonly<Record<string, number>>;
  readonly fzfRecords: readonly FzfRecord[];
}

/** The real tools exposed by default; a case adds more (`python3`) through `GoldenCase.tools`. */
export const DEFAULT_TOOLS: readonly string[] = ["jq", "git"];

/** The entry name of a setup: `setup-claude-interactive`. */
export const entryOf = (cli: Cli): string => `setup-${cli}-interactive`;

/** First executable regular file named `name` on the real PATH, or undefined. */
function realTool(name: string): string | undefined {
  for (const dir of (process.env["PATH"] ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, name);
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep scanning
    }
  }
  return undefined;
}

/**
 * Symlink the named real tools into `bin`. A name already present (a stub) wins, so a symlink is
 * never written through; a tool absent from the host PATH is skipped (the suite guards on `jq`).
 */
function exposeTools(bin: string, names: readonly string[]): void {
  for (const name of names) {
    const target = path.join(bin, name);
    if (fs.existsSync(target)) continue;
    const real = realTool(name);
    if (real !== undefined) fs.symlinkSync(real, target);
  }
}

/** Build a sandbox for the case, run its setup on `leg`, return the normalised observable result. */
export function runCase(c: GoldenCase, leg: Leg): CaseResult {
  const sb = createSetupSandbox(c.sandbox);
  try {
    const stubs = installStubs(sb.bin, c.stubs);
    exposeTools(sb.bin, c.tools ?? DEFAULT_TOOLS);
    const before = snapshot(sb);
    c.seed?.(sb);
    const res = sb.run(entryOf(c.cli), c.args ?? [], {
      leg,
      ...(c.stdin === undefined ? {} : { stdin: c.stdin }),
      ...(c.env === undefined ? {} : { env: c.env }),
    });
    const tree = treeOf(sb, before);
    const text = (value: string): string => normalize(value, sb);
    return {
      status: res.status,
      stdout: text(res.stdout),
      stderr: text(res.stderr),
      tree,
      bakCount: bakCountOf(tree),
      fzfRecords: stubs.fzfRecords().map((r) => ({
        ...r,
        header: text(r.header),
        options: r.options.map(text),
        answer: text(r.answer),
      })),
    };
  } finally {
    sb.dispose();
  }
}

/**
 * Run a real setup cell: the default stubs of the CLI under the case's own (a case's fzf answers
 * override the defaults per header), the common real tools, the pipx venv seed unless MemPalace is
 * declared missing, and a loopback Chroma heartbeat for `install_chroma_daemon`.
 */
export async function runSetupCase(c: GoldenCase, leg: Leg): Promise<CaseResult> {
  const base = baseStubs(c.cli);
  const stubs = { ...base, ...c.stubs, fzf: { ...base.fzf, ...c.stubs?.fzf } };
  const beat = await startChromaHeartbeat();
  try {
    return runCase(
      {
        ...c,
        stubs,
        tools: [...commonTools, ...(c.tools ?? [])],
        env: { MEMPALACE_CHROMA_PORT: String(beat.port), ...c.env },
        seed: (sb) => {
          if (stubs.mempalaceMissing !== true) seedMempalaceVenv(sb);
          c.seed?.(sb);
        },
      },
      leg,
    );
  } finally {
    beat.stop();
  }
}
