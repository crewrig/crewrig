// Replaces scripts/tests/test-spec-linter.sh (Cases 35-40: attribution of a base-branch
// `status: draft` violation, spec 0109 delta-02 R9-R11 and delta-03 R14-R16). Each test builds
// its own repository: the Bash suite shared two and reset the work tree between cases.
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { expectLint } from "./lib/spec-linter-lifecycle.ts";
import {
  commitAll,
  git,
  gitFixture,
  renderSpec,
  runLinter,
  type Fixture,
} from "./lib/spec-linter-fixtures.ts";

const T = { timeout: 60_000 };
const OFFENDER = "specs/0210-attributed.md";
const NESTED = "sub/specs/0240-nested-layout.md";
const BANNER = "present on the base branch (main) carry 'status: draft'";

/** `main` holds one draft offender and an unrelated docs file. */
function attributed(): Fixture {
  const fx = gitFixture({
    remote: false,
    files: {
      [OFFENDER]: renderSpec({ id: "0210", slug: "attributed" }),
      "docs/unrelated.md": "# Unrelated\n\nBody.\n",
    },
  });
  commitAll(fx.root, "docs", ["docs"]);
  return fx;
}

const lintMain = (fx: Fixture, cwd?: string) =>
  runLinter(fx.root, ["specs"], { cwd, env: { BASE_REF: "main" } });

describe("spec-linter attribution of base-branch violations (spec 0109)", () => {
  test("Case 35 — no change relative to the base ref blocks on every offender (R10)", T, () => {
    expectLint(lintMain(attributed()), 1, `+${OFFENDER}`, "-[WARN]");
  });

  test("Case 36 — an offender the change does not touch warns, and does not fail (R9)", T, () => {
    const fx = attributed();
    fx.put("docs/unrelated.md", "# Unrelated\n\nBody, edited by the change under test.\n");
    expectLint(lintMain(fx), 0, "+[WARN]", "-[FAIL]");
  });

  test("Case 37 — an offender the change does touch fails (R2 as replaced)", T, () => {
    const fx = attributed();
    fs.appendFileSync(path.join(fx.root, OFFENDER), "\nEdited by the change under test.\n");
    expectLint(lintMain(fx), 1, `+${OFFENDER}`, "-[WARN]");
  });

  // An orphan branch resolves but shares no history with HEAD, so `git merge-base` fails.
  test("Case 38 — attribution that cannot be derived blocks, and says so (R11)", T, () => {
    const fx = gitFixture({
      remote: false,
      files: {
        "specs/0220-unrelated-history.md": renderSpec({ id: "0220", slug: "unrelated-history" }),
      },
    });
    git(fx.root, "checkout", "-q", "--orphan", "unrelated-base");
    // `git add specs`, never `-A`: the sandbox scaffolding is untracked and must stay so.
    commitAll(fx.root, "orphan base sharing no history with main");
    git(fx.root, "checkout", "-q", "main");
    const r = runLinter(fx.root, ["specs"], { env: { BASE_REF: "unrelated-base" } });
    expectLint(r, 1, "+could not be derived", "-[WARN]");
  });
});

// Specs and markdownlint configuration both sit under `sub/` of the repository; the banner (not
// the file path, which markdownlint also prints) proves the base-branch check itself executed.
function nested(): Fixture {
  const fx = gitFixture({ remote: false, files: { "specs/.gitkeep": "" } });
  fs.mkdirSync(path.join(fx.root, "sub"));
  fs.copyFileSync(path.join(fx.root, ".markdownlintrc"), path.join(fx.root, "sub/.markdownlintrc"));
  fs.symlinkSync(path.join(fx.root, "node_modules"), path.join(fx.root, "sub/node_modules"));
  fx.put(NESTED, renderSpec({ id: "0240", slug: "nested-layout" }));
  commitAll(fx.root, "draft non-delta spec on the base branch, under sub/", ["sub/specs"]);
  return fx;
}

describe("spec-linter working-directory independence (spec 0109 delta-03)", () => {
  test("Case 39 — an offender is identified from a subdirectory (R14)", T, () => {
    const fx = nested();
    expectLint(lintMain(fx, path.join(fx.root, "sub")), 1, `+${BANNER}`);
  });

  // Discriminates a partial fix: with `ls-tree` pinned alone the offender degrades to a bystander.
  test("Case 40 — attribution stays root-anchored under diff.relative (R14)", T, () => {
    const fx = nested();
    git(fx.root, "config", "diff.relative", "true");
    fs.appendFileSync(path.join(fx.root, NESTED), "\nEdited by the change under test.\n");
    expectLint(lintMain(fx, path.join(fx.root, "sub")), 1, `+${BANNER}`, "-[WARN]");
  });
});
