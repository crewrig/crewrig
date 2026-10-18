// Replaces scripts/tests/test-spec-linter.sh (Cases 52a-c, 53-58: delta-specs follow the lifecycle
// table and an implementation branch checks everything its ticket implements, spec 0109 delta-04
// R27). "-(current status:" means "no implementation-PR status violation". Guard cases are
// green on the pre-delta-04 linter; the others are the ones that went red first.
import { describe, test } from "node:test";
import {
  expectLint,
  lifecycleFixture,
  lifecycleSpecText,
  lintBranch,
  putLifecycleSpec,
  touchUnrelated,
} from "./lib/spec-linter-lifecycle.ts";
import { commitAll, git } from "./lib/spec-linter-fixtures.ts";
import fs from "node:fs";
import path from "node:path";

const T = { timeout: 60_000 };
const MERGED = "specs/0400-merged-delta.delta-01.md";
const BANNER = "present on the base branch (main) carry 'status: draft'";
const TS_PARENT = "0243-usage-capture-hooks-typescript.md";
const TS_D3 = "0243-usage-capture-hooks-typescript.delta-03.md";

describe("spec-linter delta-specs on the base branch (Cases 52a-c, R2/R9/R10/R18)", () => {
  const fixture = () => lifecycleFixture([["0400-merged-delta.delta-01.md", "draft", 1400]]);

  test(
    "Case 52a — a draft delta-spec on the base branch fails a run with no change (R10)",
    T,
    () => {
      expectLint(lintBranch(fixture(), "main"), 1, `+${MERGED}`, `+${BANNER}`, "-[WARN]");
    },
  );

  test(
    "Case 52b — a draft delta-spec the change does not touch is a warned bystander (R9)",
    T,
    () => {
      const fx = fixture();
      touchUnrelated(fx);
      expectLint(lintBranch(fx, "main"), 0, "+[WARN]", `+${MERGED}`, "-[FAIL]");
    },
  );

  test(
    "Case 52c — a change that modifies a draft delta-spec on the base branch fails (R2)",
    T,
    () => {
      const fx = fixture();
      fs.appendFileSync(path.join(fx.root, MERGED), "\nEdited by the change under test.\n");
      expectLint(lintBranch(fx, "main"), 1, `+${MERGED}`, `+${BANNER}`, "-[WARN]");
    },
  );
});

