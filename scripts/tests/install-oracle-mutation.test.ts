// install-oracle-mutation.test.ts — mutation proof for the retargeted and the new Bash
// cases of two suites (spec 0255 delta-01, plan steps 18 and 22e): each mutant is applied
// to a FULL COPY of the repository, ONE Bash suite is run there, and the named case must
// go red while no other case regresses against the copy's own unmutated baseline. Since
// the switch (PR E) the Bash suites reach the TypeScript implementation through the
// forwarding shims, so every mutant lands on a TypeScript source or declaration. A
// mutation target that no longer exists fails loudly (nothing is silently mutated).
// Skipped on win32 and when bash is missing. The copy keeps its own `.git` and a REAL
// (dereferenced) closure of the production dependencies, like createFixtureTree.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { productionClosure, REPO } from "./lib/build-fixture-tree.ts";
import {
  R19,
  rewriteEntry,
  TASKFILE_MUTANTS,
  tasklessPath,
} from "./lib/oracle-taskfile-mutants.ts";

const TIER = "test-component-tier-resolution.sh";
const AGY = "test-antigravity-component-install.sh";
const DESCRIPTORS = "scripts/lib/manage/descriptors.ts";
const ROOTS = "scripts/lib/component-roots.ts";
const OVERLAY = "scripts/lib/manage/overlay-loop.ts";
const HELPER = "scripts/tests/lib/print-manage-declarations.ts";
const GUARD = "deps.place.placed.length > 0";
const CALL = '"skills",\n      deps.place.placed,';

interface Mutant {
  readonly id: string;
  readonly file: string;
  readonly from: string | null; // null: delete the file
  readonly to: string;
  /** suite -> lowercase substrings of the labels that must go red. */
  readonly red: Readonly<Record<string, readonly string[]>>;
  /**
   * The mutant changes what the TypeScript implementation really installs (it reads these
   * declarations itself), so other cases may legitimately go red too: only the named ones are
   * required. Without it, any other case that regresses against the baseline is an error.
   */
  readonly spill?: true;
}

const MUTANTS: readonly Mutant[] = [
  {
    id: "1 gemini staging root",
    spill: true,
    file: DESCRIPTORS,
    from: 'staged("skills", ".gemini/skills", ".gemini/skills", "gemini")',
    to: 'staged("skills", ".gemini/skills-x", ".gemini/skills", "gemini")',
    red: { [TIER]: ["r20/r2+r5"] },
  },
  {
    id: "2 org tier dropped",
    spill: true,
    file: ROOTS,
    from: '["library", "community", "org"]',
    to: '["library", "community"]',
    red: { [TIER]: ["r20/r2+r5"] },
  },
  {
    id: "3 antigravity skills destination",
    spill: true,
    file: DESCRIPTORS,
    from: '".agents/skills", ".gemini/config/skills", "antigravity"',
    to: '".agents/skills", ".gemini/config/skills-x", "antigravity"',
    red: { [TIER]: ["r20/r1"], [AGY]: ["r7: manage does not target"] },
  },
  {
    id: "4 antigravity customization root",
    spill: true,
    file: DESCRIPTORS,
    from: 'customizationRoot: ".gemini/config",',
    to: 'customizationRoot: ".gemini/config-x",',
    red: { [AGY]: ["no separate customization root"] },
  },
  {
    id: "5 migration guard unreachable (placed.length > 99)",
    file: OVERLAY,
    from: GUARD,
    to: "deps.place.placed.length > 99",
    red: { [AGY]: ["placed_names is never fed"] },
  },
  {
    id: "6 migration called with no names (every served name)",
    file: OVERLAY,
    from: CALL,
    to: '"skills",\n      [],',
    red: {
      [AGY]: ["reached a component this run did not place", "placement-less install removed"],
    },
  },
  {
    id: "7 empty helper output",
    file: HELPER,
    from: null,
    to: "",
    red: { [TIER]: ["r20/r1", "r20/r2+r5"], [AGY]: ["(vacuous:"] },
  },
];

/**
 * Baseline cases that are red BEFORE any mutation, per suite. Case 20 (R19) of the tier suite
 * extracts each Taskfile entry's `cmd:` by line number; PR E rewrote those entries to `cmds:`
 * lists, so that case cannot run (reported to the orchestrator; the oracle assertion itself is
 * untouched here). Any other red baseline case still fails the test.
 */
const KNOWN_RED: Readonly<Record<string, readonly string[]>> = {
  [TIER]: ["r19: all twelve documented task entry points"],
};

const hasBash = process.platform !== "win32" && spawnSync("bash", ["--version"]).status === 0;
const live: string[] = [];
after(() => {
  for (const dir of live) fs.rmSync(dir, { recursive: true, force: true });
});

function stageTemplate(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "oracle-mut-")));
  live.push(root);
  fs.cpSync(path.join(REPO, "scripts"), path.join(root, "scripts"), { recursive: true });
  for (const f of ["package.json", "Taskfile.yml"]) {
    fs.copyFileSync(path.join(REPO, f), path.join(root, f));
  }
  fs.mkdirSync(path.join(root, ".git"));
  for (const name of productionClosure()) {
    const from = path.join(REPO, "node_modules", name);
    const to = path.join(root, "node_modules", name);
    fs.cpSync(from, to, { recursive: true, dereference: true });
  }
  return root;
}

