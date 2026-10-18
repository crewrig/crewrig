// Replaces scripts/tests/test-spec-linter.sh (Cases 44-48 automated status-transition enforcement,
// spec 0168 R1/R2 and 0109 delta-04 R22; Case 59 the no-match notice; Case 60 is new: the
// `refactor/` and `perf/` prefixes the Bash suite never exercised). One repository per test.
import { describe, test } from "node:test";
import {
  expectLint,
  lifecycleFixture,
  lifecycleSpecText,
  lintBranch,
  touchUnrelated,
} from "./lib/spec-linter-lifecycle.ts";
import { commitAll, git, runLinter, type Fixture } from "./lib/spec-linter-fixtures.ts";

const T = { timeout: 60_000 };
const DRAFT_BANNER = "added or modified by this change carry 'status: draft'";

/** `main` holds spec 0300 (implemented); `withCool` also merges spec 0302 (approved). */
function base(withCool: boolean): Fixture {
  const fx = lifecycleFixture([
    ["0300-base-feature.md", "implemented", 123],
    ...(withCool ? ([["0302-cool-feature.md", "approved", 123]] as const) : []),
  ]);
  return fx;
}

const lintMain = (fx: Fixture) => runLinter(fx.root, ["specs"], { env: { BASE_REF: "main" } });

describe("spec-linter automated status transitions (spec 0168)", () => {
  test("Case 44 — new spec PR carrying draft status fails CI (spec 0168 R1)", T, () => {
    const fx = base(false);
    git(fx.root, "checkout", "-q", "-b", "spec/0301-new-feature");
    fx.put("specs/0301-new-feature.md", lifecycleSpecText("0301-new-feature.md", "draft", 123));
    commitAll(fx.root, "add spec in draft");
    expectLint(lintMain(fx), 1, `+${DRAFT_BANNER}`);
  });

  test("Case 45 — new spec PR carrying approved status passes CI (spec 0168 R1)", T, () => {
    const fx = base(false);
    git(fx.root, "checkout", "-q", "-b", "spec/0301-new-feature");
    fx.put("specs/0301-new-feature.md", lifecycleSpecText("0301-new-feature.md", "approved", 123));
    commitAll(fx.root, "transition spec to approved");
    expectLint(lintMain(fx), 0, `-${DRAFT_BANNER}`);
  });

  function implBranch(): Fixture {
    const fx = base(true);
    git(fx.root, "checkout", "-q", "-b", "feat/0302-cool-feature");
    fx.put("docs/feature.js", 'console.log("implemented");\n');
    commitAll(fx.root, "implement feature without updating spec status", ["docs"]);
    return fx;
  }

  test("Case 46 — implementation PR without status: implemented fails CI (spec 0168 R2)", T, () => {
    expectLint(
      lintMain(implBranch()),
      1,
      "+specs/0302-cool-feature.md (current status: 'approved')",
    );
  });

  test("Case 47 — implementation PR with status: implemented passes CI (spec 0168 R2)", T, () => {
    const fx = implBranch();
    fx.put(
      "specs/0302-cool-feature.md",
      lifecycleSpecText("0302-cool-feature.md", "implemented", 123),
    );
    commitAll(fx.root, "transition spec 0302 to implemented");
    expectLint(lintMain(fx), 0, "-(current status:");
  });

  test(
    "Case 48 — implementation branch with no matching spec file passes with a notice (spec 0168 R2, 0109 delta-04 R22)",
    T,
    () => {
      const fx = base(true);
      git(fx.root, "checkout", "-q", "-b", "fix/0999-no-such-spec");
      fx.put("docs/fix.js", 'console.log("fix");\n');
      commitAll(fx.root, "fix non-spec issue", ["docs"]);
      expectLint(
        lintBranch(fx, "fix/0999-no-such-spec"),
        0,
        "+[NOTICE]",
        "+999",
        "-(current status:",
      );
    },
  );
});

describe("spec-linter implementation-branch notice and prefixes (spec 0109 delta-04)", () => {
  test(
    "Case 59 — a ticket-numbered branch matching no file prints the notice and exits zero (R22)",
    T,
    () => {
      const fx = lifecycleFixture([["0270-unrelated.md", "implemented", 1270]]);
      touchUnrelated(fx);
      expectLint(lintBranch(fx, "fix/1500-typo"), 0, "+[NOTICE]", "+1500", "-(current status:");
    },
  );

  // Not in the Bash suite: the branch regex accepts feat|fix|refactor|perf|chore.
  for (const branch of ["refactor/1500-x", "perf/1500-x"]) {
    test(`Case 60 — ${branch} is checked as an implementation branch (R20)`, T, () => {
      const fx = lifecycleFixture([["0262-still-open.md", "approved", 1500]]);
      touchUnrelated(fx);
      expectLint(
        lintBranch(fx, branch),
        1,
        "+specs/0262-still-open.md (current status: 'approved')",
      );
    });
  }
});
