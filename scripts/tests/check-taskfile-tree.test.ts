// Tests for scripts/check-taskfile-tree.ts and scripts/lib/governance/taskfile-tree-guard.ts
// (spec 0278 R13, R14, R15). Every tree is staged programmatically in a mkdtemp directory; the live
// repository tree is never read. The guard cannot pass on the monolithic root (check c), so only
// split-shaped fixtures are exercised.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { ROOT_READER_ALLOW, checkTaskfileTree } from "../lib/governance/taskfile-tree-guard.ts";

const guard = path.resolve(import.meta.dirname, "..", "check-taskfile-tree.ts");
const roots: string[] = [];
const hasTask = spawnSync("task", ["--version"], { encoding: "utf8" }).error === undefined;

after(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const ROOT = `version: '3.39'
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

const E2E = `version: '3.39'
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

const LINT = `version: '3.39'
tasks:
  hello:
    cmds:
      - echo hello
  gate:
    deps: ["e2e:build:base"]
    cmds:
      - echo gate
`;

type Tree = Record<string, string>;

function split(): Tree {
  return {
    "Taskfile.yml": ROOT,
    "taskfiles/e2e.yml": E2E,
    "taskfiles/lint.yml": LINT,
    "scripts/tests/ok.test.ts": 'export const answer = "no root reader here";\n',
  };
}

function stage(tree: Tree): string {
  const root = mkdtempSync(path.join(tmpdir(), "taskfile-tree-guard-"));
  roots.push(root);
  for (const [rel, text] of Object.entries(tree)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

function findings(tree: Tree): string[] {
  return checkTaskfileTree(stage(tree), { compareWithTask: false }).findings;
}

function cli(root: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", guard], {
    encoding: "utf8",
    env: { ...process.env, ...env, CREWRIG_REPO_DIR: root },
  });
}

describe("check-taskfile-tree checks (a)-(g)", () => {
  it("passes a clean split-shaped tree", () => {
    assert.deepEqual(findings(split()), []);
  });

  it("(a) fails an unincluded taskfiles/foo.yml", () => {
    const out = findings({ ...split(), "taskfiles/foo.yml": `version: '3.39'\ntasks: {}\n` });
    assert.deepEqual(out, ["taskfiles/foo.yml is not reachable from the root includes"]);
  });

  it("(b) fails a test source under scripts/tests/ reading the root file", () => {
    const out = findings({
      ...split(),
      "scripts/tests/reader.test.ts": 'readFileSync(path.join(repo, "Taskfile.yml"), "utf8");\n',
    });
    assert.equal(out.length, 1);
    assert.match(out[0] ?? "", /^scripts\/tests\/reader\.test\.ts:1: reads the root Taskfile directly/);
  });

  it("(b) matches the single-quote and backtick forms", () => {
    const out = findings({
      ...split(),
      "scripts/a.ts": "read('Taskfile.yml');\n",
      "scripts/b.js": "read(`Taskfile.yml`);\n",
    });
    assert.deepEqual(
      out.map((f) => f.split(":")[0]),
      ["scripts/a.ts", "scripts/b.js"],
    );
  });

  it("(b) skips comment lines and unquoted mentions", () => {
    const out = findings({
      ...split(),
      "scripts/c.ts": [
        '// reads "Taskfile.yml" in a comment',
        '/* "Taskfile.yml" */',
        ' * "Taskfile.yml" in a block comment',
        "const note = Taskfile.yml.length;",
        "",
      ].join("\n"),
    });
    assert.deepEqual(out, []);
  });

  it("(b) honours the allow-list, every entry with a reason", () => {
    const allowed = [...ROOT_READER_ALLOW.keys()];
    assert.ok(allowed.length > 0);
    for (const [file, reason] of ROOT_READER_ALLOW) {
      assert.match(reason, /\S/, file);
    }
    const tree = split();
    for (const file of allowed) {
      tree[file] = 'const root = "Taskfile.yml";\n';
    }
    assert.deepEqual(findings(tree), []);
  });

  it("(c) fails a task other than default in the root", () => {
    const out = findings({
      ...split(),
      "Taskfile.yml": `${ROOT}  stray:\n    cmds:\n      - echo stray\n`,
    });
    assert.deepEqual(out, ["Taskfile.yml defines task 'stray'; the root may only define 'default'"]);
  });

  it("(d) fails a version string differing from '3.39'", () => {
    const out = findings({ ...split(), "taskfiles/lint.yml": LINT.replace("'3.39'", "'3.38'") });
    assert.deepEqual(out, ["taskfiles/lint.yml: version '3.38' differs from '3.39'"]);
  });

  it("(d) fails an unquoted 3.39 float and a root version '3'", () => {
    const float = findings({ ...split(), "taskfiles/lint.yml": LINT.replace("'3.39'", "3.39") });
    assert.deepEqual(float, ["taskfiles/lint.yml: version 3.39 (number) differs from '3.39'"]);
    const root = findings({ ...split(), "Taskfile.yml": ROOT.replace("'3.39'", "'3'") });
    assert.deepEqual(root, ["Taskfile.yml: version '3' differs from '3.39'"]);
  });

  it("(e) fails TASKFILE_DIR in an included file but not in comments", () => {
    const used = LINT.replace("echo hello", "cat {{.TASKFILE_DIR}}/x");
    assert.deepEqual(findings({ ...split(), "taskfiles/lint.yml": used }), [
      "taskfiles/lint.yml: uses TASKFILE_DIR; build repository paths from REPO_DIR",
    ]);
    const commented = `# TASKFILE_DIR is forbidden here\n${LINT}`;
    assert.deepEqual(findings({ ...split(), "taskfiles/lint.yml": commented }), []);
  });

  it("(f) fails a dangling deps entry and a dangling task call", () => {
    const dep = findings({ ...split(), "taskfiles/lint.yml": LINT.replace("e2e:build:base", "e2e:nope") });
    assert.deepEqual(dep, [
      "taskfiles/lint.yml: task 'gate' references 'e2e:nope' which resolves to 'e2e:nope' (no such task)",
    ]);
    const call = findings({ ...split(), "taskfiles/e2e.yml": E2E.replace("task: build:base", "task: gone") });
    assert.deepEqual(call, [
      "taskfiles/e2e.yml: task 'e2e:build' references 'gone' which resolves to 'e2e:gone' (no such task)",
    ]);
  });

  it("(f) R20: a full e2e:build:base inside the e2e namespace is dangling, build:base passes", () => {
    const full = E2E.replace("deps: [build:base]", "deps: [e2e:build:base]");
    assert.deepEqual(findings({ ...split(), "taskfiles/e2e.yml": full }), [
      "taskfiles/e2e.yml: task 'e2e:build' references 'e2e:build:base' which resolves to 'e2e:e2e:build:base' (no such task)",
    ]);
    assert.deepEqual(findings(split()), []);
  });

  it("(f) a root-anchored ':' reference and a defer call resolve from any namespace", () => {
    const deferred = E2E.replace(
      '      - task: ":hello"',
      '      - task: ":hello"\n      - defer:\n          task: ":absent"',
    );
    assert.deepEqual(findings({ ...split(), "taskfiles/e2e.yml": deferred }), [
      "taskfiles/e2e.yml: task 'e2e:build' references ':absent' which resolves to 'absent' (no such task)",
    ]);
  });

  it("(g) fails dir:, excludes: and aliases: on an include", () => {
    for (const key of ["dir: .", "excludes: [hello]", "aliases: [l]"]) {
      const root = ROOT.replace(
        "    flatten: true\n",
        `    flatten: true\n    ${key}\n`,
      );
      const out = findings({ ...split(), "Taskfile.yml": root });
      assert.deepEqual(out, [
        `Taskfile.yml: include 'lint' uses '${key.split(":")[0]}:' (not allowed, R7/R9)`,
      ]);
    }
  });

  it("reports every finding, not just the first", () => {
    const out = findings({
      ...split(),
      "taskfiles/foo.yml": `version: '3.39'\ntasks: {}\n`,
      "taskfiles/lint.yml": LINT.replace("'3.39'", "'3'"),
    });
    assert.equal(out.length, 2);
  });
});

describe("check-taskfile-tree CLI contract", () => {
  it("prints the OK line on stdout and exits 0 on a clean tree", () => {
    const result = cli(stage(split()));
    if (hasTask) {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "check-taskfile-tree: OK (5 tasks, 3 files)\n");
      assert.equal(result.stderr, "");
    }
  });

  it("exits 1 and lists the offender under FAILED on stderr", () => {
    const result = cli(stage({ ...split(), "taskfiles/foo.yml": "version: '3.39'\ntasks: {}\n" }));
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr,
      /^check-taskfile-tree: FAILED\n {2}- taskfiles\/foo\.yml is not reachable from the root includes\n/,
    );
  });

  it("exits 2 on an unreadable include", () => {
    const tree = split();
    delete tree["taskfiles/lint.yml"];
    const result = cli(stage(tree));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^check-taskfile-tree: cannot load the tree: unreadable: taskfiles\/lint\.yml/);
  });

  it("exits 2 on an unparsable file", () => {
    const result = cli(stage({ ...split(), "taskfiles/lint.yml": "tasks: [unclosed\n" }));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /cannot load the tree: unparsable: taskfiles\/lint\.yml/);
  });
});

