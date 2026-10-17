// build-components-canonical-repo.test.ts — canonical_repo URL validation end to end
// (friction #77, spec 0265 P1). Replaces scripts/test-build-components.sh.
//
// Each case runs the TypeScript entry in a throwaway fixture root whose
// crewrig.config.toml is rewritten per case; the checkout config is never touched.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import { baseEnv, seedSkill } from "./lib/build-sandbox.ts";
import { seedMappings } from "./fixtures/build-components/entry-kit.ts";

const tree = createFixtureTree();
seedSkill(tree, "core", "probe");
seedMappings(tree);

const withRepo = (value: string): void =>
  void tree.config(`canonical_repo = "${value}"\nfeedback_repo = "https://example.test/o/f"\n`);
const run = (...args: string[]) => tree.run(["--target", "all", ...args], { env: baseEnv() });

describe("canonical_repo validation", () => {
  test("canonical-repo::(a) valid URL accepted by --check", () => {
    withRepo("https://github.com/crewrig/crewrig");
    const built = run();
    assert.equal(built.status, 0, built.stderr);
    // Vacuity guard: the root holds a core component, so --check compares real output.
    assert.ok(tree.exists(".claude/skills/probe/SKILL.md"), "core skill was built");
    const res = run("--check");
    assert.equal(res.status, 0, res.stderr);
  });

  test("canonical-repo::(b) file scheme rejected", () => {
    const bad = "file:///tmp/foo";
    withRepo(bad);
    const res = run();
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stderr, /malformed/);
    assert.ok(res.stderr.includes(bad), `URL echoed: ${res.stderr}`);
    assert.match(res.stderr, /Expected: https:\/\/<host>\/<owner>\/<repo>/);
  });

  test("canonical-repo::(c) blob path rejected", () => {
    const bad = "https://github.com/crewrig/crewrig/blob/main/foo.md";
    withRepo(bad);
    const res = run();
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stderr, /malformed/);
    assert.ok(res.stderr.includes(bad), `URL echoed: ${res.stderr}`);
  });
});
