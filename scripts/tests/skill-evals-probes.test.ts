// skill-evals-probes.test.ts — trigger probes, the effort flag and `skill_loaded`
// (spec 0290 R45, R47, R48 as added by delta-04, R25). The real executor and judge driver run against
// a recording stub `claude` (see `stubRig`): it emits a `Skill` tool_use naming the skill, or plain
// text. No model call, no network.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { readCalls } from "./lib/skill-evals-fixtures.ts";
import { stubRig } from "./lib/skill-evals-stub-rig.ts";

const read = (...p: string[]) => JSON.parse(fs.readFileSync(path.join(...p), "utf8"));
const opt = (argv: readonly string[], k: string) => argv[argv.indexOf(k) + 1];

/** One eval that is graded by a check alone (no judge call), and the given probes. */
const checkOnly = (probes: { query: string; should_trigger: boolean }[]): string =>
  JSON.stringify({
    skill_name: "demo",
    evals: [
      {
        id: 1,
        prompt: "Task 1",
        expected_output: "An answer file.",
        files: [],
        expectations: [],
        checks: [{ type: "file_exists", path: "answer.md" }],
      },
    ],
    trigger_probes: probes,
  });

const PROBES = [
  { query: "do the thing", should_trigger: true },
  { query: "something unrelated", should_trigger: false },
];

test("R45: a stub that emits a Skill call naming the skill: the true probe passes and the false probe fails; no judge call", async () => {
  const t = stubRig(
    { loggedIn: true },
    {},
    { evalsText: checkOnly(PROBES), stub: { loadSkill: "demo" } },
  );
  try {
    const r = await t.run();
    const s = r.results[0];
    assert.equal(s?.probesPassed, 1, r.text + r.stderr);
    assert.equal(s?.probesTotal, 2);
    assert.equal(s?.status, "fail", "1/2 probes is below the threshold");
    const p1 = read(t.rig.out, "demo", "probe-1", "probe.json");
    assert.deepEqual(p1, {
      query: "do the thing",
      should_trigger: true,
      observed: true,
      passed: true,
    });
    const p2 = read(t.rig.out, "demo", "probe-2", "probe.json");
    assert.deepEqual(p2, {
      query: "something unrelated",
      should_trigger: false,
      observed: true,
      passed: false,
    });
    for (const n of [1, 2])
      for (const f of ["transcript.md", "metrics.json"])
        assert.ok(fs.existsSync(path.join(t.rig.out, "demo", `probe-${n}`, f)), `probe-${n}/${f}`);
    assert.equal(
      readCalls(t.bin, "judge").length,
      0,
      "no judge call for a probe, nor for a check-only eval",
    );
    assert.equal(s?.judgeCalls, 0);
  } finally {
    t.cleanup();
  }
});

test("R45: a stub that emits plain text: the reverse, and the recorded argv of a probe is --tools Skill with --max-turns 1", async () => {
  const t = stubRig({ loggedIn: true }, {}, { evalsText: checkOnly(PROBES) });
  try {
    const r = await t.run();
    const s = r.results[0];
    assert.equal(s?.probesPassed, 1, r.text + r.stderr);
    assert.equal(read(t.rig.out, "demo", "probe-1", "probe.json").passed, false);
    assert.equal(read(t.rig.out, "demo", "probe-1", "probe.json").observed, false);
    assert.equal(read(t.rig.out, "demo", "probe-2", "probe.json").passed, true);
    const runs = readCalls(t.bin, "executor");
    assert.equal(runs.length, 3, "1 eval + 2 probes, one run each");
    const probeRuns = runs.filter((c) => opt(c.argv, "--tools") === "Skill");
    assert.equal(probeRuns.length, 2);
    for (const c of probeRuns) {
      assert.equal(opt(c.argv, "--max-turns"), "1");
      assert.equal(opt(c.argv, "--allowedTools"), "Skill");
      assert.ok(
        c.listing?.includes(".claude/skills/demo/SKILL.md"),
        "the skill is installed as for an eval",
      );
    }
    const evalRun = runs.find((c) => opt(c.argv, "--tools") !== "Skill");
    assert.equal(opt(evalRun?.argv ?? [], "--max-turns"), "25");
    assert.match(evalRun?.argv.join(" ") ?? "", /--tools Bash,Read,Write,Edit,Skill/);
  } finally {
    t.cleanup();
  }
});

