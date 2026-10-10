// setup-cli-copilot-antigravity.test.ts — the Copilot and Antigravity descriptors (plan v2 step
// B3b.1, task T8b). The descriptor shape is compared with the observable behaviour of the shell
// setups, stored in the golden cells and the declaration goldens (setup-cli-shape-fixtures.ts); the
// prompt inventory and the step registry are asserted here.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { antigravityDescriptor } from "../lib/setup/cli-antigravity.ts";
import { copilotDescriptor } from "../lib/setup/cli-copilot.ts";
import type { SetupDescriptor } from "../lib/setup/descriptor.ts";
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
import { asked, CASES } from "./setup-cli-copilot-antigravity-fixtures.ts";
import { shapeTests } from "./setup-cli-shape-fixtures.ts";
import { printed } from "./setup-golden-readers.ts";
import { run, useSandbox } from "./setup-flow-fixtures.ts";
import { rulesData } from "./setup-steps-rules-fixtures.ts";

describe("descriptor shape against the golden cells of the shell setup", () => {
  for (const [cli, d] of CASES) {
    describe(cli, () => {
      shapeTests(cli, d);

      it("the rule data is the steps' fixture data", () => {
        assert.deepEqual(d.rules, rulesData(cli).rules);
      });

      it("no field is empty (blank extra lines excepted)", () => {
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
        for (const [name, value] of strings) assert.notEqual(value, "", name);
      });
    });
  }

  it("copilot: the closing extra lines are printed as one block, blank lines included", () => {
    const out = printed("copilot", "default-answers");
    const extra = copilotDescriptor.summary.extraLines;
    assert.ok(extra.includes("") && extra.length >= 5, "vacuity");
    assert.ok(out.includes(`${extra.join("\n")}\n`), "the block");
    assert.ok(out.indexOf(extra[0] as string) > out.indexOf("MCP servers (from mcp-config.json):"));
    const closing = out.slice(out.indexOf("  Setup complete"));
    assert.ok(!closing.includes("Restart any running"));
    assert.equal(copilotDescriptor.summary.restartLine, undefined);
  });

  it("antigravity: the usage capture is the statusline, the tiers its own, no store guidance", () => {
    assert.deepEqual(antigravityDescriptor.strategies, {
      mcp: "antigravityMcp",
      tiers: "antigravity",
      usageCapture: "statusline",
    });
    assert.equal(antigravityDescriptor.hooks.channel, "agy-json");
    assert.equal(antigravityDescriptor.storeGuidance, false);
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
