// manage-descriptors.test.ts — pins the four descriptors against goldens of the shell facts (spec 0255 R6, plan step 9).
//
// The manage-*-component.sh scripts are forwarding shims since PR E, so the facts the descriptors
// were pinned against (echo lines, case arms, root arguments, markers) are committed goldens under
// scripts/tests/fixtures/manage-shell-facts/, extracted from the scripts at
// origin/release/1231-ts-migration before the switch. A descriptor that drifts from them is red.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { ANTIGRAVITY, CLAUDE, COPILOT, GEMINI } from "../lib/manage/descriptors.ts";
import { normaliseType } from "../lib/manage/normalise.ts";
import type { CliDescriptor } from "../lib/manage/types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const all = [CLAUDE, GEMINI, COPILOT, ANTIGRAVITY];

/** The golden of a descriptor's script: `key: value` lines, `#` lines are comments. */
class Facts {
  readonly rows: [string, string][] = [];
  constructor(d: CliDescriptor) {
    const name = d.script.replace(/^manage-(.+)-component\.sh$/, "$1");
    const file = path.join(here, "fixtures", "manage-shell-facts", `${name}.facts.golden`);
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const at = line.indexOf(": ");
      if (line !== "" && !line.startsWith("#") && at > 0)
        this.rows.push([line.slice(0, at), line.slice(at + 2)]);
    }
  }
  all(key: string): string[] {
    return this.rows.filter((r) => r[0] === key).map((r) => r[1]);
  }
  has(key: string, value: string): boolean {
    return this.all(key).includes(value);
  }
  /** The `case "$TYPE"` arms `singular) TYPE="plural"`, in script order. */
  aliases(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const v of this.all("alias")) {
      const [s, p] = v.split(" -> ");
      out[s ?? ""] = p ?? "";
    }
    return out;
  }
}
const facts = (d: CliDescriptor): Facts => new Facts(d);
const marker = (f: Facts, text: string): void => assert.ok(f.has("marker", text), text);

describe("descriptors against the shell-fact goldens", () => {
  for (const d of all) {
    const f = facts(d);
    describe(d.cli, () => {
      test("the types line is the one printed by the usage and the unknown-type error", () => {
        const lines = f.all("types-echo");
        assert.ok(lines.length >= 1, "no Types: line found");
        for (const l of lines) assert.equal(l, d.typesLine);
        assert.equal(lines.length, d.unknownType.listsTypes ? 2 : 1);
      });

      test("the aliases are the normalisation case, in order", () => {
        assert.deepEqual(f.aliases(), { ...d.aliases });
        assert.deepEqual(Object.keys(f.aliases()), Object.keys(d.aliases));
      });

      test("every alias normalises, a plural and an unknown word pass through", () => {
        for (const [s, p] of Object.entries(d.aliases)) assert.equal(normaliseType(d, s), p);
        assert.equal(normaliseType(d, d.types[0]?.name ?? ""), d.types[0]?.name);
        assert.equal(normaliseType(d, "toString"), "toString");
        assert.equal(normaliseType(d, ""), "");
      });

      test("the staging and artifact roots are the arguments of the shell calls", () => {
        const staged = d.types.filter((t) => t.root === "staging");
        // Copilot declares one root for two types, so compare the set of distinct arguments.
        assert.deepEqual(
          [...new Set(f.all("staging-root"))].sort(),
          [...new Set(staged.map((t) => t.rootArg))].sort(),
        );
        const authored = d.types.filter((t) => t.root === "artifact" && d.cli !== "gemini");
        for (const t of authored) assert.ok(f.all("artifact-root").includes(t.rootArg), t.name);
      });

      test("the link prompt exists exactly where the script reads a key", () => {
        assert.equal(f.all("prompt")[0] === "true", d.linkPrompt);
        assert.equal(d.defaultMode, "install");
        assert.deepEqual(f.all("mode-default"), ["true"]);
      });

      test("the link warning lines are the script's", () => {
        const body = d.linkWarning.join("\n");
        assert.ok(f.all("link-warning").join("\n").includes(body), "link warning text diverges");
      });

      test("the home is the script's HOME-relative home variable", () => {
        assert.deepEqual(f.all("home"), [d.home]);
      });
    });
  }
});

