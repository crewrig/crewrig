// Replaces scripts/tests/test-spec-linter.sh (Cases 17-27 incl. 26b: specs/org exclusion and
// duplicate-id detection). Cases 17-19 run against the sandbox copy of the committed
// .crewrig/core-paths.txt (no CREWRIG_REPO_DIR), so they stay coupled to `specs/org` being
// classified `excluded` there; Cases 20/21 prove the mechanism is manifest-driven.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  HEADINGS,
  manifestDir,
  newFixture,
  renderSpec,
  runLinter,
} from "./lib/spec-linter-fixtures.ts";

const T = { timeout: 30_000 };
const EXPERIMENTAL = "specs/experimental\texcluded\n";

const orgSpec = `---
id: "ORG-0001"
slug: "example"
status: "draft"
complexity: "standard"
version: 1.0.0
related-issue: 123
---

# Title

## Intent

## Requirements
`;

const badExperimental = `---
id: "9999"
slug: "bad"
status: "draft"
complexity: "standard"
version: 1.0.0
related-issue: 123
---

# Title

## Intent
`;

describe("spec-linter specs/org exclusion (spec 0071)", () => {
  test("Case 17 — non-conforming specs/org file ignored on default CI invocation", T, () => {
    const fx = newFixture();
    fx.put("specs/org/ORG-0001-example.md", orgSpec);
    const r = runLinter(fx.root, []);
    assert.equal(r.status, 0, r.output);
  });

  test("Case 18 — non-conforming upstream spec still fails alongside specs/org", T, () => {
    const fx = newFixture();
    fx.put("specs/org/ORG-0001-example.md", orgSpec);
    fx.putSpec("specs/9999-bad!name.md", { id: "9999", slug: "bad" });
    const r = runLinter(fx.root, []);
    assert.equal(r.status, 1, r.output);
  });

  test("Case 19 — explicit specs/org target still exempts non-conforming file", T, () => {
    const fx = newFixture();
    fx.put("specs/org/ORG-0001-example.md", orgSpec);
    const r = runLinter(fx.root, ["specs/org"]);
    assert.equal(r.status, 0, r.output);
  });

  test("Case 20 — manifest-driven exclusion of a novel path (exit 0)", T, () => {
    const fx = newFixture();
    fx.put("specs/experimental/9999-bad.md", badExperimental);
    const r = runLinter(fx.root, [], { env: { CREWRIG_REPO_DIR: manifestDir(EXPERIMENTAL) } });
    assert.equal(r.status, 0, r.output);
  });

  test("Case 21 — same fixture without override still fails (exit 1)", T, () => {
    const fx = newFixture();
    fx.put("specs/experimental/9999-bad.md", badExperimental);
    const r = runLinter(fx.root, []);
    assert.equal(r.status, 1, r.output);
  });
});

describe("spec-linter duplicate ids", () => {
  test("Case 22 — duplicate id across two original specs names both files (exit 1)", T, () => {
    const fx = newFixture();
    const a = "0042-collision-a.md";
    const b = "0042-collision-b.md";
    fx.putSpec(a, { id: "0042", slug: "collision-a" });
    fx.putSpec(b, { id: "0042", slug: "collision-b" });
    const r = runLinter(fx.root, [a, b]);
    assert.equal(r.status, 1, r.output);
    assert.ok(r.output.includes(a), r.output);
    assert.ok(r.output.includes(b), r.output);
    assert.match(r.output, /Duplicate spec id "0042"/);
  });

  test("Case 23 — delta spec sharing parent id is not a duplicate-id failure", T, () => {
    const fx = newFixture();
    fx.putSpec("0043-parent.md", { id: "0043", slug: "parent" });
    fx.putSpec("0043-parent.delta-01.md", {
      id: "0043",
      slug: "parent",
      headings: "## ADDED\n\n## MODIFIED\n\n## REMOVED",
    });
    const r = runLinter(fx.root, ["0043-parent.md", "0043-parent.delta-01.md"]);
    assert.equal(r.status, 0, r.output);
  });

  test("Case 24 — distinct ids across specs pass", T, () => {
    const fx = newFixture();
    fx.putSpec("0044-first.md", { id: "0044", slug: "first" });
    fx.putSpec("0045-second.md", { id: "0045", slug: "second" });
    const r = runLinter(fx.root, ["0044-first.md", "0045-second.md"]);
    assert.equal(r.status, 0, r.output);
  });

  test("Case 25 — three-way id collision names every colliding file (exit 1)", T, () => {
    const fx = newFixture();
    const files = ["0050-triple-a.md", "0050-triple-b.md", "0050-triple-c.md"];
    for (const f of files) fx.putSpec(f, { id: "0050", slug: f.slice(5, -3) });
    const r = runLinter(fx.root, files);
    assert.equal(r.status, 1, r.output);
    for (const f of files) assert.ok(r.output.includes(f), r.output);
  });

  // The manifest exclusion must apply before the cross-file accumulation (R5).
  test(
    "Case 26 — manifest-excluded file sharing an id with a real spec is not a duplicate (R5)",
    T,
    () => {
      const fx = newFixture();
      fx.putSpec("specs/0071-real.md", { id: "0071", slug: "real" });
      fx.putSpec("specs/experimental/0071-twin.md", { id: "0071", slug: "twin" });
      const r = runLinter(fx.root, ["specs"], {
        env: { CREWRIG_REPO_DIR: manifestDir(EXPERIMENTAL) },
      });
      assert.equal(r.status, 0, r.output);
      assert.ok(!r.output.includes("Duplicate spec id"), r.output);
    },
  );

  test(
    "Case 26b — negative control: without the exclusion override the 0071 collision is reported",
    T,
    () => {
      const fx = newFixture();
      fx.putSpec("specs/0071-real.md", { id: "0071", slug: "real" });
      fx.putSpec("specs/experimental/0071-twin.md", { id: "0071", slug: "twin" });
      const r = runLinter(fx.root, ["specs"]);
      assert.equal(r.status, 1, r.output);
      assert.match(r.output, /Duplicate spec id "0071"/);
    },
  );

  // A frontmatter parse failure must not leak a filename-derived id into the cross-file check.
  test(
    "Case 27 — unparseable frontmatter does not leak a stale id into the cross-file check",
    T,
    () => {
      const fx = newFixture();
      const broken = `---
id: "0072
slug: broken
status: draft
complexity: standard
version: 1.0.0
related-issue: 1
---

# Title

${HEADINGS}
`;
      fx.put("0072-broken.md", broken);
      fx.put("0072-good.md", renderSpec({ id: "0072", slug: "good" }));
      const r = runLinter(fx.root, ["0072-broken.md", "0072-good.md"]);
      assert.equal(r.status, 1, r.output);
      assert.match(r.output, /Failed to parse YAML frontmatter/);
      assert.ok(!r.output.includes("Duplicate spec id"), r.output);
    },
  );
});
