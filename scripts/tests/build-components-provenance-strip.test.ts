// build-components-provenance-strip.test.ts — spec 0269 R7: `<!-- provenance: ... -->`
// citation comments never reach a compiled output; every other comment, including the Gemini
// carrier `<!-- crewrig-provenance: ... -->`, survives.
//
// The assertions are functions so the mutation cases can run them on in-memory bad outputs.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stripProvenanceComments } from "../lib/build-components/provenance.ts";
import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import { baseEnv } from "./lib/build-sandbox.ts";
import { seedMappings } from "./fixtures/build-components/entry-kit.ts";

const CITE = "<!-- provenance: spec 0080 R12 -->";
const NOTE = "<!-- note: keep me -->";
const CARRIER = '<!-- crewrig-provenance: version="1.0.0" canonical="c" feedback="f" -->';

const lacksCitation = (out: string): void =>
  assert.ok(!/<!--\s*provenance:/.test(out), "a provenance citation comment survived");
const keepsNote = (out: string): void =>
  assert.ok(out.includes(NOTE), "the unrelated comment was stripped");

describe("stripProvenanceComments", () => {
  test("an own-line comment is removed with its line", () => {
    assert.equal(stripProvenanceComments(`a\n${CITE}\nb`), "a\nb");
  });

  test("an inline comment is removed alone", () => {
    assert.equal(stripProvenanceComments(`Rule text ${CITE} more`), "Rule text  more");
  });

  test("other comments and the Gemini carrier are kept", () => {
    const text = `${NOTE}\n${CARRIER}\n<!-- crewrig-doc: x -->`;
    assert.equal(stripProvenanceComments(text), text);
  });

  test("text without a comment is returned unchanged", () => {
    assert.equal(stripProvenanceComments("plain\n"), "plain\n");
  });

  test("mutation: the assertions go red on bad outputs", () => {
    assert.throws(() => lacksCitation(`x\n${CITE}`));
    assert.throws(() => keepsNote("x"));
  });
});

describe("build output", () => {
  const tree = createFixtureTree();
  tree.artifact(
    "core/skills/probe/SKILL.md",
    `---\nname: probe\ndescription: probe skill.\nmetadata:\n  provenance:\n    version: 1.0.0\n    canonical: c\n    feedback: f\n---\n\n# Probe\n\n${CITE}\n${NOTE}\n`,
  );
  tree.artifact("core/skills/probe/references/ref.md", `# Ref\n${CITE}\n${NOTE}\n`);
  seedMappings(tree);

  test("all four CLI trees drop the citation and keep the note", () => {
    const built = tree.run(["--target", "all"], { env: baseEnv() });
    assert.equal(built.status, 0, built.stderr);
    const outs = [".claude", ".gemini", ".github", ".agents"].map((d) =>
      tree.read(`${d}/skills/probe/SKILL.md`),
    );
    assert.equal(outs.length, 4);
    for (const out of outs) {
      lacksCitation(out);
      keepsNote(out);
    }
    const ref = tree.read(".claude/skills/probe/references/ref.md");
    lacksCitation(ref);
    keepsNote(ref);
  });
});
