// Replaces scripts/tests/test-check-ci-parity.sh (positive group P1-P6).
// Spec 0049 (CI drift harness) through the TypeScript entry scripts/check-ci-parity.ts,
// over hermetic copies of ci/, .github/ and .gitlab-ci.yml (scripts/tests/lib/ci-parity-fixture.ts).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  capOf,
  editYaml,
  list,
  makeFixture,
  map,
  replaceOnce,
  runCheck,
} from "./lib/ci-parity-fixture.ts";

const OK_LINE =
  "OK: reference, GitHub Actions, GitLab agree on the portable capability set; every pipeline job is traceable.";
const ANNOTATION = "  deploy: # ci-capability: pages-deploy";

const buildYml = (fx: string) => path.join(fx, ".github", "workflows", "build.yml");
const refYml = (fx: string) => path.join(fx, "ci", "ci-capabilities.yml");
const gitlabYml = (fx: string) => path.join(fx, ".gitlab-ci.yml");

test("P1 + P2a: conforming tree passes, names both engines, deploy fallback resolves", () => {
  const fx = makeFixture();
  const r = runCheck(fx);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /OK:/);
  assert.ok(r.stdout.includes("GitHub Actions"));
  assert.ok(r.stdout.includes("GitLab"));
  // R18/R24: the path-filter comparison adds nothing to the success reporting.
  assert.equal(r.stdout.trimEnd(), OK_LINE);
  // P2a: the load-bearing fallback guard (`deploy` resolves through its annotation).
  assert.ok(!r.stderr.includes("untraceable job 'deploy'"), r.stderr);
});

test("P2b: stripped `# ci-capability:` annotation fails closed", () => {
  const fx = makeFixture();
  const pages = path.join(fx, ".github", "workflows", "pages.yml");
  assert.ok(
    fs.readFileSync(pages, "utf8").includes(ANNOTATION),
    "precondition: annotation present",
  );
  replaceOnce(pages, ANNOTATION, "  deploy:");
  const r = runCheck(fx);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("untraceable job 'deploy'"), r.stderr);
  assert.ok(r.stderr.includes("github-actions"), r.stderr);
});

test("P3: an extra hand-authored setup step is tolerated", () => {
  const fx = makeFixture();
  editYaml(buildYml(fx), (doc) => {
    const steps = list(map(map(doc["jobs"])["build"])["steps"]);
    steps.push({ uses: "actions/cache@v4" });
  });
  const r = runCheck(fx);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /OK:/);
});

test("P4a: GitLab absent, GHA-only repo passes", () => {
  const fx = makeFixture();
  fs.rmSync(gitlabYml(fx), { force: true });
  const r = runCheck(fx);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes("GitHub Actions"));
  assert.ok(!r.stdout.includes("GitLab"), r.stdout);
});

test("P4b: GitHub Actions absent, GitLab-only repo passes; path filters skipped (R20)", () => {
  const fx = makeFixture();
  fs.rmSync(path.join(fx, ".github"), { recursive: true, force: true });
  const r = runCheck(fx);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes("GitLab"));
  assert.ok(!r.stdout.includes("GitHub Actions"), r.stdout);
  assert.ok(!r.stderr.includes("path filters diverge"), r.stderr);
});

for (const [label, tool] of [
  ["P5a", "git"],
  ["P5b", "diff"],
] as const) {
  test(`${label}: '${tool}' requirement is exempt on GitHub Actions (GHA-only)`, () => {
    const fx = makeFixture();
    fs.rmSync(gitlabYml(fx), { force: true });
    editYaml(refYml(fx), (doc) => {
      map(capOf(doc, "check-agents-size")["requires"])["tools"] = [tool, "task"];
    });
    const r = runCheck(fx);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stderr.includes(`requires tool '${tool}'`), r.stderr);
  });
}

test("P6: python3 requirement satisfied by actions/setup-python alone (GHA-only)", () => {
  const fx = makeFixture();
  fs.rmSync(gitlabYml(fx), { force: true });
  editYaml(refYml(fx), (doc) => {
    list(map(capOf(doc, "figure-labels")["requires"])["tools"]).push("python3");
  });
  editYaml(buildYml(fx), (doc) => {
    list(map(map(doc["jobs"])["figure-labels"])["steps"]).push({
      name: "Set up Python",
      uses: "actions/setup-python@v5",
      with: { "python-version": "3.12" },
    });
  });
  const r = runCheck(fx);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stderr.includes("requires tool 'python3'"), r.stderr);
});
