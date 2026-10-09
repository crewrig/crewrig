// build-components-names.test.ts — the two readings of a component name and the skip rule
// (spec 0250 R9, R17, R33(f); spec Scenarios 6, 7; plan step 21).
//
// The collision pre-pass reads a name LINE BASED (`name: probe # note` is `probe # note`); the
// build reads it as YAML (`probe`). A source whose YAML `name` is absent, empty or null in any
// spelling is skipped with the shell's existing warning (R33(f)), while the pre-pass still falls
// back to the directory name; a quoted `"~"` is a string and is built.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import {
  builtFiles,
  command,
  CONFIG,
  lines,
  skill,
  source,
  NATIVE_PATHS,
} from "./fixtures/build-components/entry-kit.ts";

function tree(files: Record<string, string>) {
  const t = createFixtureTree();
  t.config(CONFIG);
  for (const [rel, content] of Object.entries(files)) t.artifact(rel, content);
  return t;
}

describe("a line-based name and a YAML name differ on purpose (Scenario 7)", () => {
  test("`name: probe # note` is keyed `probe # note` by the pre-pass and built as `probe`", () => {
    const t = tree({
      "core/skills/noted/SKILL.md": source(["name: probe # note", 'description: "d"']),
      "core/skills/plain/SKILL.md": skill("probe"),
    });
    const res = t.run(["--target", "claude"]);
    assert.equal(
      res.status,
      0,
      "`probe # note` and `probe` are two names to the pre-pass: no refusal",
    );
    assert.deepEqual(
      lines(res.stdout).filter((l) => l.startsWith("Building")),
      ["Building skill: probe", "Building skill: probe"],
    );
    assert.deepEqual(builtFiles(t), [".claude/skills/probe/SKILL.md"]);
    assert.doesNotMatch(t.read(".claude/skills/probe/SKILL.md"), /# note/);
  });

  test("two sources with the same line-based name `probe # note` are refused under that name", () => {
    const noted = source(["name: probe # note", 'description: "d"']);
    const t = tree({ "core/skills/a/SKILL.md": noted, "core/commands/b.md": noted });
    const res = t.run(["--target", "claude"]);
    assert.equal(res.status, 1);
    assert.match(
      res.stderr,
      /^Refusing 'probe # note': one installed name is claimed by more than one component\.$/m,
    );
    assert.deepEqual(builtFiles(t), []);
  });

  test("a quote around the name is stripped by the pre-pass (double, then single) and by YAML alike", () => {
    const t = tree({
      "core/skills/a/SKILL.md": source(['name: "probe"', 'description: "d"']),
      "core/commands/b.md": source(["name: 'probe'", 'description: "d"']),
    });
    const res = t.run(["--target", "claude"]);
    assert.equal(res.status, 1, "the same installed name through two quote styles is one name");
    assert.match(res.stderr, /^Refusing 'probe':/m);
  });
});

describe("a component with no name (R33(f))", () => {
  const nullSpellings: Array<[string, string[]]> = [
    ["absent", ['description: "d"']],
    ["empty value", ["name:", 'description: "d"']],
    ["null", ["name: null", 'description: "d"']],
    ["tilde", ["name: ~", 'description: "d"']],
    ["Null", ["name: Null", 'description: "d"']],
    ["NULL", ["name: NULL", 'description: "d"']],
  ];
  for (const [label, frontmatter] of nullSpellings) {
    test(
      `${label}: skipped with the warning, nothing built, exit 0`,
      { skip: NATIVE_PATHS },
      () => {
        const t = tree({
          "core/skills/x/SKILL.md": source(frontmatter),
          "core/skills/ok/SKILL.md": skill("ok"),
        });
        const res = t.run(["--target", "claude"]);
        assert.equal(res.status, 0, res.stderr);
        assert.ok(
          lines(res.stdout).includes(
            `Warning: ${t.root}/artifacts/core/skills/x//SKILL.md missing 'name' field, skipping`,
          ),
          res.stdout,
        );
        assert.deepEqual(builtFiles(t), [".claude/skills/ok/SKILL.md"]);
        assert.doesNotMatch(res.stdout, /Building skill: (null|~|Null|NULL)/);
      },
    );
  }

  test("an empty frontmatter and a missing frontmatter are skipped too", () => {
    const t = tree({
      "core/skills/e/SKILL.md": "---\n---\nBody\n",
      "core/skills/n/SKILL.md": "just a body\n",
    });
    const res = t.run(["--target", "claude"]);
    assert.equal(res.status, 0);
    assert.equal(lines(res.stdout).filter((l) => l.startsWith("Warning:")).length, 2);
    assert.deepEqual(builtFiles(t), []);
  });

  test('a quoted "~" and `false` are names: they are built', () => {
    const t = tree({
      "core/skills/q/SKILL.md": source(['name: "~"', 'description: "d"']),
      "core/skills/f/SKILL.md": source(["name: false", 'description: "d"']),
    });
    const res = t.run(["--target", "claude"]);
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /^Warning:/m);
    assert.deepEqual(builtFiles(t), [".claude/skills/false/SKILL.md", ".claude/skills/~/SKILL.md"]);
  });

  test(
    "the warning shows a single slash for a command and a double slash for a skill and an agent",
    { skip: NATIVE_PATHS },
    () => {
      const t = tree({
        "core/commands/c.md": source(['description: "d"']),
        "core/skills/s/SKILL.md": source(['description: "d"']),
        "core/agents/a/AGENT.md": source(['description: "d"']),
      });
      const warnings = lines(t.run(["--target", "claude"]).stdout).filter((l) =>
        l.startsWith("Warning:"),
      );
      assert.deepEqual(warnings, [
        `Warning: ${t.root}/artifacts/core/skills/s//SKILL.md missing 'name' field, skipping`,
        `Warning: ${t.root}/artifacts/core/commands/c.md missing 'name' field, skipping`,
        `Warning: ${t.root}/artifacts/core/agents/a//AGENT.md missing 'name' field, skipping`,
      ]);
    },
  );

  test("the collision pre-pass still falls back to the directory name of a nameless source", () => {
    const t = tree({
      "core/skills/probe/SKILL.md": source(["name: ~", 'description: "d"']),
      "core/commands/probe.md": command("probe"),
    });
    t.artifact("core/skills/dir-only/SKILL.md", source(['description: "d"']));
    t.artifact("core/commands/dir-only.md", command("dir-only"));
    const res = t.run(["--target", "claude"]);
    assert.equal(
      res.status,
      1,
      "a nameless skill `dir-only` and a command `dir-only` collide on the directory name",
    );
    assert.match(res.stderr, /^Refusing 'dir-only':/m);
    assert.doesNotMatch(
      res.stderr,
      /Refusing 'probe'/,
      "`name: ~` is the text `~` to the pre-pass, not the directory name",
    );
    assert.deepEqual(builtFiles(t), []);
  });
});
