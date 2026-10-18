// governance-check-test-strays-cases.test.ts — Replaces scripts/tests/test-check-test-strays.sh
// (spec 0265, row J2, P6). Cases a, b, g, n (ten rows), u (gaps over
// governance-check-test-strays.test.ts), t, plus the code-unit-order and cwd-default tests.
// Case r lives in governance-base-ref.test.ts. POSIX-only (the entry skips on win32).
//
// All suites are generated into mkdtemp directories; no `test-*.sh` fixture is committed.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, test } from "node:test";

import {
  ciTopology,
  countSuites,
  mkSuites,
  okLine,
  probeSuite,
} from "./lib/governance-test-strays-fixture.ts";
import { makeSandbox, REPO, runEntry, type RunResult } from "./lib/governance-sandbox.ts";

interface RunOutcome {
  code: number;
  stdout: string;
  stderr: string;
}

const skip = process.platform === "win32" ? "POSIX only (the entry skips on win32)" : false;

// A path taken from the environment must be contained: it is resolved with realpath and accepted
// only inside the repo checkout or inside the real temp directory, else the test refuses to run.
function resolveEntryDir(): string {
  const raw = process.env.CREWRIG_GOV_ENTRY_DIR;
  if (raw === undefined) return path.join(REPO, "scripts");
  const real = fs.realpathSync(raw);
  const roots = [fs.realpathSync(REPO), fs.realpathSync(os.tmpdir())];
  const inside = roots.some((root) => real === root || real.startsWith(root + path.sep));
  if (!inside)
    throw new Error(`CREWRIG_GOV_ENTRY_DIR escapes the checkout and the temp dir: ${real}`);
  return real;
}
const ENTRY = path.join(resolveEntryDir(), "check-test-strays.ts");
const CLEAN_ENV = {
  GITHUB_BASE_REF: undefined,
  CI_MERGE_REQUEST_TARGET_BRANCH_NAME: undefined,
  CI_COMMIT_BEFORE_SHA: undefined,
  GITHUB_ACTIONS: undefined,
};

function check(
  repo: string,
  args: readonly string[] = [],
  env: Readonly<Record<string, string | undefined>> = {},
): RunResult {
  return runEntry(ENTRY, { args, env: { ...CLEAN_ENV, CREWRIG_REPO_DIR: repo, ...env } });
}

function repoWith(files: Record<string, string> = {}): string {
  const repo = makeSandbox("strays-repo-");
  mkSuites(repo, files);
  return repo;
}

