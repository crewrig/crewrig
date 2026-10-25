// check-plan-review-ci-wiring.test.ts — the CI reference, the GitHub workflow and the GitLab
// pipeline wire the plan review gate (spec 0277 R17, R19): a focused, path-filtered job that runs
// the script on a skipping and a requiring committed fixture, and the unit and wiring tests in the
// governance job. Mirrors check-seat-brief-ci-wiring.test.ts.
//
// Assertions are functions over text so the mutation tests run the same functions on mutated copies.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { loadTaskfileTree, taskCmds, type TaskfileTree } from "../lib/taskfile-tree.ts";
import { REPO } from "./lib/build-fixture-tree.ts";
import {
  ciTaskCommands,
  effectivePaths,
  resolveCapabilityCommands,
} from "./lib/ci-task-commands.ts";
import { yamlLib } from "./lib/yaml-lib.ts";
import { gatePaths } from "./lib/capability-path-scan.ts";
import { readWorkflowUnionText } from "./lib/workflow-union.ts";

const ID = "check-plan-review";
const SCRIPT = "scripts/check-plan-review.ts";
const NODE = "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
const FIXTURE_DIR = "scripts/tests/fixtures/plan-review/";
const TESTS = [
  "scripts/tests/check-plan-review.test.ts",
  "scripts/tests/check-plan-review-gate.test.ts",
  "scripts/tests/check-plan-review-ci-wiring.test.ts",
];
const PATHS = [
  "scripts/check-plan-review.ts",
  "scripts/lib/governance/plan-review-gate.ts",
  "scripts/tests/check-plan-review*",
  "scripts/tests/fixtures/plan-review/**",
];
const read = (...p: string[]): string => fs.readFileSync(path.join(REPO, ...p), "utf8");

/** The task body runs the script on committed fixtures and expects one decision on each. */
function assertCommands(joined: string): void {
  assert.ok(joined.includes(NODE), "uses the node entry");
  assert.ok(joined.includes(SCRIPT), "runs the script");
  assert.ok(joined.includes(FIXTURE_DIR), "runs on committed plan-review fixtures");
  assert.ok(/plan-review:\\\\x20/.test(joined), "compares the decision line");
  assert.ok(/ skipped(\n|$)/.test(joined), "expects a skip");
  assert.ok(/ required(\n|$)/.test(joined), "expects a require");
  assert.ok(!/\bgrep\b/.test(joined), "no grep in the task body");
}

function jobBlock(text: string, header: RegExp, gitlab = false): string {
  const m = header.exec(text);
  assert.ok(m, `job ${header} present`);
  const rest = text.slice(m.index + 1);
  const next = rest.search(gitlab ? /\n[a-z0-9-]+:\n/ : /\n {2}[a-z0-9-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next);
}

function assertCapabilities(text: string): void {
  const caps = (
    yamlLib.load(text) as {
      capabilities: {
        id: string;
        command?: string[];
        paths?: string[];
        trigger?: { paths?: string[] }[];
        requires?: { runtime?: string };
      }[];
    }
  ).capabilities;
  const cap = caps.find((c) => c.id === ID);
  assert.ok(cap, `capability ${ID}`);
  assert.equal(cap.requires?.runtime, "node@24");
  assertCommands(resolveCapabilityCommands(cap.command).join("\n"));
  assert.ok((cap.trigger ?? []).length > 0, "has a trigger");
  for (const t of cap.trigger ?? [])
    for (const p of PATHS) assert.ok(effectivePaths(cap, t).includes(p), `trigger paths has ${p}`);
  const gov = caps.find((c) => c.id === "governance-checks-ts");
  assert.ok(gov);
  for (const t of TESTS)
    assert.ok(resolveCapabilityCommands(gov.command).join(" ").includes(t), `governance runs ${t}`);
}

function assertGithub(
  text: string,
  govCmds: string[] = ciTaskCommands("governance-checks-ts"),
  cmds: string[] = ciTaskCommands(ID),
): void {
  const job = jobBlock(text, new RegExp(`\\n  ${ID}:\\n`));
  assert.ok(job.includes(`id: ${ID}`) && job.includes("./.github/actions/ci-job"), "calls ci-job");
  assertCommands(cmds.join("\n"));
  const gov = jobBlock(text, /\n {2}governance-checks-ts:\n/);
  for (const t of TESTS) assert.ok(govCmds.join(" ").includes(t), `governance-checks-ts runs ${t}`);
  for (const p of ["scripts/tests/fixtures/plan-review/**", "scripts/tests/check-plan-review*"])
    assert.ok(gatePaths("governance-checks-ts").includes(p), `paths have ${p}`);
}

function assertGitlab(
  text: string,
  govCmds: string[] = ciTaskCommands("governance-checks-ts"),
  cmds: string[] = ciTaskCommands(ID),
): void {
  const job = jobBlock(text, new RegExp(`\\n${ID}:\\n`), true);
  assert.ok(job.includes("image: node:24"));
  assert.ok(job.includes(`task ci:${ID}`), "runs the task");
  assertCommands(cmds.join("\n"));
  const gov = jobBlock(text, /\ngovernance-checks-ts:\n/, true);
  for (const t of TESTS) assert.ok(govCmds.join(" ").includes(t), `governance-checks-ts runs ${t}`);
}

function assertTaskfile(tree: TaskfileTree): void {
  assert.ok(tree.byName.has("check-plan-review"), "Taskfile target");
  const want = `{{.REPO_DIR}}/${SCRIPT}`;
  assert.ok(taskCmds(tree, "check-plan-review").some((c) => c.includes(want)));
}

describe("check-plan-review CI wiring", () => {
  test("ci/ci-capabilities.yml", () => assertCapabilities(read("ci", "ci-capabilities.yml")));
  test("GitHub workflow", () => assertGithub(readWorkflowUnionText(REPO)));
  test("GitLab pipeline", () => assertGitlab(read(".gitlab-ci.yml")));
  test("Taskfile target", () => assertTaskfile(loadTaskfileTree(REPO)));

  test("mutation: a job that never expects a skip is rejected", () => {
    assert.throws(() =>
      assertGithub(
        readWorkflowUnionText(REPO),
        ciTaskCommands("governance-checks-ts"),
        ciTaskCommands(ID).map((c) => c.replaceAll(" skipped", " ok")),
      ),
    );
  });
  test("mutation: a governance job without the unit test is rejected", () => {
    assert.throws(() =>
      assertGitlab(
        read(".gitlab-ci.yml"),
        ciTaskCommands("governance-checks-ts").map((c) =>
          c.replaceAll("scripts/tests/check-plan-review.test.ts", ""),
        ),
      ),
    );
  });
  test("mutation: a capability on the wrong runtime is rejected", () => {
    assert.throws(() =>
      assertCapabilities(
        read("ci", "ci-capabilities.yml").replace(
          /(id: check-plan-review[\s\S]*?runtime: )node@24/,
          "$1node@22",
        ),
      ),
    );
  });
});
