// worktree-guard-bash-port.test.ts — the TypeScript port of
// scripts/tests/test-worktree-git-guard.sh (spec 0260, row J1a; spec 0153 R2,
// spec 0116 delta-03 R29). The nine Bash cases run through the TypeScript entry
// and through the `.sh` shim. The Bash suite got "no claim" by accident (the
// process cwd was whatever checkout ran it); here the claim state is explicit:
// the fixture worktree is unclaimed, and a non-repo process cwd gives the
// undetermined state, which must refuse too (never read as `claimed`).
// The file name joins the `worktree-*.test.ts` CI glob.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { applyMutation, copyTracked, type MutationCopy } from "./lib/mutation-copy.ts";
import { isAntigravityInput } from "./lib/guard-asserts.ts";
import { requireOrSkip } from "./lib/capability.ts";
import {
  cleanEnv,
  cleanupAll,
  GUARD_SH,
  makeFixture,
  realTmp,
  REPO,
  runGuard,
  SKIP_POSIX,
  which,
  writeClaim,
  type Fixture,
  type Result,
} from "./lib/worktree-fixtures.ts";

interface Row {
  readonly id: string;
  readonly name: string;
  readonly expected: 0 | 1;
  readonly payload: (wt: string, elsewhere: string) => string;
  /** Process cwd: the unclaimed fixture worktree, or a non-repo directory (undetermined state). */
  readonly proc: "wt" | "bare";
}

const cmd = (command: string, cwd: string): string =>
  JSON.stringify({ cwd, tool_input: { command } });
const agy = (args: unknown): string => JSON.stringify({ toolCall: { name: "run_command", args } });

const ROWS: readonly Row[] = [
  // case-1
  {
    id: "1",
    name: "outside scope",
    expected: 0,
    proc: "wt",
    payload: (_w, e) => cmd("git reset --hard", e),
  },
  // case-2
  { id: "2", name: "safe command", expected: 0, proc: "wt", payload: (w) => cmd("git status", w) },
  // case-3
  {
    id: "3",
    name: "reset refused",
    expected: 1,
    proc: "wt",
    payload: (w) => cmd("git reset --hard", w),
  },
  // case-3, undetermined claim state (process cwd is no repository)
  {
    id: "3u",
    name: "reset refused, claim undetermined",
    expected: 1,
    proc: "bare",
    payload: (w) => cmd("git reset --hard", w),
  },
  // case-4
  {
    id: "4",
    name: "clean refused",
    expected: 1,
    proc: "wt",
    payload: (w) => cmd("git clean -fd", w),
  },
  // agy-R29: CommandLine refused
  {
    id: "5",
    name: "agy CommandLine",
    expected: 1,
    proc: "wt",
    payload: () => agy({ CommandLine: "git reset --hard" }),
  },
  // agy-R29: CommandLine wins over other args text (case 5b, strengthening: discriminates the CommandLine extraction)
  {
    id: "5b",
    name: "agy CommandLine wins over args text",
    expected: 0,
    proc: "wt",
    payload: () => agy({ CommandLine: "git status", Reason: "git reset --hard" }),
  },
  // agy-R29: CommandLine git status allowed
  {
    id: "6",
    name: "agy safe",
    expected: 0,
    proc: "wt",
    payload: () => agy({ CommandLine: "git status" }),
  },
  // agy-R29: CommandLine git stash refused
  {
    id: "7",
    name: "stash refused",
    expected: 1,
    proc: "wt",
    payload: () => agy({ CommandLine: "git stash" }),
  },
  // agy-R29: .toolCall.args object-text
  {
    id: "8",
    name: "args object",
    expected: 1,
    proc: "wt",
    payload: () => agy({ cmd: "git reset --hard" }),
  },
  // agy-workspacePaths
  {
    id: "9",
    name: "workspacePaths",
    expected: 1,
    proc: "bare",
    payload: (w) =>
      JSON.stringify({
        workspacePaths: [w],
        toolCall: { name: "run_command", args: { CommandLine: "git clean -fd" } },
      }),
  },
];

let fx: Fixture;
let bare: string;
let elsewhere: string;

before(() => {
  fx = makeFixture({ ticket: "771" });
  bare = realTmp("crewrig-guard-port-bare-");
  elsewhere = path.join(realTmp("crewrig-guard-port-out-"), "some-dir");
});
after(cleanupAll);

/** The contract of a row: the status, silence on allow, a `worktree` diagnostic on refuse. */
function meets(row: Row, res: Result, input: string): boolean {
  if (res.status !== row.expected) return false;
  // An allow answers `ask` to an Antigravity payload and stays silent otherwise (spec 0248 R40, R42).
  const stdout = isAntigravityInput(input) ? '{"decision": "ask"}\n' : "";
  return row.expected === 0
    ? res.stdout === stdout && res.stderr === ""
    : res.stdout === "" && res.stderr.includes("worktree");
}

