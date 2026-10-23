// Spec 0168 delta-01 (R7, R8, R9, R17): the Draft-PR signal. When the CI engine reports the change
// as a Draft PR/MR through CREWRIG_PR_DRAFT, ONLY the spec 0168 R1 `status: draft` block is
// skipped (replaced by a [NOTICE] naming the tolerated files). Fail-closed: any value other than
// the exact string 'true' keeps R1 enforced, and every other check keeps failing under 'true'.
// Every case builds its own fixture; R1 only sees files in the committed diff against the base,
// so each draft spec is committed on a branch cut from `main` (BASE_REF=main).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  commitAll,
  git,
  gitFixture,
  renderSpec,
  runLinter,
  type Fixture,
  type LintResult,
} from "./lib/spec-linter-fixtures.ts";
import { lifecycleSpecText } from "./lib/spec-linter-lifecycle.ts";

const T = { timeout: 60_000 };
const NEW_SPEC = "specs/0300-new-draft.md";
const NEW_DELTA = "specs/0301-delta-host.delta-01.md";
const BRANCH = "spec/0300-new-draft";
const R1_FAIL =
  "[FAIL] Specs or delta-specs added or modified by this change carry 'status: draft'";
const NOTICE =
  "[NOTICE] Specs or delta-specs added or modified by this change carry 'status: draft'";
const BASE_0109_FAIL = "[FAIL] Specs or delta-specs present on the base branch";
const R2_FAIL = "[FAIL] Implementation branch";

/** `main` with one conformant `implemented` spec, then a branch carrying the given files. */
function branchFixture(
  branch: string,
  files: Readonly<Record<string, string>>,
  baseFiles: Readonly<Record<string, string>> = {},
): Fixture {
  const fx = gitFixture({
    remote: false,
    files: {
      "specs/0200-on-base.md": renderSpec({
        id: "0200",
        slug: "on-base",
        status: "implemented",
        extraFm: "interaction-mode: INTERMEDIATE",
      }),
      ...baseFiles,
    },
  });
  git(fx.root, "checkout", "-q", "-b", branch);
  for (const [rel, text] of Object.entries(files)) fx.put(rel, text);
  commitAll(fx.root, "change under test");
  return fx;
}

const lint = (fx: Fixture, branch: string, draft: string | undefined): LintResult =>
  runLinter(fx.root, ["specs"], {
    env: { BASE_REF: "main", BRANCH_NAME: branch, CREWRIG_PR_DRAFT: draft },
  });

const newDraftSpec = (): Fixture =>
  branchFixture(BRANCH, { [NEW_SPEC]: renderSpec({ id: "0300", slug: "new-draft" }) });

const newDraftDelta = (): Fixture =>
  branchFixture(BRANCH, {
    [NEW_DELTA]: renderSpec({
      id: "0301",
      slug: "delta-host",
      headings: "## ADDED\n\n## MODIFIED\n\n## REMOVED",
    }),
  });

describe("spec-linter Draft-PR signal (spec 0168 delta-01)", () => {
  test("a new draft spec under CREWRIG_PR_DRAFT=true passes and a [NOTICE] names it", T, () => {
    const r = lint(newDraftSpec(), BRANCH, "true");
    assert.equal(r.status, 0, r.output);
    assert.ok(r.output.includes(NOTICE), r.output);
    assert.ok(r.output.includes(`  - ${NEW_SPEC}`), r.output);
    assert.ok(!r.output.includes(R1_FAIL), r.output);
  });

  test(
    "a new draft delta-spec under CREWRIG_PR_DRAFT=true passes and a [NOTICE] names it",
    T,
    () => {
      const r = lint(newDraftDelta(), BRANCH, "true");
      assert.equal(r.status, 0, r.output);
      assert.ok(r.output.includes(NOTICE), r.output);
      assert.ok(r.output.includes(NEW_DELTA), r.output);
      assert.ok(!r.output.includes(R1_FAIL), r.output);
    },
  );

  // Fail-closed: only the exact string 'true' is a draft signal.
  for (const [label, value] of [
    ["'false'", "false"],
    ["empty", ""],
    ["absent", undefined],
    ["'TRUE'", "TRUE"],
    ["'1'", "1"],
  ] as const) {
    test(`CREWRIG_PR_DRAFT ${label} keeps R1 enforced for a new draft spec`, T, () => {
      const r = lint(newDraftSpec(), BRANCH, value);
      assert.equal(r.status, 1, r.output);
      assert.ok(r.output.includes(R1_FAIL), r.output);
      assert.ok(r.output.includes(NEW_SPEC), r.output);
      assert.ok(!r.output.includes(NOTICE), r.output);
    });
  }

  test("CREWRIG_PR_DRAFT=false keeps R1 enforced for a new draft delta-spec", T, () => {
    const r = lint(newDraftDelta(), BRANCH, "false");
    assert.equal(r.status, 1, r.output);
    assert.ok(r.output.includes(R1_FAIL), r.output);
    assert.ok(r.output.includes(NEW_DELTA), r.output);
  });

  test("malformed frontmatter still fails under CREWRIG_PR_DRAFT=true", T, () => {
    // Draft, but the mandatory `slug` is missing: a per-file failure R1's skip does not touch.
    const broken = renderSpec({ id: "0300", slug: "new-draft" }).replace(/^slug: .*\n/m, "");
    const fx = branchFixture(BRANCH, { [NEW_SPEC]: broken });
    const r = lint(fx, BRANCH, "true");
    assert.equal(r.status, 1, r.output);
    assert.ok(r.output.includes(NEW_SPEC), r.output);
    assert.ok(r.output.includes("[FAIL]"), r.output);
  });

  test(
    "a draft spec already on the base branch and modified by the change still fails (spec 0109) under true",
    T,
    () => {
      const onBase = "specs/0210-base-draft.md";
      const fx = branchFixture(
        "spec/0210-base-draft",
        {
          [onBase]: renderSpec({ id: "0210", slug: "base-draft" }).replace(
            "# Title",
            "# Title edited by the change",
          ),
        },
        { [onBase]: renderSpec({ id: "0210", slug: "base-draft" }) },
      );
      const r = lint(fx, "spec/0210-base-draft", "true");
      assert.equal(r.status, 1, r.output);
      assert.ok(r.output.includes(BASE_0109_FAIL), r.output);
      assert.ok(r.output.includes(onBase), r.output);
      assert.ok(!r.output.includes(NOTICE), r.output);
    },
  );

  for (const status of ["draft", "approved"]) {
    test(
      `an implementation branch with a '${status}' spec of its ticket still fails R2 under true`,
      T,
      () => {
        const branch = "feat/0302-cool-feature";
        const fx = branchFixture(branch, {
          "specs/0302-cool-feature.md": lifecycleSpecText("0302-cool-feature.md", status, 123),
        });
        const r = lint(fx, branch, "true");
        assert.equal(r.status, 1, r.output);
        assert.ok(r.output.includes(R2_FAIL), r.output);
        assert.ok(r.output.includes(`(current status: '${status}')`), r.output);
      },
    );
  }

  test("a non-draft (approved) spec under CREWRIG_PR_DRAFT=true passes with no [NOTICE]", T, () => {
    const fx = branchFixture(BRANCH, {
      [NEW_SPEC]: lifecycleSpecText("0300-new-draft.md", "approved", 123),
    });
    const r = lint(fx, BRANCH, "true");
    assert.equal(r.status, 0, r.output);
    assert.ok(!r.output.includes(NOTICE), r.output);
    assert.ok(!r.output.includes(R1_FAIL), r.output);
  });
});
