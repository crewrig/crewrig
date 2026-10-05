// golden-replay.ts — replay a golden scenario against a claim tool and report
// what it did (spec 0248 R18, plan steps 19-20).
//
// A scenario is a list of steps over one fixture repository. Before each step
// optional operations shape the claim root (seed a state captured from the
// shell tool, plant a claim field, dirty the worktree); the step then runs one
// tool invocation, and its exit status, standard streams and the placeholdered
// state of the claim root are recorded.
//
// The same function produced the committed expectations (against the shell
// tool at 7302366, on macOS and Linux) and checks the TypeScript tool against
// them, so a divergence is a difference of two recordings of one procedure.

import fs from "node:fs";
import path from "node:path";

import {
  makeFixture,
  nowEpoch,
  placeholder,
  realTmp,
  snapshotClaimRoot,
  type Fixture,
  type PlaceholderContext,
  type Result,
} from "./worktree-fixtures.ts";

export type Op =
  | { readonly op: "seed"; readonly name: string }
  | { readonly op: "claimFile"; readonly file: string; readonly content: string }
  | { readonly op: "claimEpoch"; readonly offset: number }
  | { readonly op: "removeClaimFile"; readonly file: string }
  | { readonly op: "dirty"; readonly path: string }
  /** A claim directory with nothing in it: `[ -d ]` reads it as claimed (and git cannot commit it). */
  | { readonly op: "emptyClaim" };

export interface GoldenStep {
  readonly args: readonly string[];
  /** Where the tool runs. `outside` is a directory that is in no repository. Default `wt`. */
  readonly cwd?: "wt" | "main" | "sub" | "outside";
  /**
   * Environment overrides; `{WT}`, `{MAIN}`, `{SUB}` and `{COMMON}` stand for the fixture
   * directories and `{TOOL}` for the command line that runs the tool under test (so a
   * wrapped command can call the same implementation without naming it in its arguments).
   */
  readonly env?: Readonly<Record<string, string>>;
  readonly before?: readonly Op[];
}

export interface GoldenScenario {
  readonly id: string;
  readonly description: string;
  readonly steps: readonly GoldenStep[];
}

export interface GoldenOutcome {
  readonly exit: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** The claim root after the step: relative path to placeholdered content. */
  readonly files: Record<string, string>;
}

export type Runner = (
  args: readonly string[],
  options: { cwd: string; env: Record<string, string> },
) => Result;

function copyTree(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else fs.copyFileSync(source, target);
  }
}

function applyOp(fx: Fixture, op: Op, seedsDir: string): void {
  switch (op.op) {
    case "seed": {
      fs.rmSync(fx.claimRoot, { recursive: true, force: true });
      copyTree(path.join(seedsDir, op.name), fx.claimRoot);
      return;
    }
    case "claimFile":
      fs.writeFileSync(path.join(fx.claimDir, op.file), op.content);
      return;
    case "removeClaimFile":
      fs.rmSync(path.join(fx.claimDir, op.file), { force: true });
      return;
    case "claimEpoch":
      fs.writeFileSync(path.join(fx.claimDir, "since_epoch"), `${nowEpoch() + op.offset}\n`);
      return;
    case "emptyClaim":
      fs.rmSync(fx.claimDir, { recursive: true, force: true });
      fs.mkdirSync(fx.claimDir, { recursive: true });
      return;
    case "dirty": {
      const target = path.join(fx.wt, op.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "dirt\n");
      return;
    }
  }
}

/** Run every step of `scenario` in a fresh fixture and return what each did. */
export function replayScenario(
  scenario: GoldenScenario,
  runner: Runner,
  seedsDir: string,
  toolCommand: string,
): GoldenOutcome[] {
  const fx = makeFixture({ ticket: "736" });
  const outside = realTmp("crewrig-outside-");
  const ctx: PlaceholderContext = {
    main: fx.main,
    wt: fx.wt,
    common: fx.common,
    extra: { OUTSIDE: outside },
  };
  const dirs = { wt: fx.wt, main: fx.main, sub: fx.sub, outside };
  const outcomes: GoldenOutcome[] = [];
  try {
    for (const step of scenario.steps) {
      for (const op of step.before ?? []) applyOp(fx, op, seedsDir);
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(step.env ?? {})) {
        env[key] = value
          .replace("{WT}", fx.wt)
          .replace("{MAIN}", fx.main)
          .replace("{SUB}", fx.sub)
          .replace("{COMMON}", fx.common)
          .replace("{TOOL}", toolCommand);
      }
      const res = runner(step.args, { cwd: dirs[step.cwd ?? "wt"], env });
      outcomes.push({
        exit: res.status,
        stdout: placeholder(res.stdout, ctx),
        stderr: placeholder(res.stderr, ctx),
        files: snapshotClaimRoot(fx.claimRoot, ctx),
      });
    }
  } finally {
    fx.cleanup();
    fs.rmSync(outside, { recursive: true, force: true });
  }
  return outcomes;
}
