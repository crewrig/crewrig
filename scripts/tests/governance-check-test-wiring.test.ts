// check-test-wiring.test.ts — black-box edge cases of scripts/check-test-wiring.ts that
// the Bash suite does not cover: a CRLF exemption file, a name that is a prefix of
// another, and a later uncommented occurrence on a line whose first occurrence is
// commented. Each case asserts byte-for-byte against FROZEN expectations recorded on Linux
// from the original shell script under LC_ALL=C (fixtures/governance-oracle/check-test-wiring.json.golden).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(SCRIPTS, "check-test-wiring.ts");
const GOLDEN = path.join(
  SCRIPTS,
  "tests",
  "fixtures",
  "governance-oracle",
  "check-test-wiring.json.golden",
);

const tmp = mkdtempSync(path.join(tmpdir(), "test-wiring-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

const ORACLE: Record<string, Run & { input: unknown }> = JSON.parse(
  readFileSync(GOLDEN, "utf8"),
) as Record<string, Run & { input: unknown }>;

function run(repo: string): Run {
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY], {
    encoding: "utf8",
    env: { ...process.env, CREWRIG_REPO_DIR: repo, LC_ALL: "C" },
  });
  // The recording replaced the fixture root with a placeholder; do the same here.
  const norm = (t: string): string => t.split(repo).join("<REPO>");
  return { status: r.status, stdout: norm(r.stdout), stderr: norm(r.stderr) };
}

let n = 0;
/** Build a fixture repo: test names, one workflow body, an optional exemption file. */
function fixture(key: string, tests: string[], workflow: string, exemptions?: string): string {
  assert.deepEqual(ORACLE[key].input, [tests, workflow, exemptions ?? null]);
  const repo = path.join(tmp, `r${n++}`);
  mkdirSync(path.join(repo, "scripts/tests"), { recursive: true });
  mkdirSync(path.join(repo, ".github/workflows"), { recursive: true });
  mkdirSync(path.join(repo, "ci"), { recursive: true });
  for (const t of tests) writeFileSync(path.join(repo, "scripts/tests", t), "#!/bin/bash\n");
  writeFileSync(path.join(repo, ".github/workflows/ci.yml"), workflow);
  if (exemptions !== undefined)
    writeFileSync(path.join(repo, "ci/test-wiring-exemptions.txt"), exemptions);
  return repo;
}

function check(key: string, repo: string): Run {
  const ts = run(repo);
  const { input: _input, ...frozen } = ORACLE[key];
  assert.deepEqual(ts, frozen);
  return ts;
}

describe("check-test-wiring edge cases", () => {
  it("accepts a CRLF exemption file", () => {
    const repo = fixture("crlf", ["test-a.sh"], "", "# header\r\ntest-a.sh\tkept on purpose\r\n");
    const r = check("crlf", repo);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /exempted with a reason \(1\)/);
  });

  it("does not let a name that prefixes another wire it", () => {
    const repo = fixture(
      "prefix",
      ["test-foo.sh", "test-foo.sh.sh"],
      "      - run: bash scripts/tests/test-foo.sh.sh\n",
    );
    const r = check("prefix", repo);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /1 test script\(s\)/);
    assert.match(r.stderr, / {2}- scripts\/tests\/test-foo\.sh\n/);
  });

  it("judges only the first occurrence of a line", () => {
    const repo = fixture(
      "first",
      ["test-a.sh"],
      "# scripts/tests/test-a.sh then scripts/tests/test-a.sh\n",
    );
    const r = check("first", repo);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /scripts\/tests\/test-a\.sh/);
  });

  it("prints the reader's FAILED block, not a stack trace, for a malformed reference directory", () => {
    // Not an oracle case: the shell twin never read the reference directory (spec 0309 R3).
    const repo = path.join(tmp, "bad-reference");
    mkdirSync(path.join(repo, "scripts/tests"), { recursive: true });
    mkdirSync(path.join(repo, "ci/capabilities"), { recursive: true });
    writeFileSync(path.join(repo, "ci/capabilities/bogus.yml"), "capabilities: []\n");
    const r = run(repo);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.match(
      r.stderr,
      /^FAILED: 1 reference-validity violation\(s\) in <REPO>\/ci\/capabilities\/:\n/,
    );
    assert.match(r.stderr, /\n {2}- ci\/capabilities\/bogus\.yml: name is not /);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  });

  it("exits 2 when the tests directory is missing", () => {
    const repo = path.join(tmp, "empty");
    mkdirSync(repo);
    const r = check("missing", repo);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^Error: tests directory not found: /);
  });
});
