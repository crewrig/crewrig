// build-components-output.test.ts — the entry end to end in fixture trees: tier routing,
// progress lines, argument forms and symbolic links (spec 0250 R4, R9, R14; spec Scenario 13;
// plan step 21). The per-CLI file shapes are in build-components-output-skills.test.ts,
// -output-resources.test.ts and -output-agents.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import {
  agent,
  builtFiles,
  command,
  CONFIG,
  lines,
  scratch,
  skill,
  strays,
  NATIVE_PATHS,
} from "./fixtures/build-components/entry-kit.ts";

const RULE = "=".repeat(41);
const POSIX = process.platform === "win32" ? "skipped: symbolic links need privileges" : undefined;

function seeded() {
  const tree = createFixtureTree();
  tree.config(CONFIG);
  tree.artifact("core/skills/probe/SKILL.md", skill("probe"));
  tree.artifact("core/commands/hello.md", command("hello"));
  tree.artifact("core/agents/ag/AGENT.md", agent("ag"));
  tree.artifact("library/skills/lib/SKILL.md", skill("lib"));
  tree.artifact("community/skills/com/SKILL.md", skill("com"));
  return tree;
}

describe("progress lines, byte for byte (R9)", { skip: NATIVE_PATHS }, () => {
  test("a build of one CLI: banner, tier line, Building, Generated, blank line, Done.", () => {
    const tree = createFixtureTree();
    tree.config(CONFIG);
    tree.artifact("core/skills/probe/SKILL.md", skill("probe"));
    const res = tree.run(["--target", "claude"]);
    const root = tree.root;
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stderr, "");
    assert.deepEqual(lines(res.stdout), [
      RULE,
      "  Community Component Builder",
      "  Target: claude",
      "  Mode: BUILD (generate files)",
      RULE,
      "",
      `--- Tier: core (output root: ${root}) ---`,
      "Building skill: probe",
      `  Generated: ${root}/.claude/skills/probe/SKILL.md`,
      "",
      "Done.",
    ]);
  });

  test("--check on a clean tree: the CHECK banner, the same tier lines, the OK verdict last", () => {
    const tree = createFixtureTree();
    tree.config(CONFIG);
    tree.artifact("core/skills/probe/SKILL.md", skill("probe"));
    assert.equal(tree.run(["--target", "gemini"]).status, 0);
    const res = tree.run(["--target", "gemini", "--check"]);
    assert.equal(res.status, 0, res.stdout);
    assert.deepEqual(lines(res.stdout), [
      RULE,
      "  Community Component Builder",
      "  Target: gemini",
      "  Mode: CHECK (drift detection)",
      RULE,
      "",
      `--- Tier: core (output root: ${tree.root}) ---`,
      "Building skill: probe",
      "",
      "OK: All generated files match source.",
    ]);
  });

  test("a REPO_DIR with a trailing slash is printed and joined as given", () => {
    const tree = createFixtureTree();
    tree.config(CONFIG);
    tree.artifact("core/skills/probe/SKILL.md", skill("probe"));
    const res = tree.run(["--target", "claude"], { env: { REPO_DIR: `${tree.root}/` } });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`output root: ${tree.root}/\\) ---`));
    assert.match(
      res.stdout,
      new RegExp(`  Generated: ${tree.root}//\\.claude/skills/probe/SKILL.md`),
    );
  });
});

