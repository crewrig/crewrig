// build-components-output-agents.test.ts — agent files through the entry (spec 0250 R6, R12,
// R13, R19; plan step 21): the four CLI shapes, the Antigravity layout and its `enable_*` rule,
// the Gemini provenance comment, a profile-bearing agent against the committed trees, and
// `--diagnostics`. Expected files are written by hand from the rules of R13.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import {
  agent,
  CONFIG,
  lines,
  REPO,
  seedMappings,
  source,
} from "./fixtures/build-components/entry-kit.ts";

function build(extra: readonly string[], body = "Agent body.\n") {
  const tree = createFixtureTree();
  tree.config(CONFIG);
  tree.artifact("core/agents/ag/AGENT.md", agent("ag", body, extra));
  const res = tree.run([]);
  assert.equal(res.status, 0, res.stderr + res.stdout);
  assert.equal(res.stderr, "", "an agent without a capability profile resolves silently");
  return tree;
}

describe("the four CLI shapes (R13)", () => {
  const extra = ["license: MIT", 'compatibility: "c"', "claude:", "  allowed-tools:", "    - Read"];
  test("Gemini, Claude Code, Copilot CLI and Antigravity CLI files", () => {
    const tree = build(extra);
    assert.equal(
      tree.read(".gemini/agents/ag.md"),
      '---\nname: ag\ndescription: "An agent."\n---\n\nAgent body.\n',
    );
    assert.equal(
      tree.read(".claude/agents/ag.md"),
      '---\nname: ag\ndescription: "An agent."\nlicense: MIT\ncompatibility: "c"\n---\n\nAgent body.\n',
    );
    assert.equal(
      tree.read(".github/agents/ag.md"),
      '---\nname: ag\ndescription: "An agent."\n---\n\nAgent body.\n',
    );
    assert.equal(
      tree.read(".agents/agents/ag/AGENT.md"),
      '---\nname: ag\ndescription: "An agent."\nlicense: MIT\ncompatibility: "c"\n---\n\nAgent body.\n',
    );
  });

  test("Antigravity places the agent in a directory of its own name", () => {
    const tree = build([]);
    assert.equal(tree.exists(".agents/agents/ag/AGENT.md"), true);
    assert.equal(tree.exists(".agents/agents/ag.md"), false);
  });
});

describe("the Antigravity enable_* rule (R13)", () => {
  const read = (extra: string[]): string =>
    build(extra).read(".agents/agents/ag/AGENT.md").split("---\n")[1] ?? "";
  const bash = ["claude:", "  allowed-tools:", "    - Read", "    - Bash"];

  test("each key is written when present and neither empty nor null; false is kept", () => {
    const fm = read([
      "antigravity:",
      "  enable_write_tools: false",
      "  enable_mcp_tools: true",
      "  enable_subagent_tools: null",
    ]);
    assert.equal(
      fm,
      'name: ag\ndescription: "An agent."\nenable_write_tools: false\nenable_mcp_tools: true\n',
    );
  });

  test("enable_write_tools alone falls back to true when claude.allowed-tools has an element equal to Bash", () => {
    assert.match(read(bash), /\nenable_write_tools: true\n$/);
    assert.doesNotMatch(read(["claude:", "  allowed-tools:", "    - Bash2"]), /enable_write_tools/);
    assert.match(
      read([...bash, "antigravity:", "  enable_write_tools:"]),
      /enable_write_tools: true/,
    );
    assert.match(
      read([...bash, "antigravity:", "  enable_write_tools: false"]),
      /enable_write_tools: false/,
    );
  });

  test("the fallback never applies to the other two keys", () => {
    const fm = read(bash);
    assert.doesNotMatch(fm, /enable_mcp_tools|enable_subagent_tools/);
  });
});

describe("the Gemini provenance comment (R12)", () => {
  const prov = [
    "metadata:",
    "  provenance:",
    '    canonical: "${CANONICAL_REPO}"',
    "    version: 1.0",
  ];
  test("Gemini carries an HTML comment and no metadata block; the others carry the block", () => {
    const tree = build(prov);
    assert.equal(
      tree.read(".gemini/agents/ag.md"),
      '---\nname: ag\ndescription: "An agent."\n---\n' +
        '<!-- crewrig-provenance: version="1.0" canonical="https://example.test/o/r" feedback="" -->\nAgent body.\n',
    );
    for (const file of [
      ".claude/agents/ag.md",
      ".github/agents/ag.md",
      ".agents/agents/ag/AGENT.md",
    ]) {
      const text = tree.read(file);
      assert.match(
        text,
        /\nmetadata:\n {2}provenance:\n {4}canonical: "https:\/\/example\.test\/o\/r"\n {4}version: "1\.0"\n---\n/,
        file,
      );
    }
    assert.doesNotMatch(tree.read(".gemini/agents/ag.md"), /^metadata:/m);
  });
});

describe("a profile-bearing agent against the committed trees (R13, R19)", () => {
  test("the real tester agent, real mappings and configuration reproduce its four committed files", () => {
    const tree = createFixtureTree();
    fs.copyFileSync(path.join(REPO, "crewrig.config.toml"), tree.resolve("crewrig.config.toml"));
    seedMappings(tree);
    fs.cpSync(
      path.join(REPO, "artifacts/core/agents/tester"),
      tree.resolve("artifacts/core/agents/tester"),
      { recursive: true },
    );
    const res = tree.run([]);
    assert.equal(res.status, 0, res.stderr);
    for (const rel of [
      ".gemini/agents/tester.md",
      ".claude/agents/tester.md",
      ".github/agents/tester.md",
      ".agents/agents/tester/AGENT.md",
    ]) {
      assert.equal(tree.read(rel), fs.readFileSync(path.join(REPO, rel), "utf8"), rel);
    }
    assert.match(res.stderr, /^model-/m, "the resolution reports its notes on standard error");
  });

  test("--diagnostics: each diagnostic line goes to standard error and is appended to the file, never truncated", () => {
    const tree = createFixtureTree();
    fs.copyFileSync(path.join(REPO, "crewrig.config.toml"), tree.resolve("crewrig.config.toml"));
    seedMappings(tree);
    fs.cpSync(
      path.join(REPO, "artifacts/core/agents/tester"),
      tree.resolve("artifacts/core/agents/tester"),
      { recursive: true },
    );
    const log = tree.write("diag.log", "kept\n");
    const res = tree.run(["--diagnostics", log]);
    assert.equal(res.status, 0, res.stderr);
    const file = lines(fs.readFileSync(log, "utf8"));
    assert.equal(file[0], "kept");
    assert.deepEqual(file.slice(1), lines(res.stderr));
    assert.ok(file.length > 1);
  });

  test("a source with no capability profile writes nothing to the diagnostics file", () => {
    const tree = createFixtureTree();
    tree.config(CONFIG);
    seedMappings(tree);
    tree.artifact("core/agents/ag/AGENT.md", source(["name: ag", 'description: "d"']));
    const log = tree.resolve("diag.log");
    const res = tree.run(["--diagnostics", log]);
    assert.equal(res.status, 0);
    assert.equal(fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "", "");
  });
});