describe("check-taskfile-tree R14 comparison with task --list-all --json", () => {
  it("prints an explicit NOTICE and still runs the other checks when task is absent", () => {
    const emptyBin = mkdtempSync(path.join(tmpdir(), "taskfile-tree-nopath-"));
    roots.push(emptyBin);
    const clean = cli(stage(split()), { PATH: emptyBin });
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(
      clean.stderr,
      /^check-taskfile-tree: NOTICE task binary not found; loader-vs-Task name comparison \(spec 0278 R14\) SKIPPED\n/,
    );
    assert.match(clean.stdout, /^check-taskfile-tree: OK/);

    const broken = cli(stage({ ...split(), "taskfiles/foo.yml": "version: '3.39'\ntasks: {}\n" }), {
      PATH: emptyBin,
    });
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /NOTICE task binary not found/);
    assert.match(broken.stderr, /taskfiles\/foo\.yml is not reachable/);
  });

  it("passes the comparison on a clean tree when task is present", (t) => {
    if (!hasTask) {
      t.skip("task binary not found; R14 comparison not exercised here");
      return;
    }
    const result = checkTaskfileTree(stage(split()));
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.notices, []);
  });

  it("fails on a name Task does not list (an internal task) when task is present", (t) => {
    if (!hasTask) {
      t.skip("task binary not found; R14 mismatch not exercised here");
      return;
    }
    const hidden = LINT.replace("tasks:\n", "tasks:\n  hidden:\n    internal: true\n    cmds:\n      - echo hidden\n");
    const result = checkTaskfileTree(stage({ ...split(), "taskfiles/lint.yml": hidden }));
    assert.deepEqual(result.findings, [
      "task 'hidden' is loaded from the tree but not listed by Task (R14)",
    ]);
  });

  it("fails when Task itself rejects the tree (mismatched included version)", (t) => {
    if (!hasTask) {
      t.skip("task binary not found; R14 mismatch not exercised here");
      return;
    }
    const result = checkTaskfileTree(
      stage({ ...split(), "taskfiles/lint.yml": LINT.replace("'3.39'", "'3.38'") }),
    );
    assert.ok(result.findings.some((f) => f.startsWith("taskfiles/lint.yml: version '3.38'")));
    assert.ok(result.findings.some((f) => f.startsWith("'task --list-all --json' exited")));
  });
});