describe("tier routing (R9, ADR-0011)", () => {
  test(
    "core goes into the project tree, every other tier into dist/<tier>",
    { skip: NATIVE_PATHS },
    () => {
      const tree = seeded();
      const res = tree.run(["--target", "claude"]);
      assert.equal(res.status, 0, res.stderr);
      const files = builtFiles(tree);
      for (const expected of [
        ".claude/skills/probe/SKILL.md",
        ".claude/skills/hello/SKILL.md",
        ".claude/agents/ag.md",
        "dist/library/.claude/skills/lib/SKILL.md",
        "dist/community/.claude/skills/com/SKILL.md",
      ]) {
        assert.ok(files.includes(expected), `${expected} in ${files.join(", ")}`);
      }
      assert.ok(
        !files.includes(".claude/skills/lib/SKILL.md"),
        "a library skill never reaches the project tree",
      );
      assert.match(
        res.stdout,
        new RegExp(`--- Tier: library \\(output root: ${tree.root}/dist/library\\) ---`),
      );
    },
  );

  test(
    "--check compiles non-core tiers into a staging root, compares only core, leaves nothing",
    { skip: NATIVE_PATHS },
    () => {
      const tree = seeded();
      assert.equal(tree.run(["--target", "claude"]).status, 0);
      const before = builtFiles(tree);
      const tmp = scratch("route-");
      fs.rmSync(tree.resolve("dist"), { recursive: true });
      const res = tree.run(["--target", "claude", "--check"], { env: { TMPDIR: tmp } });
      assert.equal(res.status, 0, res.stdout + res.stderr);
      assert.match(
        res.stdout,
        new RegExp(
          `--- Tier: library \\(output root: ${tmp}/crewrig-check-staging-[A-Za-z0-9]{6}/library\\) ---`,
        ),
      );
      assert.equal(tree.exists("dist"), false, "--check never writes dist/");
      assert.deepEqual(
        builtFiles(tree),
        before.filter((f) => !f.startsWith("dist/")),
      );
      assert.deepEqual(strays(tmp), [], "the staging root is removed");
    },
  );

  test(
    "--check reports a missing and a differing core file on standard output, then fails",
    { skip: NATIVE_PATHS },
    () => {
      const tree = seeded();
      assert.equal(tree.run(["--target", "claude"]).status, 0);
      fs.rmSync(tree.resolve(".claude/skills/probe/SKILL.md"));
      tree.write(".claude/agents/ag.md", "stale\n");
      const res = tree.run(["--target", "claude", "--check"]);
      assert.equal(res.status, 1);
      const out = lines(res.stdout);
      assert.ok(
        out.includes(
          `DRIFT: ${tree.root}/.claude/skills/probe/SKILL.md does not exist (expected from source)`,
        ),
      );
      assert.ok(out.includes(`DRIFT: ${tree.root}/.claude/agents/ag.md differs from source`));
      assert.equal(
        out.at(-1),
        "FAILED: Drift detected. Run 'node scripts/build-components.ts' to regenerate.",
      );
      assert.equal(tree.read(".claude/agents/ag.md"), "stale\n", "--check writes nothing");
    },
  );

  test("an absent artifacts/ yields zero tiers and exit 0; a plain file and a dot directory are ignored", () => {
    const tree = createFixtureTree();
    tree.config(CONFIG);
    const empty = tree.run([]);
    assert.equal(empty.status, 0);
    assert.doesNotMatch(empty.stdout, /--- Tier/);
    tree.artifact("README.md", "not a tier\n");
    tree.artifact(".hidden/skills/h/SKILL.md", skill("h"));
    const res = tree.run([]);
    assert.equal(res.status, 0);
    assert.doesNotMatch(res.stdout, /--- Tier/);
    assert.deepEqual(builtFiles(tree), []);
  });

  test("tiers run in code-unit order, components in the order skills, commands, agents", () => {
    const tree = seeded();
    tree.artifact("B/skills/up/SKILL.md", skill("up"));
    const res = tree.run(["--target", "claude"]);
    const out = lines(res.stdout);
    const tierLines = out.filter((l) => l.startsWith("--- Tier:")).map((l) => l.split(" ")[2]);
    assert.deepEqual(tierLines, ["B", "community", "core", "library"]);
    const core = out.filter((l) => /^Building /.test(l));
    const coreStart = core.indexOf("Building skill: probe");
    assert.deepEqual(core.slice(coreStart, coreStart + 3), [
      "Building skill: probe",
      "Building command: hello",
      "Building agent: ag",
    ]);
  });
});

