// check-plan-review.test.ts — test of scripts/check-plan-review.ts and its library (spec 0277 R1-R8, R11, R18).
// Decisions run in-process through runPlanReview with fixture manifests swapped through the `io`
// argument; the CLI is spawned only for exit codes, stdin and one smoke case on the live manifests.
// Fixtures live under scripts/tests/fixtures/plan-review/. Temp paths come from mkdtemp only.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { COMPONENT_THRESHOLD, runPlanReview } from "../lib/governance/plan-review-gate.ts";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(SCRIPTS, "check-plan-review.ts");
const FIXTURES = path.join(SCRIPTS, "tests", "fixtures", "plan-review");
const tmp = mkdtempSync(path.join(tmpdir(), "plan-review-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const fx = (name: string) => path.join(FIXTURES, name);
const COMPONENTS = fx("components.txt");
const SHARED = fx("shared.txt");

/** Run the gate in-process against the fixture manifests unless overridden. */
function gate(
  spec: string,
  plan: string,
  extra: string[] = [],
  io: { componentsManifest?: string; sharedManifest?: string } = {},
) {
  return runPlanReview([fx(spec), fx(plan), ...extra], {
    componentsManifest: COMPONENTS,
    sharedManifest: SHARED,
    ...io,
  });
}
const decision = (r: { stdout: string }) => r.stdout.split("\n")[0];
function assertDecision(r: { code: number; stdout: string }, d: string): void {
  assert.equal(r.code, 0);
  assert.equal(decision(r), `plan-review: ${d}`);
}
function assertFailClosed(r: { code: number; stdout: string }, cause: string): void {
  assertDecision(r, "required");
  assert.ok(r.stdout.includes(`reason: fail-closed: ${cause}`), r.stdout);
}

const cli = (args: string[], input?: string) =>
  spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, ...args], {
    cwd: tmp,
    encoding: "utf8",
    input,
  });

describe("check-plan-review: tier gate and thresholds", () => {
  it("skips a standard plan of 2 components with no shared path", () => {
    const r = gate("standard-spec.md", "standard-skip-plan.md");
    assertDecision(r, "skipped");
    assert.ok(r.stdout.includes("reason: tier=standard"));
    assert.ok(
      r.stdout.includes(
        `reason: components declared=2 derived=2 union=2 threshold=${COMPONENT_THRESHOLD}`,
      ),
      r.stdout,
    );
    assert.ok(r.stdout.includes("reason: shared-contract=none"));
  });
  it("requires 4 components", () => {
    const r = gate("standard-spec.md", "four-components-plan.md");
    assertDecision(r, "required");
    assert.ok(r.stdout.includes("union=4 threshold=3"), r.stdout);
  });
  it("requires one component plus a shared-contract hit", () => {
    const r = gate("standard-spec.md", "shared-hit-plan.md");
    assertDecision(r, "required");
    assert.ok(r.stdout.includes("reason: shared-contract=docs/spec-format.md"), r.stdout);
  });
  it("requires when the spec Requirements cite a shared path and the plan is clean", () => {
    const r = gate("cites-shared-spec.md", "standard-skip-plan.md");
    assertDecision(r, "required");
    assert.ok(r.stdout.includes("docs/spec-format.md"), r.stdout);
  });
  it("ignores a shared path cited outside the spec Requirements section", () => {
    // standard-spec.md cites docs/spec-format.md in its Intent only.
    assertDecision(gate("standard-spec.md", "standard-skip-plan.md"), "skipped");
  });
  it("requires when under-declaring hides a fourth component", () => {
    const r = gate("standard-spec.md", "under-declared-plan.md");
    assertDecision(r, "required");
    assert.ok(r.stdout.includes("declared=2 derived=4 union=4"), r.stdout);
  });
  it("counts declared components that Steps do not reveal", () => {
    const r = gate("standard-spec.md", "inflated-declared-plan.md");
    assertDecision(r, "required");
    assert.ok(r.stdout.includes("declared=4 derived=2 union=4"), r.stdout);
  });
  it("names the threshold as 3", () => assert.equal(COMPONENT_THRESHOLD, 3));
  it("always reviews the large tier", () => {
    const r = gate("large-spec.md", "standard-skip-plan.md");
    assertDecision(r, "required");
    assert.ok(r.stdout.includes("reason: tier=large (always reviewed)"));
  });
  for (const t of ["small", "trivial"]) {
    it(`is not-applicable at the ${t} tier`, () => {
      const r = gate(`${t}-spec.md`, "four-components-plan.md");
      assertDecision(r, "not-applicable");
      assert.ok(r.stdout.includes(`reason: tier=${t} (not applicable)`));
    });
  }
  it("counts the five skill mirrors as one component", () => {
    const r = gate("standard-spec.md", "mirrors-plan.md");
    assertDecision(r, "skipped");
    assert.ok(r.stdout.includes("derived=1 union=1"), r.stdout);
  });
  it("counts the five agent paths of both layouts as one component", () => {
    const r = gate("standard-spec.md", "agent-mirrors-plan.md");
    assertDecision(r, "skipped");
    assert.ok(r.stdout.includes("derived=1 union=1"), r.stdout);
  });
  it("forces required with --prior-review on an otherwise skippable plan", () => {
    const r = gate("standard-spec.md", "standard-skip-plan.md", ["--prior-review"]);
    assertDecision(r, "required");
    assert.ok(r.stdout.includes("reason: prior-review (review stays mandatory)"));
  });
  it("reads the plan from stdin when the path is absent or '-'", () => {
    const text = readFileSync(fx("standard-skip-plan.md"), "utf8");
    for (const argv of [[fx("standard-spec.md")], [fx("standard-spec.md"), "-"]]) {
      const r = runPlanReview(argv, {
        stdin: () => text,
        componentsManifest: COMPONENTS,
        sharedManifest: SHARED,
      });
      assertDecision(r, "skipped");
    }
  });
});

