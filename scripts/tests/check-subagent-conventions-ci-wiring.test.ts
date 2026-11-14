// check-subagent-conventions-ci-wiring.test.ts — the CI reference, the GitHub workflow, the GitLab
// pipeline and the Taskfile wire the subagent conventions check (spec 0306 R19; plan v2 v1-F1):
// a focused, path-filtered, changeset-gated job that runs the script on the repository, on a
// conforming and on every breaching committed root, plus the unit and wiring tests in the
// governance job, and the new build test in the build-components job.
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

const ID = "check-subagent-conventions";
const SCRIPT = "scripts/check-subagent-conventions.ts";
const FIXTURES = "scripts/tests/fixtures/subagent-conventions";
const BREACHING_ROOTS = [
  "fragment-invalid",
  "fragment-invalid-provenance",
  "missing-block",
  "stale-block",
  "missing-omit-key",
  "foreign-omit-key",
  "source-carries-block",
  "no-fragment",
];
const GOVERNANCE_TESTS = [
  "scripts/tests/check-subagent-conventions.test.ts",
  "scripts/tests/check-subagent-conventions-ci-wiring.test.ts",
];
const BUILD_TEST = "scripts/tests/build-components-conventions-block.test.ts";
const PATHS = [
  SCRIPT,
  "scripts/lib/governance/subagent-conventions.ts",
  "scripts/tests/check-subagent-conventions*",
  `${FIXTURES}/**`,
  "artifacts/core/fragments/**",
  "artifacts/*/agents/**",
  ".claude/agents/**",
  ".gemini/agents/**",
  ".github/agents/**",
  ".agents/agents/**",
  "scripts/lib/build-components/**",
];
const GOVERNANCE_PATHS = ["scripts/tests/check-subagent-conventions*", `${FIXTURES}/**`];
const read = (...p: string[]): string => fs.readFileSync(path.join(REPO, ...p), "utf8");

const runsScript = (c: string): boolean => c.includes(SCRIPT);
const onRoot = (c: string, root: string): boolean =>
  new RegExp(`${FIXTURES}/${root}(?![\\w-])`).test(c);

/** The commands the job runs: the repository, the conforming root, every breaching root negated. */
function assertCommands(cmds: string[]): void {
  const mine = cmds.filter(runsScript);
  assert.ok(
    mine.some((c) => !c.startsWith("!") && !c.includes(FIXTURES)),
    "runs the check on the repository",
  );
  assert.ok(
    mine.some((c) => !c.startsWith("!") && onRoot(c, "pass")),
    "runs the check on the conforming root",
  );
  for (const root of BREACHING_ROOTS)
    assert.ok(
      mine.some((c) => c.startsWith("!") && onRoot(c, root)),
      `runs the check on ${root} and expects a failure`,
    );
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
        group?: string;
        portability?: string;
        command?: string[];
        "changeset-gated"?: boolean;
        paths?: string[];
        trigger?: { on?: string; branches?: string[]; paths?: string[] }[];
        requires?: { runtime?: string; tools?: string[] };
      }[];
    }
  ).capabilities;
  const cap = caps.find((c) => c.id === ID);
  assert.ok(cap, `capability ${ID}`);
  assert.equal(cap.group, "governance");
  assert.equal(cap.portability, "portable");
  assert.equal(cap.requires?.runtime, "node@24");
  assert.deepEqual(cap.requires?.tools, ["task"]);
  assert.deepEqual(cap.command, [`task ci:${ID}`]);
  assertCommands(resolveCapabilityCommands(cap.command));
  assert.equal(cap["changeset-gated"], true);
  assert.deepEqual(cap.trigger?.map((t) => t.on).sort(), ["pull-request", "push"]);
  for (const t of cap.trigger ?? []) {
    assert.deepEqual(t.branches, ["main", "release/**"]);
    for (const p of PATHS) assert.ok(effectivePaths(cap, t).includes(p), `trigger paths has ${p}`);
  }
  const gov = caps.find((c) => c.id === "governance-checks-ts");
  assert.ok(gov);
  for (const t of GOVERNANCE_TESTS)
    assert.ok(resolveCapabilityCommands(gov.command).join(" ").includes(t), `governance runs ${t}`);
  const build = caps.find((c) => c.id === "build-components-ts");
  assert.ok(build);
  assert.ok(
    resolveCapabilityCommands(build.command).join(" ").includes(BUILD_TEST),
    `build-components-ts runs ${BUILD_TEST}`,
  );
}

