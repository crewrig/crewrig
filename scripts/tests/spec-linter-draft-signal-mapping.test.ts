// Spec 0168 delta-01 (R9, R10, R11, R17): the engine-to-linter mapping of the Draft-PR signal,
// asserted over the committed CI files. Read-only: nothing is created, written or removed.
// GitHub: the workflow must re-run on the draft/ready transitions and map the PR draft flag onto
// CREWRIG_PR_DRAFT in the `lint-specs` job env (the job runs the ci-job action). GitLab: the generated
// `lint-specs` job maps CI_MERGE_REQUEST_DRAFT onto the same variable.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { yamlLib } from "./lib/yaml-lib.ts";
import { readWorkflowUnion } from "./lib/workflow-union.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const T = { timeout: 60_000 };

type Doc = Record<string, unknown>;
const load = (rel: string): Doc =>
  yamlLib.load(
    // `!reference` is a GitLab-only tag js-yaml cannot resolve; the sequence under it is enough here.
    fs.readFileSync(path.join(ROOT, rel), "utf8").replaceAll("!reference ", ""),
  ) as Doc;
const obj = (v: unknown, what: string): Doc => {
  assert.ok(v !== null && typeof v === "object" && !Array.isArray(v), `${what} is not a mapping`);
  return v as Doc;
};

describe("Draft-PR signal CI mapping (spec 0168 delta-01 R9-R11)", () => {
  test("GitHub: pull_request types are exactly the five lifecycle events", T, () => {
    const wf = load(".github/workflows/build.yml");
    const pr = obj(obj(wf["on"], "on")["pull_request"], "on.pull_request");
    assert.deepEqual(pr["types"], [
      "opened",
      "synchronize",
      "reopened",
      "ready_for_review",
      "converted_to_draft",
    ]);
  });

  test("GitHub: the lint-specs job env maps github.event.pull_request.draft", T, () => {
    const job = obj(readWorkflowUnion(ROOT)["lint-specs"], "jobs.lint-specs");
    const expr = obj(job["env"], "job env")["CREWRIG_PR_DRAFT"];
    assert.equal(typeof expr, "string");
    assert.ok(
      (expr as string).includes("github.event.pull_request.draft"),
      `unexpected expression: ${String(expr)}`,
    );
  });

  test("GitLab: the lint-specs job maps CI_MERGE_REQUEST_DRAFT", T, () => {
    const ci = load(".gitlab-ci.yml");
    const job = obj(ci["lint-specs"], "lint-specs");
    const value = obj(job["variables"], "lint-specs variables")["CREWRIG_PR_DRAFT"];
    assert.equal(typeof value, "string");
    assert.ok(
      (value as string).includes("CI_MERGE_REQUEST_DRAFT"),
      `unexpected value: ${String(value)}`,
    );
  });
});
