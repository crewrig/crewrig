// setup-cli-copilot-antigravity.test.ts — the Copilot and Antigravity descriptors (plan v2 step
// B3b.1, task T8b) against the shell text they were copied from, read at test time: banner, step
// order, homes, rule files, texts, summary, identity strings; plus the prompt inventory and the step
// registry. Every shell lookup has a vacuity guard (a marker that is not found fails the test).

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { antigravityDescriptor } from "../lib/setup/cli-antigravity.ts";
import { copilotDescriptor } from "../lib/setup/cli-copilot.ts";
import type { SetupDescriptor } from "../lib/setup/descriptor.ts";
import { identityInvocation } from "../lib/setup/prerequisites.ts";
import { cancelClassOf, PROMPT_INVENTORY } from "../lib/setup/prompt-ids.ts";
import { agySteps } from "../lib/setup/steps-agy.ts";
import { copilotSteps } from "../lib/setup/steps-copilot.ts";
import { hooksSteps } from "../lib/setup/steps-hooks.ts";
import { mcpSteps } from "../lib/setup/steps-mcp.ts";
import { rulesSteps } from "../lib/setup/steps-rules.ts";
import { tierSteps } from "../lib/setup/steps-tiers.ts";
import { commonSteps } from "../lib/setup/steps.ts";
import { usageSteps } from "../lib/setup/steps-usage.ts";
import { summarySteps } from "../lib/setup/summary.ts";
import { asked, CASES, MARKERS, shellOf } from "./setup-cli-copilot-antigravity-fixtures.ts";
import { run, useSandbox } from "./setup-flow-fixtures.ts";
import { rulesData } from "./setup-steps-rules-fixtures.ts";

