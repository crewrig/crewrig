// setup-cli-claude-gemini.test.ts — the Claude and Gemini descriptors (spec 0256 requirements 3 and
// 6, plan v2 step B3b.1): every field is compared with the text of the shell script it was copied
// from, read at test time, with vacuity guards (a marker that is not found fails, never passes).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { claudeDescriptor } from "../lib/setup/cli-claude.ts";
import { geminiDescriptor } from "../lib/setup/cli-gemini.ts";
import type { Cli } from "../lib/setup/context.ts";
import type { PickKind, SetupDescriptor, StepId } from "../lib/setup/descriptor.ts";
import { cancelClassOf, PROMPT_INVENTORY } from "../lib/setup/prompt-ids.ts";
import { checkIdentity } from "../lib/setup/prerequisites.ts";
import { agySteps } from "../lib/setup/steps-agy.ts";
import { hooksSteps } from "../lib/setup/steps-hooks.ts";
import { mcpSteps } from "../lib/setup/steps-mcp.ts";
import { rulesSteps } from "../lib/setup/steps-rules.ts";
import { tierSteps } from "../lib/setup/steps-tiers.ts";
import { usageSteps } from "../lib/setup/steps-usage.ts";
import { commonSteps } from "../lib/setup/steps.ts";
import { summarySteps } from "../lib/setup/summary.ts";
import {
  ASKS,
  ASKS_MCP,
  at,
  dirOf,
  escape,
  has,
  markers,
  shellOf,
} from "./setup-cli-claude-gemini-fixtures.ts";

type Cell = readonly [Cli, SetupDescriptor, string, string];
// [cli, descriptor, home variable, rules variable] of each shell script.
const CELLS: readonly Cell[] = [
  ["claude", claudeDescriptor, "CLAUDE_HOME", "CLAUDE_RULES"],
  ["gemini", geminiDescriptor, "GEMINI_HOME", "GEMINI_HOME"],
];

