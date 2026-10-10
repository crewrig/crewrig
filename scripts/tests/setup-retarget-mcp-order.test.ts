// setup-retarget-mcp-order.test.ts — the order of the MCP sub-steps of the Copilot and Antigravity
// setups, read from the declaration (spec 0256 requirement 9). The Bash suite test-setup-mcp-merge.sh
// section 3 reads the declaration only; the shell it used to compare against is a forwarding shim now.
//
// Pinned property (spec 0089 R2/R4/R11): the operator's pre-run MCP servers are captured BEFORE the
// framework overwrite, folded back AFTER it, and the org fold runs after that.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SETUP_DESCRIPTORS } from "./lib/print-setup-declarations.ts";
import { declarationFacts } from "./lib/setup-declarations-facts.ts";

type Cli = "copilot" | "antigravity";

const CLIS: readonly Cli[] = ["copilot", "antigravity"];

function declaredSubsteps(cli: Cli): string[] {
  const descriptor = SETUP_DESCRIPTORS[cli];
  assert.ok(descriptor !== undefined, `a descriptor for ${cli}`);
  const fact = declarationFacts(descriptor).find(([k]) => k === "substeps.mcp");
  assert.ok(fact !== undefined && fact[1] !== "", `${cli}: the declaration carries substeps.mcp`);
  return fact[1].split(",");
}

for (const cli of CLIS) {
  describe(`${cli}: capture, write, fold order`, () => {
    it("the declaration captures before the write, folds the operator servers, then the org servers", () => {
      const subs = declaredSubsteps(cli);
      const at = (id: string): number => subs.indexOf(id);
      for (const id of ["backup-capture-operator-servers", "write-mcp-config", "org-mcp-fold"])
        assert.ok(at(id) >= 0, `${cli}: ${id} is declared`);
      assert.ok(at("backup-capture-operator-servers") < at("write-mcp-config"));
      assert.ok(at("write-mcp-config") < at("org-mcp-fold"));
    });
  });
}