describe("check-plan-review: fail closed", () => {
  it("requires on a missing Components line", () =>
    assertFailClosed(
      gate("standard-spec.md", "missing-components-plan.md"),
      "missing-components-line",
    ));
  it("requires on an empty component list", () =>
    assertFailClosed(
      gate("standard-spec.md", "empty-components-plan.md"),
      "empty-components-list",
    ));
  it("requires on a plan with no Steps section", () =>
    assertFailClosed(gate("standard-spec.md", "no-steps-plan.md"), "missing-steps"));
  it("requires when Steps yields zero repo paths", () =>
    assertFailClosed(gate("standard-spec.md", "zero-paths-plan.md"), "no-paths-in-steps"));
  it("requires on an absent tier", () =>
    assertFailClosed(gate("no-tier-spec.md", "standard-skip-plan.md"), "unknown-tier"));
  it("requires on a plan with no Blast radius section", () =>
    assertFailClosed(
      gate("standard-spec.md", "no-blast-radius-plan.md"),
      "missing-components-line",
    ));
  it("requires on a comments-only component manifest", () =>
    assertFailClosed(
      gate("standard-spec.md", "standard-skip-plan.md", [], {
        componentsManifest: fx("components-comments-only.txt"),
      }),
      "manifest-empty",
    ));
  it("requires on an unknown tier", () =>
    assertFailClosed(gate("unknown-tier-spec.md", "standard-skip-plan.md"), "unknown-tier"));
  it("requires on an empty shared-contract manifest", () =>
    assertFailClosed(
      gate("standard-spec.md", "standard-skip-plan.md", [], {
        sharedManifest: fx("shared-empty.txt"),
      }),
      "manifest-empty",
    ));
  it("requires on an empty component manifest", () =>
    assertFailClosed(
      gate("standard-spec.md", "standard-skip-plan.md", [], {
        componentsManifest: fx("components-empty.txt"),
      }),
      "manifest-empty",
    ));
  it("requires on a malformed component manifest line", () =>
    assertFailClosed(
      gate("standard-spec.md", "standard-skip-plan.md", [], {
        componentsManifest: fx("components-malformed.txt"),
      }),
      "manifest-malformed",
    ));
  it("requires (exit 0) on a missing manifest, unlike a missing spec", () =>
    assertFailClosed(
      gate("standard-spec.md", "standard-skip-plan.md", [], {
        sharedManifest: path.join(tmp, "absent-manifest.txt"),
      }),
      "manifest-missing",
    ));
});

describe("check-plan-review: exit 2 on unusable input", () => {
  it("exits 2 with no argument", () => assert.equal(cli([]).status, 2));
  it("exits 2 and names a missing spec", () => {
    const missing = path.join(tmp, "no-such-spec.md");
    const r = cli([missing, fx("standard-skip-plan.md")]);
    assert.equal(r.status, 2);
    assert.ok(r.stderr.includes(missing), r.stderr);
  });
  it("exits 2 and names a missing plan", () => {
    const missing = path.join(tmp, "no-such-plan.md");
    const r = cli([fx("standard-spec.md"), missing]);
    assert.equal(r.status, 2);
    assert.ok(r.stderr.includes(missing), r.stderr);
  });
});

describe("check-plan-review: live manifests smoke", () => {
  it("skips and requires through the CLI on the committed manifests", () => {
    const skip = cli([fx("standard-spec.md"), fx("standard-skip-plan.md")]);
    assert.equal(skip.status, 0, skip.stderr);
    assert.equal(skip.stdout.split("\n")[0], "plan-review: skipped");
    const req = cli(
      [fx("standard-spec.md"), "-"],
      readFileSync(fx("four-components-plan.md"), "utf8"),
    );
    assert.equal(req.status, 0, req.stderr);
    assert.equal(req.stdout.split("\n")[0], "plan-review: required");
  });
});
