// build-components-conventions-block.test.ts — the subagent conventions block through the build
// entry (spec 0306 R6-R12, R5): the tail on all four CLIs for every tier, the head left alone,
// the Claude Code key and its position, the fragment refusals, the hand-copy refusal, the
// skills-only exemption and `--check` drift.
//
// Nothing here hard-codes an agent count, a file count or a core path: sources are built in the
// tree under test and the fragment text is read from the repository file (plan v2 step 2, v1-F5).

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

import { agent, CONFIG, skill } from "./fixtures/build-components/entry-kit.ts";
import {
  conventionsFragment,
  createFixtureTree,
  FRAGMENT_REL,
  type FixtureTree,
} from "./lib/build-fixture-tree.ts";

const F = conventionsFragment();
const HEADING = F.split("\n")[0] ?? "";
const TAIL = `\n\n${F}`;
const KEY = "omitClaudeMd: true";
const FILES = [".claude", ".gemini", ".github", ".agents"].map((d) => `${d}/agents/ag.md`);
const OTHERS = FILES.filter((f) => !f.startsWith(".claude"));
const PROV = [
  "metadata:",
  "  provenance:",
  '    canonical: "${CANONICAL_REPO}"',
  "    version: 1.0",
];

function tree(extra: readonly string[] = [], fragment = true): FixtureTree {
  const t = createFixtureTree({ fragment });
  t.config(CONFIG);
  t.artifact("core/agents/ag/AGENT.md", agent("ag", "Agent body.\n", extra));
  return t;
}

/** The frontmatter lines of a compiled file. */
function front(text: string): string[] {
  return (text.split("---\n")[1] ?? "").split("\n").filter((l) => l !== "");
}

describe("the block on every CLI and every tier (R6, R13)", () => {
  test("a core agent ends with a blank line and the fragment, byte for byte, on all four CLIs", () => {
    const t = tree();
    const res = t.run([]);
    assert.equal(res.status, 0, res.stderr);
    for (const f of FILES) {
      const text = t.read(f);
      assert.ok(text.endsWith(TAIL), `${f} ends with the block`);
      assert.equal(text.split(HEADING).length, 2, `${f} carries the heading once`);
    }
  });

  test("an agent of the library tier, staged under dist/library, gets the same tail and key", () => {
    const t = tree();
    t.artifact("library/agents/lib/AGENT.md", agent("lib"));
    const res = t.run([]);
    assert.equal(res.status, 0, res.stderr);
    for (const d of [".claude", ".gemini", ".github", ".agents"]) {
      const text = t.read(`dist/library/${d}/agents/lib.md`);
      assert.ok(text.endsWith(TAIL), `dist/library/${d}`);
      assert.equal(text.includes(KEY), d === ".claude", `${d}: key only on Claude Code`);
    }
  });

  test("a source body with extra trailing line feeds still yields exactly one blank line", () => {
    const t = createFixtureTree();
    t.config(CONFIG);
    t.artifact("core/agents/ag/AGENT.md", agent("ag", "Agent body.\n\n\n\n"));
    assert.equal(t.run([]).status, 0);
    for (const f of FILES) assert.ok(t.read(f).endsWith(`Agent body.${TAIL}`), f);
  });

  test("the block appears in no skill and no command output", () => {
    const t = tree();
    t.artifact("core/skills/sk/SKILL.md", skill("sk"));
    assert.equal(t.run([]).status, 0);
    assert.equal(t.read(".claude/skills/sk/SKILL.md").includes(HEADING), false);
  });

  test("editing the fragment once and rebuilding moves every file with no source edit", () => {
    const t = tree();
    t.artifact("library/agents/lib/AGENT.md", agent("lib"));
    assert.equal(t.run([]).status, 0);
    const next = `${F.replace(/\n$/, "")}\n7. **A seventh rule.**\n`;
    t.write(FRAGMENT_REL, next);
    assert.equal(t.run([]).status, 0);
    for (const f of [
      ...FILES,
      ...[".claude", ".gemini", ".github", ".agents"].map((d) => `dist/library/${d}/agents/lib.md`),
    ])
      assert.ok(t.read(f).endsWith(`\n\n${next}`), f);
  });
});

