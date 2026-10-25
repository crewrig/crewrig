// Tests for scripts/check-taskfile-tree.ts and scripts/lib/governance/taskfile-tree-guard.ts,
// part 2: checks (e)-(g), the CLI contract and the R14 comparison with `task --list-all --json`
// (spec 0278 R13, R14, R15). Part 1 is check-taskfile-tree-layout.test.ts.

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { checkTaskfileTree } from "../lib/governance/taskfile-tree-guard.ts";
import {
  E2E,
  LINT,
  ROOT,
  ROOT_NAME,
  cleanup,
  cli,
  findings,
  hasTask,
  split,
  stage,
  tempDir,
} from "./lib/taskfile-tree-guard-fixtures.ts";

after(cleanup);

describe("check-taskfile-tree checks (e)-(g)", () => {
  it("(e) fails TASKFILE_DIR in an included file but not in comments", () => {
    const used = LINT.replace("echo hello", "cat {{.TASKFILE_DIR}}/x");
    assert.deepEqual(findings({ ...split(), "taskfiles/lint.yml": used }), [
      "taskfiles/lint.yml: uses TASKFILE_DIR; build repository paths from REPO_DIR",
    ]);
    const commented = `# TASKFILE_DIR is forbidden here\n${LINT}`;
    assert.deepEqual(findings({ ...split(), "taskfiles/lint.yml": commented }), []);
  });

  it("(f) fails a dangling deps entry and a dangling task call", () => {
    const dep = findings({
      ...split(),
      "taskfiles/lint.yml": LINT.replace("e2e:build:base", "e2e:nope"),
    });
    assert.deepEqual(dep, [
      "taskfiles/lint.yml: task 'gate' references 'e2e:nope' which resolves to 'e2e:nope' (no such task)",
    ]);
    const call = findings({
      ...split(),
      "taskfiles/e2e.yml": E2E.replace("task: build:base", "task: gone"),
    });
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
      const root = ROOT.replace("    flatten: true\n", `    flatten: true\n    ${key}\n`);
      const out = findings({ ...split(), [ROOT_NAME]: root });
      assert.deepEqual(out, [
        `Taskfile.yml: include 'lint' uses '${key.split(":")[0]}:' (not allowed, R7/R9)`,
      ]);
    }
  });
});

describe("check-taskfile-tree (g) delta-02 R32: `dir: ..` on ci group includes", () => {
  const CI = (dir: string, target = "./ci/gate.yml"): string =>
    `version: '3.54'\nincludes:\n  gate: { taskfile: ${target}, flatten: true${dir} }\ntasks:\n  pre-push:\n    cmds:\n      - echo x\n`;
  const GATE = `version: '3.54'\ntasks:\n  lint:\n    cmds:\n      - echo x\n`;
  const ciTree = (ciYml: string): Record<string, string> => ({
    ...split(),
    [ROOT_NAME]: ROOT.replace(
      "  e2e: ./taskfiles/e2e.yml\n",
      "  e2e: ./taskfiles/e2e.yml\n  ci: ./taskfiles/ci.yml\n",
    ),
    "taskfiles/ci.yml": ciYml,
    "taskfiles/ci/gate.yml": GATE,
  });
  const offence = (key: string, file = "taskfiles/ci.yml", inc = "gate"): string =>
    `${file}: include '${inc}' uses '${key}:' (not allowed, R7/R9)`;

  it("accepts `dir: ..` on a taskfiles/ci.yml include of ./ci/<group>.yml", () => {
    assert.deepEqual(findings(ciTree(CI(", dir: .."))), []);
  });

  it("accepts a ci sub-include with no dir: (the runtime test owns that omission)", () => {
    assert.deepEqual(findings(ciTree(CI(""))), []);
  });

  it("rejects other dir values on that include, naming it", () => {
    for (const value of ["'{{.ROOT_DIR}}'", "../x", ".", "../", "/tmp"]) {
      assert.deepEqual(findings(ciTree(CI(`, dir: ${value}`))), [offence("dir")]);
    }
  });

  it("rejects `dir: ..` on a root include and on a taskfiles/e2e.yml include", () => {
    const root = ROOT.replace("    flatten: true\n", "    flatten: true\n    dir: ..\n");
    assert.deepEqual(findings({ ...split(), [ROOT_NAME]: root }), [
      `${ROOT_NAME}: include 'lint' uses 'dir:' (not allowed, R7/R9)`,
    ]);
    const e2e = `${E2E}includes:\n  lint2: { taskfile: ./lint.yml, dir: .. }\n`;
    const out = findings({ ...split(), "taskfiles/e2e.yml": e2e });
    assert.ok(out.includes(offence("dir", "taskfiles/e2e.yml", "lint2")), out.join("\n"));
  });

  it("rejects `dir: ..` on a ci.yml include whose target is not under taskfiles/ci/", () => {
    const tree = { ...ciTree(CI(", dir: ..", "./lint.yml")) };
    assert.ok(findings(tree).includes(offence("dir")), findings(tree).join("\n"));
  });

  it("rejects `dir: ..` on an include nested in a taskfiles/ci/ file", () => {
    const tree = {
      ...ciTree(CI(", dir: ..")),
      "taskfiles/ci/gate.yml": `${GATE}includes:\n  inner: { taskfile: ./other.yml, dir: .. }\n`,
      "taskfiles/ci/other.yml": GATE,
    };
    assert.ok(findings(tree).includes(offence("dir", "taskfiles/ci/gate.yml", "inner")));
  });

  it("still rejects excludes: and aliases: on a ci.yml include", () => {
    for (const key of ["excludes", "aliases"]) {
      const value = key === "excludes" ? "[lint]" : "[l]";
      assert.deepEqual(findings(ciTree(CI(`, ${key}: ${value}`))), [offence(key)]);
    }
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
    const result = cli(stage({ ...split(), "taskfiles/foo.yml": "version: '3.54'\ntasks: {}\n" }));
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
    assert.match(
      result.stderr,
      /^check-taskfile-tree: cannot load the tree: unreadable: taskfiles\/lint\.yml/,
    );
  });

  it("exits 2 on an unparsable file", () => {
    const result = cli(stage({ ...split(), "taskfiles/lint.yml": "tasks: [unclosed\n" }));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /cannot load the tree: unparsable: taskfiles\/lint\.yml/);
  });
});

describe("check-taskfile-tree R14 comparison with task --list-all --json", () => {
  it("prints an explicit NOTICE and still runs the other checks when task is absent", () => {
    const emptyBin = tempDir("taskfile-tree-nopath-");
    const clean = cli(stage(split()), { PATH: emptyBin });
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(
      clean.stderr,
      /^check-taskfile-tree: NOTICE task binary not found; loader-vs-Task name comparison \(spec 0278 R14\) SKIPPED\n/,
    );
    assert.match(clean.stdout, /^check-taskfile-tree: OK/);

    const broken = cli(stage({ ...split(), "taskfiles/foo.yml": "version: '3.54'\ntasks: {}\n" }), {
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
    const hidden = LINT.replace(
      "tasks:\n",
      "tasks:\n  hidden:\n    internal: true\n    cmds:\n      - echo hidden\n",
    );
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
      stage({ ...split(), "taskfiles/lint.yml": LINT.replace("'3.54'", "'3.38'") }),
    );
    assert.ok(result.findings.some((f) => f.startsWith("taskfiles/lint.yml: version '3.38'")));
    assert.ok(result.findings.some((f) => f.startsWith("'task --list-all --json' exited")));
  });
});
