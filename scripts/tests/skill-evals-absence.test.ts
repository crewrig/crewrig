// skill-evals-absence.test.ts — the deterministic absence check `file_not_contains` (spec 0304 R18):
// written and validated like `file_contains`, it passes only when the produced file exists and does
// not match; a run that wrote nothing has not shown an absence. No model call.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { checkText, runCheck } from "../lib/skill-evals/checks.ts";
import { formatViolation, validateEvals } from "../lib/skill-evals/schema.ts";
import { evalsJson, makeRepo, skillRel, tmpDir, writeSkill } from "./lib/skill-evals-fixtures.ts";

const KEY = { type: "file_not_contains", path: "report.md", pattern: "AKIA[0-9A-Z]{16}" } as const;

function outputs(files: Record<string, string>) {
  const root = tmpDir("skill-evals-absence-");
  const outputsDir = path.join(root, "outputs");
  fs.mkdirSync(outputsDir, { recursive: true });
  for (const [rel, text] of Object.entries(files))
    fs.writeFileSync(path.join(outputsDir, rel), text);
  return { root, ctx: { outputsDir, skillDir: root } };
}

test("passes when the produced file holds no match", async () => {
  const o = outputs({ "report.md": "# Report\nno secrets here\n" });
  try {
    const r = await runCheck(KEY, o.ctx);
    assert.equal(r.passed, true, r.evidence);
    assert.match(r.evidence, /exists and does not match/);
    assert.equal(r.text, "check file_not_contains: report.md does not match /AKIA[0-9A-Z]{16}/");
    assert.equal(checkText(KEY), r.text);
  } finally {
    fs.rmSync(o.root, { recursive: true, force: true });
  }
});

test("fails when the produced file matches, naming the match", async () => {
  const o = outputs({ "report.md": "key: AKIAABCDEFGHIJKLMNOP\n" });
  try {
    const r = await runCheck(KEY, o.ctx);
    assert.equal(r.passed, false);
    assert.match(r.evidence, /matches \/AKIA\[0-9A-Z\]\{16\}\/ at "AKIAABCDEFGHIJKLMNOP"/);
  } finally {
    fs.rmSync(o.root, { recursive: true, force: true });
  }
});

test("fails with `file not produced` when the run wrote nothing: an absence was not shown", async () => {
  const o = outputs({});
  try {
    const r = await runCheck(KEY, o.ctx);
    assert.equal(r.passed, false);
    assert.match(r.evidence, /file not produced/);
    // the same missing file also fails file_contains: the two differ only in the sense of the match
    assert.equal(
      (await runCheck({ type: "file_contains", path: "report.md", pattern: "x" }, o.ctx)).passed,
      false,
    );
  } finally {
    fs.rmSync(o.root, { recursive: true, force: true });
  }
});

test("a path that escapes the outputs directory fails like the other file checks", async () => {
  const o = outputs({});
  try {
    const r = await runCheck({ ...KEY, path: "../secret.txt" }, o.ctx);
    assert.equal(r.passed, false);
    assert.match(r.evidence, /escapes/);
  } finally {
    fs.rmSync(o.root, { recursive: true, force: true });
  }
});

function validate(check: unknown) {
  const repo = makeRepo();
  try {
    writeSkill(repo, "demo");
    const doc = JSON.parse(evalsJson("demo")) as { evals: { checks: unknown[] }[] };
    doc.evals[0]!.checks = [check];
    return validateEvals(JSON.stringify(doc), {
      file: `${skillRel("demo")}/evals/evals.json`,
      skillDir: path.join(repo.root, skillRel("demo")),
      skillName: "demo",
    });
  } finally {
    repo.cleanup();
  }
}

test("the evals file validates a file_not_contains check like a file_contains one", () => {
  const r = validate(KEY);
  assert.deepEqual(r.violations, []);
  assert.deepEqual(r.evals?.evals[0]?.checks[0], KEY);
});

test("an invalid regular expression makes the evals file invalid naming the eval and the field", () => {
  const r = validate({ type: "file_not_contains", path: "report.md", pattern: "(unclosed" });
  const lines = r.violations.map(formatViolation);
  assert.equal(r.evals, undefined);
  assert.ok(
    lines.some((l) => l.includes("$.evals[0].checks[0].pattern")),
    lines.join("\n"),
  );
});

test("a missing pattern, an unknown field and an escaping path are invalid", () => {
  assert.ok(validate({ type: "file_not_contains", path: "report.md" }).violations.length > 0);
  const unknown = validate({ ...KEY, flags: "i" }).violations.map(formatViolation);
  assert.ok(
    unknown.some((l) => l.includes("checks[0].flags") && l.includes("unknown field")),
    unknown.join("\n"),
  );
  assert.ok(validate({ ...KEY, path: "../x" }).violations.length > 0);
});

test("an unknown check type still names the closed set, which now includes file_not_contains", () => {
  const v = validate({ type: "file_missing", path: "a" })
    .violations.map(formatViolation)
    .join("\n");
  assert.match(v, /file_not_contains/);
});
