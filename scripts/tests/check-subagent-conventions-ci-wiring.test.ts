// check-subagent-conventions-ci-wiring.test.ts — the subagent conventions check JOINS the existing
// check-description-length capability, GitHub job, GitLab job and task (spec 0306 R19 as amended by
// delta 01, R25 line budget): no capability, GitHub job or GitLab job of its own; the task runs the
// script on the repository, on a conforming and on every breaching committed root, then the unit and
// wiring tests; the path filter covers the script, its tests and fixtures, the fragment, the agent
// sources and the four agent trees, and the build library; the GitLab `changes` list equals it.
//
// Assertions are functions over text so the mutation tests run the same functions on mutated copies.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { globToRegExp } from "../lib/glob-engine.ts";
import { loadTaskfileTree, taskCmds, type TaskfileTree } from "../lib/taskfile-tree.ts";
import { REPO } from "./lib/build-fixture-tree.ts";
import {
  ciTaskCommands,
  ciTaskDelegatedCommands,
  effectivePaths,
  resolveCapabilityCommands,
} from "./lib/ci-task-commands.ts";
import { yamlLib } from "./lib/yaml-lib.ts";
import { readWorkflowUnionText } from "./lib/workflow-union.ts";

const ID = "check-subagent-conventions";
const HOST = "check-description-length";
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
const TESTS = [
  "scripts/tests/check-subagent-conventions.test.ts",
  "scripts/tests/check-subagent-conventions-ci-wiring.test.ts",
];
const BUILD_TEST = "scripts/tests/build-components-conventions-block.test.ts";
// The entries delta 01 adds to the host capability (R25), and sample files the filter must select.
const ADDED = [
  SCRIPT,
  "scripts/tests/check-subagent-conventions*",
  `${FIXTURES}/**`,
  "scripts/lib/build-components/**",
];
const COVERED = [
  SCRIPT,
  TESTS[0] as string,
  `${FIXTURES}/pass/artifacts/core/agents/alpha/AGENT.md`,
  "artifacts/core/fragments/subagent-conventions.md",
  "artifacts/core/agents/developer/AGENT.md",
  ".claude/agents/developer.md",
  ".gemini/agents/developer.md",
  ".github/agents/developer.md",
  ".agents/agents/developer.md",
  "scripts/lib/build-components/emit.ts",
];
/** The host task's own commands plus those of the root tasks it delegates to. */
const hostCmds = (): string[] => [...ciTaskCommands(HOST), ...ciTaskDelegatedCommands(HOST)];
const read = (...p: string[]): string => fs.readFileSync(path.join(REPO, ...p), "utf8");

const runsScript = (c: string): boolean => c.includes(SCRIPT);
const onRoot = (c: string, root: string): boolean =>
  new RegExp(`${FIXTURES}/${root}(?![\\w-])`).test(c);

