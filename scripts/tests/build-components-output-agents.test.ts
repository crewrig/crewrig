// build-components-output-agents.test.ts — agent files through the entry (spec 0250 R6, R12,
// R13, R19; plan step 21): the four CLI shapes, the Antigravity layout and its `enable_*` rule,
// the Gemini provenance comment, a profile-bearing agent against the committed trees, and
// `--diagnostics`. Expected files are written by hand from the rules of R13.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { reconcileRetiredAgentDir } from "../lib/build-components/retire-agent.ts";
import { makeCtx, tempDir } from "./fixtures/build-components/ctx-kit.ts";
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
      tree.read(".agents/agents/ag.md"),
      '---\nname: ag\ndescription: "An agent."\n---\n\nAgent body.\n',
    );
  });

  test("Antigravity places the agent as a flat file, never in a sub-directory (spec 0053 delta-01 R11)", () => {
    const tree = build([]);
    assert.equal(tree.exists(".agents/agents/ag.md"), true);
    assert.equal(tree.exists(".agents/agents/ag"), false);
  });
});

describe("the flat Antigravity agent (spec 0053 delta-01 R11-R13, #1847)", () => {
  const prov = [
    "metadata:",
    "  provenance:",
    '    canonical: "${CANONICAL_REPO}"',
    "    version: 1.0",
  ];
  const bash = ["claude:", "  allowed-tools:", "    - Read", "    - Bash"];
  const flat = (extra: string[]): string => build(extra).read(".agents/agents/ag.md");

  test("flat <name>.md, keys name, description, metadata in that order", () => {
    const text = flat(["license: MIT", 'compatibility: "c"', ...prov]);
    const fm = (text.split("---\n")[1] ?? "").split("\n").filter((l) => /^\S.*:/.test(l));
    assert.deepEqual(
      fm.map((l) => l.split(":")[0]),
      ["name", "description", "metadata"],
    );
  });

  test("pr-reviewer: no enable_*, no tools (a Bash source emits neither)", () => {
    assert.doesNotMatch(flat(bash), /enable_|tools|license|compatibility/);
  });

  test("source declaring antigravity.enable_write_tools builds silently", () => {
    const text = flat(["antigravity:", "  enable_write_tools: true", "  enable_mcp_tools: false"]);
    assert.doesNotMatch(text, /enable_/);
  });
});

