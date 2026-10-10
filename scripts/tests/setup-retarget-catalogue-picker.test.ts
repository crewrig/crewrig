// setup-retarget-catalogue-picker.test.ts — the team/expertise/level selection of the four setups
// read from the shell AND from the declaration (spec 0256 requirement 9, PR D1; spec 0096 R3/R5/R6).
// Retired with the shell (PR E): test-setup-catalogue-picker.sh section 4 reads the declaration only;
// this file asserts, while the shell exists, that the shell and the declaration agree.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { SETUP_DESCRIPTORS } from "./lib/print-setup-declarations.ts";
import { declarationFacts } from "./lib/setup-declarations-facts.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CATEGORIES = ["team", "expertise", "level"] as const;

/** The lines strictly between the first `begin` line and the next `end` line (exact match). */
function between(text: string, begin: string, end: string): string {
  const lines = text.split("\n");
  const from = lines.indexOf(begin);
  if (from < 0) return "";
  const to = lines.indexOf(end, from + 1);
  return lines.slice(from + 1, to < 0 ? undefined : to).join("\n");
}

/** The selection body of one shell setup, in the order the categories appear. */
function shellBlock(cli: string, text: string): string {
  if (cli === "copilot") {
    // Copilot orders level, expertise, team and nests one level deeper (spec 0096).
    return `${between(text, "  # Level", "  # Team")}\n${between(text, "  # Team", "fi")}`;
  }
  return between(text, "# --- Team selection ---", "# --- Profile handling ---");
}

function facts(cli: string): Map<string, string> {
  const descriptor = SETUP_DESCRIPTORS[cli];
  assert.ok(descriptor !== undefined, `a descriptor for ${cli}`);
  const m = new Map(declarationFacts(descriptor));
  assert.ok(m.size > 0, `${cli}: the declaration is not empty`);
  return m;
}

for (const cli of ["claude", "gemini", "copilot", "antigravity"]) {
  describe(`${cli}: the selection block and the declaration agree`, () => {
    const text = fs.readFileSync(path.join(REPO, "scripts", `setup-${cli}-interactive.sh`), "utf8");
    const block = shellBlock(cli, text);
    const f = facts(cli);

    it("the shell block exists, aborts nowhere and uses the shared helper", () => {
      assert.ok(block !== "" && block.trim() !== "", "the selection block was extracted");
      assert.ok(!/^\s*exit 1\s*$/m.test(block), "no bare `exit 1` in the block");
      assert.ok(block.includes("pick_catalogue_entry"), "the block calls pick_catalogue_entry");
    });

    it("every declared category has a skip branch removing the marker the declaration names", () => {
      for (const category of CATEGORIES) {
        const marker = f.get(`rules.marker.${category}`);
        assert.ok(marker?.endsWith(`/.selected_${category}`), `${category}: a declared marker`);
        assert.match(
          block,
          new RegExp(`rm -f "[^"]*\\.selected_${category}"`),
          `${category}: skip removes it`,
        );
        assert.equal(
          f.get(`prompt.catalogue.${category}.cancel`),
          "decline",
          `${category}: declared decline`,
        );
      }
    });

    it("the declared pick order is the order of the shell", () => {
      const declared = (f.get("rules.pick-order") ?? "").split(",");
      assert.deepEqual([...declared].sort(), [...CATEGORIES].sort());
      const at = (category: string): number =>
        block.search(new RegExp(`\\.selected_${category}\\b`));
      const shell = [...CATEGORIES].sort((a, b) => at(a) - at(b));
      assert.deepEqual(declared, shell);
    });
  });
}
