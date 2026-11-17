// skill-evals-shipped.test.ts — evals/ is never shipped and existing tooling tolerates it
// (spec 0290 R7, R8, R25).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import { builtFiles, CONFIG, REPO, skill } from "./fixtures/build-components/entry-kit.ts";
import { commitAll, makeRepo, markOrigin, skillRel } from "./lib/skill-evals-fixtures.ts";

const body = "Body.\n";
const EXTRA = [
  "license: Apache-2.0",
  'compatibility: "needs node"',
  "metadata:",
  "  provenance:",
  '    version: "1.0.0"',
];

function evalsTree() {
  const tree = createFixtureTree();
  tree.config(CONFIG);
  tree.artifact("core/skills/probe/SKILL.md", skill("probe", body));
  tree.artifact("core/skills/probe/scripts/run.sh", "#!/bin/sh\necho hi\n");
  tree.artifact("core/skills/probe/references/ref.md", "ref\n");
  tree.artifact("core/skills/probe/assets/a.txt", "asset\n");
  tree.artifact("core/skills/probe/evals/evals.json", '{"skill_name":"probe","evals":[]}\n');
  tree.artifact("core/skills/probe/evals/results.json", "{}\n");
  tree.artifact("core/skills/probe/evals/files/in.txt", "input\n");
  return tree;
}

test("no built skill directory contains an evals/ path, for every CLI target, and the drift check passes", () => {
  const tree = evalsTree();
  const built = tree.run([]);
  assert.equal(built.status, 0, built.stderr + built.stdout);
  const files = builtFiles(tree);
  const skillFiles = files.filter((f) => f.includes("/skills/probe/"));
  assert.ok(
    skillFiles.length >= 4 * 4,
    `the skill is built for the four CLIs (${skillFiles.length} files)`,
  );
  assert.deepEqual(
    files.filter(
      (f) => /(^|\/)evals(\/|$)/.test(f) || f.endsWith("results.json") || f.endsWith("evals.json"),
    ),
    [],
  );
  assert.ok(
    skillFiles.some((f) => f.endsWith("scripts/run.sh")),
    "scripts/ still propagates",
  );
  const drift = tree.run(["--check"]);
  assert.equal(drift.status, 0, drift.stderr + drift.stdout);
});

test("a change touching only evals/ needs no version bump; a SKILL.md change without one is still caught", () => {
  const repo = makeRepo();
  try {
    const dir = path.join(repo.root, skillRel("demo"));
    fs.mkdirSync(path.join(dir, "evals"), { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), skill("demo", body, EXTRA));
    fs.writeFileSync(path.join(dir, "evals", "evals.json"), "{}\n");
    commitAll(repo, "base");
    markOrigin(repo);
    const check = () =>
      spawnSync(
        process.execPath,
        [
          "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
          path.join(REPO, "scripts", "check-skill-versions.ts"),
          "origin/main",
        ],
        {
          cwd: repo.root,
          encoding: "utf8",
          env: { PATH: process.env["PATH"] ?? "" },
        },
      );
    fs.writeFileSync(path.join(dir, "evals", "evals.json"), '{"changed":true}\n');
    fs.writeFileSync(path.join(dir, "evals", "results.json"), "{}\n");
    commitAll(repo, "evals only");
    const onlyEvals = check();
    assert.equal(onlyEvals.status, 0, onlyEvals.stdout + onlyEvals.stderr);
    fs.appendFileSync(path.join(dir, "SKILL.md"), "edit\n");
    commitAll(repo, "skill edit");
    assert.equal(check().status, 1, "the rule is not relaxed for SKILL.md itself");
  } finally {
    repo.cleanup();
  }
});

test("the skill linter accepts a skill directory that contains evals/", () => {
  const repo = makeRepo();
  try {
    const dir = path.join(repo.root, skillRel("demo"));
    fs.mkdirSync(path.join(dir, "evals", "files"), { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), skill("demo", body, EXTRA));
    fs.writeFileSync(path.join(dir, "evals", "evals.json"), "{}\n");
    fs.writeFileSync(path.join(dir, "evals", "results.json"), "{}\n");
    commitAll(repo, "base");
    markOrigin(repo);
    const r = spawnSync(
      process.execPath,
      [
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        path.join(REPO, "artifacts", "core", "skills", "pr-reviewer", "scripts", "lint-skill.ts"),
        path.join(dir, "SKILL.md"),
      ],
      {
        cwd: repo.root,
        encoding: "utf8",
        env: { PATH: process.env["PATH"] ?? "", BASE_REF: "origin/main" },
      },
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    repo.cleanup();
  }
});

test("the build copies only scripts/, references/ and assets/: the resource list in the build source names no evals", () => {
  const src = fs.readFileSync(
    path.join(REPO, "scripts", "lib", "build-components", "resources.ts"),
    "utf8",
  );
  assert.match(src, /const RESOURCE_FOLDERS = \["scripts", "references", "assets"\] as const;/);
});