describe("nothing before the block changes (R7)", () => {
  test("the head of each file is the pre-change output, provenance included", () => {
    const t = tree(PROV);
    assert.equal(t.run([]).status, 0);
    assert.equal(
      t.read(".gemini/agents/ag.md"),
      '---\nname: ag\ndescription: "An agent."\n---\n' +
        '<!-- crewrig-provenance: version="1.0" canonical="https://example.test/o/r" feedback="" -->\nAgent body.\n' +
        `\n${F}`,
    );
    for (const f of [".github/agents/ag.md", ".agents/agents/ag.md"])
      assert.equal(
        t.read(f),
        '---\nname: ag\ndescription: "An agent."\nmetadata:\n  provenance:\n    canonical: "https://example.test/o/r"\n    version: "1.0"\n---\n\nAgent body.\n' +
          `\n${F}`,
        f,
      );
  });
});

describe("the Claude Code key (R8, R9)", () => {
  const withTools = ["license: MIT", "claude:", "  allowed-tools:", "    - Read", "    - Bash"];

  test("after tools and before the metadata block, exactly once", () => {
    const t = tree(["metadata:", "  tools: [read, search]", "  provenance:", '    canonical: "x"']);
    assert.equal(t.run([]).status, 0);
    const text = t.read(".claude/agents/ag.md");
    assert.match(text, /\ntools: Read, Grep, Glob\nomitClaudeMd: true\nmetadata:\n/);
    assert.equal(front(text).filter((l) => l === KEY).length, 1);
    assert.equal(text.split(KEY).length, 2);
  });

  test("with no tools, after the license line", () => {
    const t = tree(["license: MIT"]);
    assert.equal(t.run([]).status, 0);
    assert.equal(
      t.read(".claude/agents/ag.md"),
      `---\nname: ag\ndescription: "An agent."\nlicense: MIT\n${KEY}\n---\n\nAgent body.\n\n${F}`,
    );
  });

  test("with neither tools nor license, the last frontmatter line before the closing fence", () => {
    const t = tree();
    assert.equal(t.run([]).status, 0);
    const lines = front(t.read(".claude/agents/ag.md"));
    assert.equal(lines[lines.length - 1], KEY);
  });

  test("it is the last line assembled: with tools and a provenance block it still precedes metadata", () => {
    const t = tree([...withTools, ...PROV]);
    assert.equal(t.run([]).status, 0);
    const keys = front(t.read(".claude/agents/ag.md")).filter((l) => /^\S.*:/.test(l));
    const names = keys.map((l) => l.split(":")[0]);
    assert.equal(names.indexOf("omitClaudeMd"), names.indexOf("metadata") - 1);
  });

  test("Gemini, Copilot and Antigravity files carry no omitClaudeMd key anywhere", () => {
    const t = tree([...withTools, ...PROV]);
    assert.equal(t.run([]).status, 0);
    for (const f of OTHERS) assert.equal(t.read(f).includes("omitClaudeMd"), false, f);
  });
});