function assertPaths(): void {
  for (const p of GOVERNANCE_PATHS)
    assert.ok(
      gatePaths("governance-checks-ts").includes(p),
      `governance-checks-ts paths have ${p}`,
    );
  assert.ok(
    gatePaths("build-components-ts").includes("artifacts/core/fragments/**"),
    "build-components-ts paths have the fragment",
  );
}

function assertGithub(
  text: string,
  govCmds: string[] = ciTaskCommands("governance-checks-ts"),
  cmds: string[] = ciTaskCommands(ID),
  buildCmds: string[] = ciTaskCommands("build-components-ts"),
): void {
  const job = jobBlock(text, new RegExp(`\\n  ${ID}:\\n`));
  assert.ok(job.includes(`id: ${ID}`) && job.includes("./.github/actions/ci-job"), "calls ci-job");
  assertCommands(cmds);
  for (const t of GOVERNANCE_TESTS)
    assert.ok(govCmds.join(" ").includes(t), `governance-checks-ts runs ${t}`);
  assert.ok(buildCmds.join(" ").includes(BUILD_TEST), `build-components-ts runs ${BUILD_TEST}`);
  jobBlock(text, /\n {2}governance-checks-ts:\n/);
}

function assertGitlab(
  text: string,
  govCmds: string[] = ciTaskCommands("governance-checks-ts"),
  cmds: string[] = ciTaskCommands(ID),
): void {
  const job = jobBlock(text, new RegExp(`\\n${ID}:\\n`), true);
  assert.ok(job.includes("image: node:24"));
  assert.ok(job.includes(`task ci:${ID}`), "runs the task");
  assertCommands(cmds);
  for (const t of GOVERNANCE_TESTS)
    assert.ok(govCmds.join(" ").includes(t), `governance-checks-ts runs ${t}`);
}

function assertTaskfile(tree: TaskfileTree): void {
  assert.ok(tree.byName.has(ID), "Taskfile target");
  assert.ok(taskCmds(tree, ID).some((c) => c.includes(SCRIPT)));
}

describe("check-subagent-conventions CI wiring", () => {
  test("ci/ci-capabilities.yml", () => assertCapabilities(read("ci", "ci-capabilities.yml")));
  test("path filters of governance-checks-ts and build-components-ts", () => assertPaths());
  test("GitHub workflow", () => assertGithub(readWorkflowUnionText(REPO)));
  test("GitLab pipeline", () => assertGitlab(read(".gitlab-ci.yml")));
  test("Taskfile target", () => assertTaskfile(loadTaskfileTree(REPO)));

  test("mutation: a job that does not run a breaching root is rejected", () => {
    assert.throws(() =>
      assertGithub(
        readWorkflowUnionText(REPO),
        ciTaskCommands("governance-checks-ts"),
        ciTaskCommands(ID).filter((c) => !onRoot(c, "stale-block")),
      ),
    );
  });
  test("mutation: a build-components job without the new test is rejected", () => {
    assert.throws(() =>
      assertGithub(
        readWorkflowUnionText(REPO),
        ciTaskCommands("governance-checks-ts"),
        ciTaskCommands(ID),
        ciTaskCommands("build-components-ts").map((c) =>
          c.replaceAll("build-components-conventions-block.test.ts", ""),
        ),
      ),
    );
  });
  test("mutation: a capability on the wrong runtime is rejected", () => {
    assert.throws(() =>
      assertCapabilities(
        read("ci", "ci-capabilities.yml").replace(
          /(id: check-subagent-conventions[\s\S]*?runtime: )node@24/,
          "$1node@22",
        ),
      ),
    );
  });
});