describe("descriptor shape against the shell", () => {
  for (const [cli, d] of CASES) {
    const shell = shellOf(cli);

    it(`${cli}: the banner title is the shell's`, () => {
      assert.ok(shell.includes(`echo "  ${d.banner}"`));
      assert.equal(d.cli, cli);
    });

    it(`${cli}: the steps follow the order of the shell's markers`, () => {
      const markers = MARKERS[cli] ?? [];
      assert.ok(markers.length >= 16, "vacuity: the marker table is not empty");
      assert.deepEqual(
        markers.map(([id]) => id),
        d.steps,
      );
      let from = 0;
      for (const [id, marker] of markers) {
        const rest = shell.slice(from);
        const hit = marker.exec(rest);
        assert.ok(hit !== null, `marker of '${id}' not found after offset ${from}`);
        from += hit.index + hit[0].length;
      }
    });

    it(`${cli}: the homes are the shell's`, () => {
      const assign = (name: string): string => {
        const hit = new RegExp(`^${name}="([^"]+)"`, "m").exec(shell);
        assert.ok(hit !== null, `${name} not assigned`);
        return (hit[1] ?? "").replace("${HOME}/", "").replace("${COPILOT_HOME}", ".copilot");
      };
      if (cli === "copilot") {
        assert.equal(d.homes.cliHome, assign("COPILOT_HOME"));
        assert.equal(d.homes.rulesDir, assign("COPILOT_INSTRUCTIONS"));
        assert.equal(d.homes.skillsDir, assign("COPILOT_SKILLS"));
        assert.ok(shell.includes('MCP_CONFIG_TARGET="$COPILOT_HOME/mcp-config.json"'));
        assert.equal(d.homes.mcpConfig, ".copilot/mcp-config.json");
        assert.equal(d.homes.agentsDir, undefined);
      } else {
        assert.equal(d.homes.cliHome, assign("AGY_HOME"));
        assert.equal(d.homes.rulesDir, assign("AGY_HOME"));
        assert.equal(d.homes.skillsDir, assign("AGY_SKILLS_HOME"));
        assert.equal(d.homes.agentsDir, assign("AGY_AGENTS_HOME"));
        assert.equal(d.homes.mcpConfig, assign("AGY_MCP_CONFIG"));
      }
      assert.equal(d.homes.settings, undefined);
    });

    it(`${cli}: rule files, labels and install order are the shell's`, () => {
      const calls = [...shell.matchAll(/install_(?:file|dir)\b[^\n]*\\\n\s*"([^"]*)"/g)].flatMap(
        (m) => (m[1] === undefined ? [] : [m[1]]),
      );
      const fromShell = calls
        // The tier loop (`$tier/$skill_name/...`) and the profile overwrite are not shared files.
        .filter((label) => !label.includes("(backup saved as .ori)") && !label.startsWith("$"))
        .map((label) => label.replace(/\$\{(?:LEVEL|EXPERTISE|TEAM)\}/, "{name}"));
      assert.ok(fromShell.length >= 10, "vacuity: the install calls were found");
      const { rules } = d;
      const expected = [
        ...rules.shared.map((r) => r.label),
        ...rules.pickOrder.map((kind) => rules.selections[kind].label),
        ...(rules.profile.mode === "method" ? [rules.profile.file.label] : []),
      ];
      assert.deepEqual(expected, fromShell);
      assert.ok(rules.shared.some((r) => r.src === rules.store.src));
      assert.deepEqual(
        rules.shared.filter((r) => r.optional === true).map((r) => r.src),
        ["AGENTS.org.md"],
      );
      assert.deepEqual(d.rules, rulesData(cli).rules);
    });

    it(`${cli}: texts, glob, markers and pick order are the shell's`, () => {
      const { rules } = d;
      assert.ok(shell.includes(`-name "${rules.existingGlob}"`));
      for (const text of Object.values(rules.texts)) assert.ok(shell.includes(text), text);
      assert.ok(shell.includes(rules.sharedHeader.replace("{dir}", "$COPILOT_INSTRUCTIONS")));
      const titles = [...shell.matchAll(/echo "Select your ([a-z ]+):"/g)].map((m) => m[1]);
      const names = { team: "team", expertise: "expertise", level: "experience level" } as const;
      assert.deepEqual(
        rules.pickOrder.map((kind) => names[kind]),
        titles,
      );
      for (const kind of rules.pickOrder) assert.ok(shell.includes(`.selected_${kind}"`));
      assert.equal(rules.mkdirInExisting === true, cli === "copilot");
    });

    it(`${cli}: the identity strings are the shell's`, () => {
      const invocation = identityInvocation(cli, "$skill");
      assert.ok(shell.includes(`run: ${invocation.replaceAll('"', '\\"')}`));
    });

    it(`${cli}: hooks, strategies and the summary spec are the shell's`, () => {
      assert.ok(shell.includes(`hooks/${path.basename(d.hooks.src)}`));
      assert.ok(shell.includes(path.basename(d.hooks.file)));
      assert.ok(shell.includes("mempalace-transcript.sh"));
      assert.equal(d.hooks.envPatch, false);
      assert.equal(d.hooks.leadingBlank, false);
      const { summary } = d;
      for (const text of [summary.listHeader, summary.mcpHeader, summary.note, summary.restartLine])
        if (text !== undefined) assert.ok(shell.includes(text), text);
      assert.ok(shell.includes(summary.mcpHeader.replace(/^MCP servers \(from (.*)\):$/, "$1")));
      assert.equal(summary.mcpSource, summary.mcpHeader.replace(/^.*from (.*)\):$/, "$1"));
    });
  }

  it("copilot: the closing extra lines are the shell's echoes, blank lines included", () => {
    const shell = shellOf("copilot");
    const tail = shell.slice(shell.indexOf('echo "MCP servers (from mcp-config.json):"'));
    const body = tail.slice(0, tail.indexOf("print_store_access_guidance copilot"));
    const echoes = body
      .split("\n")
      .filter((line) => line.startsWith('echo "'))
      .map((line) => line.slice(6, -1).replaceAll("\\$", "$"));
    assert.deepEqual(echoes.slice(2), copilotDescriptor.summary.extraLines);
    assert.equal(echoes[1], "");
    assert.equal(copilotDescriptor.storeGuidance, true);
    assert.ok(!shell.includes("Restart any running"));
    assert.equal(copilotDescriptor.summary.restartLine, undefined);
    assert.equal(copilotDescriptor.summary.note, undefined);
  });

  it("antigravity: the usage capture is the statusline, the tiers its own, no store guidance", () => {
    assert.deepEqual(antigravityDescriptor.strategies, {
      mcp: "antigravityMcp",
      tiers: "antigravity",
      usageCapture: "statusline",
    });
    assert.equal(antigravityDescriptor.hooks.channel, "agy-json");
    assert.equal(antigravityDescriptor.storeGuidance, false);
    assert.ok(!shellOf("antigravity").includes("print_store_access_guidance"));
    assert.ok(!antigravityDescriptor.steps.includes("legacy-context-cleanup"));
  });

  it("copilot: user-level hooks JSON, copilot strategies, skills only", () => {
    assert.deepEqual(copilotDescriptor.strategies, {
      mcp: "copilotMcp",
      tiers: "standard",
      usageCapture: "user-hooks-json",
    });
    assert.equal(copilotDescriptor.hooks.channel, "user-json");
    assert.equal(copilotDescriptor.rules.profile.mode, "direct");
    assert.deepEqual(copilotDescriptor.rules.pickOrder, ["level", "expertise", "team"]);
  });

  it("no field of a descriptor is empty (blank extra lines excepted)", () => {
    for (const [cli, d] of CASES) {
      const strings: [string, string][] = [
        ["banner", d.banner],
        ...Object.entries(d.homes).map(([k, v]): [string, string] => [`homes.${k}`, v]),
        ...Object.entries(d.hooks)
          .filter(([, v]) => typeof v === "string")
          .map(([k, v]): [string, string] => [`hooks.${k}`, String(v)]),
        ...Object.entries(d.rules.texts).map(([k, v]): [string, string] => [`texts.${k}`, v]),
        ["rules.existingGlob", d.rules.existingGlob],
        ["rules.sharedHeader", d.rules.sharedHeader],
        ["summary.listHeader", d.summary.listHeader],
        ["summary.listGlob", d.summary.listGlob],
        ["summary.mcpHeader", d.summary.mcpHeader],
      ];
      for (const [name, value] of strings) assert.notEqual(value, "", `${cli} ${name}`);
    }
  });
});