for (const [cli, d, homeVar, rulesVar] of CELLS) {
  describe(`${cli} descriptor against setup-${cli}-interactive.sh`, () => {
    const shell = shellOf(cli);

    it("the banner, the cli and the link question", () => {
      assert.equal(d.cli, cli);
      at(shell, new RegExp(escape(`echo "  ${d.banner}"`)), "banner");
      assert.equal(d.steps.includes("link-confirm"), has(shell, "Continue with symlink mode?"));
      assert.ok(d.steps.includes("link-confirm"));
    });

    it("the step order is the order of the markers in the shell", () => {
      const table = markers(cli, d);
      const found: [number, StepId][] = [];
      for (const [id, pattern] of Object.entries(table) as [StepId, RegExp | undefined][]) {
        if (pattern !== undefined) found.push([at(shell, pattern, id), id]);
      }
      const byShell = found.sort((a, b) => a[0] - b[0]).map(([, id]) => id);
      assert.deepEqual(d.steps, byShell);
      assert.equal(new Set(d.steps).size, d.steps.length);
      // The two known deviations of the order from the other CLIs, pinned from the shell.
      assert.equal(d.steps.includes("prerequisites"), cli === "claude");
      if (cli === "claude") {
        assert.ok(d.steps.indexOf("prerequisites") > d.steps.indexOf("link-confirm"));
      }
      assert.ok(d.steps.indexOf("rules-selection") > d.steps.indexOf("mcp"));
    });

    it("the homes", () => {
      const home = new RegExp(`^${homeVar}="\\$\\{HOME\\}/(\\.[a-z]+)"$`, "m").exec(shell);
      assert.ok(home, "home assignment not found");
      assert.equal(d.homes.cliHome, home[1]);
      const rules = rulesVar === homeVar ? d.homes.cliHome : `${d.homes.cliHome}/rules`;
      assert.equal(d.homes.rulesDir, rules);
      if (rulesVar !== homeVar)
        at(shell, new RegExp(`^${rulesVar}="\\$\\{${homeVar}\\}/rules"$`, "m"), "rules");
      assert.ok(has(shell, `SKILLS_HOME="$${homeVar}/skills"`));
      assert.equal(d.homes.skillsDir, `${d.homes.cliHome}/skills`);
      assert.ok(has(shell, `AGENTS_HOME="$${homeVar}/agents"`));
      assert.equal(d.homes.agentsDir, `${d.homes.cliHome}/agents`);
      assert.ok(has(shell, `SETTINGS_TARGET="$${homeVar}/settings.json"`));
      assert.equal(d.homes.settings, `${d.homes.cliHome}/settings.json`);
      assert.equal(d.hooks.file, d.homes.settings);
      if (cli === "claude") {
        assert.ok(has(shell, 'CLAUDE_USER_CONFIG="$HOME/.claude.json"'));
        assert.equal(d.homes.mcpConfig, ".claude.json");
      } else assert.equal(d.homes.mcpConfig, undefined);
      assert.ok(has(shell, `dist/$tier/${d.homes.cliHome}`), "tier staging");
    });

    it("the rule files, their sources and their labels", () => {
      const placed = [
        ...d.rules.shared.filter((r) => r.src !== d.rules.store.src),
        d.rules.profile.file,
      ];
      assert.ok(placed.length >= 5);
      for (const rule of placed) {
        assert.ok(has(shell, `"$REPO_DIR/${rule.src}"`), `source ${rule.src}`);
        assert.ok(has(shell, `"$${rulesVar}/${rule.dest}"`), rule.dest);
        assert.ok(has(shell, `"${rule.label}"`), `label ${rule.label}`);
      }
      assert.ok(has(shell, `"$REPO_DIR/${d.rules.store.src}" "$HOME/${d.rules.store.dest}"`));
      assert.ok(has(shell, `"${d.rules.store.label}"`));
      assert.ok(has(shell, `TARGET="$${rulesVar}/${d.rules.profile.file.dest}"`));
      assert.ok(has(shell, `"${d.rules.profile.file.label} (backup saved as .ori)"`));
      assert.equal(d.rules.profile.mode, "method");
      // The shared order is the order of the labels in the shell, the store included.
      const positions = d.rules.shared.map((r) =>
        at(shell, new RegExp(escape(`"${r.label}"`)), r.label),
      );
      assert.deepEqual(
        [...positions].sort((a, b) => a - b),
        positions,
      );
      // Only the org rules are optional, and only when the shell guards them.
      for (const r of d.rules.shared)
        assert.equal(r.optional === true, has(shell, `if [ -f "$REPO_DIR/${r.src}" ]`));
      assert.equal(has(shell, "66_ORG_RULES.md"), cli === "gemini");
    });

    it("the selections: pick order, files, labels and markers", () => {
      const kinds: readonly PickKind[] = ["team", "expertise", "level"];
      const order = [...kinds].sort(
        (a, b) =>
          at(shell, new RegExp(`pick_catalogue_entry "\\$REPO_DIR/config/${dirOf(a)}" "${a}"`), a) -
          at(shell, new RegExp(`pick_catalogue_entry "\\$REPO_DIR/config/${dirOf(b)}" "${b}"`), b),
      );
      assert.deepEqual(d.rules.pickOrder, order);
      for (const kind of kinds) {
        const sel = d.rules.selections[kind];
        const upper = kind.toUpperCase();
        assert.equal(sel.src, `config/${dirOf(kind)}`);
        assert.ok(
          has(shell, `"$REPO_DIR/${sel.src}/\${${upper}}.md" "$${rulesVar}/${sel.dest}"`),
          kind,
        );
        assert.ok(has(shell, `"${sel.label.replace("{name}", `\${${upper}}`)}"`), `label ${kind}`);
        assert.ok(has(shell, `> "$${homeVar}/.selected_${kind}"`), `marker ${kind}`);
      }
    });

    it("the existing-files texts and glob", () => {
      const { texts, existingGlob } = d.rules;
      assert.ok(has(shell, `-name "${existingGlob}"`));
      assert.ok(has(shell, `echo "${texts["existingFound"]} $${rulesVar}:"`));
      assert.ok(has(shell, `--header "${texts["actionHeader"]}"`));
      assert.ok(has(shell, `echo "${texts["keptMessage"]}"`));
      assert.ok(has(shell, `echo "${texts["removedMessage"]}"`));
      assert.ok(has(shell, `echo "${d.rules.sharedHeader}"`));
    });

    it("the identity invocations come from the cli of the context", () => {
      assert.ok(
        has(
          shell,
          'check_finalized "$REPO_DIR/config/SOUL.md"    "config/SOUL.md"    "/init-soul"',
        ),
      );
      assert.ok(has(shell, '"config/PROFILE.md" "/init-personal-profile"'));
      const template = /is missing — run: (\w+) \$skill"/.exec(shell);
      assert.ok(template, "invocation template not found");
      const lines: string[] = [];
      const repo = fs.mkdtempSync(path.join(os.tmpdir(), "setup-cli-id-"));
      try {
        const io = {
          out: (l: string) => void lines.push(l),
          err: () => undefined,
          errRaw: () => undefined,
        };
        assert.throws(() =>
          checkIdentity({ io, env: {}, platform: process.platform, repoDir: repo, cli }),
        );
      } finally {
        fs.rmSync(repo, { recursive: true, force: true });
      }
      assert.ok(lines.includes(`  - config/SOUL.md is missing — run: ${template[1]} /init-soul`));
      assert.ok(
        lines.includes(
          `  - config/PROFILE.md is missing — run: ${template[1]} /init-personal-profile`,
        ),
      );
      assert.equal(template[1], cli);
    });

    it("the hooks data", () => {
      assert.equal(d.hooks.channel, "settings");
      assert.ok(has(shell, `HOOKS_SRC="$REPO_DIR/${d.hooks.src}"`));
      assert.ok(
        has(
          shell,
          `report_unused_transcript_copy "$${homeVar}/${d.hooks.unusedCopy.slice(d.homes.cliHome.length + 1)}"`,
        ),
      );
      assert.equal(d.hooks.envPatch, has(shell, "ENV_PATCH="));
      assert.equal(d.hooks.leadingBlank, /^echo ""\nguard_rewrite_installed /m.test(shell));
    });

    it("the strategies and the tiers", () => {
      assert.deepEqual(d.strategies, {
        mcp: `${cli}Mcp`,
        tiers: "standard",
        usageCapture: "settings",
      });
      assert.ok(has(shell, `ensure_tier_built "$REPO_DIR" ${cli} `));
      assert.ok(has(shell, `usage_capture_apply ${cli} "$SETTINGS_TARGET"`));
    });

    it("the summary spec", () => {
      const s = d.summary;
      assert.ok(has(shell, `echo "${s.listHeader}"`));
      assert.ok(has(shell, `"$${rulesVar}"/${s.listGlob} `), "list glob");
      assert.ok(has(shell, `echo "${s.mcpHeader}"`));
      assert.equal(s.mcpSource, cli === "claude" ? "claude-mcp-list" : "settings.json");
      assert.ok(
        has(
          shell,
          cli === "claude"
            ? "claude mcp list 2>/dev/null | sed"
            : "jq -r '.mcpServers // {} | keys[]'",
        ),
      );
      assert.ok(s.note !== undefined && has(shell, `echo "${s.note}"`));
      assert.ok(s.restartLine !== undefined && has(shell, `echo "${s.restartLine}"`));
      assert.deepEqual(s.extraLines, []);
      assert.equal(d.storeGuidance, has(shell, `print_store_access_guidance ${cli}`));
    });

    it("every prompt a step can ask is in the inventory for this cli, and every row is asked", () => {
      const asked = new Set<string>();
      for (const step of d.steps) {
        const ids = step === "mcp" ? ASKS_MCP[cli] : ASKS[step];
        for (const id of ids ?? []) {
          assert.notEqual(cancelClassOf(id, cli), undefined, `${id} is not asked by ${cli}`);
          asked.add(id);
        }
      }
      assert.ok(asked.size > 10);
      for (const row of PROMPT_INVENTORY.filter((r) => r.clis.includes(cli))) {
        assert.ok(asked.has(row.id), `inventory row ${row.id} is asked by no step`);
      }
    });

    it("every step id is registered and the mcp strategy exports run()", async () => {
      const registry = {
        ...commonSteps,
        ...rulesSteps,
        ...mcpSteps,
        ...hooksSteps,
        ...agySteps,
        ...usageSteps,
        ...tierSteps,
        ...summarySteps,
      };
      for (const id of d.steps) {
        if (id === "link-confirm") continue; // executed by the flow itself
        assert.equal(typeof registry[id], "function", `no implementation for ${id}`);
      }
      const file = { claudeMcp: "mcp-claude-step", geminiMcp: "mcp-gemini-step" } as const;
      const loaded: unknown = await import(
        `../lib/setup/${file[d.strategies.mcp as "claudeMcp" | "geminiMcp"]}.ts`
      );
      assert.equal(typeof (loaded as { run?: unknown }).run, "function");
    });
  });
}
