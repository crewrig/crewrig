// check-plan-review-gate.test.ts — unit test of the plan-review-gate library: path-token regex and
// predicate, and the component manifest grammar (spec 0277 R6, R7, R18). Fixtures live under
// scripts/tests/fixtures/plan-review/.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  extractPathTokens,
  isPathToken,
  PATH_TOKEN_REGEX,
  resolveComponent,
} from "../lib/governance/plan-review-gate.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "plan-review");
const fx = (name: string) => path.join(FIXTURES, name);
const COMPONENTS = fx("components.txt");

describe("plan-review-gate: path-token regex and predicate", () => {
  it("defines the token regex as a backticked span without whitespace", () => {
    assert.equal(PATH_TOKEN_REGEX.source, "`([^`\\s]+)`");
  });
  it("accepts slashes, bare directories and the listed extensions", () => {
    for (const t of [
      "a/b",
      "specs/",
      "x.md",
      "x.ts",
      "x.js",
      "x.yml",
      "x.yaml",
      "x.json",
      "x.txt",
      "x.sh",
      "./x.ts",
    ])
      assert.equal(isPathToken(t), true, t);
  });
  it("rejects words, other extensions and URLs", () => {
    for (const t of ["foo", "x.tsx", "x.py", "https://e.com/a.md", "http://e.com/a"])
      assert.equal(isPathToken(t), false, t);
  });
  it("extracts unique tokens in document order from mixed text", () => {
    const text = [
      "Edit `docs/a.md` then `./scripts/x.ts`, see `https://example.com/a.md` and `http://x/y`.",
      "Directory `specs/`, word `foo`, spaced `a b/c`, again `docs/a.md`, file `README.md`.",
    ].join("\n");
    assert.deepEqual(extractPathTokens(text), ["docs/a.md", "scripts/x.ts", "specs/", "README.md"]);
  });
});

describe("plan-review-gate: component manifest grammar", () => {
  const manifest = readFileSync(COMPONENTS, "utf8");
  it("maps a skill source and its four mirrors to one component", () => {
    const paths = [
      "artifacts/core/skills/architect/SKILL.md",
      ".claude/skills/architect/SKILL.md",
      ".gemini/skills/architect/SKILL.md",
      ".github/skills/architect/SKILL.md",
      ".agents/skills/architect/SKILL.md",
    ];
    assert.deepEqual(
      new Set(paths.map((p) => resolveComponent(p, manifest))),
      new Set(["skill:architect"]),
    );
  });
  it("maps the five agent paths of both layouts to one component", () => {
    const paths = [
      "artifacts/core/agents/architect/AGENT.md",
      ".claude/agents/architect.md",
      ".gemini/agents/architect.md",
      ".github/agents/architect.md",
      ".agents/agents/architect/AGENT.md",
    ];
    assert.deepEqual(
      new Set(paths.map((p) => resolveComponent(p, manifest))),
      new Set(["agent:architect"]),
    );
  });
  it("picks the longest literal prefix", () => {
    assert.equal(resolveComponent("docs/adr/0001.md", manifest), "adr");
    assert.equal(resolveComponent("scripts/lib/governance/x.ts", manifest), "governance-libs");
    assert.equal(resolveComponent("docs/x.md", manifest), "docs");
  });
  it("resolves a longest-literal-prefix tie to the first manifest line", () => {
    assert.equal(
      resolveComponent("docs/ab", readFileSync(fx("components-tie.txt"), "utf8")),
      "first-comp",
    );
    assert.equal(
      resolveComponent("docs/ab", readFileSync(fx("components-tie-reversed.txt"), "utf8")),
      "second-comp",
    );
  });
  it("keeps distinct skills distinct", () => {
    assert.notEqual(
      resolveComponent(".claude/skills/architect/SKILL.md", manifest),
      resolveComponent(".claude/skills/tester/SKILL.md", manifest),
    );
  });
  it("maps an unmatched path to its first segment", () => {
    assert.equal(resolveComponent("tools/x.ts", manifest), "tools");
  });
});
