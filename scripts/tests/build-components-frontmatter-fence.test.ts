// Replaces scripts/tests/test-extract-frontmatter.sh (issue #24; spec 0265): a skill body holding a
// fenced `---` pair must not bleed into the built frontmatter. Observed on the build's OUTPUT, split
// with the independent two-fence splitter of the helper (not the build's own code).

import assert from "node:assert/strict";
import { describe, test, before } from "node:test";

import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import { baseEnv, fenceSplit } from "./lib/build-sandbox.ts";

const SOURCE = [
  "---",
  "name: test-skill",
  "description: A test skill",
  "---",
  "",
  "Some body text.",
  "",
  "```yaml",
  "---",
  "nested: value",
  "---",
  "```",
  "",
  "More body text.",
  "",
].join("\n");

const BUILT = ".claude/skills/test-skill/SKILL.md";

describe("frontmatter extraction ignores fenced --- lines", () => {
  const tree = createFixtureTree();
  let status: number | null = null;
  let stderr = "";
  let split: { front: string; body: string } | null = null;

  before(() => {
    tree.artifact("core/skills/test-skill/SKILL.md", SOURCE);
    const res = tree.run(["--target", "claude"], { env: baseEnv() });
    status = res.status;
    stderr = res.stderr;
    if (tree.exists(BUILT)) split = fenceSplit(tree.read(BUILT));
  });

  test("E1 fence::build succeeds", () => {
    assert.equal(status, 0, `stderr: ${stderr}`);
  });

  test("E2 fence::skill built under the right path", () => {
    assert.ok(tree.exists(BUILT), `${BUILT} missing`);
  });

  test("E3 fence::no body leaks into frontmatter", () => {
    assert.ok(split, "no frontmatter fence in the built file");
    assert.ok(!split.front.includes("nested: value"));
    assert.ok(!split.front.split("\n").includes("---"));
  });

  test("E4 fence::exactly name and description", () => {
    assert.ok(split, "no frontmatter fence in the built file");
    const lines = split.front.split("\n");
    const keys = lines.filter((l) => /^[A-Za-z_][A-Za-z0-9_-]*:/.test(l));
    assert.equal(keys.length, 2, `got: ${lines.join("|")}`);
    const value = (key: string): string | undefined =>
      lines
        .find((l) => l.startsWith(`${key}:`))
        ?.slice(key.length + 1)
        .trim()
        .replace(/^"([^"]*)"$/, "$1");
    assert.equal(value("name"), "test-skill");
    assert.equal(value("description"), "A test skill");
  });

  test("E5 fence::fenced content survives in the body", () => {
    assert.ok(split, "no frontmatter fence in the built file");
    assert.ok(split.body.split("\n").includes("nested: value"));
  });

  test("E6 fence::both fence rules kept", () => {
    assert.ok(split, "no frontmatter fence in the built file");
    assert.equal(split.body.split("\n").filter((l) => l === "---").length, 2);
  });
});
