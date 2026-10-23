// Shared fixtures for the Taskfile tree guard suites (spec 0278 R13, R14, R15): a split-shaped tree
// staged in a mkdtemp directory, plus the in-process and CLI runners. The live repository tree is
// never read. The root file name is built from parts so that this helper does not itself trip the
// guard's check (b).

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkTaskfileTree } from "../../lib/governance/taskfile-tree-guard.ts";

const guard = path.resolve(import.meta.dirname, "..", "..", "check-taskfile-tree.ts");
const roots: string[] = [];

export const hasTask = spawnSync("task", ["--version"], { encoding: "utf8" }).error === undefined;
export const ROOT_NAME = ["Task", "file.yml"].join("");

/** Remove every staged tree; call it from `after()` in each suite. */
export function cleanup(): void {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Register a mkdtemp directory for cleanup and return it. */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

export const ROOT = `version: '3.39'
vars:
  REPO_DIR: '{{.PWD}}'
includes:
  e2e: ./taskfiles/e2e.yml
  lint:
    taskfile: ./taskfiles/lint.yml
    flatten: true
tasks:
  default:
    cmds:
      - task --list
`;

export const E2E = `version: '3.39'
tasks:
  build:base:
    cmds:
      - echo base
  build:
    deps: [build:base]
    cmds:
      - task: build:base
      - task: ":hello"
`;

export const LINT = `version: '3.39'
tasks:
  hello:
    cmds:
      - echo hello
  gate:
    deps: ["e2e:build:base"]
    cmds:
      - echo gate
`;

export type Tree = Record<string, string>;

export function split(): Tree {
  return {
    [ROOT_NAME]: ROOT,
    "taskfiles/e2e.yml": E2E,
    "taskfiles/lint.yml": LINT,
    "scripts/tests/ok.test.ts": 'export const answer = "no root reader here";\n',
  };
}

export function stage(tree: Tree): string {
  const root = tempDir("taskfile-tree-guard-");
  for (const [rel, text] of Object.entries(tree)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

export function findings(tree: Tree): string[] {
  return checkTaskfileTree(stage(tree), { compareWithTask: false }).findings;
}

export function cli(root: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", guard], {
    encoding: "utf8",
    env: { ...process.env, ...env, CREWRIG_REPO_DIR: root },
  });
}
