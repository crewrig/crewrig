// Spec 0279 delta-03 R22: the parity guard checks a migrated capability (`command:` exactly
// `task ci:<id>`) by shape. Fixtures live in mkdtemp directories driven through `--root`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { makeSandbox, REPO, runEntry } from "./lib/governance-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "check-ci-pre-push-parity.ts");
const ROOT_NAME = ["Task", "file.yml"].join("");
const ROOT = `version: '3.54'
vars:
  REPO_DIR: '{{.PWD}}'
includes:
  ci: ./taskfiles/ci.yml
tasks:
  lint-md:
    cmds:
      - echo md
`;

const cap = (id: string, cmds: readonly string[]): string => `  - id: ${id}
    name: "${id}"
    trigger:
      - on: pull-request
        branches: [main]
    portability: portable
    command:
${cmds.map((c) => `      - ${JSON.stringify(c)}`).join("\n")}
`;

const task = (id: string, cmds: readonly string[]): string =>
  `  ${id}:\n    cmds:\n${cmds.map((c) => `      - ${c}`).join("\n")}\n`;

function stage(caps: string, tasks: string): string {
  const dir = makeSandbox("ci-pre-push-parity-migrated-");
  fs.mkdirSync(path.join(dir, "taskfiles"));
  fs.mkdirSync(path.join(dir, "ci"));
  fs.writeFileSync(path.join(dir, ROOT_NAME), ROOT);
  fs.writeFileSync(
    path.join(dir, "taskfiles", "ci.yml"),
    `version: '3.54'\ntasks:\n${tasks}  pre-push:\n    cmds:\n      - echo control\n`,
  );
  fs.writeFileSync(path.join(dir, "ci", "ci-capabilities.yml"), `capabilities:\n${caps}`);
  fs.writeFileSync(path.join(dir, "ci", "pre-push-tier.json"), "{}");
  return dir;
}

const run = (dir: string) => runEntry(ENTRY, { args: ["--root", dir] });

describe("R22 migrated capability", () => {
  it("(1) passes by shape, whatever the task body", () => {
    const dir = stage(cap("alpha", ["task ci:alpha"]), task("alpha", ["node scripts/anything.ts"]));
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
  });

  it("(1) whitespace is collapsed before the comparison", () => {
    const dir = stage(cap("alpha", ["task   ci:alpha "]), task("alpha", ["echo x"]));
    assert.equal(run(dir).status, 0);
  });

  it("(2) fails naming the id when the task is missing", () => {
    const dir = stage(cap("alpha", ["task ci:alpha"]), task("beta", ["echo b"]) + "");
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /missing-task: alpha: migrated capability 'alpha'/);
  });

  it("(3) a not yet migrated capability is compared as before", () => {
    const ok = stage(cap("alpha", ["node scripts/a.ts"]), task("alpha", ["node scripts/a.ts"]));
    assert.equal(run(ok).status, 0);
    const bad = stage(cap("alpha", ["node scripts/a.ts"]), task("alpha", ["node scripts/b.ts"]));
    const r = run(bad);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /command-mismatch: ci:alpha/);
  });

  it("(4) a mixed run evaluates each capability under its own rule", () => {
    const dir = stage(
      cap("alpha", ["task ci:alpha"]) + cap("beta", ["node scripts/a.ts"]),
      task("alpha", ["echo new"]) + task("beta", ["node scripts/changed.ts"]),
    );
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /command-mismatch: ci:beta/);
    assert.doesNotMatch(r.stderr, /ci:alpha/);
  });

  it("(5) task ci:<other> fails unconditionally, even with identical bodies", () => {
    const dir = stage(
      cap("alpha", ["task ci:beta"]) + cap("beta", ["task ci:beta"]),
      task("alpha", ["echo same"]) + task("beta", ["echo same"]),
    );
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /mismatched-command: alpha: .*'task ci:beta'.*expected 'task ci:alpha'/);
  });

  it("(5) task ci:<id> plus a raw entry is compared and fails there", () => {
    const dir = stage(
      cap("alpha", ["task ci:alpha", "node scripts/a.ts"]),
      task("alpha", ["node scripts/other.ts"]),
    );
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stderr, /mismatched-command/);
  });

  it("(6) editing only the command flips the class and back", () => {
    const tasks = task("alpha", ["node scripts/b.ts"]);
    const dir = stage(cap("alpha", ["node scripts/a.ts"]), tasks);
    assert.equal(run(dir).status, 1, "raw and different");
    const file = path.join(dir, "ci", "ci-capabilities.yml");
    const raw = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, `capabilities:\n${cap("alpha", ["task ci:alpha"])}`);
    assert.equal(run(dir).status, 0, "migrated");
    fs.writeFileSync(file, raw);
    assert.equal(run(dir).status, 1, "reverted");
  });

  it("provisioning stays rejected in a migrated task (R5)", () => {
    const dir = stage(cap("alpha", ["task ci:alpha"]), task("alpha", ["npm ci", "echo x"]));
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /provisioning: ci:alpha/);
  });

  it("(7) the real tree passes", () => {
    const r = runEntry(ENTRY, { args: [] });
    assert.equal(r.status, 0, r.stderr);
  });
});
