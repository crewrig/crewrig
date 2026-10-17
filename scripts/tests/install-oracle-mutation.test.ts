// install-oracle-mutation.test.ts — mutation proof for the install oracle (spec 0255 delta-01,
// spec 0263 requirement 20): each mutant is applied to a FULL COPY of the repository, the
// TypeScript suites that replaced the Bash tier-resolution and antigravity suites run there
// with `node --test`, and the named tests must go red. A mutation target that no longer
// exists fails loudly (nothing is silently mutated). The copy keeps its own `.git` and a REAL
// (dereferenced) closure of the production dependencies, like createFixtureTree.
// POSIX-only: the suites under test spawn bash.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  R19,
  rewriteEntry,
  TASKFILE_MUTANTS,
  tasklessPath,
} from "./lib/oracle-taskfile-mutants.ts";
import {
  cleanup,
  type Mutation,
  runFiles,
  stageCopy,
  stageTemplate,
  track,
} from "./lib/oracle-ts-runner.ts";

const named = (names: readonly string[]): string[] =>
  names.map((n) => `scripts/tests/${n}.test.ts`);
const TIER = named([
  "tier-resolution-collision",
  "tier-resolution-declarations",
  "tier-resolution-install",
  "tier-resolution-landing",
  "tier-resolution-taskfile",
  "tier-resolution-three-tiers",
]);
const AGY = named([
  "antigravity-common-sh",
  "antigravity-common-sh-migrate",
  "antigravity-manage-sandbox",
  "antigravity-tier-twin",
  "print-manage-declarations", // G17/G18: the declarations the sandbox suite does not read
]);
const SUITES: Readonly<Record<string, readonly string[]>> = { tier: TIER, agy: AGY };
const DESCRIPTORS = "scripts/lib/manage/descriptors.ts";
const ROOTS = "scripts/lib/component-roots.ts";
const OVERLAY = "scripts/lib/manage/overlay-loop.ts";
const HELPER = "scripts/tests/lib/print-manage-declarations.ts";
const GUARD = "deps.place.placed.length > 0";
const CALL = '"skills",\n      deps.place.placed,';

interface Mutant extends Mutation {
  /** suite -> lowercase substrings of the test labels that must go red. */
  readonly red: Readonly<Record<string, readonly string[]>>;
}

/**
 * Every mutant changes what the TypeScript implementation really installs, and the declaration
 * tests of other files read the same sources, so other tests may legitimately go red too: only
 * the named ones are required.
 */
const MUTANTS: readonly Mutant[] = [
  {
    id: "1 gemini staging root",
    file: DESCRIPTORS,
    from: 'staged("skills", ".gemini/skills", ".gemini/skills", "gemini")',
    to: 'staged("skills", ".gemini/skills-x", ".gemini/skills", "gemini")',
    red: { tier: ["r20/r2+r5"] },
  },
  {
    id: "2 org tier dropped",
    file: ROOTS,
    from: '["library", "community", "org"]',
    to: '["library", "community"]',
    red: { tier: ["r20/r2+r5"] },
  },
  {
    id: "3 antigravity skills destination",
    file: DESCRIPTORS,
    from: '".agents/skills", ".gemini/config/skills", "antigravity"',
    to: '".agents/skills", ".gemini/config/skills-x", "antigravity"',
    red: { tier: ["r20/r1"], agy: ["g19/g20"] },
  },
  {
    id: "4 antigravity customization root",
    file: DESCRIPTORS,
    from: 'customizationRoot: ".gemini/config",',
    to: 'customizationRoot: ".gemini/config-x",',
    red: { agy: ["destinations and roots are in sentinel form"] },
  },
  {
    id: "5 migration guard unreachable (placed.length > 99)",
    file: OVERLAY,
    from: GUARD,
    to: "deps.place.placed.length > 99",
    red: { agy: ["g19/g20"] },
  },
  {
    id: "6 migration called with no names (every served name)",
    file: OVERLAY,
    from: CALL,
    to: '"skills",\n      [],',
    red: { agy: ["g19/g20"] },
  },
  {
    id: "7 empty helper output",
    file: HELPER,
    from: null,
    to: "",
    red: {
      tier: ["the manage declaration helper prints facts", "r20/r1", "r20/r2+r5"],
      agy: ["print-manage-declarations.test.ts"],
    },
  },
];

