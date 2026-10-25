// Spec 0278 delta-02 R31, R33: every task of a `taskfiles/ci/*.yml` file runs from the repository
// root, from the root and from a subdirectory. Runs the real `task` (Task 3.54) on a staged mkdtemp
// copy of the Taskfile tree in which each group file is replaced by one `pwd` recorder task, so the
// checkout is never mutated. The mutation proof drops `dir: ..` from one include and expects that
// group to report `taskfiles/`. When `task` is absent the suite says so (explicit notice, never a
// silent skip).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { makeSandbox, REPO } from "./lib/governance-sandbox.ts";

const TASK = spawnSync("task", ["--version"], { encoding: "utf8" });
const HAS_TASK = TASK.status === 0;
if (!HAS_TASK) {
  process.stderr.write("ci-taskfile-dir: NOTICE `task` binary absent, runtime cases skipped\n");
}
const opts = { skip: HAS_TASK ? false : "task binary absent (explicit notice, R33)" };

const ROOT_NAME = ["Task", "file.yml"].join("");
const GROUPS = fs
  .readdirSync(path.join(REPO, "taskfiles", "ci"))
  .filter((f) => f.endsWith(".yml"))
  .map((f) => f.slice(0, -".yml".length))
  .sort();

/** Stage the real Taskfile tree; replace each group file with a `pwd` recorder task. */
function stage(mutate?: (ciYml: string) => string): string {
  const dir = makeSandbox("ci-taskfile-dir-");
  fs.copyFileSync(path.join(REPO, ROOT_NAME), path.join(dir, ROOT_NAME));
  fs.cpSync(path.join(REPO, "taskfiles"), path.join(dir, "taskfiles"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts"));
  for (const group of GROUPS) {
    fs.writeFileSync(
      path.join(dir, "taskfiles", "ci", `${group}.yml`),
      `version: '3.54'\ntasks:\n  probe-${group}:\n    cmds:\n      - pwd -P\n`,
    );
  }
  if (mutate) {
    const ciYml = path.join(dir, "taskfiles", "ci.yml");
    fs.writeFileSync(ciYml, mutate(fs.readFileSync(ciYml, "utf8")));
  }
  return dir;
}

function probe(cwd: string, group: string): string {
  const result = spawnSync("task", [`ci:probe-${group}`], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PWD: cwd },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

describe("ci group tasks run from the repository root (delta-02 R31, R33)", () => {
  it("has one probe per taskfiles/ci/*.yml group", () => {
    assert.ok(GROUPS.length >= 7, GROUPS.join(","));
  });

  it("reports the staged root from the root and from scripts/", opts, () => {
    const root = fs.realpathSync.native(stage());
    for (const cwd of [root, path.join(root, "scripts")]) {
      for (const group of GROUPS) {
        assert.equal(probe(cwd, group), root, `${group} from ${path.relative(root, cwd) || "."}`);
      }
    }
  });

  it(
    "mutation: dropping `dir: ..` from one include reports taskfiles/ for that group",
    opts,
    () => {
      const victim = GROUPS[0] as string;
      const root = fs.realpathSync.native(
        stage((text) =>
          text.replace(
            new RegExp(`(taskfile: \\./ci/${victim}\\.yml, flatten: true), dir: \\.\\.`),
            "$1",
          ),
        ),
      );
      for (const cwd of [root, path.join(root, "scripts")]) {
        assert.equal(probe(cwd, victim), path.join(root, "taskfiles"));
        for (const group of GROUPS.filter((g) => g !== victim)) {
          assert.equal(probe(cwd, group), root);
        }
      }
    },
  );
});
