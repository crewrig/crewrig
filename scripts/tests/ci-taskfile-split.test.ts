// Spec 0278 R23, R28 (d): every `ci:*` task is defined in the file the R23 table names, each file
// of the `ci` sub-tree stays within 200 lines, and `task --list-all` on the split tree is
// byte-identical to the baseline captured on the pre-split tree.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { loadTaskfileTree } from "../lib/taskfile-tree.ts";
import { REPO } from "./lib/governance-sandbox.ts";

const FIXTURES = path.join(REPO, "scripts", "tests", "fixtures", "taskfile-tree");
const CONTROL = ["pre-push", "hooks-install", "hooks-uninstall", "hooks-status"];
const GROUP_FILES: Record<string, readonly string[]> = {
  "taskfiles/ci/gate.yml": [
    "check-taskfile-tree",
    "check-taskfile-tree-selftest",
    "check-task-provisioning",
    "check-task-provisioning-selftest",
    "check-taskfile-commands",
    "check-taskfile-commands-selftest",
    "lint-specs",
    "lint-specs-selftest",
    "lint-markdown",
    "markdown-links",
    "repository-scan",
    "lint-typescript",
    "lint-typescript-selftest",
    "ratchet",
    "ratchet-selftest",
    "check-agents-size",
    "check-rules-size",
    "check-comment-size",
    "frontmatter",
  ],
  "taskfiles/ci/modules.yml": [
    "install-ts",
    "setup-modules-ts",
    "release-driver-modules-ts",
    "packaging-modules-ts",
    "governance-checks-ts",
    "build-components-ts",
    "extension-builders-ts",
    "skill-scripts-ts",
    "model-ci-tooling-ts",
  ],
  "taskfiles/ci/governance.yml": [
    "host-safety",
    "host-safety-selftest",
    "path-ownership",
    "path-ownership-selftest",
    "check-skill-versions",
    "check-description-length",
    "test-wiring",
    "test-wiring-selftest",
    "check-seat-brief",
    "check-plan-review",
    "check-model-mappings",
    "check-agent-profiles",
    "agent-profile-migration",
    "check-metadata-keys",
    "check-claude-agent-layout",
    "check-ci-parity",
    "ci-parity",
    "gitlab-ci-check",
    "alert-scheduled-failure",
    "alert-scheduled-failure-selftest",
    "alert-scheduled-failure-check",
    "ci-pre-push-replay",
    "misc",
  ],
  "taskfiles/ci/extensions.yml": [
    "component-drift",
    "component-drift-selftest",
    "docs-index",
    "docs-index-selftest",
    "cli-matrix-fresh",
    "cli-matrix-fresh-selftest",
    "extension-provenance",
    "extension-manifest",
    "extension-render",
    "extension-install",
    "setup",
    "setup-differential",
    "core-paths",
  ],
  "taskfiles/ci/integration.yml": [
    "setup-oracle",
    "figure-labels",
    "mempalace",
    "chroma-mcp",
    "e2e",
    "worktree-guard",
    "mempalace-transcript",
  ],
};

/** The R23 defining file of `ci:<id>`; the 24 `windows-*` tasks span windows.yml and windows-b.yml. */
function expectedFiles(id: string): string[] {
  if (CONTROL.includes(id)) return ["taskfiles/ci.yml"];
  if (id.startsWith("windows-")) return ["taskfiles/ci/windows.yml", "taskfiles/ci/windows-b.yml"];
  const hit = Object.entries(GROUP_FILES).find(([, ids]) => ids.includes(id));
  return hit ? [hit[0]] : [];
}

describe("taskfiles/ci split (spec 0278 R23)", () => {
  const tree = loadTaskfileTree(REPO);
  const ciTasks = tree.tasks.filter((t) => t.name.startsWith("ci:"));

  it("defines each of the 99 ci:* names in exactly the file of the R23 table", () => {
    assert.equal(ciTasks.length, 99);
    for (const t of ciTasks) {
      const id = t.name.slice("ci:".length);
      assert.ok(expectedFiles(id).includes(t.file), `${t.name} is in ${t.file}`);
    }
  });

  it("matches the committed mapping fixture", () => {
    const mapping = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, "mapping.json"), "utf8"),
    ) as Record<string, string>;
    for (const t of ciTasks) assert.equal(mapping[t.name], t.file, t.name);
  });

  it("keeps every file of taskfiles/ci.yml + taskfiles/ci/*.yml at or under 200 lines", () => {
    const files = ["taskfiles/ci.yml"];
    for (const f of fs.readdirSync(path.join(REPO, "taskfiles", "ci")).sort()) {
      if (f.endsWith(".yml")) files.push(`taskfiles/ci/${f}`);
    }
    for (const f of files) {
      const lines = fs.readFileSync(path.join(REPO, f), "utf8").trimEnd().split("\n").length;
      assert.ok(lines <= 200, `${f} has ${lines} lines`);
    }
  });

  // Deterministic output: CI exports colour-forcing variables the real binary honours.
  const plainTaskEnv = (cwd: string): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...process.env, PWD: cwd, NO_COLOR: "1" };
    for (const k of ["FORCE_COLOR", "CLICOLOR_FORCE", "TASK_COLOR"]) delete env[k];
    return env;
  };
  const hasTask = spawnSync("task", ["--version"], { encoding: "utf8" }).status === 0;
  if (!hasTask)
    process.stderr.write("ci-taskfile-split: NOTICE `task` absent, list-all case skipped\n");
  it(
    "task --list-all is byte-identical to the pre-split baseline (R28 d)",
    { skip: !hasTask },
    () => {
      const r = spawnSync("task", ["--color=false", "--list-all"], {
        cwd: REPO,
        encoding: "utf8",
        env: plainTaskEnv(REPO),
      });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(
        r.stdout,
        fs.readFileSync(path.join(FIXTURES, "ci-list-all.baseline.txt"), "utf8"),
      );
    },
  );
});
