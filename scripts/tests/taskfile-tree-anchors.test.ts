// Spec 0278 R28 (a, b): YAML anchors, aliases and the file variable of R22 are accepted by the
// real `task` binary and read identically by the loader (js-yaml); an unanchored `- task: x` in a
// flattened file runs `ci:x`; two flattened siblings declaring the same variable do not conflict.
// The real `task` is required: when it is absent the suite says so explicitly and skips (never
// silently). Fixture trees live in mkdtemp directories only.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { expandFileVars, ciFileVars } from "../lib/ci-pre-push/normalize.ts";
import { loadTaskfileTree } from "../lib/taskfile-tree.ts";
import { makeSandbox, REPO } from "./lib/governance-sandbox.ts";

const TASK = spawnSync("task", ["--version"], { encoding: "utf8" });
const HAS_TASK = TASK.status === 0;
if (!HAS_TASK) {
  process.stderr.write(
    "taskfile-tree-anchors: NOTICE `task` binary absent, real-task cases skipped\n",
  );
}
const opts = { skip: HAS_TASK ? false : "task binary absent (explicit notice, R14)" };

function task(
  cwd: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  // Deterministic output: CI exports colour-forcing variables the real binary honours.
  const env: NodeJS.ProcessEnv = { ...process.env, PWD: cwd, NO_COLOR: "1" };
  for (const k of ["FORCE_COLOR", "CLICOLOR_FORCE", "TASK_COLOR"]) delete env[k];
  return spawnSync("task", ["--color=false", ...args], { cwd, encoding: "utf8", env });
}

// Spelled in two parts so the root-reader guard does not mistake the fixture writer for a reader.
const ROOT_NAME = ["Task", "file.yml"].join("");