test("R45: a probe whose result is error_max_turns after the Skill call is a pass for should_trigger true, with no limit tag and no error", async () => {
  const t = stubRig(
    { loggedIn: true },
    {},
    {
      evalsText: checkOnly([{ query: "do the thing", should_trigger: true }]),
      stub: { loadSkill: "demo", probeMaxTurns: true },
    },
  );
  try {
    const r = await t.run();
    const s = r.results[0];
    assert.equal(s?.status, "pass", r.text + r.stderr);
    assert.equal(r.exitCode, 0);
    assert.equal(s?.probesPassed, 1);
    const m = read(t.rig.out, "demo", "probe-1", "metrics.json");
    assert.equal(m.limit, null, "the one-turn bound is the early stop, not a limit (R27)");
    assert.equal(read(t.rig.out, "demo", "probe-1", "probe.json").passed, true);
    assert.doesNotMatch(r.text, /executor failure/);
    // the same stream on an eval run IS a turn limit: only a probe clears it
  } finally {
    t.cleanup();
  }
});

test("R47: executor, probe and judge argv each carry --model claude-sonnet-5-5 and --effort medium; changing the setting changes all three", async () => {
  const withEffort = async (effort: string | undefined) => {
    const t = stubRig(
      { loggedIn: true },
      {},
      {
        evals: 1,
        probes: [{ query: "do the thing", should_trigger: true }],
        stub: { loadSkill: "demo" },
      },
    );
    try {
      const r = await t.run(effort === undefined ? {} : { settings: { effort } });
      assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
      const runs = readCalls(t.bin, "executor");
      const judge = readCalls(t.bin, "judge");
      assert.equal(runs.length, 2);
      assert.equal(judge.length, 1);
      const rec = read(t.rig.repo.root, "artifacts/core/skills/demo/evals/results.json");
      return { argvs: [...runs, ...judge].map((c) => c.argv), rec };
    } finally {
      t.cleanup();
    }
  };
  const medium = await withEffort(undefined);
  for (const a of medium.argvs) {
    assert.equal(opt(a, "--model"), "claude-sonnet-5-5");
    assert.equal(opt(a, "--effort"), "medium");
  }
  assert.equal(medium.rec.effort, "medium", "the results file records it");
  const high = await withEffort("high");
  for (const a of high.argvs) {
    assert.equal(opt(a, "--model"), "claude-sonnet-5-5");
    assert.equal(opt(a, "--effort"), "high");
  }
  assert.equal(high.rec.effort, "high");
});

test("R48: skill_loaded is recorded per eval run and shown in the report, and it scores nothing", async () => {
  const run = async (loadSkill: string | undefined) => {
    const t = stubRig({ loggedIn: true }, {}, { evals: 2, stub: loadSkill ? { loadSkill } : {} });
    try {
      const r = await t.run();
      return {
        r,
        loaded: [1, 2].map(
          (n) => read(t.rig.out, "demo", `eval-${n}`, "metrics.json").skill_loaded,
        ),
        passed: [1, 2].map(
          (n) => read(t.rig.out, "demo", `eval-${n}`, "grading.json").summary.failed === 0,
        ),
      };
    } finally {
      t.cleanup();
    }
  };
  const yes = await run("demo");
  const no = await run(undefined);
  const other = await run("another-skill");
  assert.deepEqual(yes.loaded, [true, true]);
  assert.deepEqual(no.loaded, [false, false]);
  assert.deepEqual(other.loaded, [false, false], "another skill's load is not this skill's");
  assert.match(yes.r.text, /skill_loaded=2\/2/);
  assert.match(no.r.text, /skill_loaded=0\/2/);
  // not scored: the same eval outcomes and the same status whether or not the skill was loaded
  assert.deepEqual(yes.passed, no.passed);
  assert.equal(yes.r.results[0]?.status, no.r.results[0]?.status);
  assert.equal(yes.r.results[0]?.evalPassRate, no.r.results[0]?.evalPassRate);
});
