// build-components-package-field.test.ts — spec 0316 R2, R6, R8: the build adds `package` (the root
// package.json `name`) to the marker of every canonical skill, agent and command on all four CLIs,
// never from the source, and emits no marker for a source without `metadata.provenance`.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  agent,
  command,
  CONFIG,
  seedMappings,
  skill,
} from "./fixtures/build-components/entry-kit.ts";
import { createFixtureTree } from "./lib/build-fixture-tree.ts";

const PROV = ["metadata:", "  provenance:", "    version: 1.0", "    canonical: https://h/o/r"];

function tree(name: string | null, provenance: readonly string[] = PROV) {
  const t = createFixtureTree();
  t.config(CONFIG);
  seedMappings(t);
  // The real manifest keeps its dependencies (the build loads js-yaml through it).
  const { name: _real, ...manifest } = JSON.parse(t.read("package.json")) as Record<
    string,
    unknown
  >;
  t.write("package.json", JSON.stringify(name === null ? manifest : { ...manifest, name }));
  t.artifact("core/skills/s/SKILL.md", skill("s", "B\n", provenance));
  t.artifact("core/agents/a/AGENT.md", agent("a", "B\n", provenance));
  t.artifact("core/commands/c.md", command("c", "B\n", provenance));
  return t;
}

const YAML_FILES = [
  ".claude/skills/s/SKILL.md",
  ".github/skills/s/SKILL.md",
  ".agents/skills/s/SKILL.md",
  ".gemini/skills/s/SKILL.md",
  ".claude/agents/a.md",
  ".github/agents/a.md",
  ".agents/agents/a.md",
  ".claude/skills/c/SKILL.md",
  ".github/skills/c/SKILL.md",
  ".agents/skills/c/SKILL.md",
];

describe("the package field (R2, R8)", () => {
  test("taken from the root package.json on every CLI, first in the YAML block and the comments", () => {
    const t = tree("forked-name");
    const res = t.run([]);
    assert.equal(res.status, 0, res.stderr);
    for (const file of YAML_FILES) {
      assert.match(
        t.read(file),
        /\nmetadata:\n {2}provenance:\n {4}package: "forked-name"\n {4}version: "1\.0"\n/,
        file,
      );
    }
    assert.match(
      t.read(".gemini/agents/a.md"),
      /^<!-- crewrig-provenance: package="forked-name" version="1\.0" /m,
    );
    assert.match(
      t.read(".gemini/commands/c.toml"),
      /^# crewrig-provenance: package="forked-name" version="1\.0" /,
    );
  });

  test("a source without metadata.provenance gets no marker on any CLI (R8)", () => {
    const t = tree("crewrig", []);
    assert.equal(t.run([]).status, 0);
    for (const file of [...YAML_FILES, ".gemini/agents/a.md", ".gemini/commands/c.toml"]) {
      assert.doesNotMatch(t.read(file), /crewrig-provenance|\nmetadata:/, file);
    }
  });

  test("an authored package is replaced by the root name, never merged (R2, R6)", () => {
    const t = tree("crewrig", [
      "metadata:",
      "  provenance:",
      "    package: other",
      "    version: 1.0",
    ]);
    assert.equal(t.run([]).status, 0);
    const text = t.read(".claude/skills/s/SKILL.md");
    assert.match(text, /package: "crewrig"/);
    assert.doesNotMatch(text, /other/);
    assert.equal(t.read(".gemini/agents/a.md").match(/package=/g)?.length, 1);
  });

  test("a package.json without a name fails the build naming the file; nothing is built", () => {
    for (const name of [null, ""]) {
      const t = tree(name);
      const res = t.run([]);
      assert.equal(res.status, 1);
      assert.match(res.stderr, /^Error: .*package\.json: .*`name`/m);
      assert.equal(t.exists(".claude/skills/s/SKILL.md"), false);
    }
  });

  test("a placeholder value holding a double quote is refused after substitution (v1-F4)", () => {
    const t = tree("crewrig", [
      "metadata:",
      "  provenance:",
      "    version: 1.0",
      "    feedback: ${FEEDBACK_REPO}",
    ]);
    t.config('feedback_repo = x" y\n');
    const res = t.run([]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /double quote/);
  });
});
