// agent-profile-build.test.ts — the build-driven cases of the spec 0200 migration to capability
// profiles: T4 (diagnostic stream over the 22 core sources), T5 (harness-curator, the profile-less
// witness) and R40 (an unregenerated profile edit reds `--check`).
// Replaces scripts/tests/test-agent-profile-migration.sh (part), spec 0265 P1.
//
// T4 and T5 read the WORKING TREE sources; R40 reads the git blobs of HEAD (frozen behaviour of the
// former `git archive HEAD`): an uncommitted profile edit is invisible to R40. Every build runs in a
// throwaway fixture root; the checkout is never written.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createFixtureTree, REPO, type FixtureTree } from "./lib/build-fixture-tree.ts";
import { baseEnv, copyFromHead, copyFromWorktree, readFrontmatter } from "./lib/build-sandbox.ts";

process.env.GIT_CONFIG_NOSYSTEM = "1";

const NOTE = /^model-note.*claude.*guard-withheld/;
const DROP = /^model-drop.*copilot.*metadata\.model\.intelligence.*unsupported-on-cli/;
const GUIDANCE = "Run this agent on the";
const CONFIG = ["crewrig.config.toml", "model-mappings"];

const stderrLines = (text: string): string[] => text.split("\n").filter((l) => l !== "");
const build = (tree: FixtureTree, ...args: string[]) =>
  tree.run(["--target", "all", ...args], { env: baseEnv() });

/** Every regular file below `dir` (absolute paths); empty when `dir` is absent. */
function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? filesUnder(p) : [p];
  });
}

describe("T4 — R21: diagnostic stream of a plain build, 22-source throwaway root", () => {
  const tree = createFixtureTree();
  const sources = copyFromWorktree(tree, ["artifacts/core/agents", ...CONFIG]).filter((f) =>
    f.endsWith("/AGENT.md"),
  );
  const built = build(tree);

  test("T4 — a plain build over the 22-source root emits exactly 44 lines (22 guard-withheld + 22 unsupported-on-cli)", () => {
    assert.equal(sources.length, 22, "the root is seeded with all 22 core AGENT.md");
    assert.equal(built.status, 0, built.stderr);
    const lines = stderrLines(built.stderr);
    const notes = lines.filter((l) => NOTE.test(l));
    const drops = lines.filter((l) => DROP.test(l));
    const other = lines.filter((l) => !NOTE.test(l) && !DROP.test(l));
    assert.deepEqual(
      { total: lines.length, notes: notes.length, drops: drops.length, other },
      { total: 44, notes: 22, drops: 22, other: [] },
    );
  });

  test("T4 — no compiled output contains a note or a drop record", () => {
    const compiled = [".claude", ".gemini", ".github", ".agents"].flatMap((d) =>
      filesUnder(tree.resolve(d)),
    );
    assert.ok(compiled.length > 0, "the build produced compiled outputs");
    const hits = compiled.filter((f) => /model-note|model-drop/.test(fs.readFileSync(f, "utf8")));
    assert.deepEqual(hits, []);
  });
});

describe("T5 — R20,R5: harness-curator stays the tree's profile-less witness", () => {
  const tree = createFixtureTree();
  const [source] = copyFromWorktree(tree, ["artifacts/library/agents/harness-curator/AGENT.md"]);
  copyFromWorktree(tree, CONFIG);
  const built = build(tree);

  test("T5 — harness-curator's source declares no metadata.model and no metadata.claude", () => {
    assert.equal(source, "artifacts/library/agents/harness-curator/AGENT.md");
    const meta = (readFrontmatter(tree.read(source ?? "")).metadata ?? {}) as object;
    assert.equal(Object.hasOwn(meta, "model"), false);
    assert.equal(Object.hasOwn(meta, "claude"), false);
  });

  test("T5 — a build seeded with harness-curator alone emits 0 model-note/model-drop lines", () => {
    assert.equal(built.status, 0, built.stderr);
    assert.deepEqual(
      stderrLines(built.stderr).filter((l) => /model-note|model-drop/.test(l)),
      [],
    );
  });

  test("T5 — harness-curator's four compiled outputs carry no model:/effort: key and no guidance prose", () => {
    const outputs = [
      "dist/library/.claude/agents/harness-curator.md",
      "dist/library/.gemini/agents/harness-curator.md",
      "dist/library/.github/agents/harness-curator.md",
      "dist/library/.agents/agents/harness-curator/AGENT.md",
    ];
    for (const out of outputs) {
      assert.ok(tree.exists(out), `${out} exists`);
      const fm = readFrontmatter(tree.read(out));
      assert.equal(Object.hasOwn(fm, "model"), false, `${out} has no model key`);
      assert.equal(Object.hasOwn(fm, "effort"), false, `${out} has no effort key`);
      assert.ok(!String(fm.description ?? "").includes(GUIDANCE), `${out} has no guidance prose`);
    }
  });
});

describe("R40 mutation — a profile edit without regenerating reds component-drift's --check", () => {
  const inGit = spawnSync("git", ["rev-parse", "--git-dir"], { cwd: REPO }).status === 0;
  if (!inGit && process.env.CI) assert.fail("R40 needs a git checkout under CI");

  test(
    "R40 — component-drift's --check reds on an unregenerated profile edit, naming .claude/.gemini/.agents but not .github",
    { skip: inGit ? false : "no git checkout: R40 reads the blobs of HEAD" },
    () => {
      const tree = createFixtureTree();
      copyFromHead(tree, ["artifacts", "model-mappings", "crewrig.config.toml"]);
      copyFromHead(tree, [".claude", ".gemini", ".github", ".agents"]);
      const rel = "artifacts/core/agents/developer/AGENT.md";
      const edited = tree.read(rel).replace(/^(\s+intelligence:).*$/m, "$1 medium");
      assert.notEqual(edited, tree.read(rel), "the profile edit changed the source");
      tree.write(rel, edited);
      const res = build(tree, "--check");
      const out = `${res.stdout}\n${res.stderr}`;
      assert.notEqual(res.status, 0, out);
      for (const re of [
        /[\\/]?\.claude[\\/]agents[\\/]developer\.md differs from source/,
        /[\\/]?\.gemini[\\/]agents[\\/]developer\.md differs from source/,
        /[\\/]?\.agents[\\/]agents[\\/]developer[\\/]AGENT\.md differs from source/,
      ]) {
        assert.match(out, re);
      }
      assert.doesNotMatch(out, /\.github[\\/]agents[\\/]developer\.md differs from source/);
      tree.dispose();
    },
  );
});
