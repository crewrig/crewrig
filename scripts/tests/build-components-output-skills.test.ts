// build-components-output-skills.test.ts — skills, commands, provenance, links, resources and
// line endings through the entry (spec 0250 R10, R12, R13, R14, R15; spec Scenarios 8, 10, 11,
// 12, 13, 14, 15; plan step 21). Expected files are written by hand from the rules of R13.

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import {
  builtFiles,
  command,
  CONFIG,
  skill,
  source,
} from "./fixtures/build-components/entry-kit.ts";

const CLAUDE_EXTRA = [
  "license: Apache-2.0",
  'compatibility: "needs node"',
  "claude:",
  "  allowed-tools:",
  "    - Read",
  "    - Bash",
  "  user-invocable: true",
  "  disable-model-invocation: false",
  "  context: fork",
  "  agent: Explore",
];

function build(files: Record<string, string>, args: string[] = [], config = CONFIG) {
  const tree = createFixtureTree();
  tree.config(config);
  for (const [rel, content] of Object.entries(files)) tree.artifact(rel, content);
  const res = tree.run(args);
  assert.equal(res.status, 0, res.stderr + res.stdout);
  return tree;
}

describe("skills (R13)", () => {
  const body =
    "Links ../../../../docs/x.md and ../../../../specs/y.md\nand ../../../../docs/a ../../../../docs/b\n";
  test("the four CLIs: the shared shape, then Claude Code's own fields; core links lose one ../", () => {
    const tree = build({ "core/skills/probe/SKILL.md": skill("probe", body, CLAUDE_EXTRA) });
    const shared = [
      "---",
      "name: probe",
      'description: "A skill."',
      "license: Apache-2.0",
      'compatibility: "needs node"',
      "---",
      "",
      "Links ../../../docs/x.md and ../../../specs/y.md",
      "and ../../../docs/a ../../../docs/b",
      "",
    ].join("\n");
    for (const dir of [".gemini", ".github", ".agents"]) {
      assert.equal(tree.read(`${dir}/skills/probe/SKILL.md`), shared, dir);
    }
    const claude = tree.read(".claude/skills/probe/SKILL.md");
    assert.equal(
      claude,
      shared.replace(
        '"needs node"\n---',
        '"needs node"\nallowed-tools:\n  - Read\n  - Bash\nuser-invocable: true\n' +
          "disable-model-invocation: false\ncontext: fork\nagent: Explore\n---",
      ),
    );
  });

  test("license, compatibility and each claude.* key are omitted when empty or null", () => {
    const tree = build({
      "core/skills/p/SKILL.md": skill("p", "B\n", [
        "license:",
        "compatibility: null",
        "claude:",
        "  context: null",
        "  agent: ''",
      ]),
    });
    assert.equal(
      tree.read(".claude/skills/p/SKILL.md"),
      '---\nname: p\ndescription: "A skill."\n---\n\nB\n',
    );
  });

  test("other tiers keep the source link as written", () => {
    const tree = build({ "library/skills/p/SKILL.md": skill("p", "see ../../../../docs/x.md\n") });
    assert.match(
      tree.read("dist/library/.claude/skills/p/SKILL.md"),
      /\.\.\/\.\.\/\.\.\/\.\.\/docs\/x\.md/,
    );
  });

  test("a number-like version is written as written, a folded description with a blank line as yq printed it (scenario 8)", () => {
    const tree = build({
      "core/skills/p/SKILL.md": source(
        [
          "name: p",
          "description: >",
          "  first line",
          "  second line",
          "",
          "  after blank",
          "metadata:",
          "  provenance:",
          "    version: 1.0",
          "    canonical: 007",
        ],
        "B\n",
      ),
    });
    const out = tree.read(".claude/skills/p/SKILL.md");
    assert.match(out, /^description: "first line second line\nafter blank"$/m);
    assert.match(out, /^ {4}version: "1\.0"$/m);
    assert.match(out, /^ {4}canonical: "007"$/m);
  });
});