describe("spec-linter delta-spec lifecycle on branches (Cases 53-58, R19-R21)", () => {
  test(
    "Case 53 — a delta spec-PR is rejected while draft (run 1) and passes once approved (run 2) (R19)",
    T,
    () => {
      const fx = lifecycleFixture([[TS_PARENT, "approved", 1326]]);
      const branch = "spec/0243-usage-capture-hooks-typescript-delta-03";
      git(fx.root, "checkout", "-q", "-b", branch);
      fx.put(`specs/${TS_D3}`, lifecycleSpecText(TS_D3, "draft", 1392));
      commitAll(fx.root, "add delta-03 in draft");
      expectLint(
        lintBranch(fx, branch),
        1,
        "+added or modified by this change carry 'status: draft'",
        `+specs/${TS_D3}`,
      );
      putLifecycleSpec(fx, TS_D3, "approved", 1392);
      expectLint(
        lintBranch(fx, branch),
        0,
        "-added or modified by this change carry 'status: draft'",
      );
    },
  );

  test(
    "Case 54 — a ticket-numbered branch fails on the draft delta-spec of its ticket (run 1), passes once implemented (run 2) (R20)",
    T,
    () => {
      const fx = lifecycleFixture([
        [TS_PARENT, "implemented", 1326],
        [TS_D3, "draft", 1392],
      ]);
      touchUnrelated(fx);
      const branch = "feat/1392-agy-guarded-cmd-form";
      expectLint(
        lintBranch(fx, branch),
        1,
        `+specs/${TS_D3} (current status: 'draft')`,
        `-specs/${TS_PARENT} (current status:`,
      );
      putLifecycleSpec(fx, TS_D3, "implemented", 1392);
      expectLint(lintBranch(fx, branch), 0, "-(current status:", "-[NOTICE]");
    },
  );

  test(
    "Case 55 — a ticket-numbered branch names the parent and every delta of its ticket (R20)",
    T,
    () => {
      const fx = lifecycleFixture([
        [TS_PARENT, "approved", 1326],
        ["0243-usage-capture-hooks-typescript.delta-01.md", "draft", 1326],
        ["0243-usage-capture-hooks-typescript.delta-02.md", "approved", 1326],
      ]);
      touchUnrelated(fx);
      expectLint(
        lintBranch(fx, "feat/1326-usage-capture-hooks-typescript"),
        1,
        `+specs/${TS_PARENT} (current status: 'approved')`,
        "+specs/0243-usage-capture-hooks-typescript.delta-01.md (current status: 'draft')",
        "+specs/0243-usage-capture-hooks-typescript.delta-02.md (current status: 'approved')",
      );
    },
  );

  // feat/0209-usage-pricing: spec 0209 exists with related-issue 1187, so the ticket is 1187, not 209.
  describe("Cases 56a-b — a spec-id branch resolves to its spec's ticket (R20)", () => {
    const fixture = () => {
      const fx = lifecycleFixture([
        ["0209-usage-pricing.md", "approved", 1187],
        ["0002-spec-author-skill.md", "implemented", 150],
        ["0002-spec-author-skill.delta-04.md", "approved", 209],
        ["0210-pricing-follow-up.delta-01.md", "approved", 1187],
      ]);
      touchUnrelated(fx);
      return fx;
    };
    test(
      "Case 56a — a spec-id branch checks its spec, not the file whose related-issue is NNNN (R20, guard)",
      T,
      () => {
        expectLint(
          lintBranch(fixture(), "feat/0209-usage-pricing"),
          1,
          "+specs/0209-usage-pricing.md (current status: 'approved')",
          "-specs/0002-spec-author-skill.delta-04.md",
        );
      },
    );
    test(
      "Case 56b — a spec-id branch checks every file sharing its spec's related-issue (R20)",
      T,
      () => {
        expectLint(
          lintBranch(fixture(), "feat/0209-usage-pricing"),
          1,
          "+specs/0210-pricing-follow-up.delta-01.md (current status: 'approved')",
        );
      },
    );
  });

  describe("Cases 57a-b — the sync-main exclusion is limited to the chore form (R21)", () => {
    const fixture = () => {
      const fx = lifecycleFixture([
        ["0215-shell-to-typescript-migration.md", "approved", 1231],
        ["0250-sync-cleanup.md", "approved", 1500],
      ]);
      touchUnrelated(fx);
      return fx;
    };
    test(
      "Case 57a — a chore/<NNNN>-sync-main* branch is not checked as an implementation PR (R21, guard)",
      T,
      () => {
        expectLint(
          lintBranch(fixture(), "chore/1231-sync-main-20261001"),
          0,
          "-(current status:",
          "-[NOTICE]",
        );
      },
    );
    test(
      "Case 57b — the sync-main infix under another prefix is an ordinary implementation branch (R21)",
      T,
      () => {
        expectLint(
          lintBranch(fixture(), "feat/1500-sync-main-cleanup"),
          1,
          "+specs/0250-sync-cleanup.md (current status: 'approved')",
        );
      },
    );
  });

  // Terminal states (archived, superseded) and implemented sharing the ticket do not block;
  // "-[NOTICE]" pins that the matched set is non-empty, so run 1 is a checked pass.
  test(
    "Case 58 — terminal states on the ticket do not fail (run 1, guard); an approved file does (run 2) (R20)",
    T,
    () => {
      const fx = lifecycleFixture([
        ["0260-follow-up.md", "implemented", 1500],
        ["0260-follow-up.delta-01.md", "archived", 1500],
        ["0261-replaced.md", "superseded", 1500, 'superseded-by: "0260"'],
      ]);
      touchUnrelated(fx);
      expectLint(lintBranch(fx, "feat/1500-follow-up"), 0, "-(current status:", "-[NOTICE]");
      putLifecycleSpec(fx, "0262-still-open.md", "approved", 1500);
      git(fx.root, "add", "specs/0262-still-open.md");
      expectLint(
        lintBranch(fx, "feat/1500-follow-up"),
        1,
        "+specs/0262-still-open.md (current status: 'approved')",
        "-specs/0261-replaced.md (current status:",
        "-specs/0260-follow-up.delta-01.md (current status:",
      );
    },
  );
});
