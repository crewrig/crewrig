// check-stray-scan-wiring.test.ts — tests for the stray-scan wiring check
// (spec 0170 delta-01 R17, issue #1445).
//
// Black-box tests of scripts/check-stray-scan-wiring.ts against throwaway
// `git init` repositories through CREWRIG_REPO_DIR, modelled on
// check-path-ownership.test.ts. Standard library only (the entry point itself
// needs js-yaml from the repository's node_modules).
//
// Contract:
//   - R17a: a command whose program is `bash scripts/tests/test-*.sh`, in a
//     capability `command` of ci/ci-capabilities.yml or in a `run:` line of a
//     hand-authored workflow, is a finding unless it is the scanned form
//     `bash scripts/ci-cache-guard.sh --stray-scan -- bash scripts/tests/<suite>`.
//     One generated cache-guard layer (`--cache-dir ... --`) is removed first, so
//     a suite wrapped only by the cache guard is still bare.
//   - R17b: a tracked suite with an owner (a capability whose command names it)
//     must match the pull-request `paths:` of at least one owner, unless an owner
//     has no `paths:` filter. A suite with no owner passes.
//   - Exit 0 clean, 1 findings, 2 wiring fault.
//   - Finding lines: `stray-scan-wiring: <R17a|R17b>: <subject>: <message>` where
//     the subject is the capability id, `<workflow file>#<job>`, or the suite.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK = path.join(REPO, "scripts", "check-stray-scan-wiring.ts");
const REFERENCE_PATH = "ci/ci-capabilities.yml";
const WORKFLOW_PATH = ".github/workflows/build.yml";

// --- Fixture repositories ----------------------------------------------------------

type Tree = Record<string, string>;

interface Trigger {
  on: "pull-request" | "push";
  paths?: string[];
}

interface Capability {
  id: string;
  triggers: Trigger[];
  command: string[];
}

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

/** The environment minus anything that would leak the caller's git state or base ref. */
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    "CI_BASE_REF",
    "BASE_REF",
    "CI_MERGE_REQUEST_TARGET_BRANCH_SHA",
    "CI_COMMIT_BEFORE_SHA",
    "CREWRIG_REPO_DIR",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
  ]) {
    delete env[key];
  }
  return { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...extra };
}

function git(dir: string, ...args: string[]): void {
  const res = spawnSync(
    "git",
    ["-C", dir, "-c", "user.email=t@example.invalid", "-c", "user.name=t", ...args],
    { encoding: "utf8", env: cleanEnv({}) },
  );
  assert.equal(res.status, 0, `git ${args.join(" ")}: ${res.stderr}`);
}

