// Replaces scripts/tests/test-spec-linter.sh (Cases 28-34 incl. 32b, 32c: the base-branch
// `status: draft` check, spec 0109). Every case builds its own fixture: the Bash suite mutated
// one shared repository across cases 30-32b, here each test applies only what it measures.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
  commitAll,
  gitFixture,
  newFixture,
  renderSpec,
  runLinter,
} from "./lib/spec-linter-fixtures.ts";

const T = { timeout: 60_000 };
const ON_BASE = "specs/0200-on-base.md";
const ON_BASE_DELTA = "specs/0201-on-base-delta.delta-01.md";

/** Base-branch content: one non-delta spec and one delta-spec, both `draft`. */
const baseFixture = (remote = true) =>
  gitFixture({
    remote,
    files: {
      [ON_BASE]: renderSpec({ id: "0200", slug: "on-base" }),
      [ON_BASE_DELTA]: renderSpec({
        id: "0201",
        slug: "on-base-delta",
        headings: "## ADDED\n\n## MODIFIED\n\n## REMOVED",
      }),
    },
  });

const correct0200 = (fx: { put(rel: string, text: string): void }): void =>
  fx.put(
    ON_BASE,
    renderSpec({
      id: "0200",
      slug: "on-base",
      status: "implemented",
      extraFm: "interaction-mode: INTERMEDIATE",
    }),
  );

describe("spec-linter base-branch status check (spec 0109)", () => {
  test(
    "Case 28 — draft spec AND draft delta-spec on the base branch both fail and are named",
    T,
    () => {
      const fx = baseFixture();
      const r = runLinter(fx.root, ["specs"], { env: { BASE_REF: "main", BRANCH_NAME: "main" } });
      assert.equal(r.status, 1, r.output);
      assert.ok(r.output.includes(ON_BASE), r.output);
      assert.ok(r.output.includes(ON_BASE_DELTA), r.output);
    },
  );

  test("Case 29 — default base-ref derivation (origin/main) enforces the check", T, () => {
    const fx = baseFixture();
    const r = runLinter(fx.root, ["specs"]);
    assert.equal(r.status, 1, r.output);
    assert.ok(r.output.includes(ON_BASE), r.output);
  });

  test("Case 30 — correcting the status in the tree clears the violation", T, () => {
    const fx = baseFixture();
    correct0200(fx);
    const r = runLinter(fx.root, ["specs"], { env: { BASE_REF: "main" } });
    assert.equal(r.status, 0, r.output);
  });

  test("Case 31 — a spec absent from the base branch may be draft", T, () => {
    const fx = baseFixture();
    correct0200(fx);
    fx.putSpec("specs/0202-introduced-by-change.md", { id: "0202", slug: "introduced-by-change" });
    const r = runLinter(fx.root, ["specs"], { env: { BASE_REF: "main" } });
    assert.equal(r.status, 0, r.output);
    assert.ok(!r.output.includes("specs/0202-introduced-by-change.md"), r.output);
  });

  test("Case 32 — unresolvable base ref inside a repository fails closed (exit 2)", T, () => {
    const fx = baseFixture();
    const r = runLinter(fx.root, ["specs"], { env: { BASE_REF: "no-such-base" } });
    assert.equal(r.status, 2, r.output);
    assert.ok(r.output.includes("BASE_REF"), r.output);
  });

  test("Case 32b — a trailing-slash BASE_REF is normalized to unset", T, () => {
    const fx = baseFixture();
    correct0200(fx);
    const r = runLinter(fx.root, ["specs"], { env: { BASE_REF: "origin/" } });
    assert.equal(r.status, 0, r.output);
    assert.ok(!r.output.includes(ON_BASE), r.output);
  });

  // The reference remote carries NO `main` branch at all (trunk is `develop`).
  test("Case 32c — a repository with no main branch falls back to develop", T, () => {
    const fx = gitFixture({
      branch: "develop",
      files: {
        "specs/0210-on-develop-base.md": renderSpec({ id: "0210", slug: "on-develop-base" }),
      },
    });
    const r = runLinter(fx.root, ["specs"]);
    assert.equal(r.status, 1, r.output);
    assert.ok(r.output.includes("specs/0210-on-develop-base.md"), r.output);
  });

  test("Case 33 — outside a git work tree the check skips and announces it", T, (t) => {
    const fx = newFixture();
    for (let d = fx.root; ; d = path.dirname(d)) {
      if (fs.existsSync(path.join(d, ".git"))) return t.skip(`ancestor ${d} is a git work tree`);
      if (path.dirname(d) === d) break;
    }
    fx.putSpec("specs/0203-outside-any-repo.md", { id: "0203", slug: "outside-any-repo" });
    const r = runLinter(fx.root, ["specs"], { env: { BASE_REF: "main" } });
    assert.equal(r.status, 0, r.output);
    assert.ok(r.output.includes("Base-branch status check"), r.output);
  });

  test("Case 34 — an uncanonicalizable linted path is named, not a stack trace", T, () => {
    const fx = gitFixture({
      remote: false,
      files: {
        "specs/0204-beside-a-dangling-symlink.md": renderSpec({
          id: "0204",
          slug: "beside-a-dangling-symlink",
        }),
      },
    });
    fs.symlinkSync("./no-such-target.md", path.join(fx.root, "specs/0205-dangling.md"));
    commitAll(fx.root, "content with a dangling symlink");
    const r = runLinter(fx.root, ["specs"], { env: { BASE_REF: "main" } });
    assert.equal(r.status, 1, r.output);
    assert.ok(r.output.includes("Cannot resolve linted path: specs/0205-dangling.md"), r.output);
    assert.ok(!r.output.includes("at resolveBaseContext"), r.output);
  });
});
