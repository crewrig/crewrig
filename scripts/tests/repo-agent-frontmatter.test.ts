// Replaces scripts/tests/test-gemini-agent-frontmatter.sh (issue #54; spec 0265): repository-state
// test over the committed agent outputs. Gemini agents carry neither `metadata:` nor `type:` in their
// frontmatter and open their body with a provenance comment; Claude and Copilot agents keep `metadata:`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { fenceSplit } from "./lib/build-sandbox.ts";

function mdFiles(dir: string): string[] {
  const abs = path.join(REPO, dir);
  return fs
    .readdirSync(abs, { recursive: true, encoding: "utf8" })
    .filter((rel) => rel.endsWith(".md") && fs.statSync(path.join(abs, rel)).isFile())
    .sort()
    .map((rel) => path.join(abs, rel));
}

function split(file: string): { front: string; body: string } {
  const s = fenceSplit(fs.readFileSync(file, "utf8"));
  assert.ok(s, `no frontmatter fence in ${file}`);
  return s;
}

const PROVENANCE = /^<!-- crewrig-provenance: .*version=".*".*canonical=".*".*-->$/;

describe("committed agent outputs", () => {
  test("(1) no metadata:/type: in .gemini/agents frontmatter", () => {
    const files = mdFiles(".gemini/agents");
    assert.ok(files.length > 0, "no .md files under .gemini/agents");
    const offenders = files.filter((f) => /^(metadata|type):/m.test(split(f).front));
    assert.deepEqual(offenders, []);
  });

  test("(2) crewrig-provenance comment on first body line of every Gemini agent", () => {
    const files = mdFiles(".gemini/agents");
    assert.ok(files.length > 0, "no .md files under .gemini/agents");
    const offenders = files.filter((f) => {
      const first = split(f)
        .body.split("\n")
        .find((l) => l.trim() !== "");
      return first === undefined || !PROVENANCE.test(first);
    });
    assert.deepEqual(offenders, []);
  });

  for (const [name, dir] of [
    ["claude", ".claude/agents"],
    ["copilot", ".github/agents"],
  ] as const) {
    test(`(3-${name}) metadata: still present in every ${name} agent`, () => {
      const files = mdFiles(dir);
      assert.ok(files.length > 0, `no .md files under ${dir}`);
      const missing = files.filter((f) => !/^metadata:/m.test(split(f).front));
      assert.deepEqual(missing, []);
    });
  }
});
