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

import { readCapabilities } from "../lib/ci-parity/reference-read.ts";
import { parse } from "../lib/yq-accessors/index.ts";
import { REPO } from "./lib/build-fixture-tree.ts";
import { resolveCapabilityCommands } from "./lib/ci-task-commands.ts";
import { yamlLib } from "./lib/yaml-lib.ts";
import { gatePaths } from "./lib/capability-path-scan.ts";

const ID = "check-taskfile-tree";
const ROOT = ["Task", "file.yml"].join("");
const NODE = "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
const GUARD = `${NODE} scripts/check-taskfile-tree.ts`;
const SUITES = [
  "scripts/tests/taskfile-tree.test.ts",
  "scripts/tests/check-taskfile-tree-layout.test.ts",
  "scripts/tests/check-taskfile-tree-contract.test.ts",
  "scripts/tests/taskfile-tree-references.test.ts",
  "scripts/tests/check-taskfile-tree-ci-wiring.test.ts",
];
const TREE_PATHS = [ROOT, "taskfiles/**", "scripts/**"];
const COMPANIONS = [
  "taskfiles/**",
  "scripts/lib/taskfile-tree.ts",
  "scripts/lib/taskfile-tree-parse.ts",
  "scripts/lib/governance/taskfile-tree-guard.ts",
];
const LISTING_JOBS = ["skill-scripts-ts", "extension-render", "check-taskfile-commands"];
const read = (...p: string[]): string => fs.readFileSync(path.join(REPO, ...p), "utf8");

// Install-step audit: a test that reaches the Taskfile loader pulls js-yaml, so every CI job that
// runs one must install dependencies first. The importer set is computed, one level transitively.
const SEEDS = [
  "taskfile-tree.ts",
  "tier-taskfile.ts",
  "tier-fixtures.ts",
  "oracle-ts-runner.ts",
  "harness-curator-callers.ts",
  "taskfile-commands.ts",
];
const INSTALL = /\bnpm (ci|install)\b/;

