// setup-retarget-catalogue-picker.test.ts — the team/expertise/level selection of the four setups,
// pinned on the declaration with literal expectations (spec 0256 requirement 9; spec 0096 R3/R5/R6).
// The declaration half of the former shell-vs-declaration comparison; the behaviour half (a declined
// pick removes the marker, an empty catalogue stays non-fatal) is pinned by the golden cells
// `catalogue-pick-declined`, `declined-catalogue-pick`, `empty-catalogue` and
// `empty-catalogue-stale-markers` through setup-retarget-behaviour-a.test.ts and setup-steps-rules.test.ts.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SETUP_DESCRIPTORS } from "./lib/print-setup-declarations.ts";
import { declarationFacts } from "./lib/setup-declarations-facts.ts";

const CATEGORIES = ["team", "expertise", "level"] as const;

/** Per CLI: the literal pick order and the directory holding the three `.selected_<category>` markers. */
const EXPECTED: Readonly<Record<string, { order: string; markerDir: string }>> = {
  claude: { order: "team,expertise,level", markerDir: "<HOME>/.claude" },
  gemini: { order: "team,expertise,level", markerDir: "<HOME>/.gemini" },
  // Copilot picks level, then expertise, then team (spec 0096).
  copilot: { order: "level,expertise,team", markerDir: "<HOME>/.copilot" },
  antigravity: { order: "team,expertise,level", markerDir: "<HOME>/.gemini/antigravity-cli" },
};

const CATALOGUES: Readonly<Record<string, string>> = {
  team: "<config/teams>",
  expertise: "<config/expertise>",
  level: "<config/level>",
};

function facts(cli: string): Map<string, string> {
  const descriptor = SETUP_DESCRIPTORS[cli];
  assert.ok(descriptor !== undefined, `a descriptor for ${cli}`);
  const m = new Map(declarationFacts(descriptor));
  assert.ok(m.size > 0, `${cli}: the declaration is not empty`);
  return m;
}

for (const [cli, expected] of Object.entries(EXPECTED)) {
  describe(`${cli}: the declared catalogue selection`, () => {
    const f = facts(cli);

    it("picks the three categories in the declared order", () => {
      assert.equal(f.get("rules.pick-order"), expected.order);
    });

    it("names one marker per category, in the CLI home", () => {
      for (const category of CATEGORIES) {
        assert.equal(
          f.get(`rules.marker.${category}`),
          `${expected.markerDir}/.selected_${category}`,
        );
      }
    });

    it("runs every pick in the rules-selection step, from its catalogue, a cancel declining", () => {
      for (const category of CATEGORIES) {
        assert.equal(f.get(`prompt.catalogue.${category}.step`), "rules-selection");
        assert.equal(f.get(`prompt.catalogue.${category}.options`), CATALOGUES[category]);
        assert.equal(f.get(`prompt.catalogue.${category}.cancel`), "decline");
      }
    });
  });
}
