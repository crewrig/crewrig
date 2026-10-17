// Replaces scripts/tests/test-artifact-build-install-scope.sh (part): the opt-in gate invariant
// (GATE1, GATE2 and the antigravity extension of spec 0265, V11/V12).
// The fzf-driven decision cannot be called headless, so the contract that gates the install calls is
// read from the setup DECLARATION (in-process: `SETUP_DESCRIPTORS` + `declarationFacts`):
//   * library is the ONLY automatic tier (`tiers.automatic=library`);
//   * community and org are the opt-in overlay tiers (`tiers.overlay`), each behind a yes/no prompt
//     (`tiers.overlay-prompts` names them, `prompt.overlay.<tier>.options` is the no,yes choice).
// Vacuity guard: an empty declaration, or an absent fact, fails the case.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SETUP_DESCRIPTORS } from "./lib/print-setup-declarations.ts";
import { declarationFacts } from "./lib/setup-declarations-facts.ts";

function readDecl(cli: string): Map<string, string> {
  const descriptor = SETUP_DESCRIPTORS[cli];
  assert.ok(descriptor !== undefined, `no setup descriptor for ${cli}`);
  const facts = new Map<string, string>();
  for (const [key, value] of declarationFacts(descriptor))
    if (!facts.has(key)) facts.set(key, value);
  assert.ok(facts.size > 0, "the setup declaration printed nothing (vacuity guard)");
  return facts;
}

/** Each sub-check is its own assertion (the Bash returned at the first failure). */
function assertGateShape(cli: string): void {
  const decl = readDecl(cli);
  const automatic = decl.get("tiers.automatic");
  const overlay = decl.get("tiers.overlay");
  const prompts = decl.get("tiers.overlay-prompts");
  assert.ok(
    automatic !== undefined &&
      automatic !== "" &&
      overlay !== undefined &&
      overlay !== "" &&
      prompts !== undefined &&
      prompts !== "",
    `${cli}: a tier fact is absent (automatic='${automatic}' overlay='${overlay}' prompts='${prompts}')`,
  );
  assert.equal(
    automatic,
    "library",
    `${cli}: the automatic tiers are '${automatic}', not library alone (R7/R8 scope violation if community/org)`,
  );
  assert.equal(
    overlay,
    "community,org",
    `${cli}: community/org are no longer the opt-in overlay tiers (got '${overlay}')`,
  );
  for (const tier of ["community", "org"]) {
    assert.ok(
      `,${prompts},`.includes(`,overlay.${tier},`),
      `${cli}: overlay ${tier} is no longer gated by an opt-in prompt`,
    );
    assert.equal(
      decl.get(`prompt.overlay.${tier}.options`),
      "no,yes",
      `${cli}: overlay ${tier} prompt is not a no,yes decision`,
    );
  }
}

describe("gate", () => {
  test("claude gate shape (GATE1: Opt-in gate invariant: library auto, community/org gated)", () => {
    assertGateShape("claude");
  });

  test("gemini and copilot share the gate shape (GATE2: Opt-in gate invariant parity guard)", () => {
    for (const cli of ["gemini", "copilot"]) assertGateShape(cli);
  });

  test("antigravity gate shape (V12: extension of GATE2, not in the Bash list)", () => {
    assertGateShape("antigravity");
  });
});