describe("destinations", () => {
  test("claude", () => {
    const t = facts(CLAUDE);
    marker(t, 'DEST="$CLAUDE_HOME/skills"');
    marker(t, 'DEST="$CLAUDE_HOME/rules"');
    assert.deepEqual(
      CLAUDE.types.map((x) => [x.name, x.dest]),
      [
        ["claude-skills", ".claude/skills"],
        ["policies", ".claude/rules"],
        ["mcp-servers", null],
      ],
    );
  });

  test("copilot: skills and commands share one landing zone and one staging root", () => {
    marker(facts(COPILOT), 'DEST="$COPILOT_HOME/skills"');
    marker(facts(COPILOT), "skills|commands)");
    assert.deepEqual(
      COPILOT.types.map((x) => [x.name, x.dest, x.rootArg]),
      [
        ["skills", ".copilot/skills", ".github/skills"],
        ["commands", ".copilot/skills", ".github/skills"],
        ["mcp-servers", null, "mcp-servers"],
      ],
    );
    assert.deepEqual(COPILOT.refused, ["agents"]);
    marker(facts(COPILOT), "agents)");
    marker(facts(COPILOT), 'config_file="$COPILOT_HOME/mcp-config.json"');
    assert.deepEqual(COPILOT.mcp, {
      kind: "json",
      file: ".copilot/mcp-config.json",
      initial: '{"mcpServers":{}}\n',
    });
  });

  test("antigravity: skills in the customization root, policies and settings under ANTIGRAVITY_HOME", () => {
    const t = facts(ANTIGRAVITY);
    marker(t, 'AGY_CUSTOMIZATION_ROOT="${HOME}/.gemini/config"');
    assert.equal(ANTIGRAVITY.customizationRoot, ".gemini/config");
    marker(t, 'DEST="$AGY_CUSTOMIZATION_ROOT/skills"');
    marker(t, 'DEST="$ANTIGRAVITY_HOME/rules"');
    marker(t, 'config_file="$ANTIGRAVITY_HOME/settings.json"');
    marker(t, "migrate_antigravity_superseded_components");
    assert.deepEqual(
      ANTIGRAVITY.types.map((x) => [x.name, x.dest, x.migratesSuperseded ?? false]),
      [
        ["antigravity-skills", ".gemini/config/skills", true],
        ["policies", ".gemini/antigravity-cli/rules", false],
        ["mcp-servers", null, false],
      ],
    );
    assert.deepEqual(ANTIGRAVITY.mcp, {
      kind: "json",
      file: ".gemini/antigravity-cli/settings.json",
      initial: '{"mcpServers":{}}\n',
    });
  });

  test("gemini: five types land under GEMINI_HOME/<type>; two staged, two merged", () => {
    const t = facts(GEMINI);
    marker(t, "commands|skills|hooks|agents|policies)");
    marker(t, 'DEST="$GEMINI_HOME/$TYPE"');
    marker(t, 'skills) component_set_staging_roots ".gemini/skills"; REFRESH_CLI="gemini"');
    marker(t, 'agents) component_set_staging_roots ".gemini/agents"; REFRESH_CLI="gemini"');
    marker(t, "mcp-servers|themes)");
    marker(t, 'KEY="mcpServers"');
    marker(t, '[ "$TYPE" = "themes" ] && KEY="themes"');
    marker(t, 'settings_file="$GEMINI_HOME/settings.json"');
    const dests = GEMINI.types.map((x) => [x.name, x.dest, x.root]);
    for (const n of ["commands", "skills", "hooks", "agents", "policies"])
      assert.ok(
        dests.some((d) => d[0] === n && d[1] === `.gemini/${n}`),
        n,
      );
    assert.deepEqual(
      GEMINI.types.filter((x) => x.root === "staging").map((x) => x.name),
      ["skills", "agents"],
    );
    assert.deepEqual(
      GEMINI.types.filter((x) => x.action === "mcp").map((x) => [x.name, x.mcpKey]),
      [
        ["mcp-servers", "mcpServers"],
        ["themes", "themes"],
      ],
    );
    assert.deepEqual(GEMINI.mcp, { kind: "json", file: ".gemini/settings.json", initial: "{}\n" });
  });

  test("claude registers through a spawn; the others merge JSON", () => {
    assert.deepEqual(CLAUDE.mcp, { kind: "spawn" });
    marker(facts(CLAUDE), "claude mcp add --scope user");
    assert.deepEqual(
      all.map((d) => d.mcp.kind),
      ["spawn", "json", "json", "json"],
    );
  });
});