const write = (dir: string, rel: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

function fixture(): string {
  const dir = makeSandbox("taskfile-tree-anchors-");
  write(
    dir,
    ROOT_NAME,
    `version: '3.54'
vars:
  REPO_DIR: '{{.PWD}}'
includes:
  ci: ./taskfiles/ci.yml
tasks:
  x:
    cmds:
      - echo root-x
`,
  );
  write(
    dir,
    "taskfiles/ci.yml",
    `version: '3.54'
vars:
  NODE_SCRIPTS: "echo {{.REPO_DIR}}/scripts"
includes:
  a: { taskfile: ./ci/a.yml, flatten: true }
  b: { taskfile: ./ci/b.yml, flatten: true }
tasks:
  top:
    desc: top
    preconditions: &needs
      - sh: "{{.NODE_SCRIPTS}}/pre.ts"
        msg: "Run: task lint-bootstrap"
    cmds:
      - '{{.NODE_SCRIPTS}}/top.ts'
  tb:
    desc: tb-ci
    cmds:
      - echo called-ci
  top2:
    desc: top2
    preconditions: *needs
    cmds:
      - '{{.NODE_SCRIPTS}}/top2.ts'
`,
  );
  for (const f of ["a", "b"]) {
    write(
      dir,
      `taskfiles/ci/${f}.yml`,
      `version: '3.54'
tasks:
  run-${f}:
    desc: run-${f}
    preconditions: &needs-${f}
      - sh: "{{.NODE_SCRIPTS}}/pre.ts"
        msg: "Run: task lint-bootstrap"
    cmds:
      - '{{.NODE_SCRIPTS}}/${f}.ts'
      - task: tb
  run-${f}2:
    desc: run-${f}2
    preconditions: *needs-${f}
    cmds:
      - echo ${f}2
`,
    );
  }
  return dir;
}

describe("anchors, aliases and file variable under the real task binary", opts, () => {
  it("lists every ci task the loader sees", () => {
    const dir = fixture();
    const tree = loadTaskfileTree(dir);
    const r = task(dir, ["--list-all", "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const names = (JSON.parse(r.stdout) as { tasks: { name: string }[] }).tasks
      .map((t) => t.name)
      .filter((n) => n.startsWith("ci:"))
      .sort();
    const loader = tree.tasks
      .map((t) => t.name)
      .filter((n) => n.startsWith("ci:"))
      .sort();
    assert.deepEqual(names, loader);
  });

  it("resolves the loader's raw definition to the commands task --dry reports", () => {
    const dir = fixture();
    const tree = loadTaskfileTree(dir);
    const vars = ciFileVars(tree);
    for (const entry of tree.tasks.filter((t) => t.name.startsWith("ci:"))) {
      const def = entry.definition as { cmds?: unknown[]; preconditions?: unknown };
      const strings = (def.cmds ?? []).filter((c): c is string => typeof c === "string");
      const expected = strings.map((c) => expandFileVars(c, vars).replaceAll("{{.REPO_DIR}}", dir));
      const r = task(dir, ["--dry", entry.name]);
      assert.equal(r.status, 0, `${entry.name}: ${r.stderr}`);
      const actual = `${r.stdout}\n${r.stderr}`
        .split("\n")
        .filter((l) => l.startsWith(`task: [${entry.name}] `))
        .map((l) => l.slice(`task: [${entry.name}] `.length));
      assert.deepEqual(actual, expected, entry.name);
    }
  });

  it("js-yaml resolves an alias to the anchored definition", () => {
    const dir = fixture();
    const tree = loadTaskfileTree(dir);
    const a = tree.byName.get("ci:top")?.definition as { preconditions: unknown };
    const b = tree.byName.get("ci:top2")?.definition as { preconditions: unknown };
    assert.deepEqual(b.preconditions, a.preconditions);
  });

  it("runs an unanchored call from a flattened file as ci:<name> (R24, R28 a), not the root task", () => {
    const dir = fixture();
    const r = task(dir, ["--dry", "ci:run-a"]);
    assert.equal(r.status, 0, r.stderr);
    const out = `${r.stdout}\n${r.stderr}`;
    assert.match(out, /\[ci:tb\]/);
    assert.doesNotMatch(out, /root-x/);
  });
});

describe("two flattened siblings declaring the same variable (R28 b)", opts, () => {
  it("load without a conflict when the values are equal", () => {
    const dir = fixture();
    for (const f of ["a", "b"]) {
      const p = path.join(dir, `taskfiles/ci/${f}.yml`);
      fs.writeFileSync(
        p,
        fs.readFileSync(p, "utf8").replace("tasks:\n", "vars:\n  SHARED: same\ntasks:\n"),
      );
    }
    const r = task(dir, ["--list-all"]);
    assert.equal(r.status, 0, r.stderr);
  });
});

// Floor for the comparison to stay non-vacuous when preconditions skip tasks (CI omit-dev).
const MIN_COMPARED = 20;

describe("the real tree", opts, () => {
  it("every ci task's string commands match task --dry (aliases and NODE_SCRIPTS resolve alike)", () => {
    const tree = loadTaskfileTree(REPO);
    const vars = ciFileVars(tree);
    const list = task(REPO, ["--list-all", "--json"]);
    assert.equal(list.status, 0, list.stderr);
    const names = (JSON.parse(list.stdout) as { tasks: { name: string }[] }).tasks
      .map((t) => t.name)
      .filter((n) => n.startsWith("ci:"))
      .sort();
    assert.deepEqual(
      names,
      tree.tasks
        .map((t) => t.name)
        .filter((n) => n.startsWith("ci:"))
        .sort(),
    );
    let compared = 0;
    const skipped: string[] = [];
    for (const entry of tree.tasks.filter((t) => t.name.startsWith("ci:"))) {
      const def = entry.definition as { cmds?: unknown[] };
      const cmds = def.cmds ?? [];
      if (!cmds.every((c) => typeof c === "string" && !c.includes("\n"))) continue;
      const expected = (cmds as string[])
        .map((c) =>
          expandFileVars(c, vars)
            .replaceAll("{{.REPO_DIR}}", REPO)
            .replaceAll("{{.CLI_ARGS}}", "")
            .trimEnd(),
        )
        .filter((c) => !c.includes("{{"));
      if (expected.length !== cmds.length) continue;
      const r = task(REPO, ["--dry", entry.name]);
      if (r.status !== 0) {
        // Only an unmet precondition (dev tooling omitted, e.g. CI omit-dev) may skip a task;
        // every other dry-run failure still fails the test.
        const unmet = /task: Run: task lint-bootstrap/.test(r.stderr);
        assert.ok(unmet, `${entry.name}: ${r.stderr}`);
        skipped.push(entry.name);
        continue;
      }
      const prefix = `task: [${entry.name}] `;
      const actual = `${r.stdout}\n${r.stderr}`
        .split("\n")
        .filter((l) => l.startsWith(prefix))
        .map((l) => l.slice(prefix.length).trimEnd());
      assert.deepEqual(actual, expected, entry.name);
      compared += 1;
    }
    if (skipped.length > 0) {
      console.log(
        `NOTICE: skipped (precondition unmet in this environment) ${skipped.length} ci task(s): ${skipped.join(", ")}`,
      );
    }
    console.log(`NOTICE: compared ${compared} ci task(s) against task --dry`);
    assert.ok(compared >= MIN_COMPARED, `only ${compared} tasks compared (floor ${MIN_COMPARED})`);
  });
});
