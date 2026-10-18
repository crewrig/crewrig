// build-components-conformance.test.ts — the shell/TypeScript conformance of model
// resolution (spec 0250 R21, requirement 19; scenario 16). Linux only, spawning `bash` and
// `yq` on purpose: the shell library is the oracle until row I2 retires it, and with it
// this suite.
//
// Per (agent, target) pair the offering id, native value, directed frontmatter lines, prose,
// diagnostics, `mapping_in_force` handle and standard error are compared between
// `resolve_agent` (sourced with `render-command.sh`, one `bash` per case group) and
// `resolveAgent`. The corpus is the 22 core agents on the four targets, every fixture of
// scripts/tests/fixtures/agent-profiles/, and every builder of lib/mapping-fixtures.ts (the
// inline cases of test-model-resolution.sh plus an axis matrix); organisation-channel cases are
// the sibling suite's. A guard fails when a fixture-defining section of the Bash suite has no
// builder, so the two cannot drift. Where the twin differs on purpose, the case is listed in
// DOCUMENTED with its clause: an unlisted difference fails, and so does a listed one that
// vanishes.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  bashIntegerOnly,
  checkCase,
  diffOutcomes,
  limited,
  replayGate,
  REPO,
  runShellResolve,
  runTwinResolve,
  type Documented,
  type Outcome,
  type ResolveCase,
} from "./lib/shell-resolve-harness.ts";
import { BUILDERS, casesOf, EXEMPT_LABELS, type Builder } from "./lib/mapping-fixtures.ts";

const skip = replayGate();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "conformance-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Documented differences of the resolution (the organisation ones are in the sibling suite). */
const DOCUMENTED: readonly Documented[] = [
  {
    id: "bash-integer-diagnostic",
    clause:
      "PLAN S3 (spec 0250 R33 'no other byte differs' read as not covering bash's own " +
      "diagnostics): a non-numeric `rank` or an overflowing `context` makes `[ -lt ]`/`[ -ge ]` " +
      "print `integer expected`; the twin selects the same offering and prints nothing",
    keys: ["x_rank_nonnumeric#0", "x_context#2"],
    verify: bashIntegerOnly,
  },
];

interface Result {
  readonly c: ResolveCase;
  readonly shell: Outcome;
  readonly twin: Outcome;
}
const results = new Map<string, Result[]>();
/** Merge directories that a case group left non-empty: nothing here may merge (core tree, no org file). */
const leaks: string[] = [];

/** One `bash` per case group (the shell runs concurrently, the twin in-process), each in its own merge directories. */
async function compare(group: string, cases: ResolveCase[]): Promise<void> {
  const [ms, mt] = ["shell", "twin"].map((side) => fs.mkdtempSync(path.join(tmp, `${side}-`)));
  const shell = await runShellResolve(
    cases.map((c) => ({ ...c, mergeDir: ms })),
    `conformance/${group}`,
  );
  const twin = runTwinResolve(cases.map((c) => ({ ...c, mergeDir: mt })));
  results.set(
    group,
    cases.map((c, i) => ({ c, shell: shell[i] as Outcome, twin: twin[i] as Outcome })),
  );
  for (const dir of [ms, mt]) if (fs.readdirSync(dir as string).length > 0) leaks.push(group);
}
const groupOf = (b: Builder) => () =>
  compare(`builder ${b.label}: ${b.name}`, casesOf(b, tmp, b.build(tmp)));

const agentsDir = path.join(REPO, "artifacts", "core", "agents");
const agents = fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir).sort() : [];
const TARGETS = ["claude", "gemini", "copilot", "antigravity"];
const profileDir = path.join(REPO, "scripts", "tests", "fixtures", "agent-profiles");
const fixtures = fs.existsSync(profileDir) ? fs.readdirSync(profileDir).sort() : [];
const plain = BUILDERS.filter((b) => b.org !== true);