/** The commands the task runs: the repository, the conforming root, every breaching root negated, the tests. */
function assertCommands(cmds: string[]): void {
  for (const t of TESTS) assert.ok(cmds.join(" ").includes(t), `the task runs ${t}`);
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

interface Cap {
  id: string;
  paths?: string[];
  command?: string[];
  trigger?: { on?: string; branches?: string[]; paths?: string[] }[];
}
const capsOf = (text: string): Cap[] =>
  (yamlLib.load(text) as { capabilities: Cap[] }).capabilities;

function assertCapabilities(text: string, cmds: string[] = hostCmds()): void {
  const caps = capsOf(text);
  assert.equal(caps.filter((c) => c.id === ID).length, 0, `no capability ${ID} of its own`);
  const cap = caps.find((c) => c.id === HOST);
  assert.ok(cap, `capability ${HOST}`);
  assert.deepEqual(cap.command, [`task ci:${HOST}`]);
  assertCommands(cmds);
  for (const t of cap.trigger ?? []) {
    const eff = effectivePaths(cap, t);
    for (const p of ADDED) assert.ok(eff.includes(p), `${HOST} paths have ${p}`);
    for (const f of COVERED)
      assert.ok(
        eff.some((g) => globToRegExp(g).test(f)),
        `paths select ${f}`,
      );
  }
  const build = caps.find((c) => c.id === "build-components-ts");
  assert.ok(build);
  assert.ok(
    resolveCapabilityCommands(build.command).join(" ").includes(BUILD_TEST),
    `build-components-ts runs ${BUILD_TEST}`,
  );
  assert.ok(
    effectivePaths(build, build.trigger?.[0] ?? {}).includes("artifacts/core/fragments/**"),
    "build-components-ts paths have the fragment",
  );
}

function assertGithub(text: string): void {
  assert.ok(!new RegExp(`\\n  ${ID}:\\n`).test(text), `no GitHub job ${ID}`);
  const job = jobBlock(text, new RegExp(`\\n  ${HOST}:\\n`));
  assert.ok(job.includes(`id: ${HOST}`) && job.includes("./.github/actions/ci-job"), "host job");
}

function gitlabChanges(job: string): string[] {
  const m = /changes: &\S+\n((?: {8}- .+\n)+)/.exec(job);
  assert.ok(m, "the GitLab job has a changes list");
  return (m[1] ?? "")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.replace(/^ +- "?|"?$/g, ""));
}

function assertGitlab(text: string, paths: readonly string[]): void {
  assert.ok(!new RegExp(`\\n${ID}:\\n`).test(text), `no GitLab job ${ID}`);
  const job = jobBlock(text, new RegExp(`\\n${HOST}:\\n`), true);
  assert.ok(job.includes(`task ci:${HOST}`), "runs the host task");
  assert.deepEqual(gitlabChanges(job), [...paths], "GitLab changes equal the capability paths");
}

function assertTaskfile(tree: TaskfileTree): void {
  assert.ok(!tree.byName.has(`ci:${ID}`), `no ci:${ID} task`);
  assert.ok(tree.byName.has(ID), "local mirror task");
  assert.ok(taskCmds(tree, ID).some((c) => c.includes(SCRIPT)));
}

const capPaths = (): string[] => {
  const cap = capsOf(read("ci", "ci-capabilities.yml")).find((c) => c.id === HOST);
  return effectivePaths(cap as Cap, (cap as Cap).trigger?.[0] ?? {});
};

describe("check-subagent-conventions CI wiring (joined to check-description-length)", () => {
  test("ci/ci-capabilities.yml", () => assertCapabilities(read("ci", "ci-capabilities.yml")));
  test("GitHub workflow", () => assertGithub(readWorkflowUnionText(REPO)));
  test("GitLab pipeline", () => assertGitlab(read(".gitlab-ci.yml"), capPaths()));
  test("Taskfile mirror", () => assertTaskfile(loadTaskfileTree(REPO)));
  test("mutation: a task that does not run a breaching root is rejected", () => {
    assert.throws(() =>
      assertCapabilities(
        read("ci", "ci-capabilities.yml"),
        hostCmds().filter((c) => !onRoot(c, "stale-block")),
      ),
    );
  });
  test("mutation: a task without the wiring test is rejected", () => {
    assert.throws(() =>
      assertCapabilities(
        read("ci", "ci-capabilities.yml"),
        hostCmds().map((c) => c.replaceAll("check-subagent-conventions-ci-wiring.test.ts", "")),
      ),
    );
  });
  test("mutation: a dedicated capability or GitLab job is rejected", () => {
    assert.throws(() =>
      assertCapabilities(
        `${read("ci", "ci-capabilities.yml")}  - id: ${ID}\n`.replace(/\n$/, "\n"),
      ),
    );
    assert.throws(() =>
      assertGitlab(`${read(".gitlab-ci.yml")}\n${ID}:\n  stage: governance\n`, capPaths()),
    );
  });
  test("mutation: a GitLab changes list that drifts from the paths is rejected", () => {
    assert.throws(() => assertGitlab(read(".gitlab-ci.yml"), capPaths().slice(1)));
  });
});
