// check-skill-quality-evals.test.ts — spec 0304 R19: the three eval-authoring warnings of the skill
// linter (an absence expectation, a missing sample, too many evals), their severity on a protected
// skill, `--strict`, and the nine attested skills staying free of errors. Throwaway roots only.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { probes, REPO, root, rules, run } from "./lib/skill-quality-fixture.ts";
import { parsed } from "./lib/skill-quality-fixture.ts";

interface EvalSpec {
  readonly expectations?: readonly string[];
}

/** An evals.json of `specs.length` evals with the given expectations and `nProbes` balanced probes. */
function evalsOf(specs: readonly EvalSpec[], nProbes = 6): string {
  return JSON.stringify({
    skill_name: "x",
    evals: specs.map((s, i) => ({
      id: i + 1,
      prompt: "p",
      expected_output: "o",
      files: [],
      expectations: s.expectations ?? ["The report lists every finding"],
    })),
    trigger_probes: probes(nProbes, nProbes / 2),
  });
}
const samples = (n: number): Record<string, string> =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`evals/samples/${i + 1}/answer.md`, "sample\n"]),
  );
const three = (over: EvalSpec[] = []): EvalSpec[] => [{}, {}, {}].map((e, i) => over[i] ?? e);

const messagesOf = (dir: string, rule: string, args: string[] = []): string[] =>
  parsed(run(dir, ["--json", ...args]).stdout)
    .findings.filter((f) => f.rule === rule)
    .map((f) => f.message);

describe("R19(a): an expectation worded as an absence", () => {
  const absent = [
    "The report does not mention the key",
    "Do not leak the token",
    "It never calls the API",
    "The file no longer exists",
    "None of the jobs write contents",
    "The workflow runs without secrets",
    "There is no token in the file",
  ];
  for (const text of absent)
    test(`warns, with the file_not_contains fix, on "${text}" and exits as before`, () => {
      const dir = root({
        "evals/evals.json": evalsOf(three([{ expectations: [text] }])),
        ...samples(3),
      });
      assert.equal(rules(dir).get("evals-absence-expectation"), "warning");
      assert.equal(run(dir).status, 0, "a warning leaves the exit code alone, protected or not");
      const msg = messagesOf(dir, "evals-absence-expectation")[0] ?? "";
      assert.match(msg, /file_not_contains/);
      assert.match(msg, /enumerate/);
      assert.match(msg, /eval 1 expectation 1/);
    });

  test("--strict turns the warning into an error and exits 1", () => {
    const dir = root({
      "evals/evals.json": evalsOf(
        three([{ expectations: ["The report does not mention the key"] }]),
      ),
      ...samples(3),
    });
    assert.equal(rules(dir, ["--strict"]).get("evals-absence-expectation"), "error");
    assert.equal(run(dir, ["--strict"]).status, 1);
  });

  test("a positive wording, and a word that merely contains `no`, is not flagged", () => {
    const fine = [
      "The report lists every finding",
      "It knows the known issues",
      "The title is a single gitmoji",
      "The notes name the cannot-merge case",
    ];
    const dir = root({
      "evals/evals.json": evalsOf(three([{ expectations: fine }])),
      ...samples(3),
    });
    assert.equal(rules(dir).has("evals-absence-expectation"), false);
  });
});

describe("R19(b): an eval with no evals/samples/<id>/ directory", () => {
  test("warns, names the eval and the dry-run, and exits 0 on a protected skill", () => {
    const dir = root({ "evals/evals.json": evalsOf(three()) });
    assert.equal(rules(dir).get("evals-sample-missing"), "warning");
    assert.equal(run(dir).status, 0);
    const msgs = messagesOf(dir, "evals-sample-missing");
    assert.equal(msgs.length, 3, "one warning per eval without a sample");
    assert.match(msgs[0] ?? "", /eval 1 has no evals\/samples\/1\//);
    assert.match(msgs[0] ?? "", /--dry-run/);
  });

  test("only the evals without a sample are named", () => {
    const dir = root({ "evals/evals.json": evalsOf(three()), "evals/samples/2/answer.md": "s\n" });
    const msgs = messagesOf(dir, "evals-sample-missing");
    assert.equal(msgs.length, 2);
    assert.equal(
      msgs.some((m) => /eval 2 /.test(m)),
      false,
    );
  });

  test("a sample for every eval silences the rule; --strict makes a missing one an error", () => {
    const withAll = root({ "evals/evals.json": evalsOf(three()), ...samples(3) });
    assert.equal(rules(withAll).has("evals-sample-missing"), false);
    const without = root({ "evals/evals.json": evalsOf(three()) });
    assert.equal(rules(without, ["--strict"]).get("evals-sample-missing"), "error");
    assert.equal(run(without, ["--strict"]).status, 1);
  });
});

describe("R19(c): too many evals or a plan maximum over the run cap", () => {
  test("7 evals that carry expectations warn: the judge cap refuses such a skill", () => {
    const dir = root({
      "evals/evals.json": evalsOf(Array.from({ length: 7 }, () => ({}))),
      ...samples(7),
    });
    assert.equal(rules(dir).get("evals-too-many"), "warning");
    assert.equal(run(dir).status, 0);
    const msg = messagesOf(dir, "evals-too-many")[0] ?? "";
    assert.match(msg, /7 evals carry expectations/);
    assert.match(msg, /judge worst case 63 calls against the cap of 60/);
    assert.match(msg, /split the skill/);
  });

  test("6 evals and 12 probes (plan maximum 48) do not warn", () => {
    const dir = root({
      "evals/evals.json": evalsOf(
        Array.from({ length: 6 }, () => ({})),
        12,
      ),
      ...samples(6),
    });
    assert.equal(rules(dir).has("evals-too-many"), false);
  });

  test("a plan maximum above 60 warns even with 6 evals (6 x 4 + 19 x 2 = 62)", () => {
    const dir = root({
      "evals/evals.json": evalsOf(
        Array.from({ length: 6 }, () => ({})),
        20,
      ),
      ...samples(6),
    });
    const msg = messagesOf(dir, "evals-too-many")[0] ?? "";
    assert.match(msg, /plan maximum is 64 runs \(cap 60\)/);
  });

  test("evals without expectations do not count against the judge cap", () => {
    const dir = root({
      "evals/evals.json": evalsOf(
        Array.from({ length: 8 }, (_, i) => (i < 6 ? {} : { expectations: [] })),
      ),
      ...samples(8),
    });
    assert.equal(rules(dir).has("evals-too-many"), false);
  });

  test("--strict makes it an error", () => {
    const dir = root({
      "evals/evals.json": evalsOf(Array.from({ length: 7 }, () => ({}))),
      ...samples(7),
    });
    assert.equal(rules(dir, ["--strict"]).get("evals-too-many"), "error");
    assert.equal(run(dir, ["--strict"]).status, 1);
  });
});

describe("the shipped skills", () => {
  test("the nine attested skills and every other skill have no error from the three rules", () => {
    const res = run(REPO, ["--json"]);
    const out = parsed(res.stdout);
    const eval3 = ["evals-absence-expectation", "evals-sample-missing", "evals-too-many"];
    const errors = out.findings.filter((f) => eval3.includes(f.rule) && f.severity === "error");
    assert.deepEqual(errors, []);
    assert.equal(res.status, 0, res.stdout.slice(0, 2000));
  });
});