const hasBash = process.platform !== "win32" && spawnSync("bash", ["--version"]).status === 0;
after(cleanup);

/** The number of tests a TAP run reported as passed. */
const passed = (out: string): number => Number(/^# pass (\d+)/m.exec(out)?.[1] ?? 0);

describe("install oracle mutation", { skip: !hasBash }, () => {
  test("every mutant turns its named tests red, in the suite it concerns", async () => {
    const template = stageTemplate();
    const jobs: { mutant: Mutant | null; suite: string }[] = [];
    for (const suite of Object.keys(SUITES)) jobs.push({ mutant: null, suite });
    for (const mutant of MUTANTS) {
      for (const suite of Object.keys(mutant.red)) jobs.push({ mutant, suite });
    }
    const results = await Promise.all(
      jobs.map(async ({ mutant, suite }) =>
        runFiles(stageCopy(template, mutant), SUITES[suite] ?? []),
      ),
    );
    const problems: string[] = [];
    jobs.forEach((job, i) => {
      const { mutant, suite } = job;
      const run = results[i];
      if (run === undefined) return;
      if (mutant === null) {
        // Non-vacuity: a green baseline must have run tests, not skipped them all.
        if (run.status !== 0 || run.fails.length > 0 || passed(run.out) < 10) {
          problems.push(`baseline of ${suite} is not green: ${run.fails.join("; ") || run.status}`);
        }
        return;
      }
      for (const want of mutant.red[suite] ?? []) {
        if (!run.fails.some((f) => f.toLowerCase().includes(want))) {
          problems.push(`mutant ${mutant.id}: ${suite} stayed green on "${want}"`);
        }
      }
    });
    if (problems.length > 0) throw new Error(problems.join("\n"));
  });

  // Spec 0255 delta-03: the R19 test reads a Taskfile entry written as `cmds:`. The entry
  // `install-workspace` of each copy is rewritten into the two-command form, then one mutant
  // is applied; go-task is hidden so the fallback runner (the CI condition) is what runs.
  test("the R19 test goes red for each Taskfile mutant of the cmds: form", async () => {
    const template = stageTemplate();
    const bin = track(tasklessPath());
    const taskfile = ["scripts/tests/tier-resolution-taskfile.test.ts"];
    const prepare = (mutant: (typeof TASKFILE_MUTANTS)[number] | null) => {
      const dir = stageCopy(template, null);
      const file = path.join(dir, "Taskfile.yml");
      fs.writeFileSync(file, rewriteEntry(fs.readFileSync(file, "utf8"), mutant));
      return dir;
    };
    const runs = await Promise.all(
      [null, ...TASKFILE_MUTANTS].map((m) => runFiles(prepare(m), taskfile, bin)),
    );
    const [base, ...mutated] = runs;
    if (base?.status !== 0 || passed(base.out) < 5) {
      throw new Error(`cmds: baseline is not green (${base?.fails.join("; ")})`);
    }
    const problems: string[] = [];
    mutated.forEach((run, i) => {
      const mutant = TASKFILE_MUTANTS[i];
      if (mutant === undefined) return;
      if (!run.fails.some((f) => f.toLowerCase().includes(R19))) {
        problems.push(`mutant ${mutant.id}: the R19 test stayed green`);
      } else if (!run.out.toLowerCase().includes(mutant.detail)) {
        problems.push(`mutant ${mutant.id}: red, but not by "${mutant.detail}"`);
      }
      for (const f of run.fails) {
        if (!f.toLowerCase().includes(R19)) problems.push(`mutant ${mutant.id}: regressed ${f}`);
      }
    });
    if (problems.length > 0) throw new Error(problems.join("\n"));
  });
});
