// Spec 0287 delta-02 R24 (b): the truth table of the `windows` job condition. The condition text is
// read from `jobs.windows.if` of the committed build.yml (not a copy of it) and evaluated by the
// one closed evaluator of the push check (scripts/lib/ci-push/gha-if.ts). Exactly one row skips:
// pull_request, pr-scope success, output true. The row pull_request / failure / true runs (D4).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { evalJobIf, pushContext } from "../lib/ci-push/gha-if.ts";
import { yamlLib as yaml } from "./lib/yaml-lib.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");

interface Row {
  event: string;
  result: "success" | "failure";
  output: string | null;
  expected: "run" | "skip";
}
const ROWS = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "fixtures", "ci-windows-condition.json"), "utf8"),
) as Row[];

const buildDoc = yaml.load(
  fs.readFileSync(path.join(REPO, ".github", "workflows", "build.yml"), "utf8"),
) as { jobs: Record<string, Record<string, unknown>> };
const COND = String(buildDoc.jobs["windows"]?.["if"]);

/** Whether the job runs under `row`; a missing output reads as the empty string. */
function runs(cond: string, row: Row): boolean {
  return evalJobIf(cond, {
    ...pushContext("main"),
    event_name: row.event,
    success: row.result === "success",
    cancelled: false,
    needs: {
      "pr-scope": {
        result: row.result,
        outputs: { "spec-only": row.output ?? "" },
      },
    },
  });
}
const mismatches = (cond: string): Row[] =>
  ROWS.filter((r) => runs(cond, r) !== (r.expected === "run"));

describe("windows condition truth table", () => {
  it("has 18 rows and exactly one skipping row", () => {
    assert.equal(ROWS.length, 18);
    const skips = ROWS.filter((r) => r.expected === "skip");
    assert.deepEqual(skips, [
      { event: "pull_request", result: "success", output: "true", expected: "skip" },
    ]);
    assert.ok(
      ROWS.some(
        (r) =>
          r.event === "pull_request" &&
          r.result === "failure" &&
          r.output === "true" &&
          r.expected === "run",
      ),
    );
  });
  it("the condition read from build.yml matches every row", () => {
    assert.deepEqual(mismatches(COND), []);
  });
  const mutants: [string, (c: string) => string][] = [
    ["drop !cancelled()", (c) => c.replace("!cancelled() && ", "")],
    ["drop the result clause", (c) => c.replace("needs.pr-scope.result != 'success' || ", "")],
    ["!= to == on the output", (c) => c.replace("spec-only != 'true'", "spec-only == 'true'")],
    ["drop the event clause", (c) => c.replace("github.event_name != 'pull_request' || ", "")],
    ["change the 'true' literal", (c) => c.replace("!= 'true'", "!= 'yes'")],
  ];
  for (const [name, mutate] of mutants)
    it(`mutation: ${name} mismatches at least one row`, () => {
      const m = mutate(COND);
      assert.notEqual(m, COND, "the mutation must apply");
      assert.ok(mismatches(m).length > 0);
    });
});
