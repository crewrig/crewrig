// build-components-output-resources.test.ts — skill resources, line endings and byte-order marks
// through the entry (spec 0250 R10, R14, R15; spec Scenarios 10, 11, 12, 14, 15; plan step 21).
// The skills, commands and provenance are in build-components-output-skills.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import {
  builtFiles,
  CONFIG,
  lines,
  skill,
  source,
  NATIVE_PATHS,
} from "./fixtures/build-components/entry-kit.ts";
import {
  LINKS,
  LINKS_REWRITTEN,
  SKILL_FILES,
  writeSkill,
} from "./fixtures/build-components/skill-fixture.ts";

const POSIX = process.platform === "win32" ? "skipped: POSIX modes and links" : undefined;
const CONFIG_TEXT = CONFIG;

function build(files: Record<string, string>, args: string[] = []) {
  const tree = createFixtureTree();
  tree.config(CONFIG_TEXT);
  for (const [rel, content] of Object.entries(files)) tree.artifact(rel, content);
  const res = tree.run(args);
  assert.equal(res.status, 0, res.stderr + res.stdout);
  return tree;
}

describe("skill resources (R15; spec Scenarios 10-12)", () => {
  function withResources() {
    const tree = createFixtureTree();
    tree.config(CONFIG);
    writeSkill(tree.resolve("artifacts/core/skills/x"), SKILL_FILES, process.platform !== "win32");
    tree.artifact("library/skills/x/SKILL.md", skill("x", "../../../../docs/x.md\n"));
    return tree;
  }

  test("links in a core body and a .md resource are rewritten, other bytes of a resource are not", () => {
    const tree = withResources();
    tree.write("artifacts/core/skills/x/SKILL.md", skill("x", "../../../../docs/x.md\n"));
    assert.equal(tree.run(["--target", "claude"]).status, 0);
    assert.match(tree.read(".claude/skills/x/SKILL.md"), /\n\.\.\/\.\.\/\.\.\/docs\/x\.md\n$/);
    assert.equal(tree.read(".claude/skills/x/references/doc.md"), `a\r\n${LINKS_REWRITTEN}b`);
    assert.equal(
      tree.read(".claude/skills/x/references/UPPER.MD"),
      LINKS,
      "UPPER.MD is not a .md file",
    );
    assert.equal(
      tree.read("dist/library/.claude/skills/x/SKILL.md").includes("../../../../docs/x.md"),
      true,
    );
  });

  test("a CRLF-bytes asset and a binary are copied byte for byte", () => {
    const tree = withResources();
    assert.equal(tree.run(["--target", "claude"]).status, 0);
    for (const rel of [
      "scripts/links.txt",
      "assets/blob.bin",
      "assets/bad.md",
      "assets/empty.txt",
    ]) {
      const src = SKILL_FILES.find((f) => f.rel === rel);
      assert.ok(src !== undefined);
      const copy = fs.readFileSync(tree.resolve(`.claude/skills/x/${rel}`));
      if (rel !== "assets/bad.md") assert.deepEqual(copy, Buffer.from(src.content), rel);
    }
    assert.ok(tree.read(".claude/skills/x/scripts/links.txt").includes("\r\n"));
  });

  test(
    "the files of one skill are listed in whole-path code-unit order, links skipped",
    { skip: NATIVE_PATHS },
    () => {
      const tree = withResources();
      const res = tree.run(["--target", "claude", "--tier", "core"]);
      const generated = lines(res.stdout).filter((l) => l.includes("/.claude/skills/x/scripts/"));
      const rels = generated.map((l) => l.split("/skills/x/scripts/")[1]);
      assert.deepEqual(rels, [
        ".hidden",
        "B.txt",
        "a-b.txt",
        "a.txt",
        "a/b.txt",
        "lib/Zed.txt",
        "lib/alpha.txt",
        "links.txt",
        "run.sh",
      ]);
      if (process.platform !== "win32") {
        assert.equal(tree.exists(".claude/skills/x/scripts/link-to-file"), false);
        assert.equal(tree.exists(".claude/skills/x/scripts/link-to-dir"), false);
        assert.equal(tree.exists(".claude/skills/x/references/dangling"), false);
      }
    },
  );

  test(
    "an executable source leaves an executable copy; --check never compares modes",
    { skip: POSIX },
    () => {
      const tree = withResources();
      assert.equal(tree.run(["--target", "claude", "--tier", "core"]).status, 0);
      const copy = tree.resolve(".claude/skills/x/scripts/run.sh");
      assert.notEqual(fs.statSync(copy).mode & 0o111, 0, "built executable");
      fs.chmodSync(copy, 0o644);
      const res = tree.run(["--target", "claude", "--tier", "core", "--check"]);
      assert.equal(res.status, 0, res.stdout);
      assert.doesNotMatch(res.stdout, /DRIFT/);
    },
  );

  test(
    "modes of the copies: a plain file keeps its source mode, a .md copy takes the default mode, execute bits are added never cleared",
    { skip: POSIX },
    () => {
      const tree = withResources();
      const umask = process.umask(0);
      process.umask(umask);
      const mode = (rel: string): number =>
        fs.statSync(tree.resolve(`.claude/skills/x/${rel}`)).mode & 0o777;
      assert.equal(tree.run(["--target", "claude", "--tier", "core"]).status, 0);
      assert.equal(mode("scripts/a/b.txt"), 0o600 & ~umask, "cp: the source mode, masked");
      assert.equal(mode("scripts/a.txt"), 0o644 & ~umask);
      assert.equal(
        mode("references/sub/two.md"),
        0o666 & ~umask,
        "a .md copy ignores its source mode (0600)",
      );
      assert.equal(mode("scripts/run.sh"), 0o755 & ~umask);
      assert.equal(
        mode("references/tool.md"),
        (0o666 | 0o111) & ~umask,
        "an executable .md source: the bits are added",
      );
      // rewrite over existing copies: execute bits are added to a copy that lost them, others are kept
      fs.chmodSync(tree.resolve(".claude/skills/x/scripts/run.sh"), 0o640);
      fs.chmodSync(tree.resolve(".claude/skills/x/scripts/a.txt"), 0o640);
      assert.equal(tree.run(["--target", "claude", "--tier", "core"]).status, 0);
      assert.equal(
        mode("scripts/run.sh"),
        0o640 | (0o111 & ~umask),
        "the execute bits come back, nothing else changes",
      );
      assert.equal(mode("scripts/a.txt"), 0o640, "a rewritten non-executable copy keeps its mode");
    },
  );

  test("--check reports a missing and a differing resource", () => {
    const tree = withResources();
    assert.equal(tree.run(["--target", "claude", "--tier", "core"]).status, 0);
    fs.rmSync(tree.resolve(".claude/skills/x/scripts/a.txt"));
    fs.appendFileSync(tree.resolve(".claude/skills/x/assets/blob.bin"), "x");
    const res = tree.run(["--target", "claude", "--tier", "core", "--check"]);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /DRIFT: .*\/scripts\/a\.txt does not exist \(expected from source\)/);
    assert.match(res.stdout, /DRIFT: .*\/assets\/blob\.bin differs from source/);
  });
});

