// setup-retarget-mcp-order.test.ts — the order of the MCP steps of the Copilot and Antigravity setups
// read from the shell AND from the declaration (spec 0256 requirement 9, PR D1). Retired with the
// shell (PR E): test-setup-mcp-merge.sh section 3 reads the declaration only, and this file keeps
// the declaration honest against the shell text while the shell exists.
//
// Pinned property (spec 0089 R2/R4/R11): the operator's pre-run MCP servers are captured BEFORE the
// framework overwrite, folded back AFTER it, and the org fold runs after that.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { SETUP_DESCRIPTORS } from "./lib/print-setup-declarations.ts";
import { declarationFacts } from "./lib/setup-declarations-facts.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Row {
  readonly cli: "copilot" | "antigravity";
  readonly script: string;
  /** The first framework-write line of the shell. */
  readonly write: RegExp;
}

const ROWS: readonly Row[] = [
  {
    cli: "copilot",
    script: "setup-copilot-interactive.sh",
    write: /write_json_config_secure_from "\$MCP_CONFIG_TARGET"/,
  },
  {
    cli: "antigravity",
    script: "setup-antigravity-interactive.sh",
    write: /write_json_config_secure_from "\$AGY_MCP_CONFIG"/,
  },
];

/** The 1-based line of the first non-comment line matching `re`, or 0. */
function lineOf(text: string, re: RegExp): number {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => !/^\s*#/.test(l) && re.test(l));
  return i + 1;
}

function declaredSubsteps(cli: Row["cli"]): string[] {
  const descriptor = SETUP_DESCRIPTORS[cli];
  assert.ok(descriptor !== undefined, `a descriptor for ${cli}`);
  const fact = declarationFacts(descriptor).find(([k]) => k === "substeps.mcp");
  assert.ok(fact !== undefined && fact[1] !== "", `${cli}: the declaration carries substeps.mcp`);
  return fact[1].split(",");
}

for (const row of ROWS) {
  describe(`${row.cli}: capture, write, fold order`, () => {
    const text = fs.readFileSync(path.join(REPO, "scripts", row.script), "utf8");
    const cap = lineOf(text, /^\s*PREEXISTING_MCP=/);
    const write = lineOf(text, row.write);
    const fold = lineOf(text, /merge_preexisting_mcp_servers "\$PREEXISTING_MCP"/);
    const org = lineOf(text, /apply_org_mcp_servers /);

    it("the shell captures before the write, folds after it, then folds the org servers", () => {
      for (const [name, n] of [
        ["capture", cap],
        ["write", write],
        ["fold", fold],
        ["org", org],
      ] as const)
        assert.ok(n > 0, `${row.script}: the ${name} line exists`);
      assert.ok(cap < write, `capture (l${cap}) precedes write (l${write})`);
      assert.ok(write < fold, `fold (l${fold}) follows write (l${write})`);
      assert.ok(fold < org, `org fold (l${org}) follows the operator fold (l${fold})`);
    });

    it("the declaration orders the same three steps the same way", () => {
      const subs = declaredSubsteps(row.cli);
      const at = (id: string): number => subs.indexOf(id);
      for (const id of ["backup-capture-operator-servers", "write-mcp-config", "org-mcp-fold"])
        assert.ok(at(id) >= 0, `${row.cli}: ${id} is declared`);
      assert.ok(at("backup-capture-operator-servers") < at("write-mcp-config"));
      assert.ok(at("write-mcp-config") < at("org-mcp-fold"));
    });
  });
}
