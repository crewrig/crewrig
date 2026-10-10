// manage-descriptors.test.ts — pins the four descriptors against the shell scripts (spec 0255 R6, plan step 9).
//
// The assertions read the text of scripts/manage-*-component.sh in the test itself, so a value that
// drifts in either the descriptor or the script is red. This is a test, not an oracle retarget:
// the scripts stay the source of the values until the migration lands.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { ANTIGRAVITY, CLAUDE, COPILOT, GEMINI } from "../lib/manage/descriptors.ts";
import { normaliseType } from "../lib/manage/normalise.ts";
import type { CliDescriptor } from "../lib/manage/types.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (d: CliDescriptor): string =>
  fs.readFileSync(path.join(repo, "scripts", d.script), "utf8");
const all = [CLAUDE, GEMINI, COPILOT, ANTIGRAVITY];

/** The `case "$TYPE"` block that follows the normalisation comment: `singular) TYPE="plural" ;;`. */
function shellAliases(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/^\s+([a-z-]+)\)\s+TYPE="([a-z-]+)"\s*;;$/gm))
    out[m[1] ?? ""] = m[2] ?? "";
  return out;
}

/** Every `component_set_staging_roots "<arg>"` call in script order. */
const stagingArgs = (text: string): string[] =>
  [...text.matchAll(/component_set_staging_roots "([^"]+)"/g)].map((m) => m[1] ?? "");
const artifactArgs = (text: string): string[] =>
  [...text.matchAll(/component_set_artifact_roots "([^"]+)"/g)].map((m) => m[1] ?? "");
const prompts = (text: string): boolean => /read -p "Continue\? \[y\/N\] "/.test(text);

describe("descriptors against the shell scripts", () => {
  for (const d of all) {
    const text = read(d);
    describe(d.cli, () => {
      test("the types line is the one printed by the usage and the unknown-type error", () => {
        const lines = [...text.matchAll(/^\s*echo "Types: ([^"\n]+)"$/gm)].map((m) => m[1]);
        assert.ok(lines.length >= 1, "no Types: line found");
        for (const l of lines) assert.equal(l, d.typesLine);
        assert.equal(lines.length, d.unknownType.listsTypes ? 2 : 1);
      });

      test("the aliases are the normalisation case, in order", () => {
        assert.deepEqual(shellAliases(text), { ...d.aliases });
        assert.deepEqual(Object.keys(shellAliases(text)), Object.keys(d.aliases));
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
          [...new Set(stagingArgs(text))].sort(),
          [...new Set(staged.map((t) => t.rootArg))].sort(),
        );
        const authored = d.types.filter((t) => t.root === "artifact" && d.cli !== "gemini");
        for (const t of authored) assert.ok(artifactArgs(text).includes(t.rootArg), t.name);
      });

      test("the link prompt exists exactly where the script reads a key", () => {
        assert.equal(prompts(text), d.linkPrompt);
        assert.equal(d.defaultMode, "install");
        assert.match(text, /MODE="\$\{1:-install\}"/);
      });

      test("the link warning lines are the script's", () => {
        const body = d.linkWarning.map((l) => `  echo "${l}"`).join("\n");
        assert.ok(text.includes(body), "link warning text diverges");
      });

      test("the home is the script's HOME-relative home variable", () => {
        const m =
          /^(?:CLAUDE_HOME|COPILOT_HOME|ANTIGRAVITY_HOME|GEMINI_HOME)="\$\{HOME\}\/([^"]+)"$/m.exec(
            text,
          );
        assert.equal(m?.[1], d.home);
      });
    });
  }
});

describe("destinations", () => {
  test("claude", () => {
    const t = read(CLAUDE);
    assert.match(t, /DEST="\$CLAUDE_HOME\/skills"/);
    assert.match(t, /DEST="\$CLAUDE_HOME\/rules"/);
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
    assert.match(read(COPILOT), /DEST="\$COPILOT_HOME\/skills"/);
    assert.match(read(COPILOT), /^\s*skills\|commands\)$/m);
    assert.deepEqual(
      COPILOT.types.map((x) => [x.name, x.dest, x.rootArg]),
      [
        ["skills", ".copilot/skills", ".github/skills"],
        ["commands", ".copilot/skills", ".github/skills"],
        ["mcp-servers", null, "mcp-servers"],
      ],
    );
    assert.deepEqual(COPILOT.refused, ["agents"]);
    assert.match(read(COPILOT), /^\s*agents\)$/m);
    assert.match(read(COPILOT), /config_file="\$COPILOT_HOME\/mcp-config.json"/);
    assert.deepEqual(COPILOT.mcp, {
      kind: "json",
      file: ".copilot/mcp-config.json",
      initial: '{"mcpServers":{}}\n',
    });
  });

  test("antigravity: skills in the customization root, policies and settings under ANTIGRAVITY_HOME", () => {
    const t = read(ANTIGRAVITY);
    assert.match(t, /^AGY_CUSTOMIZATION_ROOT="\$\{HOME\}\/\.gemini\/config"$/m);
    assert.equal(ANTIGRAVITY.customizationRoot, ".gemini/config");
    assert.match(t, /DEST="\$AGY_CUSTOMIZATION_ROOT\/skills"/);
    assert.match(t, /DEST="\$ANTIGRAVITY_HOME\/rules"/);
    assert.match(t, /config_file="\$ANTIGRAVITY_HOME\/settings.json"/);
    assert.match(t, /migrate_antigravity_superseded_components/);
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
    const t = read(GEMINI);
    assert.match(t, /^\s*commands\|skills\|hooks\|agents\|policies\)$/m);
    assert.match(t, /DEST="\$GEMINI_HOME\/\$TYPE"/);
    assert.match(
      t,
      /skills\) component_set_staging_roots "\.gemini\/skills"; REFRESH_CLI="gemini"/,
    );
    assert.match(
      t,
      /agents\) component_set_staging_roots "\.gemini\/agents"; REFRESH_CLI="gemini"/,
    );
    assert.match(t, /^\s*mcp-servers\|themes\)$/m);
    assert.match(t, /KEY="mcpServers"/);
    assert.match(t, /\[ "\$TYPE" = "themes" \] && KEY="themes"/);
    assert.match(t, /settings_file="\$GEMINI_HOME\/settings.json"/);
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
    assert.match(read(CLAUDE), /claude mcp add --scope user/);
    assert.deepEqual(
      all.map((d) => d.mcp.kind),
      ["spawn", "json", "json", "json"],
    );
  });
});
