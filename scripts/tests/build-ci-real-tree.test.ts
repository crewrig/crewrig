// Replaces scripts/tests/test-build-ci.sh (group R: real-tree cases A-F2e, spec 0048 and deltas).
// The committed .gitlab-ci.yml is the contract's output; `--check` writes nothing, so it runs
// on the checkout itself. js-yaml replaces the Bash `yq` reads.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { jobText, REPO, runBuildCi, topLevelKeys } from "./lib/ci-reference-fixtures.ts";
import { yamlLib } from "./lib/yaml-lib.ts";

const referenceText = fs.readFileSync(path.join(REPO, "ci", "ci-capabilities.yml"), "utf8");
const outputText = fs.readFileSync(path.join(REPO, ".gitlab-ci.yml"), "utf8");

interface Capability {
  readonly id: string;
  readonly portability: string;
}
const reference = yamlLib.load(referenceText) as { capabilities: Capability[] };
const idsOf = (portability: string): string[] =>
  reference.capabilities.filter((c) => c.portability === portability).map((c) => c.id);
const keys = new Set(topLevelKeys(outputText));

// Reserved GitLab keywords, copied verbatim from the Bash suite (case D).
const RESERVED = [
  "stages",
  "workflow",
  "default",
  "include",
  "variables",
  "image",
  "before_script",
  "after_script",
  "cache",
  "services",
  "pages",
];

describe("build-ci real tree (group R)", () => {
  it("A: committed pipeline matches the reference (--check on the checkout)", () => {
    const res = runBuildCi(REPO, ["--check"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout, "OK: .gitlab-ci.yml matches the CI capability reference.\n");
    assert.equal(res.stderr, "");
  });

  it("B: every portable capability id is a GitLab job key (Scenario 1)", () => {
    const portable = idsOf("portable");
    assert.ok(portable.length > 0, "non-empty portable list (no vacuous pass)");
    assert.deepEqual(
      portable.filter((id) => !keys.has(id)),
      [],
    );
  });

  const build = jobText(outputText, "build");
  it("B1: build job script carries the command (delta-01 R10)", () => {
    assert.ok(build.includes("npm run build --workspaces --if-present"));
  });
  it("B2: build runtime node@22 becomes image node:22 (delta-02 R12)", () => {
    assert.ok(build.includes("node:22"));
  });
  it("B3: build job has the merge-request rule (trigger mapping)", () => {
    assert.ok(build.includes("merge_request_event"));
  });

  it("C: no engine-specific capability emits a job or placeholder (Scenario 3, R4)", () => {
    const specific = idsOf("specific");
    assert.ok(specific.length > 0, "non-empty specific list (no vacuous pass)");
    assert.deepEqual(
      specific.filter((id) => keys.has(id)),
      [],
    );
  });

  it("D: job count equals the portable capability count", () => {
    const jobs = [...keys].filter((k) => !RESERVED.includes(k));
    assert.equal(jobs.length, idsOf("portable").length);
  });

  it("E: check-skill-versions history-depth full emits GIT_DEPTH", () => {
    assert.ok(jobText(outputText, "check-skill-versions").includes("GIT_DEPTH"));
  });

  const parity = jobText(outputText, "ci-parity");
  it("F: ci-parity tools:[yq] installs yq in before_script", () => {
    assert.ok(parity.includes("/usr/local/bin/yq"));
  });

  const mempalace = jobText(outputText, "mempalace");
  it("F1a: first requires.runtime entry (python@3.12) becomes the image", () => {
    assert.ok(mempalace.includes("image: python:3.12"));
  });
  it("F1b: a further runtime entry (node@24) installs Node in before_script", () => {
    assert.ok(mempalace.includes("setup_24.x"));
  });
  it("F1c: the secondary-runtime install keeps the tools:[yq] install", () => {
    assert.ok(mempalace.includes("/usr/local/bin/yq"));
  });

  for (const [label, text, why] of [
    ["F2a", "cache:", "cached capability emits cache:key:files"],
    ["F2b", "ci/ci-capabilities.yml", "cache key derived from declared files"],
    ["F2c", ".ci-cache/", "cache persists the .ci-cache/ dir"],
    ["F2d", "ci-cache-guard.sh", "hermetic command wrapped in cache-guard"],
    ["F2e", "ci-parity-positive.test.ts", "cache-guard unwraps to the declared command"],
  ] as const) {
    it(`${label}: ${why}`, () => {
      assert.ok(parity.includes(text), `ci-parity job lacks ${text}`);
    });
  }
});