describe("commands (R13)", () => {
  const files = {
    "core/commands/hello.md": command("hello", "Say hello.\n", [
      "claude:",
      "  allowed-tools:",
      "    - Read",
    ]),
  };
  test("Gemini TOML, Claude Code, Copilot and Antigravity files", () => {
    const tree = build(files);
    assert.equal(
      tree.read(".gemini/commands/hello.toml"),
      'description = "A command."\n\nprompt = """\nSay hello.\n"""\n',
    );
    assert.equal(
      tree.read(".claude/skills/hello/SKILL.md"),
      '---\nname: hello\ndescription: "A command."\nuser-invocable: true\nallowed-tools:\n  - Read\n---\n\nSay hello.\n',
    );
    assert.equal(
      tree.read(".github/skills/hello/SKILL.md"),
      '---\nname: hello\ndescription: "A command."\nallowed-tools:\n  - Read\n---\n\nSay hello.\n',
    );
    assert.equal(
      tree.read(".agents/skills/hello/SKILL.md"),
      '---\nname: hello\ndescription: "A command."\n---\n\nSay hello.\n',
    );
  });

  test("a command's body is never link-rewritten, even in core", () => {
    const tree = build({ "core/commands/c.md": command("c", "../../../../docs/x.md\n") });
    assert.match(tree.read(".github/skills/c/SKILL.md"), /\.\.\/\.\.\/\.\.\/\.\.\/docs\/x\.md/);
  });
});

describe("provenance (R12; spec Scenario 9)", () => {
  const prov = [
    "metadata:",
    "  provenance:",
    '    canonical: "${CANONICAL_REPO}"',
    '    feedback: "${FEEDBACK_REPO}"',
    '    version: "1.2.3"',
  ];
  const block =
    'metadata:\n  provenance:\n    canonical: "https://example.test/o/r"\n    feedback: "https://example.test/o/f"\n    version: "1.2.3"\n';

  test("spliced before the closing --- of a skill, a command (Claude and others), placeholders resolved after", () => {
    const tree = build({
      "core/skills/s/SKILL.md": skill("s", "B\n", prov),
      "core/commands/c.md": command("c", "B\n", prov),
    });
    for (const file of [
      ".claude/skills/s/SKILL.md",
      ".github/skills/s/SKILL.md",
      ".claude/skills/c/SKILL.md",
      ".agents/skills/c/SKILL.md",
    ]) {
      assert.ok(tree.read(file).includes(`${block}---\n`), file);
    }
    assert.equal(tree.read(".gemini/skills/s/SKILL.md").split("---\n")[1]?.endsWith(block), true);
    assert.match(
      tree.read(".gemini/commands/c.toml"),
      /^# crewrig-provenance: version="1\.2\.3" canonical="https:\/\/example\.test\/o\/r" feedback="https:\/\/example\.test\/o\/f"\ndescription = /,
    );
  });

  test("a value holding a later key's placeholder is substituted by that key", () => {
    const tree = build(
      {
        "core/skills/s/SKILL.md": skill("s", "B\n", [
          "metadata:",
          "  provenance:",
          '    canonical: "${CANONICAL_REPO}"',
        ]),
      },
      [],
      'canonical_repo = "https://example.test/o/${FEEDBACK_REPO}"\nfeedback_repo = "https://example.test/o/f"\n',
    );
    assert.match(
      tree.read(".claude/skills/s/SKILL.md"),
      /canonical: "https:\/\/example\.test\/o\/https:\/\/example\.test\/o\/f"/,
    );
  });

  test("an entry that is a mapping or a sequence refuses the build: exit 1, the source named, nothing written", () => {
    for (const shape of ["    nested:\n      a: 1", "    list:\n      - a"]) {
      const tree = createFixtureTree();
      tree.config(CONFIG);
      tree.artifact(
        "core/skills/bad/SKILL.md",
        `---\nname: bad\ndescription: d\nmetadata:\n  provenance:\n${shape}\n---\nB\n`,
      );
      const res = tree.run(["--target", "claude"]);
      assert.equal(res.status, 1);
      assert.match(
        res.stderr,
        /^Error: .*SKILL\.md: metadata\.provenance\.(nested|list) is a mapping or a sequence; /,
      );
      assert.deepEqual(builtFiles(tree), []);
    }
  });
});