describe("prompts and registry", () => {
  for (const [cli, d] of CASES) {
    it(`${cli}: the prompts its steps ask are exactly the inventory's for this CLI`, () => {
      const ids = asked(d);
      assert.ok(ids.size >= 10, "vacuity");
      for (const id of ids) {
        assert.ok(
          PROMPT_INVENTORY.some((row) => row.id === id),
          `${id} not in the inventory`,
        );
        assert.notEqual(cancelClassOf(id, cli), undefined, `${cli} does not ask ${id}`);
      }
      const inventory = PROMPT_INVENTORY.filter((row) => row.cancel[cli] !== undefined).map(
        (row) => row.id,
      );
      assert.deepEqual([...ids].sort(), inventory.sort());
    });
  }

  it("copilot asks neither link-confirm nor profile-method (delta-02)", () => {
    const ids = asked(copilotDescriptor);
    assert.ok(!ids.has("link-confirm") && !ids.has("profile-method"));
    assert.ok(!copilotDescriptor.steps.includes("link-confirm"));
    assert.ok(!copilotDescriptor.steps.includes("ensure-home"));
    assert.equal(cancelClassOf("link-confirm", "copilot"), undefined);
    assert.equal(cancelClassOf("profile-method", "copilot"), undefined);
  });

  it("every step is registered, link-confirm (the runner's own) excepted", () => {
    const registry = {
      ...commonSteps,
      ...rulesSteps,
      ...mcpSteps,
      ...hooksSteps,
      ...agySteps,
      ...copilotSteps,
      ...usageSteps,
      ...tierSteps,
      ...summarySteps,
    };
    assert.ok(Object.keys(registry).length >= 15, "vacuity");
    for (const [cli, d] of CASES) {
      const missing = d.steps.filter((id) => id !== "link-confirm" && registry[id] === undefined);
      assert.deepEqual(missing, [], `${cli}: unregistered steps`);
    }
  });
});

describe("copilot without link-confirm", () => {
  useSandbox();

  it("still parses --link, and asks nothing on a closed standard input", async () => {
    let seen: boolean | undefined;
    const d: SetupDescriptor = { ...copilotDescriptor, steps: ["deps-install"] };
    const result = await run(
      d,
      {
        "deps-install": async ({ ctx }) => {
          seen = ctx.link;
        },
      },
      { argv: ["--link"] },
    );
    assert.equal(result.status, 0);
    assert.equal(result.out, "");
    assert.equal(seen, true);
  });
});
