// check-comment-size-ci-wiring.test.ts — the CI reference, the GitHub workflow and the GitLab
// pipeline wire the comment size tool (spec 0275 R-E2): a job that runs the script on the two
// committed fixtures (one under, one over budget), and the unit tests in the governance job.
//
// Assertions are functions over text so the mutation tests run the same functions on mutated copies.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { loadTaskfileTree, taskCmds, type TaskfileTree } from "../lib/taskfile-tree.ts";
import { REPO } from "./lib/build-fixture-tree.ts";
import { ciTaskCommands, resolveCapabilityCommands } from "./lib/ci-task-commands.ts";
import { yamlLib } from "./lib/yaml-lib.ts";

const ID = "check-comment-size";
const SCRIPT = "scripts/check-comment-size.ts";
const NODE = "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
const UNDER = `${NODE} ${SCRIPT} scripts/tests/fixtures/comment-size/under.txt`;
const OVER = `! ${NODE} ${SCRIPT} scripts/tests/fixtures/comment-size/over.txt`;
const TESTS = [
  "scripts/tests/check-comment-size.test.ts",
  "scripts/tests/seat-ledger.test.ts",
  "scripts/tests/economy-measure.test.ts",
];
const read = (...p: string[]): string => fs.readFileSync(path.join(REPO, ...p), "utf8");

function jobBlock(text: string, header: RegExp, gitlab = false): string {
  const m = header.exec(text);
  assert.ok(m, `job ${header} present`);
  const rest = text.slice(m.index + 1);
  const next = rest.search(gitlab ? /\n[a-z0-9-]+:\n/ : /\n {2}[a-z0-9-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next);
}

/** The fixtures run in the task body, which is the single source of both CI engines' commands. */
function assertTaskRunsFixtures(cmds: string[] = ciTaskCommands(ID)): void {
  assert.deepEqual(cmds, [UNDER, OVER]);
}

function assertCapabilities(text: string): void {
  const caps = (
    yamlLib.load(text) as {
      capabilities: { id: string; command?: string[]; requires?: { runtime?: string } }[];
    }
  ).capabilities;
  const cap = caps.find((c) => c.id === ID);
  assert.ok(cap, `capability ${ID}`);
  assert.equal(cap.requires?.runtime, "node@24");
  assert.deepEqual(cap.command, [`task ci:${ID}`]);
  assert.deepEqual(resolveCapabilityCommands(cap.command), [UNDER, OVER]);
  const gov = caps.find((c) => c.id === "governance-checks-ts");
  assert.ok(gov);
  for (const t of TESTS)
    assert.ok(resolveCapabilityCommands(gov.command).join(" ").includes(t), `governance runs ${t}`);
}

function assertGithub(
  text: string,
  govCmds: string[] = ciTaskCommands("governance-checks-ts"),
): void {
  const job = jobBlock(text, new RegExp(`\\n  ${ID}:\\n`));
  assert.ok(job.includes(`id: ${ID}`), "thin ci-job call");
  assertTaskRunsFixtures();
  const gov = jobBlock(text, /\n {2}governance-checks-ts:\n/);
  for (const t of TESTS) assert.ok(govCmds.join(" ").includes(t), `governance-checks-ts runs ${t}`);
  for (const p of [
    "scripts/tests/fixtures/comment-size/**",
    "scripts/tests/fixtures/seat-ledger/**",
    "scripts/tests/fixtures/economy-1410/**",
    "scripts/lib/seat-ledger*.ts",
  ])
    assert.ok(gov.includes(`'${p}'`), `filter has ${p}`);
}

function assertGitlab(
  text: string,
  govCmds: string[] = ciTaskCommands("governance-checks-ts"),
): void {
  const job = jobBlock(text, new RegExp(`\\n${ID}:\\n`), true);
  assert.ok(job.includes("image: node:24"));
  assert.ok(job.includes(`task ci:${ID}`), "runs the task");
  assertTaskRunsFixtures();
  const gov = jobBlock(text, /\ngovernance-checks-ts:\n/, true);
  for (const t of TESTS) assert.ok(govCmds.join(" ").includes(t), `governance-checks-ts runs ${t}`);
}

function assertTaskfile(tree: TaskfileTree): void {
  assert.ok(tree.byName.has("check-comment-size"), "Taskfile target");
  const want = `${NODE} {{.REPO_DIR}}/${SCRIPT}`;
  assert.ok(taskCmds(tree, "check-comment-size").some((c) => c.includes(want)));
}

describe("check-comment-size CI wiring", () => {
  test("ci/ci-capabilities.yml", () => assertCapabilities(read("ci", "ci-capabilities.yml")));
  test("GitHub workflow", () => assertGithub(read(".github", "workflows", "build.yml")));
  test("GitLab pipeline", () => assertGitlab(read(".gitlab-ci.yml")));
  test("Taskfile target", () => assertTaskfile(loadTaskfileTree(REPO)));

  test("mutation: a job that does not run the over-budget fixture is rejected", () => {
    assert.throws(() => assertTaskRunsFixtures(ciTaskCommands(ID).filter((c) => c !== OVER)));
  });
  test("mutation: a governance job without the ledger test is rejected", () => {
    assert.throws(() =>
      assertGitlab(
        read(".gitlab-ci.yml"),
        ciTaskCommands("governance-checks-ts").map((c) =>
          c.replaceAll("scripts/tests/seat-ledger.test.ts", ""),
        ),
      ),
    );
  });
  test("mutation: a capability on the wrong runtime is rejected", () => {
    assert.throws(() =>
      assertCapabilities(
        read("ci", "ci-capabilities.yml").replace(
          /(id: check-comment-size[\s\S]*?runtime: )node@24/,
          "$1node@22",
        ),
      ),
    );
  });
});