describe("line endings and byte-order marks (R10, R14; spec Scenarios 14, 15)", () => {
  const lf = skill("probe", "Body line.\n\n", ["license: MIT"]);
  const run = (text: string) =>
    build({ "core/skills/probe/SKILL.md": text }).read(".claude/skills/probe/SKILL.md");

  test("a CRLF source and a BOM source build the same bytes as the LF source, LF only", () => {
    const expected = run(lf);
    assert.equal(run(lf.replaceAll("\n", "\r\n")), expected);
    assert.equal(run(`﻿${lf}`), expected);
    assert.equal(run(`﻿${lf.replaceAll("\n", "\r\n")}`), expected);
    assert.doesNotMatch(expected, /\r|﻿/);
    assert.match(expected, /name: probe\n/);
  });

  test("trailing line feeds are reduced to exactly one", () => {
    assert.ok(run(skill("probe", "x\n\n\n\n")).endsWith("\n\nx\n"));
  });

  test(
    "a source that cannot be parsed is skipped by the name warning: exit 0, nothing built",
    { skip: NATIVE_PATHS },
    () => {
      const tree = createFixtureTree();
      tree.config(CONFIG);
      tree.artifact(
        "core/skills/bad/SKILL.md",
        "---\nname: [unclosed\ndescription: {a: b\n---\nB\n",
      );
      tree.artifact("core/skills/good/SKILL.md", skill("good"));
      const res = tree.run(["--target", "claude"]);
      assert.equal(res.status, 0);
      assert.ok(
        lines(res.stdout).includes(
          `Warning: ${tree.root}/artifacts/core/skills/bad//SKILL.md missing 'name' field, skipping`,
        ),
      );
      assert.deepEqual(builtFiles(tree), [".claude/skills/good/SKILL.md"]);
    },
  );
});
