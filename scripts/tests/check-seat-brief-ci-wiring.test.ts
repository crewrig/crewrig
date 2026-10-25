// check-seat-brief-ci-wiring.test.ts — the CI reference, the GitHub workflow and the GitLab
// pipeline wire the seat brief linter (spec 0276 R10, R11): a focused, path-filtered,
// changeset-gated job that runs the script on a conforming and a breaching committed fixture,
// and the unit and wiring tests in the governance job.
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

const ID = "check-seat-brief";
const SCRIPT = "scripts/check-seat-brief.ts";
const NODE = "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
const CONFORMING = `${NODE} ${SCRIPT} scripts/tests/fixtures/seat-brief/conforming-review.txt`;
const BREACHING = `! ${NODE} ${SCRIPT} scripts/tests/fixtures/seat-brief/breach-1410.txt`;
const TESTS = [
  "scripts/tests/check-seat-brief.test.ts",
  "scripts/tests/check-seat-brief-ci-wiring.test.ts",
  "scripts/tests/check-comment-size-ci-wiring.test.ts",
];
const PATHS = [
  "scripts/check-seat-brief.ts",
  "scripts/lib/governance/seat-brief.ts",
  "scripts/tests/check-seat-brief*",
  "scripts/tests/fixtures/seat-brief/**",
];
const read = (...p: string[]): string => fs.readFileSync(path.join(REPO, ...p), "utf8");

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
        "changeset-gated"?: boolean;
        paths?: string[];
        trigger?: { paths?: string[] }[];
        requires?: { runtime?: string };
      }[];
    }
  ).capabilities;
  const cap = caps.find((c) => c.id === ID);
  assert.ok(cap, `capability ${ID}`);
  assert.equal(cap.requires?.runtime, "node@24");
  assert.deepEqual(cap.command, [`task ci:${ID}`]);
  assert.deepEqual(resolveCapabilityCommands(cap.command), [CONFORMING, BREACHING]);
  assert.equal(cap["changeset-gated"], true);
  assert.equal(cap.trigger?.length, 2);
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
  assert.ok(cmds.includes(CONFORMING));
  assert.ok(cmds.includes(BREACHING));
  const gov = jobBlock(text, /\n {2}governance-checks-ts:\n/);
  for (const t of TESTS) assert.ok(govCmds.join(" ").includes(t), `governance-checks-ts runs ${t}`);
  for (const p of ["scripts/tests/fixtures/seat-brief/**", "scripts/tests/check-seat-brief*"])
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
  assert.ok(cmds.includes(CONFORMING));
  assert.ok(cmds.includes(BREACHING));
  const gov = jobBlock(text, /\ngovernance-checks-ts:\n/, true);
  for (const t of TESTS) assert.ok(govCmds.join(" ").includes(t), `governance-checks-ts runs ${t}`);
}

function assertTaskfile(tree: TaskfileTree): void {
  assert.ok(tree.byName.has("check-seat-brief"), "Taskfile target");
  const want = `${NODE} {{.REPO_DIR}}/${SCRIPT}`;
  assert.ok(taskCmds(tree, "check-seat-brief").some((c) => c.includes(want)));
}

describe("check-seat-brief CI wiring", () => {
  test("ci/ci-capabilities.yml", () => assertCapabilities(read("ci", "ci-capabilities.yml")));
  test("GitHub workflow", () => assertGithub(readWorkflowUnionText(REPO)));
  test("GitLab pipeline", () => assertGitlab(read(".gitlab-ci.yml")));
  test("Taskfile target", () => assertTaskfile(loadTaskfileTree(REPO)));

  test("mutation: a job that does not run the breaching fixture is rejected", () => {
    assert.throws(() =>
      assertGithub(
        readWorkflowUnionText(REPO),
        ciTaskCommands("governance-checks-ts"),
        ciTaskCommands(ID).map((c) => c.replace(BREACHING, "true")),
      ),
    );
  });
  test("mutation: a governance job without the seat brief test is rejected", () => {
    assert.throws(() =>
      assertGitlab(
        read(".gitlab-ci.yml"),
        ciTaskCommands("governance-checks-ts").map((c) =>
          c.replaceAll("scripts/tests/check-seat-brief.test.ts", ""),
        ),
      ),
    );
  });
  test("mutation: a capability on the wrong runtime is rejected", () => {
    assert.throws(() =>
      assertCapabilities(
        read("ci", "ci-capabilities.yml").replace(
          /(id: check-seat-brief[\s\S]*?runtime: )node@24/,
          "$1node@22",
        ),
      ),
    );
  });
});