describe("a fragment the build refuses (R10)", () => {
  const long = (n: number): string => `## T\n${"x".repeat(n - 6)}\n`;
  const CASES: ReadonlyArray<readonly [string, string | null, RegExp]> = [
    ["missing", null, /missing|not found|no such|ENOENT|cannot read/i],
    ["empty", "", /empty/i],
    ["a frontmatter block", "---\ntitle: x\n---\n## T\n", /heading|frontmatter|##/i],
    ["a level-1 heading", "# T\nbody\n", /heading|##/i],
    ["1,501 characters", long(1501), /1,?500|ceiling|exceed|too (long|large)/i],
    ["a ${KEY} placeholder", "## T\nsee ${X}\n", /\$\{|placeholder/i],
    ["a line that is exactly ---", "## T\nbody\n---\nmore\n", /---|fence|frontmatter/i],
    ["a provenance comment with a space", "## T\n<!-- provenance: x -->\n", /provenance/i],
    ["a provenance comment without a space", "## T\n<!--provenance: x -->\n", /provenance/i],
    ["a crewrig-provenance comment", "## T\n<!-- crewrig-provenance: v -->\n", /provenance/i],
    ["CRLF line endings", "## T\r\nbody\r\n", /CRLF|line ending|\\r|carriage/i],
  ];

  for (const [label, content, rule] of CASES) {
    test(`${label}: non-zero, names the fragment and the rule, writes no agent file`, () => {
      const t = tree([], false);
      if (content !== null) t.write(FRAGMENT_REL, content);
      const res = t.run([]);
      assert.notEqual(res.status, 0, res.stdout);
      assert.ok(res.stderr.includes(FRAGMENT_REL), `names the fragment: ${res.stderr}`);
      assert.match(res.stderr, rule);
      for (const f of FILES) assert.equal(t.exists(f), false, `${f} written despite the refusal`);
    });
  }

  test("the ceiling is inclusive: a 1,500-character fragment builds", () => {
    const t = tree([], false);
    t.write(FRAGMENT_REL, long(1500));
    const res = t.run([]);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(t.read(".claude/agents/ag.md").endsWith(`\n\n${long(1500)}`));
  });

  test("an invalid fragment stops a --target run of any single CLI that emits agents", () => {
    for (const target of ["claude", "gemini", "copilot", "antigravity"]) {
      const t = tree([], false);
      t.write(FRAGMENT_REL, "");
      assert.notEqual(t.run(["--target", target]).status, 0, target);
    }
  });
});

describe("a build that emits no agent never reads the fragment (R10)", () => {
  test("skills only, the fragment path being a directory: exit 0 and the skills are written", () => {
    const t = createFixtureTree({ fragment: false });
    t.config(CONFIG);
    t.artifact("core/skills/sk/SKILL.md", skill("sk"));
    t.artifact("library/skills/sk2/SKILL.md", skill("sk2"));
    fs.mkdirSync(t.resolve(FRAGMENT_REL), { recursive: true });
    const res = t.run([]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(t.exists(".claude/skills/sk/SKILL.md"), true);
  });

  test("--tier on a tier with no agent: exit 0 although the fragment is invalid", () => {
    const t = tree([], false);
    t.write(FRAGMENT_REL, "");
    t.artifact("library/skills/sk/SKILL.md", skill("sk"));
    const res = t.run(["--tier", "library"]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(t.exists("dist/library/.claude/skills/sk/SKILL.md"), true);
  });
});

describe("a hand copy of the block in a source (R11)", () => {
  test("names the source, exits non-zero and writes nothing for that agent", () => {
    const t = createFixtureTree();
    t.config(CONFIG);
    t.artifact("core/agents/ag/AGENT.md", agent("ag", `Intro.\n\n${HEADING}\n\ncopied rules\n`));
    const res = t.run([]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /artifacts\/core\/agents\/ag\/+AGENT\.md/);
    for (const f of FILES) assert.equal(t.exists(f), false, f);
  });

  test("the heading text inside a longer line is not a copy", () => {
    const t = createFixtureTree();
    t.config(CONFIG);
    t.artifact("core/agents/ag/AGENT.md", agent("ag", `See also ${HEADING} in the docs.\n`));
    assert.equal(t.run([]).status, 0);
  });
});

describe("--check reports stale blocks as drift (R12)", () => {
  test("a freshly built tree is clean", () => {
    const t = tree();
    assert.equal(t.run([]).status, 0);
    assert.equal(t.run(["--check"]).status, 0);
  });

  test("a fragment edit without a rebuild is DRIFT on every agent file", () => {
    const t = tree();
    assert.equal(t.run([]).status, 0);
    t.write(FRAGMENT_REL, `${F.replace(/\n$/, "")}\nExtra line.\n`);
    const res = t.run(["--check"]);
    assert.equal(res.status, 1);
    for (const f of FILES)
      assert.match(res.stdout, new RegExp(`DRIFT: .*${f.replace(".", "\\.")}`));
  });

  test("a hand-trimmed tail is DRIFT on that file only", () => {
    const t = tree();
    assert.equal(t.run([]).status, 0);
    t.write(".gemini/agents/ag.md", t.read(".gemini/agents/ag.md").slice(0, -TAIL.length) + "\n");
    const res = t.run(["--check"]);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /DRIFT: .*\.gemini\/agents\/ag\.md/);
    assert.doesNotMatch(res.stdout, /DRIFT: .*\.claude\/agents\/ag\.md/);
  });

  test("a missing omitClaudeMd key is DRIFT on the Claude Code file", () => {
    const t = tree();
    assert.equal(t.run([]).status, 0);
    t.write(".claude/agents/ag.md", t.read(".claude/agents/ag.md").replace(`${KEY}\n`, ""));
    const res = t.run(["--check"]);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /DRIFT: .*\.claude\/agents\/ag\.md/);
  });
});

describe("the fragments zone is not a component (R5)", () => {
  test("a build writes nothing named after the fragments directory", () => {
    const t = tree();
    assert.equal(t.run([]).status, 0);
    for (const d of [".claude", ".gemini", ".github", ".agents"])
      for (const sub of ["skills", "commands", "agents"])
        assert.equal(t.exists(`${d}/${sub}/fragments`), false, `${d}/${sub}/fragments`);
  });
});