describe("check-test-strays cases", { skip }, () => {
  test("case-a: a clean tree passes with the exact OK line and empty stderr", () => {
    const r = check(repoWith({ "test-clean.sh": '#!/bin/bash\necho "Everything is fine"\n' }));
    assert.equal(r.status, 0);
    assert.equal(r.stdout, `${okLine(1)}\n`);
    assert.equal(r.stderr, "");
  });

  test("case-b: a runtime stray is not seen by the static check (if this goes red, the guard started executing suites again)", () => {
    const r = check(repoWith({ "test-stray.sh": "#!/bin/bash\nsome-bogus-command\n" }));
    assert.equal(r.status, 0);
    assert.equal(r.stdout, `${okLine(1)}\n`);
    assert.equal(r.stderr, "");
  });

  test("case-g: a syntax error exits 1 naming the file, before anything runs", () => {
    const repo = repoWith({
      "test-syntax-err.sh": '#!/bin/bash\nif [ -f "foo" ; then\n  echo "broken"\n',
    });
    const sentinel = path.join(makeSandbox("strays-sentinel-"), "sentinel.g");
    probeSuite(repo, sentinel, false);
    const r = check(repo);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes("test-syntax-err.sh has syntax errors"), r.stderr);
    assert.equal(r.stdout, "");
    assert.equal(fs.existsSync(sentinel), false);
  });

  test("the first failure reported is the first in code-unit order (z written before a)", () => {
    const repo = repoWith({ "test-z.sh": "if then\n", "test-a.sh": "fi\n" });
    const r = check(repo);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^FAILED: test-a\.sh has syntax errors:/);
    assert.ok(!r.stderr.includes("test-z.sh"), r.stderr);
  });

  test("the suites are visited in code-unit order whatever order the directory enumerates", async (t) => {
    // The file-system enumeration order is not portable (ext4 and overlayfs hash it, tmpfs reverses
    // it), so a real directory cannot prove the sort deterministically: the listing is forced to
    // the reverse order in-process, against the library the entry wraps.
    const repo = repoWith({ "test-a.sh": "fi\n", "test-b.sh": "if then\n", "test-c.sh": "true\n" });
    const real = fs.readdirSync as (...x: unknown[]) => unknown;
    t.mock.method(fs, "readdirSync", (...x: unknown[]) => {
      const out = real(...x);
      return Array.isArray(out) ? (out as string[]).slice().sort().reverse() : out;
    });
    const lib = (await import(
      pathToFileURL(path.join(resolveEntryDir(), "lib", "governance", "test-strays.ts")).href
    )) as {
      runTestStrays: (argv: string[], o: { repoDir: string; platform: string }) => RunOutcome;
    };
    const r = lib.runTestStrays([], { repoDir: repo, platform: "linux" });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /^FAILED: test-a\.sh has syntax errors:/);
  });

  describe("case-n: the guard executes nothing (ten rows)", () => {
    const sums = (dir: string): string => {
      const h = createHash("sha256");
      for (const f of fs.readdirSync(dir).sort())
        h.update(f).update(fs.readFileSync(path.join(dir, f)));
      return h.digest("hex");
    };
    let template: string | undefined;
    const gitRepo = (): string => {
      if (template === undefined) {
        template = makeSandbox("strays-tpl-");
        ciTopology(template, makeSandbox("strays-bare-"));
      }
      const repo = makeSandbox("strays-repo-");
      fs.cpSync(template, repo, { recursive: true });
      return repo;
    };
    const ZERO = "0".repeat(40);
    const rows: Array<{
      label: string;
      kind: "nogit" | "git" | "warm" | "legacy";
      args?: string[];
      env?: Record<string, string>;
    }> = [
      { label: "no-git", kind: "nogit" },
      { label: "base-ref-arg", kind: "git", args: ["--base-ref", "main"] },
      { label: "ci-topology", kind: "git" },
      { label: "github-base", kind: "git", env: { GITHUB_BASE_REF: "main" } },
      {
        label: "github-base-unresolvable",
        kind: "git",
        env: { GITHUB_BASE_REF: "nope", GITHUB_ACTIONS: "true" },
      },
      { label: "gitlab-target", kind: "git", env: { CI_MERGE_REQUEST_TARGET_BRANCH_NAME: "main" } },
      { label: "gitlab-before", kind: "git", env: { CI_COMMIT_BEFORE_SHA: "HEAD~1" } },
      { label: "gitlab-before-zero", kind: "git", env: { CI_COMMIT_BEFORE_SHA: ZERO } },
      { label: "warm-cache", kind: "warm" },
      { label: "legacy-options", kind: "legacy" },
    ];
    for (const row of rows) {
      test(`case-n ${row.label}`, { timeout: 60_000 }, () => {
        const repo = row.kind === "git" || row.kind === "legacy" ? gitRepo() : repoWith();
        const sentinel = path.join(makeSandbox("strays-sentinel-"), `sentinel.${row.label}`);
        probeSuite(repo, sentinel);
        const n = countSuites(repo);
        const cache = path.join(makeSandbox("strays-cache-"), "never-created");
        let args = row.args ?? [];
        let before = "";
        if (row.kind === "warm") {
          const dir = path.join(repo, ".ci-cache");
          fs.mkdirSync(dir);
          fs.writeFileSync(path.join(dir, "0123456789abcdef.marker"), "pass\n");
          fs.writeFileSync(path.join(dir, "fedcba9876543210.marker"), "pass\n");
          before = sums(dir);
          args = ["--cache-dir", dir];
        } else if (row.kind === "legacy") {
          args = ["--base-ref", "main", "--cache-dir", cache, "--jobs", "4"];
        }
        const r = check(repo, args, row.env);
        if (row.kind === "warm") {
          assert.equal(
            sums(path.join(repo, ".ci-cache")),
            before,
            "the warm cache is left byte-identical",
          );
        }
        if (row.kind === "legacy") {
          assert.equal(
            fs.existsSync(cache),
            false,
            "the legacy --cache-dir directory is never created",
          );
        }
        assert.equal(
          fs.existsSync(sentinel),
          false,
          "the probe suite was not executed (no sentinel)",
        );
        assert.equal(r.status, 0);
        assert.equal(r.stdout, `${okLine(n)}\n`);
        assert.equal(r.stderr, "");
      });
    }
  });

  describe("case-u: usage errors exit 2", () => {
    test("a suite-path argument is rejected and the suite is not executed", () => {
      const repo = repoWith();
      const sentinel = path.join(makeSandbox("strays-sentinel-"), "sentinel.u");
      probeSuite(repo, sentinel, false);
      const r = check(repo, ["scripts/tests/test-probe.sh"]);
      assert.equal(r.status, 2);
      assert.ok(
        r.stderr.includes("unknown option or argument 'scripts/tests/test-probe.sh'"),
        r.stderr,
      );
      assert.equal(r.stdout, "");
      assert.equal(fs.existsSync(sentinel), false);
    });

    for (const opt of ["--cache-dir", "--base-ref", "--jobs"]) {
      test(`'${opt}' without its value requires a value`, () => {
        const r = check(repoWith(), [opt]);
        assert.equal(r.status, 2);
        assert.equal(r.stderr, `Error: option '${opt}' requires a value\n`);
        assert.equal(r.stdout, "");
      });
    }

    test("a valueless option after a valid one is still exit 2", () => {
      const r = check(repoWith(), ["--base-ref", "main", "--jobs"]);
      assert.equal(r.status, 2);
      assert.equal(r.stderr, "Error: option '--jobs' requires a value\n");
    });

    test("a missing tests directory is a usage error", () => {
      const r = check(makeSandbox("strays-empty-"));
      assert.equal(r.status, 2);
      assert.ok(r.stderr.includes("tests directory not found"), r.stderr);
      assert.equal(r.stdout, "");
    });
  });

  test("case-t: the real tree passes within the time bound", () => {
    // 5 s, not the 2 s of spec 0170 R9: a hard 2 s flakes on a loaded runner, while "executes
    // nothing" is proven exactly by case n. The bound still catches a return to running suites.
    const t0 = performance.now();
    const r = check(REPO);
    const elapsed = performance.now() - t0;
    assert.equal(r.status, 0);
    const m = /^OK: ([0-9]+) test suites pass the static syntax check; none executed\.$/.exec(
      r.stdout.trimEnd(),
    );
    // Zero is a valid count since row J2's last pull request retired the final `test-*.sh` suite:
    // what matters is that the line is the OK form with a number, not the count.
    assert.ok(m !== null, r.stdout);
    assert.ok(elapsed < 5000, `the real tree took ${Math.round(elapsed)} ms (bound 5000 ms)`);
  });

  test(
    "without CREWRIG_REPO_DIR the entry checks its own checkout",
    {
      skip: process.env.CREWRIG_GOV_ENTRY_DIR !== undefined && "mutation copy has no checkout",
    },
    () => {
      const r = runEntry(ENTRY, { env: { ...CLEAN_ENV, CREWRIG_REPO_DIR: undefined } });
      assert.equal(r.status, 0);
      assert.match(
        r.stdout,
        /^OK: [0-9]+ test suites pass the static syntax check; none executed\.\n$/,
      );
    },
  );
});
