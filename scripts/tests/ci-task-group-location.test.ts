// Spec 0287 / 0278 R23: every `ci:<id>` task lives in the group file(s) named by the `group` of
// capability `<id>` in ci/ci-capabilities.yml. Control tasks of taskfiles/ci.yml are excepted, and
// the `windows` group spans taskfiles/ci/windows.yml and taskfiles/ci/windows-b.yml.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { loadTaskfileTree } from "../lib/taskfile-tree.ts";
import { ROOT_FILE } from "../lib/taskfile-tree-parse.ts";
import { yamlLib as yaml } from "./lib/yaml-lib.ts";
import { REPO } from "./lib/governance-sandbox.ts";

const CONTROL = new Set(["pre-push", "hooks-install", "hooks-uninstall", "hooks-status"]);
const GROUP_FILES: Record<string, string[]> = {
  windows: ["taskfiles/ci/windows.yml", "taskfiles/ci/windows-b.yml"],
};

function misplaced(repo: string): string[] {
  const caps = yaml.load(fs.readFileSync(path.join(repo, "ci", "ci-capabilities.yml"), "utf8")) as {
    capabilities: { id: string; group?: string; portability?: string }[];
  };
  const groupOf = new Map(caps.capabilities.map((c) => [c.id, c.group]));
  // Hand-authored engine-specific capabilities carry no `group` (spec 0047 R5); they are exempt.
  const ungrouped = new Set(
    caps.capabilities.filter((c) => !c.group && c.portability === "specific").map((c) => c.id),
  );
  const problems: string[] = [];
  for (const t of loadTaskfileTree(repo).tasks) {
    if (!t.name.startsWith("ci:")) continue;
    const id = t.name.slice("ci:".length);
    if (CONTROL.has(id)) continue;
    if (ungrouped.has(id)) continue;
    const group = groupOf.get(id) ?? groupOf.get(id.replace(/-selftest$/, ""));
    if (!group) {
      problems.push(`${t.name}: no capability (or parent capability) found`);
      continue;
    }
    const allowed = GROUP_FILES[group] ?? [`taskfiles/ci/${group}.yml`];
    if (!allowed.includes(t.file))
      problems.push(`${t.name} is in ${t.file}, expected ${allowed.join(" or ")}`);
  }
  return problems;
}

describe("ci task group location (spec 0287)", () => {
  it("keeps every ci:<id> task in the file of its capability group", () => {
    assert.deepEqual(misplaced(REPO), []);
  });

  it("fails when a task is moved to the wrong group file (mutation proof)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ci-group-loc-"));
    try {
      fs.cpSync(path.join(REPO, ROOT_FILE), path.join(tmp, ROOT_FILE));
      fs.cpSync(path.join(REPO, "taskfiles"), path.join(tmp, "taskfiles"), { recursive: true });
      fs.mkdirSync(path.join(tmp, "ci"));
      fs.cpSync(
        path.join(REPO, "ci", "ci-capabilities.yml"),
        path.join(tmp, "ci", "ci-capabilities.yml"),
      );
      assert.deepEqual(misplaced(tmp), []);
      const mod = path.join(tmp, "taskfiles", "ci", "modules.yml");
      const gov = path.join(tmp, "taskfiles", "ci", "governance.yml");
      const modText = fs.readFileSync(mod, "utf8");
      const m = /^  setup-modules-ts:\n(?:    .*\n)+/m.exec(modText);
      assert.ok(m, "setup-modules-ts block found");
      fs.writeFileSync(mod, modText.replace(m[0], ""));
      fs.appendFileSync(gov, m[0]);
      const found = misplaced(tmp);
      assert.equal(found.length, 1, found.join("\n"));
      assert.match(found[0], /ci:setup-modules-ts is in taskfiles\/ci\/governance\.yml/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