const procCwd = (row: Row): string => (row.proc === "wt" ? fx.wt : bare);

describe("TypeScript entry", () => {
  for (const row of ROWS) {
    test(`case ${row.id}: ${row.name}`, () => {
      const input = row.payload(fx.wt, elsewhere);
      const res = runGuard(input, { cwd: procCwd(row) });
      assert.equal(res.status, row.expected, `${res.stdout}${res.stderr}`);
      assert.ok(meets(row, res, input), `contract of case ${row.id}`);
    });
  }
});

const COPY = (): MutationCopy =>
  copyTracked(REPO, [
    "package.json",
    "hooks/worktree-git-guard.ts",
    "scripts/lib/worktree-claim",
    "scripts/lib/paths.ts",
  ]);
const REFUSE = 'process.stderr.write("worktree\\n"); process.exitCode = 1; return;';
const MUTANTS: readonly {
  readonly id: string;
  readonly edits: readonly (readonly [string, string])[];
  readonly red: readonly string[];
}[] = [
  {
    id: "G1 allow everywhere",
    edits: [["if (!prohibited) return allow();", "return allow();"]],
    red: ["3", "3u", "4", "5", "7", "8", "9"],
  },
  {
    id: "G2 undetermined read as claimed",
    edits: [['allowed = claim.state === "claimed";', 'allowed = claim.state !== "unclaimed";']],
    red: ["3u", "9"],
  },
  {
    id: "G3 drop CommandLine extraction",
    edits: [['["toolCall", "args", "CommandLine"],', ""]],
    red: ["5b"], // case 5 alone stays green: the args-text fallback also matches (spec table says 5)
  },
  { id: "G4 drop object-text fallback", edits: [['["toolCall", "args"],', ""]], red: ["8"] },
  {
    id: "G5 drop workspacePaths[0]",
    edits: [['["project_dir"], ["workspacePaths", 0]]', '["project_dir"]]']],
    red: ["9"],
  },
  {
    id: "G6 stash exemption widened",
    edits: [["!stashReads.some((verb) => command.includes(`git stash ${verb}`))", "false"]],
    red: ["7"],
  },
  {
    id: "G7 refuse outside .worktrees",
    edits: [["if (at === -1) return allow();", `if (at === -1) { ${REFUSE} }`]],
    red: ["1"],
  },
  {
    id: "G8 refuse safe commands",
    edits: [["if (!prohibited) return allow();", `if (!prohibited) { ${REFUSE} }`]],
    red: ["2", "6"],
  },
];

describe("mutation: the nine cases catch a broken guard", () => {
  let copy: MutationCopy | undefined;
  after(() => copy?.dispose());

  for (const mutant of MUTANTS) {
    test(mutant.id, () => {
      const mutated = COPY();
      copy = mutated;
      try {
        for (const [needle, replacement] of mutant.edits) {
          applyMutation(mutated, "hooks/worktree-git-guard.ts", needle, replacement);
        }
        const entry = path.join(mutated.root, "hooks", "worktree-git-guard.ts");
        const failing = ROWS.filter((row) => {
          const input = row.payload(fx.wt, elsewhere);
          return !meets(row, runGuard(input, { cwd: procCwd(row), entry }), input);
        }).map((row) => row.id);
        for (const id of mutant.red)
          assert.ok(
            failing.includes(id),
            `${mutant.id}: case ${id} stayed green (red: ${failing.join(",")})`,
          );
      } finally {
        mutated.dispose();
      }
    });
  }

  test("the unmutated copy is green (controls the mutation harness)", () => {
    const mutated = COPY();
    try {
      const entry = path.join(mutated.root, "hooks", "worktree-git-guard.ts");
      // A planted claim must allow: proves the claim module graph loads in the copy,
      // so a refusal is a decision and not a failed import.
      const claimed = makeFixture({ ticket: "771" });
      writeClaim(claimed, { holder: "alice" });
      const ok = runGuard(cmd("git reset --hard", claimed.wt), { cwd: claimed.wt, entry });
      assert.equal(ok.status, 0, ok.stderr);
      for (const row of ROWS) {
        const input = row.payload(fx.wt, elsewhere);
        const res = runGuard(input, { cwd: procCwd(row), entry });
        assert.ok(meets(row, res, input), `case ${row.id} red on the pristine copy: ${res.stderr}`);
      }
    } finally {
      mutated.dispose();
    }
  });

  test("a missing needle fails", () => {
    const mutated = copyTracked(REPO, ["hooks/worktree-git-guard.ts"]);
    try {
      assert.throws(
        () => applyMutation(mutated, "hooks/worktree-git-guard.ts", "no such text", "x"),
        /absent/,
      );
    } finally {
      mutated.dispose();
    }
  });
});
