// Reference-resolution proof through the real `task` binary (spec 0278 R20, plan D7).
//
// Stages a mkdtemp tree (root + a namespaced file `e2e` + a flattened file) and runs one task of each
// reference kind: namespace-relative, root-anchored (`:name`, defined in a flattened included file)
// and flattened-to-namespaced (`e2e:base`). Each must exit 0 and print the dependency's marker.
// Skipped with an explicit notice when `task` is absent.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const hasTask = spawnSync("task", ["--version"], { encoding: "utf8" }).error === undefined;
let root = "";

const files: Record<string, string> = {
  "Taskfile.yml": `version: '3.39'
includes:
  e2e: ./taskfiles/e2e.yml
  flat:
    taskfile: ./taskfiles/flat.yml
    flatten: true
tasks:
  default:
    cmds:
      - task --list
`,
  "taskfiles/e2e.yml": `version: '3.39'
tasks:
  base:
    cmds:
      - echo MARK-e2e-base
  via-dep-relative:
    deps: [base]
    cmds:
      - echo MARK-relative-dep-done
  via-call-relative:
    cmds:
      - task: base
  via-dep-root:
    deps: [":hello"]
    cmds:
      - echo MARK-root-dep-done
  via-call-root:
    cmds:
      - task: ":hello"
`,
  "taskfiles/flat.yml": `version: '3.39'
tasks:
  hello:
    cmds:
      - echo MARK-hello
  via-flat:
    deps: ["e2e:base"]
    cmds:
      - echo MARK-flat-done
`,
};

before(() => {
  if (!hasTask) {
    return;
  }
  root = mkdtempSync(path.join(tmpdir(), "taskfile-refs-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
});

after(() => {
  if (root !== "") {
    rmSync(root, { recursive: true, force: true });
  }
});

function runTask(name: string) {
  return spawnSync("task", [name], { cwd: root, encoding: "utf8" });
}

describe("task reference resolution through the real task binary", () => {
  const cases: [string, string, string[]][] = [
    [
      "namespace-relative deps",
      "e2e:via-dep-relative",
      ["MARK-e2e-base", "MARK-relative-dep-done"],
    ],
    ["namespace-relative task call", "e2e:via-call-relative", ["MARK-e2e-base"]],
    ["root-anchored deps", "e2e:via-dep-root", ["MARK-hello", "MARK-root-dep-done"]],
    ["root-anchored task call", "e2e:via-call-root", ["MARK-hello"]],
    [
      "flattened task depending on a namespaced one",
      "via-flat",
      ["MARK-e2e-base", "MARK-flat-done"],
    ],
  ];
  for (const [label, name, markers] of cases) {
    it(`${label}: ${name} exits 0 and prints the dependency marker`, (t) => {
      if (!hasTask) {
        t.skip("task binary not found; reference resolution through Task not exercised");
        return;
      }
      const result = runTask(name);
      assert.equal(result.status, 0, result.stderr);
      for (const marker of markers) {
        assert.match(result.stdout, new RegExp(marker), `${name} stdout`);
      }
    });
  }

  it("a full-name e2e:base inside the e2e namespace does not resolve (R20 premise)", (t) => {
    if (!hasTask) {
      t.skip("task binary not found; reference resolution through Task not exercised");
      return;
    }
    writeFileSync(
      path.join(root, "taskfiles", "e2e.yml"),
      files["taskfiles/e2e.yml"]?.replace("deps: [base]", "deps: [e2e:base]") ?? "",
    );
    const result = runTask("e2e:via-dep-relative");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /e2e:e2e:base/);
    writeFileSync(path.join(root, "taskfiles", "e2e.yml"), files["taskfiles/e2e.yml"] ?? "");
  });
});