describe("retired Antigravity directory cleanup (spec 0053 delta-01 R14, R16, R29)", () => {
  const PROV = [
    "---",
    "name: ag",
    'description: "An agent."',
    "metadata:",
    "  provenance:",
    '    canonical: "https://example.test/o/r"',
    "---",
    "",
    "Old body.",
    "",
  ].join("\n");
  const listing = (tree: ReturnType<typeof createFixtureTree>, rel: string): string[] =>
    fs.readdirSync(tree.resolve(rel)).sort();

  function seeded(files: Record<string, string> = { "AGENT.md": PROV }) {
    const tree = createFixtureTree();
    tree.config(CONFIG);
    tree.artifact("core/agents/ag/AGENT.md", agent("ag"));
    for (const [file, text] of Object.entries(files)) tree.write(`.agents/agents/ag/${file}`, text);
    return tree;
  }

  test("stale dir removed, second run identical", () => {
    const tree = seeded();
    const first = tree.run([]);
    assert.equal(first.status, 0, first.stderr + first.stdout);
    assert.deepEqual(listing(tree, ".agents/agents"), ["ag.md"]);
    const before = tree.read(".agents/agents/ag.md");
    const second = tree.run([]);
    assert.equal(second.status, 0);
    assert.equal(tree.read(".agents/agents/ag.md"), before);
    assert.deepEqual(listing(tree, ".agents/agents"), ["ag.md"]);
    assert.doesNotMatch(second.stdout + second.stderr, /Removed|Migrated|retired/i);
  });

  test("stale dir with extra file left, warned, --check drift", () => {
    const tree = seeded({ "AGENT.md": PROV, "NOTES.txt": "mine\n" });
    const res = tree.run(["--target", "antigravity"]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(listing(tree, ".agents/agents/ag"), ["AGENT.md", "NOTES.txt"]);
    assert.match(res.stderr, /\.agents\/agents\/ag\b/);
    const check = tree.run(["--target", "antigravity", "--check"]);
    assert.equal(check.status, 1);
    assert.match(check.stdout, /DRIFT: .*\.agents\/agents\/ag\b/);
  });

  test("body-only provenance left", () => {
    const body = "---\nname: ag\n---\n\nmetadata:\n  provenance:\n    canonical: x\n";
    const tree = seeded({ "AGENT.md": body });
    const res = tree.run(["--target", "antigravity"]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(tree.read(".agents/agents/ag/AGENT.md"), body);
    assert.match(res.stderr, /\.agents\/agents\/ag\b/);
  });

  test("unterminated frontmatter fence left, warned", () => {
    const body = "---\nname: ag\n\nmetadata:\n  provenance:\n    canonical: x\n";
    const tree = seeded({ "AGENT.md": body });
    const res = tree.run(["--target", "antigravity"]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(tree.read(".agents/agents/ag/AGENT.md"), body);
    assert.match(res.stderr, /\.agents\/agents\/ag\b/);
  });

  test("orphan dir untouched, not reported by --check", () => {
    const tree = seeded();
    tree.write(".agents/agents/gone/AGENT.md", PROV);
    const res = tree.run(["--target", "antigravity"]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(tree.read(".agents/agents/gone/AGENT.md"), PROV);
    const check = tree.run(["--target", "antigravity", "--check"]);
    assert.equal(check.status, 0, check.stdout);
    assert.doesNotMatch(check.stdout, /gone/);
  });

  test("--check reports missing file and retired dir, tree unmodified", () => {
    const tree = seeded();
    const res = tree.run(["--target", "antigravity", "--check"]);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /DRIFT: .*\.agents\/agents\/ag\.md does not exist/);
    assert.match(res.stdout, /DRIFT: .*\.agents\/agents\/ag\b/);
    assert.deepEqual(listing(tree, ".agents/agents"), ["ag"]);
    assert.deepEqual(listing(tree, ".agents/agents/ag"), ["AGENT.md"]);
  });

  test("--check on a non-compared tier writes and cleans", () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, ".agents/agents/ag"), { recursive: true });
    fs.writeFileSync(path.join(root, ".agents/agents/ag/AGENT.md"), PROV);
    const { ctx } = makeCtx({ check: true, compare: false });
    reconcileRetiredAgentDir(ctx, root, "ag");
    assert.equal(fs.existsSync(path.join(root, ".agents/agents/ag")), false);
    assert.equal(ctx.state.driftFound, false);
  });

  test("symlinked <name>/ left", { skip: process.platform === "win32" }, () => {
    const tree = seeded({});
    const target = tree.resolve("elsewhere");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "AGENT.md"), PROV);
    fs.mkdirSync(tree.resolve(".agents/agents"), { recursive: true });
    fs.symlinkSync(target, tree.resolve(".agents/agents/ag"), "dir");
    const res = tree.run(["--target", "antigravity"]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(fs.lstatSync(tree.resolve(".agents/agents/ag")).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(path.join(target, "AGENT.md"), "utf8"), PROV);
    assert.match(res.stderr, /\.agents\/agents\/ag\b/);
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
    for (const file of [".claude/agents/ag.md", ".github/agents/ag.md", ".agents/agents/ag.md"]) {
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
      ".agents/agents/tester.md",
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

// metadata.tools (spec 0291 R8-R15): byte goldens over fixture agents in a throwaway tree, never a
// shipped agent. The build under test accepts the whole vocabulary; the ban on `execute` and `edit`
// for shipped agents lives in the key check, not here.
describe("metadata.tools: one declaration, three spellings (spec 0291 R11-R14)", () => {
  const CLASSES = "read, search, edit, execute, web, agent";
  const meta = (list: string): string[] => ["metadata:", `  tools: ${list}`];
  const fmFile = (lines: string[]): string =>
    `---\nname: ag\ndescription: "An agent."\n${lines.join("\n")}${lines.length > 0 ? "\n" : ""}---\n\nAgent body.\n`;
  const BODY = "Agent body.\n";

  function built(list: string, ...args: string[]) {
    const tree = createFixtureTree();
    tree.config(CONFIG);
    tree.artifact("core/agents/ag/AGENT.md", agent("ag", BODY, meta(list)));
    const res = tree.run(args);
    return { tree, res };
  }
  const stream = (stderr: string): string[] => lines(stderr).filter((l) => l.startsWith("tools-"));
  const drop = (target: string, declared: string, reason: string): string =>
    ["tools-drop", "ag", target, "metadata.tools", declared, reason].join("\t");

  // class, claude, copilot, gemini
  const TABLE: ReadonlyArray<readonly [string, string, string, string | null]> = [
    ["read", "Read", "[read]", "[read_file, read_many_files, list_directory]"],
    ["search", "Grep, Glob", "[search]", "[grep_search, glob]"],
    ["edit", "Edit, Write", "[edit]", "[write_file, replace]"],
    ["execute", "Bash", "[execute]", "[run_shell_command]"],
    ["web", "WebFetch, WebSearch", "[web]", "[web_fetch, google_web_search]"],
    ["agent", "Agent", "[agent]", null],
  ];

  for (const [cls, claude, copilot, gemini] of TABLE) {
    test(`the class ${cls} alone`, () => {
      const targets = gemini === null ? ["claude", "copilot", "antigravity"] : ["all"];
      for (const target of targets) {
        const { tree, res } = built(`[${cls}]`, "--target", target);
        assert.equal(res.status, 0, res.stderr);
        if (target === "all" || target === "claude")
          assert.equal(tree.read(".claude/agents/ag.md"), fmFile([`tools: ${claude}`]));
        if (target === "all" || target === "copilot")
          assert.equal(tree.read(".github/agents/ag.md"), fmFile([`tools: ${copilot}`]));
        if (target === "all")
          assert.equal(tree.read(".gemini/agents/ag.md"), fmFile([`tools: ${gemini}`]));
        if (target === "all" || target === "antigravity")
          assert.equal(tree.read(".agents/agents/ag.md"), fmFile([]));
      }
    });
  }

  test("all six classes: the ten Gemini names pinned literally, one tools-drop for agent, one for Antigravity", () => {
    const { tree, res } = built(`[${CLASSES}]`);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(
      tree.read(".claude/agents/ag.md"),
      fmFile(["tools: Read, Grep, Glob, Edit, Write, Bash, WebFetch, WebSearch, Agent"]),
    );
    assert.equal(
      tree.read(".github/agents/ag.md"),
      fmFile(["tools: [read, search, edit, execute, web, agent]"]),
    );
    assert.equal(
      tree.read(".gemini/agents/ag.md"),
      fmFile([
        "tools: [read_file, read_many_files, list_directory, grep_search, glob, write_file, replace, run_shell_command, web_fetch, google_web_search]",
      ]),
    );
    assert.equal(tree.read(".agents/agents/ag.md"), fmFile([]));
    assert.deepEqual(stream(res.stderr).sort(), [
      drop("antigravity", "read,search,edit,execute,web,agent", "unsupported-on-cli"),
      drop("gemini", "agent", "no-equivalent-on-cli"),
    ]);
  });

  test("the order of the source does not matter: every file is byte-identical to the vocabulary order", () => {
    const forward = built(`[${CLASSES}]`);
    const reversed = built("[agent, web, execute, edit, search, read]");
    assert.equal(reversed.res.status, 0, reversed.res.stderr);
    for (const rel of [".claude", ".github", ".gemini", ".agents"].map((d) => `${d}/agents/ag.md`))
      assert.equal(reversed.tree.read(rel), forward.tree.read(rel), rel);
    assert.deepEqual(stream(reversed.res.stderr).sort(), stream(forward.res.stderr).sort());
  });

  test("a block-style list reads like the flow one", () => {
    const tree = createFixtureTree();
    tree.config(CONFIG);
    tree.artifact(
      "core/agents/ag/AGENT.md",
      agent("ag", BODY, ["metadata:", "  tools:", "    - search", "    - read"]),
    );
    assert.equal(tree.run([]).status, 0);
    assert.equal(tree.read(".github/agents/ag.md"), fmFile(["tools: [read, search]"]));
  });

  test("opt-in: a source without metadata.tools gets no tools key on any CLI (R12)", () => {
    const tree = createFixtureTree();
    tree.config(CONFIG);
    tree.artifact("core/agents/ag/AGENT.md", agent("ag", BODY, ["metadata:", "  other: x"]));
    const res = tree.run([]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(stream(res.stderr).length, 0);
    for (const rel of [".claude", ".github", ".gemini", ".agents"].map(
      (d) => `${d}/agents/ag.md`,
    )) {
      assert.equal(tree.read(rel), fmFile([]), rel);
      assert.doesNotMatch(tree.read(rel), /tools/);
    }
  });

  test("the tools line follows the directed model line and precedes the provenance block (R11)", () => {
    const tree = createFixtureTree();
    tree.config(CONFIG);
    seedMappings(tree);
    tree.artifact(
      "core/agents/ag/AGENT.md",
      agent("ag", BODY, [
        "license: MIT",
        "metadata:",
        "  model:",
        "    intelligence: high",
        "  tools: [read, search]",
        "  provenance:",
        '    canonical: "https://example.test/o/r"',
      ]),
    );
    assert.equal(tree.run([]).status, 0);
    const claude = tree.read(".claude/agents/ag.md");
    const keys = (claude.split("---\n")[1] ?? "").split("\n").filter((l) => /^\S.*:/.test(l));
    assert.deepEqual(
      keys.map((l) => l.split(":")[0]),
      ["name", "description", "license", "model", "tools", "metadata"],
    );
    assert.match(claude, /\nmodel: sonnet\ntools: Read, Grep, Glob\nmetadata:\n/);
    assert.match(tree.read(".github/agents/ag.md"), /\ntools: \[read, search\]\nmetadata:\n/);
  });

  test("Antigravity: no tools key, one tools-drop on standard error and in the --diagnostics file (R14)", () => {
    const tree = createFixtureTree();
    tree.config(CONFIG);
    tree.artifact("core/agents/ag/AGENT.md", agent("ag", BODY, meta("[web, read, search]")));
    const log = tree.resolve("diag.log");
    const res = tree.run(["--target", "antigravity", "--diagnostics", log]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(tree.read(".agents/agents/ag.md"), fmFile([]));
    const want = drop("antigravity", "read,search,web", "unsupported-on-cli");
    assert.deepEqual(stream(res.stderr), [want]);
    assert.deepEqual(lines(fs.readFileSync(log, "utf8")), [want]);
  });

  test("Gemini: [read, agent] lists the read names only and records the omission (R13)", () => {
    const { tree, res } = built("[read, agent]", "--target", "gemini");
    assert.equal(res.status, 0, res.stderr);
    assert.equal(
      tree.read(".gemini/agents/ag.md"),
      fmFile(["tools: [read_file, read_many_files, list_directory]"]),
    );
    assert.deepEqual(stream(res.stderr), [drop("gemini", "agent", "no-equivalent-on-cli")]);
  });

  test("Gemini: [agent] alone fails the build, no file and no empty list (R13)", () => {
    const { tree, res } = built("[agent]", "--target", "gemini");
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stderr, /^Error: .*AGENT\.md: metadata\.tools has no Gemini CLI name/m);
    assert.equal(tree.exists(".gemini/agents/ag.md"), false);
    assert.doesNotMatch(res.stderr, /tools: \[\]/);
  });

  test("a fixture agent declaring execute and edit builds for all four CLIs: the rule is the checker's (R15, R17)", () => {
    const { tree, res } = built("[read, execute, edit]");
    assert.equal(res.status, 0, res.stderr);
    assert.equal(
      tree.read(".gemini/agents/ag.md"),
      fmFile([
        "tools: [read_file, read_many_files, list_directory, write_file, replace, run_shell_command]",
      ]),
    );
    assert.equal(tree.read(".claude/agents/ag.md"), fmFile(["tools: Read, Edit, Write, Bash"]));
    assert.equal(tree.read(".github/agents/ag.md"), fmFile(["tools: [read, edit, execute]"]));
    assert.equal(tree.exists(".agents/agents/ag.md"), true);
  });

  const INVALID: ReadonlyArray<readonly [string, string, string]> = [
    ["a scalar, not a list", "read", "read"],
    ["a mapping, not a list", "{read: true}", "mapping"],
    ["an empty list", "[]", "[]"],
    ["a string outside the vocabulary", "[shell]", "shell"],
    ["a differently cased name", "[read, Read]", "Read"],
    ["a duplicate", "[read, search, read]", "read"],
    ["an empty-string element", '[read, ""]', ""],
    ["a nested list element", "[read, [search]]", ""],
  ];
  for (const [label, value, shown] of INVALID) {
    for (const target of ["all", "antigravity", "claude"]) {
      test(`${label} stops the build (--target ${target}), naming the file, the key, the value and the six classes (R10)`, () => {
        const { tree, res } = built(value, "--target", target);
        assert.equal(res.status, 1, res.stderr);
        assert.match(res.stderr, /artifacts\/core\/agents\/ag\/+AGENT\.md: metadata\.tools /);
        assert.ok(res.stderr.includes(`value: ${shown};`), res.stderr);
        assert.ok(res.stderr.includes(`the admitted classes are ${CLASSES}`), res.stderr);
        for (const d of [".claude", ".github", ".gemini", ".agents"])
          assert.equal(tree.exists(`${d}/agents/ag.md`), false, `${d} written despite the refusal`);
      });
    }
  }
});

describe("a block-scalar description is folded onto one line (issue #1956)", () => {
  test("every CLI file carries a single-line quoted description", () => {
    const tree = createFixtureTree();
    tree.config(CONFIG);
    tree.artifact(
      "core/agents/ag/AGENT.md",
      source(["name: ag", "description: |", "  First line.", "  Second line."], "Agent body.\n"),
    );
    const res = tree.run([]);
    assert.equal(res.status, 0, res.stderr + res.stdout);
    for (const file of [
      ".claude/agents/ag.md",
      ".gemini/agents/ag.md",
      ".github/agents/ag.md",
      ".agents/agents/ag.md",
    ]) {
      const out = tree.read(file);
      assert.ok(out.includes('description: "First line. Second line."\n'), `${file}:\n${out}`);
    }
  });
});