/** A fresh copy of the template with `mutant` applied (or none for the baseline). */
function stageCopy(template: string, mutant: Mutant | null): string {
  const dir = fs.mkdtempSync(path.join(template, "..", "oracle-run-"));
  live.push(dir);
  fs.cpSync(template, dir, { recursive: true });
  if (mutant === null) return dir;
  const target = path.join(dir, mutant.file);
  if (mutant.from === null) {
    fs.rmSync(target);
    return dir;
  }
  const text = fs.readFileSync(target, "utf8");
  if (!text.includes(mutant.from)) {
    throw new Error(`mutant ${mutant.id}: target text not found in ${mutant.file}`);
  }
  fs.writeFileSync(
    target,
    text.replace(mutant.from, () => mutant.to),
  );
  return dir;
}

/** Run one suite in `dir`; resolve with its exit status and the sorted labels that failed. */
function runSuite(
  dir: string,
  suite: string,
  pathOverride?: string,
): Promise<{ status: number | null; fails: string[]; out: string }> {
  const home = path.join(dir, "home");
  fs.mkdirSync(home, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, LC_ALL: "C" };
  if (pathOverride !== undefined) env["PATH"] = pathOverride;
  // The staged copy is a partial repository (no config/): the suites' TypeScript groups skip there off CI
  // and fail when CI is set (i1-F24), so the oracle runs them as a developer machine would.
  delete env["CI"];
  return new Promise((resolve) => {
    const child = spawn("bash", [path.join(dir, "scripts", "tests", suite)], { cwd: dir, env });
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.stderr.on("data", (c: Buffer) => (out += c.toString()));
    child.on("close", (status) => {
      const fails = out
        .split("\n")
        .map((l) => /^\s*FAIL: (.*)$/.exec(l)?.[1])
        .filter((l): l is string => l !== undefined)
        .sort();
      resolve({ status, fails, out });
    });
  });
}

describe("install oracle mutation", { skip: !hasBash }, () => {
  test("every mutant turns its named cases red, in the suite it concerns", async () => {
    const template = stageTemplate();
    const jobs: { mutant: Mutant | null; suite: string }[] = [];
    for (const suite of [TIER, AGY]) jobs.push({ mutant: null, suite });
    for (const mutant of MUTANTS) {
      for (const suite of Object.keys(mutant.red)) jobs.push({ mutant, suite });
    }
    const results = await Promise.all(
      jobs.map(async ({ mutant, suite }) => runSuite(stageCopy(template, mutant), suite)),
    );
    const baseline = new Map<string, string[]>();
    jobs.forEach((job, i) => {
      if (job.mutant === null) baseline.set(job.suite, results[i]?.fails ?? ["<no result>"]);
    });
    for (const suite of [TIER, AGY]) {
      const base = jobs.findIndex((j) => j.mutant === null && j.suite === suite);
      const stray = (results[base]?.fails ?? []).filter(
        (f) => !(KNOWN_RED[suite] ?? []).some((k) => f.toLowerCase().includes(k)),
      );
      if (
        stray.length > 0 ||
        (results[base]?.status !== 0 && (results[base]?.fails ?? []).length === 0)
      )
        throw new Error(
          `baseline of ${suite} is not green: ${stray.join("; ") || "no FAIL label"}`,
        );
    }
    const problems: string[] = [];
    jobs.forEach((job, i) => {
      const { mutant, suite } = job;
      if (mutant === null) return;
      const fails = results[i]?.fails ?? [];
      const known = baseline.get(suite) ?? [];
      const wanted = mutant.red[suite] ?? [];
      for (const want of wanted) {
        if (!fails.some((f) => f.toLowerCase().includes(want))) {
          problems.push(`mutant ${mutant.id}: ${suite} stayed green on "${want}"`);
        }
      }
      for (const f of fails) {
        const named = wanted.some((w) => f.toLowerCase().includes(w));
        if (!named && !known.includes(f) && mutant.spill !== true) {
          problems.push(`mutant ${mutant.id}: ${suite} regressed an unrelated case: ${f}`);
        }
      }
    });
    if (problems.length > 0) throw new Error(problems.join("\n"));
  });

  // Spec 0255 delta-03: the R19 case reads a Taskfile entry written as `cmds:`. The entry
  // `install-workspace` of each copy is rewritten into the two-command form, then one mutant
  // is applied; go-task is hidden so the fallback runner (the CI condition) is what runs.
  test("the R19 case goes red for each Taskfile mutant of the cmds: form", async () => {
    const template = stageTemplate();
    const bin = tasklessPath();
    live.push(bin);
    const prepare = (mutant: (typeof TASKFILE_MUTANTS)[number] | null) => {
      const dir = stageCopy(template, null);
      const file = path.join(dir, "Taskfile.yml");
      fs.writeFileSync(file, rewriteEntry(fs.readFileSync(file, "utf8"), mutant));
      return dir;
    };
    const runs = await Promise.all(
      [null, ...TASKFILE_MUTANTS].map((m) => runSuite(prepare(m), TIER, bin)),
    );
    const [base, ...mutated] = runs;
    if (base?.status !== 0) {
      throw new Error(`cmds: baseline is not green (${base?.fails.join("; ")})`);
    }
    const problems: string[] = [];
    mutated.forEach((run, i) => {
      const mutant = TASKFILE_MUTANTS[i];
      if (mutant === undefined) return;
      if (!run.fails.some((f) => f.toLowerCase().includes(R19))) {
        problems.push(`mutant ${mutant.id}: the R19 case stayed green`);
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
