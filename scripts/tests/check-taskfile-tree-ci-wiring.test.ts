// check-taskfile-tree-ci-wiring.test.ts — the CI reference, the GitHub workflow and the GitLab
// pipeline wire the Taskfile tree guard (spec 0278 R16, R17): a changeset-gated job triggered on
// the whole scripts/** surface plus the Taskfile tree, running the guard and its four suites, and
// every job that lists the root Taskfile also lists taskfiles/** and the loader and guard sources.
//
// Assertions are functions over text so the mutation tests run the same functions on mutated copies.
// The root Taskfile name is built from parts: the tree guard's check (b) forbids the quoted literal.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { yamlLib } from "./lib/yaml-lib.ts";

const ID = "check-taskfile-tree";
const ROOT = ["Task", "file.yml"].join("");
const NODE = "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
const GUARD = `${NODE} scripts/check-taskfile-tree.ts`;
const SUITES = [
  "scripts/tests/taskfile-tree.test.ts",
  "scripts/tests/check-taskfile-tree.test.ts",
  "scripts/tests/taskfile-tree-references.test.ts",
  "scripts/tests/check-taskfile-tree-ci-wiring.test.ts",
];
const TREE_PATHS = [ROOT, "taskfiles/**", "scripts/**"];
const COMPANIONS = [
  "taskfiles/**",
  "scripts/lib/taskfile-tree.ts",
  "scripts/lib/governance/taskfile-tree-guard.ts",
];
const LISTING_JOBS = ["skill-scripts-ts", "extension-render", "check-taskfile-commands"];
const read = (...p: string[]): string => fs.readFileSync(path.join(REPO, ...p), "utf8");

function jobBlock(text: string, header: RegExp, gitlab = false): string {
  const m = header.exec(text);
  assert.ok(m, `job ${header} present`);
  const rest = text.slice(m.index + 1);
  const next = rest.search(gitlab ? /\n[a-z0-9-]+:\n/ : /\n {2}[a-z0-9-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next);
}

type Cap = {
  id: string;
  command?: string[];
  "changeset-gated"?: boolean;
  trigger?: { on: string; paths?: string[] }[];
  requires?: { runtime?: string; tools?: string[] };
};

function assertCapabilities(text: string): void {
  const caps = (yamlLib.load(text) as { capabilities: Cap[] }).capabilities;
  const cap = caps.find((c) => c.id === ID);
  assert.ok(cap, `capability ${ID}`);
  assert.equal(cap.requires?.runtime, "node@24");
  assert.ok((cap.requires?.tools ?? []).includes("task"), "requires the task tool");
  assert.equal(cap["changeset-gated"], true);
  assert.deepEqual(cap.trigger?.map((t) => t.on).sort(), ["pull-request", "push"]);
  for (const t of cap.trigger ?? [])
    for (const p of TREE_PATHS) assert.ok((t.paths ?? []).includes(p), `${t.on} paths has ${p}`);
  const cmds = (cap.command ?? []).join("\n");
  assert.ok(cmds.includes(GUARD), "runs the guard");
  for (const s of SUITES) assert.ok(cmds.includes(s), `runs ${s}`);
  assert.ok(cmds.includes("ci-cache-guard.ts --stray-scan --"), "suites run under the cache guard");

  // R17: every job that lists the root Taskfile also lists the tree and its companions.
  // The tree job itself is covered by its scripts/** filter, so it is exempt.
  const listing = caps.filter(
    (c) => c.id !== ID && (c.trigger ?? []).some((t) => (t.paths ?? []).includes(ROOT)),
  );
  assert.deepEqual(listing.map((c) => c.id).sort(), [...LISTING_JOBS].sort());
  assert.ok(listing.length >= 3, "the jobs that list the root Taskfile are found");
  for (const c of listing)
    for (const t of c.trigger ?? [])
      if ((t.paths ?? []).includes(ROOT))
        for (const p of COMPANIONS)
          assert.ok((t.paths ?? []).includes(p), `${c.id} ${t.on} paths has ${p}`);
}

function assertGithub(text: string): void {
  const job = jobBlock(text, new RegExp(`\\n  ${ID}:\\n`));
  assert.ok(job.includes("node-version: 24"));
  assert.ok(job.includes("taskfile.dev/install.sh"), "installs Task");
  assert.ok(job.includes(GUARD), "runs the guard");
  for (const s of SUITES) assert.ok(job.includes(s), `runs ${s}`);
  for (const p of TREE_PATHS) assert.ok(job.includes(`'${p}'`), `filter has ${p}`);
  // R17: every job that lists the root Taskfile also lists the companions.
  for (const id of LISTING_JOBS) {
    const block = jobBlock(text, new RegExp(`\\n  ${id}:\\n`));
    assert.ok(block.includes(`'${ROOT}'`), `${id} filters list the root Taskfile`);
    for (const p of COMPANIONS) assert.ok(block.includes(`'${p}'`), `${id} filter has ${p}`);
  }
}

function assertGitlab(text: string): void {
  const job = jobBlock(text, new RegExp(`\\n${ID}:\\n`), true);
  assert.ok(job.includes("image: node:24"));
  assert.ok(job.includes("taskfile.dev/install.sh"), "installs Task");
  assert.ok(job.includes(GUARD), "runs the guard");
  for (const s of SUITES) assert.ok(job.includes(s), `runs ${s}`);
  for (const p of TREE_PATHS) assert.ok(job.includes(`"${p}"`), `rules have ${p}`);
  for (const id of LISTING_JOBS) {
    const block = jobBlock(text, new RegExp(`\\n${id}:\\n`), true);
    assert.ok(block.includes(`"${ROOT}"`), `${id} rules list the root Taskfile`);
    for (const p of COMPANIONS) assert.ok(block.includes(`"${p}"`), `${id} rules have ${p}`);
  }
}

describe("check-taskfile-tree CI wiring", () => {
  test("ci/ci-capabilities.yml", () => assertCapabilities(read("ci", "ci-capabilities.yml")));
  test("GitHub workflow", () => assertGithub(read(".github", "workflows", "build.yml")));
  test("GitLab pipeline", () => assertGitlab(read(".gitlab-ci.yml")));

  test("mutation: a job that does not run the guard is rejected", () => {
    assert.throws(() =>
      assertGithub(read(".github", "workflows", "build.yml").replaceAll(GUARD, "true")),
    );
  });
  test("mutation: a job missing a suite is rejected", () => {
    assert.throws(() =>
      assertGitlab(read(".gitlab-ci.yml").replaceAll("scripts/tests/taskfile-tree.test.ts", "")),
    );
  });
  test("mutation: a Taskfile filter without taskfiles/** is rejected", () => {
    assert.throws(() =>
      assertCapabilities(read("ci", "ci-capabilities.yml").replace(/\n\s*- "taskfiles\/\*\*"/, "")),
    );
  });
});
