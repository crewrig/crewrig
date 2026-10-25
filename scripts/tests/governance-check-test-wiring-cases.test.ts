// Replaces scripts/tests/test-check-test-wiring.sh (spec 0265, row J2, P6).
// Cases a-f of the Bash suite against scripts/check-test-wiring.ts. Fixtures are generated
// at run time inside a mkdtemp sandbox; no `test-*.sh` file is committed, so the repo-wide
// check-test-wiring and check-test-strays guards never see them.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { makeSandbox, REPO, runEntry } from "./lib/governance-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "check-test-wiring.ts");

function mkFixture(tests: string[], workflow: string, exemptions?: string): string {
  const dir = makeSandbox("test-wiring-");
  for (const sub of ["scripts/tests", ".github/workflows", "ci"])
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  for (const t of tests) {
    const file = path.join(dir, "scripts/tests", t);
    fs.writeFileSync(file, "#!/bin/bash\nexit 0\n");
    fs.chmodSync(file, 0o755);
  }
  fs.writeFileSync(path.join(dir, ".github/workflows/build.yml"), workflow);
  if (exemptions !== undefined)
    fs.writeFileSync(path.join(dir, "ci/test-wiring-exemptions.txt"), exemptions);
  return dir;
}

const check = (repo: string) => runEntry(ENTRY, { env: { CREWRIG_REPO_DIR: repo } });

const wired = (name: string): string =>
  `jobs:\n  check-components:\n    steps:\n      - run: bash scripts/tests/${name}\n`;

describe("check-test-wiring cases", () => {
  it("case-a: a wired test passes the check (exit 0) with the OK line", () => {
    const r = check(mkFixture(["test-alpha.sh"], wired("test-alpha.sh")));
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes("the exemption allowlist is honest"), r.stdout);
    assert.equal(
      r.stdout,
      "OK: all test scripts are wired (1) or exempted with a reason (0); the exemption allowlist is honest.\n",
    );
  });

  it("case-b: an exempted-with-reason test passes the check (exit 0)", () => {
    const r = check(
      mkFixture(
        ["test-beta.sh"],
        "jobs: {}\n",
        "test-beta.sh\tneeds a live server the hermetic job lacks\n",
      ),
    );
    assert.equal(r.status, 0, r.stderr);
  });

  it("case-c: an unwired, unexempted test fails (exit 1) and stderr names it (R2)", () => {
    const r = check(mkFixture(["test-gamma.sh"], "jobs: {}\n"));
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes("scripts/tests/test-gamma.sh"), r.stderr);
    assert.ok(
      r.stderr.startsWith(
        "FAILED: 1 test script(s) run in no CI workflow and are not exempted:\n  - scripts/tests/test-gamma.sh\n",
      ),
    );
  });

  it("case-d: a reasonless exemption fails (exit 1) and stderr says so (R3)", () => {
    const r = check(mkFixture(["test-delta.sh"], "jobs: {}\n", "test-delta.sh\n"));
    assert.equal(r.status, 1);
    assert.ok(/no reason/i.test(r.stderr), r.stderr);
    assert.ok(
      r.stderr.includes("FAILED: 1 exemption entr(y/ies) carry no reason:\n  - test-delta.sh\n"),
    );
  });

  it("case-e: a stale exemption fails (exit 1) and stderr names it (R5)", () => {
    const r = check(
      mkFixture(["test-real.sh"], wired("test-real.sh"), "test-gone.sh\tformerly needed docker\n"),
    );
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes("test-gone.sh"), r.stderr);
    assert.ok(
      r.stderr.includes(
        "FAILED: 1 exemption entr(y/ies) name a test that no longer exists:\n  - test-gone.sh\n",
      ),
    );
  });

  it("case-f: a commented-out invocation does not count as wired (exit 1), named", () => {
    const wf =
      "jobs:\n  check-components:\n    steps:\n      - run: |\n          echo hi\n          # bash scripts/tests/test-commented.sh\n";
    const r = check(mkFixture(["test-commented.sh"], wf));
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes("scripts/tests/test-commented.sh"), r.stderr);
  });

  // Issue #1375: the `*.test.ts` population, wired through the Task CI contract.
  const mkTs = (tests: string[], taskfile: string, workflow = "jobs: {}\n"): string => {
    const dir = mkFixture([], workflow);
    fs.mkdirSync(path.join(dir, "taskfiles"), { recursive: true });
    for (const t of tests) fs.writeFileSync(path.join(dir, "scripts/tests", t), "");
    fs.writeFileSync(path.join(dir, "taskfiles/ci.yml"), taskfile);
    return dir;
  };
  const cmd = (args: string): string => `tasks:\n  x:\n    cmds:\n      - node --test ${args}\n`;

  it("case-g: an unwired .test.ts fails (exit 1) and stderr names it", () => {
    const r = check(mkTs(["alpha.test.ts"], "tasks: {}\n"));
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes("  - scripts/tests/alpha.test.ts\n"), r.stderr);
  });

  it("case-h: a .test.ts named at any position of a command line is wired", () => {
    const line = "{{.REPO_DIR}}/scripts/tests/a.test.ts {{.REPO_DIR}}/scripts/tests/b.test.ts";
    const r = check(mkTs(["a.test.ts", "b.test.ts"], cmd(line)));
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes("wired (2)"), r.stdout);
  });

  it("case-i: a quoted glob in a command wires the files it matches only", () => {
    const r = check(mkTs(["grp-a.test.ts", "other.test.ts"], cmd("'scripts/tests/grp-*.test.ts'")));
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes("scripts/tests/other.test.ts"), r.stderr);
    assert.ok(!r.stderr.includes("grp-a"), r.stderr);
  });

  it("case-j: a path-filter entry alone does not wire a .test.ts", () => {
    const filter = 'on:\n  paths:\n    - "scripts/tests/alpha.test.ts"\n';
    const r = check(mkTs(["alpha.test.ts"], "tasks: {}\n", filter));
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes("scripts/tests/alpha.test.ts"), r.stderr);
  });

  it("case-k: a commented-out .test.ts command does not wire it", () => {
    const r = check(
      mkTs(
        ["alpha.test.ts"],
        "tasks:\n  x:\n    cmds:\n      # node --test scripts/tests/alpha.test.ts\n",
      ),
    );
    assert.equal(r.status, 1);
  });
});