if (skip === undefined) {
  const agentCase = (a: string, target: string): ResolveCase => ({
    label: `core agent ${a}/${target}`,
    repoDir: REPO,
    agent: a,
    source: path.join(agentsDir, a, "AGENT.md"),
    target,
  });
  const fixtureCases = fixtures.flatMap((f) =>
    TARGETS.map((target) => ({
      ...agentCase("probe", target),
      label: `fixture ${f}/${target}`,
      source: path.join(profileDir, f),
    })),
  );
  await limited([
    ...TARGETS.map(
      (t) => () =>
        compare(
          `core agents on ${t}`,
          agents.map((a) => agentCase(a, t)),
        ),
    ),
    () => compare("agent-profiles fixtures", fixtureCases),
    ...plain.map(groupOf),
  ]);
}

const describeSkip = skip === undefined ? {} : { skip };
const problems = (rs: readonly Result[]): string[] =>
  rs.flatMap((r) => checkCase(r.c, r.shell, r.twin, DOCUMENTED));

describe("resolution: the shell library and its twin agree", describeSkip, () => {
  for (const [group, rs] of results) test(group, () => assert.deepEqual(problems(rs), []));
  test("no case group merged anything", () => assert.deepEqual(leaks, []));

  test("the corpus is the whole surface and is not vacuous", (t) => {
    const all = [...results.values()].flat();
    const real = all.filter((r) => r.c.label.startsWith("core agent"));
    assert.equal(
      agents.length,
      22,
      "22 core agent sources, as test-model-resolution.sh C2(c) pins",
    );
    assert.equal(real.length, 88, "22 agents x 4 targets");
    assert.ok(fixtures.length >= 1, "scripts/tests/fixtures/agent-profiles/ holds a fixture");
    const served = real.filter((r) => r.shell.offeringId !== "");
    const recorded = real.filter((r) => r.shell.diagLines.length > 0 || r.shell.fmLines.length > 0);
    assert.ok(served.length >= 60, `only ${served.length} of 88 real pairs select an offering`);
    assert.ok(
      recorded.length >= 60,
      `only ${recorded.length} of 88 real pairs record a drop, note or line`,
    );
    for (const target of TARGETS) {
      const mine = real.filter((r) => r.c.target === target);
      const count = (f: (r: Result) => boolean): number => mine.filter(f).length;
      t.diagnostic(
        `${target}: offering ${count((r) => r.shell.offeringId !== "")}, drop/note ${count((r) => r.shell.diagLines.length > 0)}, frontmatter ${count((r) => r.shell.fmLines.length > 0)}, prose ${count((r) => r.shell.prose !== "")}`,
      );
    }
    assert.ok(all.some((r) => r.shell.prose !== "") && all.some((r) => r.shell.fmLines.length > 0));
    assert.ok(all.length >= 240, `only ${all.length} pairs compared`);
    const listed = all.filter(
      (r) => problems([r]).length === 0 && diffOutcomes(r.shell, r.twin).length > 0,
    );
    assert.equal(listed.length, 2, "the documented differences all fire (a vanished one fails)");
    t.diagnostic(
      `${all.length} pairs (${real.length} real), ${results.size} groups, ${listed.length} listed differences`,
    );
    t.diagnostic(
      `${execFileSync("yq", ["--version"], { encoding: "utf8" }).trim()}; documented: ${DOCUMENTED.map((d) => d.id)}`,
    );
  });

  test("a difference names the pair and the differing output (scenario 16)", () => {
    const [first] = [...results.values()].flat();
    assert.ok(first !== undefined);
    const twin: Outcome = {
      ...first.twin,
      offeringId: "mutant",
      fmLines: ["effort: bogus"],
      derivedAfter: 7,
    };
    const message = checkCase(first.c, first.shell, twin, [])[0] ?? "";
    for (const part of [
      first.c.label,
      "offeringId",
      "mutant",
      "fmLines",
      "effort: bogus",
      "derivedAfter",
    ]) {
      assert.ok(message.includes(part), `${part} missing from: ${message}`);
    }
    assert.deepEqual(checkCase(first.c, first.shell, first.shell, []), []);
  });
});

// The guard that tied every fixture of the Bash suite test-model-resolution.sh to a builder retired
// with that suite (spec 0262 requirement 17, row I2); the builders stay, keyed by unique name.
describe("fixture builders", () => {
  test("builder names are unique", () => {
    assert.equal(new Set(BUILDERS.map((b) => b.name)).size, BUILDERS.length);
  });
});