function write(dir: string, tree: Tree): void {
  for (const [rel, content] of Object.entries(tree)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

/** A capability list in the reference's shape; globs and commands are JSON-quoted (valid YAML). */
function reference(caps: readonly Capability[]): string {
  const lines = ["capabilities:"];
  for (const cap of caps) {
    lines.push(`  - id: ${cap.id}`, "    trigger:");
    for (const t of cap.triggers) {
      lines.push(`      - on: ${t.on}`, "        branches: [main]");
      if (t.paths !== undefined) {
        lines.push("        paths:");
        for (const p of t.paths) lines.push(`          - ${JSON.stringify(p)}`);
      }
    }
    lines.push("    command:");
    for (const c of cap.command) lines.push(`      - ${JSON.stringify(c)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** A workflow whose jobs each run the given single-line `run:` steps. */
function workflow(jobs: Record<string, string[]>): string {
  const lines = ["name: ci", "on: [push]", "jobs:"];
  for (const [job, runs] of Object.entries(jobs)) {
    lines.push(`  ${job}:`, "    runs-on: ubuntu-latest", "    steps:");
    runs.forEach((run, i) => {
      lines.push(`      - name: step ${i}`, `        run: ${JSON.stringify(run)}`);
    });
  }
  return `${lines.join("\n")}\n`;
}

const suitePath = (name: string): string => `scripts/tests/${name}`;

/** The accepted form of a suite command. */
const scanned = (name: string): string =>
  `bash scripts/ci-cache-guard.sh --stray-scan -- bash ${suitePath(name)}`;

/** A bare suite command. */
const bare = (name: string): string => `bash ${suitePath(name)}`;

/** One generated cache-guard layer, as build.yml writes it. */
const CACHE_LAYER =
  'bash scripts/ci-cache-guard.sh --cache-dir .ci-cache --key-files "scripts/a.sh,scripts/tests/test-a.sh" --key-env "" -- ';

const SUITE_A = "test-a.sh";

/** A clean capability owning test-a.sh, triggered by a change to it, plus commands that are not suites. */
const ALPHA: Capability = {
  id: "alpha",
  triggers: [{ on: "pull-request", paths: [suitePath(SUITE_A)] }],
  command: ["npm ci", "node scripts/check-x.ts", "bash scripts/other.sh", scanned(SUITE_A)],
};

interface FixtureOptions {
  caps?: readonly Capability[];
  /** Written verbatim as the reference, overriding `caps`. */
  rawReference?: string;
  /** Written verbatim as `.github/workflows/build.yml`; `null` writes none. */
  workflowText?: string | null;
  /** Extra tracked files. */
  tree?: Tree;
  /** Do not write the reference at all. */
  noReference?: boolean;
}

/** A repository holding a clean wiring unless options say otherwise. */
function repo(opts: FixtureOptions = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stray-scan-wiring-"));
  temps.push(dir);
  git(dir, "init", "-q", "-b", "main");
  const tree: Tree = { [suitePath(SUITE_A)]: "#!/usr/bin/env bash\n", ...opts.tree };
  if (opts.noReference !== true)
    tree[REFERENCE_PATH] = opts.rawReference ?? reference(opts.caps ?? [ALPHA]);
  if (opts.workflowText !== null)
    tree[WORKFLOW_PATH] = opts.workflowText ?? workflow({ alpha: [scanned(SUITE_A)] });
  write(dir, tree);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "fixture");
  return dir;
}

interface Run {
  status: number | null;
  all: string;
}

/** Run the real entry point against `dir`, from a neutral working directory. */
function check(dir: string): Run {
  const res = spawnSync("node", ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CHECK], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    env: cleanEnv({ CREWRIG_REPO_DIR: dir }),
  });
  return { status: res.status, all: `${res.stdout}${res.stderr}` };
}

/** The finding lines of one rule. */
function findings(run: Run, rule: "R17a" | "R17b"): string[] {
  return run.all.split("\n").filter((l) => l.includes(`stray-scan-wiring: ${rule}:`));
}

// --- R17a: a suite command must engage the scan -------------------------------------

describe("check-stray-scan-wiring: R17a, every suite command engages the scan", () => {
  test("a wiring where every suite command is scanned exits 0 with no finding", () => {
    const r = check(repo());

    assert.equal(r.status, 0, r.all);
    assert.doesNotMatch(r.all, /R17/);
  });

  test("a bare suite command in the reference fails, naming the capability and the suite", () => {
    const caps = [{ ...ALPHA, command: [bare(SUITE_A)] }];

    const r = check(repo({ caps }));

    assert.equal(r.status, 1, r.all);
    const lines = findings(r, "R17a");
    assert.equal(lines.length, 1, r.all);
    assert.match(lines[0] ?? "", /R17a: alpha:/);
    assert.ok(
      (lines[0] ?? "").includes(suitePath(SUITE_A)),
      `the finding names the suite:\n${r.all}`,
    );
  });

  test("a bare suite command in a workflow fails, naming the file and the job", () => {
    const r = check(
      repo({ workflowText: workflow({ alpha: [scanned(SUITE_A)], gamma: [bare(SUITE_A)] }) }),
    );

    assert.equal(r.status, 1, r.all);
    const lines = findings(r, "R17a");
    assert.equal(lines.length, 1, r.all);
    assert.match(lines[0] ?? "", /R17a: \S*build\.yml#gamma:/);
  });

  test("a bare suite command on the second line of a multi-line run: block fails", () => {
    const text = [
      "name: ci",
      "on: [push]",
      "jobs:",
      "  alpha:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: both",
      "        run: |",
      "          echo start",
      `          ${bare(SUITE_A)}`,
      "",
    ].join("\n");

    const r = check(repo({ workflowText: text }));

    assert.equal(r.status, 1, r.all);
    assert.match(findings(r, "R17a")[0] ?? "", /R17a: \S*build\.yml#alpha:/);
  });

  test("a scanned suite command wrapped in a cache-guard layer passes", () => {
    const run = `${CACHE_LAYER}${scanned(SUITE_A)}`;

    const r = check(repo({ workflowText: workflow({ alpha: [run] }) }));

    assert.equal(r.status, 0, r.all);
  });

  test("a bare suite command wrapped only in a cache-guard layer is still bare", () => {
    const run = `${CACHE_LAYER}${bare(SUITE_A)}`;

    const r = check(repo({ workflowText: workflow({ alpha: [run] }) }));

    assert.equal(r.status, 1, r.all);
    assert.match(findings(r, "R17a")[0] ?? "", /R17a: \S*build\.yml#alpha:/);
  });

  test("every bare command is its own finding, in the reference and the workflow", () => {
    const caps = [{ ...ALPHA, command: [bare(SUITE_A), scanned(SUITE_A)] }];
    const workflowText = workflow({ one: [bare(SUITE_A)], two: [bare(SUITE_A)] });

    const r = check(repo({ caps, workflowText }));

    assert.equal(r.status, 1, r.all);
    assert.equal(findings(r, "R17a").length, 3, r.all);
  });

  test("commands that are not registered suites are not findings", () => {
    const caps = [
      {
        ...ALPHA,
        command: [
          scanned(SUITE_A),
          "bash scripts/tests/lib/helper.sh",
          "bash scripts/build-ci.sh --check",
          "node --test scripts/tests/some.test.ts",
        ],
      },
    ];
    const workflowText = workflow({
      alpha: [scanned(SUITE_A), "bash scripts/check-test-wiring.sh"],
    });

    const r = check(repo({ caps, workflowText }));

    assert.equal(r.status, 0, r.all);
  });

  test("a repository without workflow files is checked on the reference alone", () => {
    const r = check(repo({ workflowText: null }));

    assert.equal(r.status, 0, r.all);
  });
});

// --- R17b: an owner must trigger on the suite's own path -----------------------------

describe("check-stray-scan-wiring: R17b, the owner triggers on the suite's path", () => {
  const OTHER = suitePath("test-b.sh");

  test("an owner whose pull-request paths miss the suite fails, naming the suite and the owner", () => {
    const caps = [{ ...ALPHA, triggers: [{ on: "pull-request" as const, paths: [OTHER] }] }];

    const r = check(repo({ caps }));

    assert.equal(r.status, 1, r.all);
    const lines = findings(r, "R17b");
    assert.equal(lines.length, 1, r.all);
    assert.ok((lines[0] ?? "").includes(suitePath(SUITE_A)), `names the suite:\n${r.all}`);
    assert.ok((lines[0] ?? "").includes("alpha"), `names the owner:\n${r.all}`);
    assert.deepEqual(findings(r, "R17a"), []);
  });

  test("an owner with no paths: filter passes", () => {
    const caps = [{ ...ALPHA, triggers: [{ on: "pull-request" as const }] }];

    const r = check(repo({ caps }));

    assert.equal(r.status, 0, r.all);
  });

  test("with two owners, one matching the suite is enough", () => {
    const missing = { ...ALPHA, triggers: [{ on: "pull-request" as const, paths: [OTHER] }] };
    const beta = (paths: string[]): Capability => ({
      id: "beta",
      triggers: [{ on: "pull-request", paths }],
      command: [scanned(SUITE_A)],
    });

    const miss = check(repo({ caps: [missing, beta([OTHER])] }));
    const hit = check(repo({ caps: [missing, beta(["scripts/tests/*.sh"])] }));

    assert.equal(miss.status, 1, miss.all);
    assert.ok(
      (findings(miss, "R17b")[0] ?? "").includes("beta"),
      `names both owners:\n${miss.all}`,
    );
    assert.equal(hit.status, 0, hit.all);
  });

  test("a suite with no owner passes both rules", () => {
    const orphan = suitePath("test-orphan.sh");

    const r = check(repo({ tree: { [orphan]: "#!/usr/bin/env bash\n" } }));

    assert.equal(r.status, 0, r.all);
  });

  test("a paths: set on a push trigger confers no ownership of a pull-request change", () => {
    const caps = [
      {
        ...ALPHA,
        triggers: [
          { on: "pull-request" as const, paths: [OTHER] },
          { on: "push" as const, paths: [suitePath(SUITE_A)] },
        ],
      },
    ];

    const r = check(repo({ caps }));

    assert.equal(r.status, 1, r.all);
    assert.equal(findings(r, "R17b").length, 1, r.all);
  });
});

// --- Wiring faults exit 2 (not 1) ---------------------------------------------------

describe("check-stray-scan-wiring: wiring faults exit 2", () => {
  test("an unsupported glob in an owner's paths:", () => {
    const glob = "scripts/tests/{test-a,test-b}.sh";
    const caps = [{ ...ALPHA, triggers: [{ on: "pull-request" as const, paths: [glob] }] }];

    const r = check(repo({ caps }));

    assert.equal(r.status, 2, r.all);
    assert.ok(r.all.includes(glob), `the message names the glob:\n${r.all}`);
  });

  test("a missing reference", () => {
    const r = check(repo({ noReference: true }));

    assert.equal(r.status, 2, r.all);
  });

  test("malformed YAML in the reference", () => {
    const r = check(repo({ rawReference: "capabilities: [unclosed\n  - id: x: y:\n" }));

    assert.equal(r.status, 2, r.all);
  });

  test("a reference without a capabilities list", () => {
    const r = check(repo({ rawReference: "something: else\n" }));

    assert.equal(r.status, 2, r.all);
  });
});

// --- The real repository ------------------------------------------------------------

describe("check-stray-scan-wiring: the real repository", () => {
  test("every suite command of the repository engages the scan and every owner triggers on its suite", () => {
    const r = check(REPO);

    assert.equal(r.status, 0, r.all);
  });
});