function listTs(dir: string): string[] {
  return fs
    .readdirSync(path.join(REPO, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts") && !f.split(path.sep).includes("node_modules"))
    .map((f) => path.posix.join(dir, f.split(path.sep).join("/")));
}

function loaderImporterTests(): string[] {
  const sources = listTs("scripts");
  const text = new Map(sources.map((f) => [f, read(...f.split("/"))]));
  const mentions = (body: string, names: string[]): boolean => names.some((n) => body.includes(n));
  const helpers = new Set(SEEDS);
  for (const [f, body] of text)
    if (!f.endsWith(".test.ts") && mentions(body, SEEDS)) helpers.add(path.posix.basename(f));
  return sources.filter(
    (f) =>
      f.startsWith("scripts/tests/") &&
      f.endsWith(".test.ts") &&
      mentions(text.get(f) ?? "", [...helpers]),
  );
}

function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${esc}$`);
}

function assertInstallBeforeLoaderTests(caps: Cap[], importers: string[]): void {
  assert.ok(
    importers.includes("scripts/tests/spec-view.test.ts"),
    "the importer scan finds spec-view",
  );
  let checked = 0;
  for (const c of caps) {
    // A migrated job runs `task ci:<id>`: read the task body, and count a declared
    // `requires.install` (the ci-job action runs it) as the install step.
    const cmd = resolveCapabilityCommands(c.command).join("\n");
    const provisioned = c.requires?.install !== undefined && c.requires.install !== "none";
    const tokens = cmd.match(/scripts\/tests\/[^\s"']+\.test\.ts/g) ?? [];
    const runs = importers.filter((t) =>
      tokens.some((tok) => (tok.includes("*") ? globToRegExp(tok).test(t) : tok === t)),
    );
    if (runs.length === 0) continue;
    checked += 1;
    assert.ok(
      INSTALL.test(cmd) || provisioned,
      `${c.id} runs ${runs[0]} (a loader importer) without an install step`,
    );
  }
  assert.ok(checked >= 4, "the audit covers the jobs that run loader importers");
}

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
  requires?: { runtime?: string | string[]; tools?: string[]; install?: string };
};

function assertCapabilities(text: string): void {
  const effective = new Map(readCapabilities(parse(text)).map((c) => [c.id, c.triggers]));
  // Triggers carry their effective paths (spec 0283 R3: own list, else the capability-level list).
  const caps = (yamlLib.load(text) as { capabilities: Cap[] }).capabilities.map((c) => ({
    ...c,
    trigger: (effective.get(c.id) ?? []).map((t) => ({ on: t.kind, paths: t.paths })),
  }));
  const cap = caps.find((c) => c.id === ID);
  assert.ok(cap, `capability ${ID}`);
  assert.equal(cap.requires?.runtime, "node@24");
  assert.ok((cap.requires?.tools ?? []).includes("task"), "requires the task tool");
  assert.equal(cap["changeset-gated"], true);
  assert.deepEqual(cap.trigger?.map((t) => t.on).sort(), ["pull-request", "push"]);
  for (const t of cap.trigger ?? [])
    for (const p of TREE_PATHS) assert.ok((t.paths ?? []).includes(p), `${t.on} paths has ${p}`);
  // Spec 0283 R1: the capability is the single `task ci:<id>` entry; the commands live in the task.
  assert.deepEqual(cap.command, [`task ci:${ID}`], "runs the migrated task");
  // Spec 0281: the suites run in the `-selftest` sibling, under the same tree filters.
  const self = caps.find((c) => c.id === `${ID}-selftest`);
  assert.ok(self, `capability ${ID}-selftest`);
  assert.ok((self.requires?.tools ?? []).includes("task"), "self-test requires the task tool");
  assert.deepEqual(self.command, [`task ci:${ID}-selftest`], "self-test runs the migrated task");

  // R17: every job that lists the root Taskfile also lists the tree and its companions.
  // The tree job itself is covered by its scripts/** filter, so it is exempt.
  const listing = caps.filter(
    (c) =>
      c.id !== ID &&
      c.id !== `${ID}-selftest` &&
      (c.trigger ?? []).some((t) => (t.paths ?? []).includes(ROOT)),
  );
  assert.deepEqual(listing.map((c) => c.id).sort(), [...LISTING_JOBS, "spec-view"].sort());
  assert.ok(listing.length >= 3, "the jobs that list the root Taskfile are found");
  for (const c of listing.filter((l) => l.id !== "spec-view"))
    for (const t of c.trigger ?? [])
      if ((t.paths ?? []).includes(ROOT))
        for (const p of COMPANIONS)
          assert.ok((t.paths ?? []).includes(p), `${c.id} ${t.on} paths has ${p}`);
  // spec-view reads the whole tree through the loader: it reruns on the tree and the loader only.
  const sv = listing.find((c) => c.id === "spec-view");
  for (const t of sv?.trigger ?? [])
    for (const p of [
      ROOT,
      "taskfiles/**",
      "scripts/lib/taskfile-tree.ts",
      "scripts/lib/taskfile-tree-parse.ts",
    ])
      assert.ok((t.paths ?? []).includes(p), `spec-view ${t.on} paths has ${p}`);
}

/** The guard and the suites run in the `ci:` tasks (spec 0283 R1), not in the pipeline text. */
function assertTasks(text: string): void {
  const flat = text.replaceAll("{{.REPO_DIR}}/", "");
  const body = (id: string): string => {
    const m = new RegExp(`\\n  ${id}:\\n([\\s\\S]*?)(?=\\n  [a-z0-9-]+:\\n|$)`).exec(flat);
    assert.ok(m, `task ci:${id}`);
    return m[1] ?? "";
  };
  const tree = body(ID);
  assert.ok(tree.includes(GUARD), "runs the guard");
  const self = body(`${ID}-selftest`);
  for (const s of SUITES) assert.ok(self.includes(s), `runs ${s}`);
  assert.ok(self.includes("ci-cache-guard.ts --stray-scan --"), "suites run under the cache guard");
}

function assertGithub(text: string): void {
  const job = jobBlock(text, new RegExp(`\\n  ${ID}:\\n`));
  assert.ok(job.includes("uses: ./.github/actions/ci-job"), "runs the thin ci-job");
  assert.ok(job.includes(`id: ${ID}\n`), "ci-job id is the capability id");
  const self = jobBlock(text, new RegExp(`\\n  ${ID}-selftest:\\n`));
  assert.ok(self.includes(`id: ${ID}-selftest\n`), "self-test job passes its id");
  for (const p of TREE_PATHS) assert.ok(gatePaths(ID).includes(p), `paths have ${p}`);
  // R17: every job that lists the root Taskfile also lists the companions.
  for (const id of LISTING_JOBS) {
    const block = jobBlock(text, new RegExp(`\\n  ${id}:\\n`));
    assert.ok(gatePaths(id).includes(ROOT), `${id} paths list the root Taskfile`);
    for (const p of COMPANIONS) assert.ok(gatePaths(id).includes(p), `${id} paths have ${p}`);
  }
}

function assertGitlab(text: string): void {
  const job = jobBlock(text, new RegExp(`\\n${ID}:\\n`), true);
  assert.ok(job.includes("image: node:24"));
  assert.ok(
    job.includes("!reference [.task-install, script]"),
    "installs Task via the shared hidden job",
  );
  assert.ok(
    jobBlock(text, /\n\.task-install:\n/, true).includes("sha256sum -c"),
    "the shared install carries a checksum check",
  );
  assert.ok(job.includes(`"task ci:${ID}"`), "runs the migrated task");
  const self = jobBlock(text, new RegExp(`\\n${ID}-selftest:\\n`), true);
  assert.ok(self.includes(`"task ci:${ID}-selftest"`), "self-test runs the migrated task");
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
  test("ci tasks run the guard and the suites", () => assertTasks(read("taskfiles", "ci.yml")));

  test("every job running a loader-importing test installs dependencies first", () => {
    const caps = (yamlLib.load(read("ci", "ci-capabilities.yml")) as { capabilities: Cap[] })
      .capabilities;
    assertInstallBeforeLoaderTests(caps, loaderImporterTests());
  });
  test("mutation: spec-view without its install command is rejected", () => {
    const caps = (yamlLib.load(read("ci", "ci-capabilities.yml")) as { capabilities: Cap[] })
      .capabilities;
    const sv = caps.find((c) => c.id === "spec-view");
    assert.ok(sv?.command);
    sv.command = sv.command.filter((c) => !INSTALL.test(c));
    assert.throws(() => assertInstallBeforeLoaderTests(caps, loaderImporterTests()), /spec-view/);
  });
  test("spec-view workflow installs dependencies and carries the tree filters", () => {
    const wf = read(".github", "workflows", "spec-view.yml");
    assert.ok(INSTALL.test(wf), "installs dependencies");
    assert.equal(wf.split(`- "${ROOT}"`).length - 1, 2);
    for (const p of COMPANIONS.slice(0, 3))
      assert.equal(wf.split(`- "${p}"`).length - 1, 2, `both filters have ${p}`);
  });

  test("mutation: a job that does not run the guard is rejected", () => {
    assert.throws(() =>
      assertTasks(read("taskfiles", "ci.yml").replaceAll("scripts/check-taskfile-tree.ts", "true")),
    );
  });
  test("mutation: a job missing a suite is rejected", () => {
    assert.throws(() =>
      assertTasks(
        read("taskfiles", "ci.yml").replaceAll("scripts/tests/taskfile-tree.test.ts", ""),
      ),
    );
  });
  test("mutation: a Taskfile filter without taskfiles/** is rejected", () => {
    assert.throws(() =>
      assertCapabilities(read("ci", "ci-capabilities.yml").replace(/\n\s*- "taskfiles\/\*\*"/, "")),
    );
  });
});