describe("--tier and --target (R4)", () => {
  test("--tier narrows, is repeatable, and an unknown name matches nothing", () => {
    const tree = seeded();
    let res = tree.run(["--target", "claude", "--tier", "library"]);
    assert.deepEqual(res.stdout.match(/^--- Tier: \w+/gm), ["--- Tier: library"]);
    res = tree.run(["--target", "claude", "--tier", "core", "--tier", "community"]);
    assert.deepEqual(res.stdout.match(/^--- Tier: \w+/gm), [
      "--- Tier: community",
      "--- Tier: core",
    ]);
    res = tree.run(["--target", "claude", "--tier", "nope"]);
    assert.equal(res.status, 0);
    assert.doesNotMatch(res.stdout, /--- Tier/);
  });

  test("each --target writes only its own CLI's trees; all writes the four", () => {
    const roots: Record<string, string> = {
      gemini: ".gemini",
      claude: ".claude",
      copilot: ".github",
      antigravity: ".agents",
    };
    for (const [target, dir] of Object.entries(roots)) {
      const tree = seeded();
      assert.equal(tree.run(["--target", target, "--tier", "core"]).status, 0);
      const tops = new Set(builtFiles(tree).map((f) => f.split("/")[0]));
      assert.deepEqual([...tops], [dir], target);
    }
    const all = seeded();
    assert.equal(all.run(["--tier", "core"]).status, 0);
    assert.deepEqual([...new Set(builtFiles(all).map((f) => f.split("/")[0]))].sort(), [
      ".agents",
      ".claude",
      ".gemini",
      ".github",
    ]);
  });

  test("an unknown --target selects no CLI: the progress lines, no file, exit 0", () => {
    const tree = seeded();
    const res = tree.run(["--target", "nope"]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /  Target: nope\n/);
    assert.match(res.stdout, /^Building skill: probe$/m);
    assert.deepEqual(builtFiles(tree), []);
  });

  test("an unrecognised argument is ignored; a value flag in final position is an Error: line", () => {
    const tree = seeded();
    const res = tree.run([
      "--bogus",
      "--target",
      "claude",
      "positional",
      "--tier",
      "core",
      "--also-bogus",
    ]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(new Set(builtFiles(tree).map((f) => f.split("/")[0])), new Set([".claude"]));
    const final = tree.run(["--target"]);
    assert.equal(final.status, 1);
    assert.equal(final.stdout, "");
    assert.equal(final.stderr, "Error: --target requires a value\n");
  });
});

describe("symbolic links (R9)", { skip: POSIX }, () => {
  test("a linked component, as the assembly suite links it, and a linked tier build", () => {
    const tree = createFixtureTree();
    tree.config(CONFIG);
    tree.write("elsewhere/dev/SKILL.md", skill("linked-skill"));
    tree.write("elsewhere/agent/AGENT.md", agent("linked-agent"));
    tree.write("elsewhere/tier/skills/in-tier/SKILL.md", skill("in-tier"));
    fs.mkdirSync(tree.resolve("artifacts/core/skills"), { recursive: true });
    fs.mkdirSync(tree.resolve("artifacts/core/agents"), { recursive: true });
    fs.symlinkSync(tree.resolve("elsewhere/dev"), tree.resolve("artifacts/core/skills/dev"));
    fs.symlinkSync(tree.resolve("elsewhere/agent"), tree.resolve("artifacts/core/agents/agent"));
    fs.symlinkSync(tree.resolve("elsewhere/tier"), tree.resolve("artifacts/linked"));
    const res = tree.run(["--target", "claude"]);
    assert.equal(res.status, 0, res.stderr);
    const files = builtFiles(tree);
    assert.ok(files.includes(".claude/skills/linked-skill/SKILL.md"), files.join(", "));
    assert.ok(files.includes(".claude/agents/linked-agent.md"));
    assert.ok(files.includes("dist/linked/.claude/skills/in-tier/SKILL.md"));
    assert.match(res.stdout, /^--- Tier: linked /m);
  });
});
