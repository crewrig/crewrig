// setup-cli-claude-gemini.test.ts — the Claude and Gemini descriptors (spec 0256 requirements 3 and
// 6, plan v2 step B3b.1). The descriptor shape is compared with the observable behaviour of the shell
// setups, stored in the golden cells and the declaration goldens (setup-cli-shape-fixtures.ts); the
// prompt inventory and the step registry are asserted here.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { claudeDescriptor } from "../lib/setup/cli-claude.ts";
import { geminiDescriptor } from "../lib/setup/cli-gemini.ts";
import { CLIS, type Cli } from "../lib/setup/context.ts";
import type { SetupDescriptor } from "../lib/setup/descriptor.ts";
import { cancelClassOf, PROMPT_INVENTORY } from "../lib/setup/prompt-ids.ts";
import { agySteps } from "../lib/setup/steps-agy.ts";
import { hooksSteps } from "../lib/setup/steps-hooks.ts";
import { mcpSteps } from "../lib/setup/steps-mcp.ts";
import { rulesSteps } from "../lib/setup/steps-rules.ts";
import { tierSteps } from "../lib/setup/steps-tiers.ts";
import { usageSteps } from "../lib/setup/steps-usage.ts";
import { commonSteps } from "../lib/setup/steps.ts";
import { summarySteps } from "../lib/setup/summary.ts";
import { ASKS, ASKS_MCP } from "./setup-cli-claude-gemini-fixtures.ts";
import { shapeTests } from "./setup-cli-shape-fixtures.ts";
import { declOf } from "./setup-golden-readers.ts";

type Cell = readonly [Cli, SetupDescriptor];
const CELLS: readonly Cell[] = [
  ["claude", claudeDescriptor],
  ["gemini", geminiDescriptor],
];

for (const [cli, d] of CELLS) {
  describe(`${cli} descriptor against the golden cells of the shell setup`, () => {
    shapeTests(cli, d);

    it("the strategies and the tiers", () => {
      assert.deepEqual(d.strategies, {
        mcp: `${cli}Mcp`,
        tiers: "standard",
        usageCapture: "settings",
      });
      const decl = declOf(cli).facts;
      assert.equal(decl.get("tiers.build-target"), cli);
      assert.equal(decl.get("tiers.strategy"), "standard");
      assert.equal(decl.get("usage-capture.strategy"), "settings");
      assert.equal(decl.get("mcp.strategy"), d.strategies.mcp);
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

describe("the steps of the four CLIs keep their relative order (declaration goldens)", () => {
  const steps = (cli: Cli): readonly string[] => declOf(cli).steps;
  const common = (cli: Cli): string[] => {
    const shared = steps("claude").filter((id) => CLIS.every((c) => steps(c).includes(id)));
    return steps(cli).filter((id) => shared.includes(id));
  };

  it("the steps all four CLIs run are the same fourteen", () => {
    assert.deepEqual(common("claude").slice().sort(), [
      "banner",
      "deps-install",
      "hooks-rewrite-installed",
      "identity-check",
      "mcp",
      "rules-existing",
      "rules-selection",
      "rules-shared",
      "session-check",
      "session-recording",
      "summary",
      "tiers",
      "tls-offer",
      "usage-capture",
    ]);
  });

  it("they come in one order, but Copilot selects before the TLS offer", () => {
    const order = (cli: Cli): string[] => common(cli).filter((id) => id !== "rules-selection");
    for (const cli of CLIS) assert.deepEqual(order(cli), order("claude"), cli);
    for (const cli of ["claude", "gemini", "antigravity"] as const)
      assert.ok(steps(cli).indexOf("rules-selection") > steps(cli).indexOf("mcp"), cli);
    assert.ok(steps("copilot").indexOf("rules-selection") < steps("copilot").indexOf("tls-offer"));
  });
});
