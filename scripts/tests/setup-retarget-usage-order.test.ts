// setup-retarget-usage-order.test.ts — the order and prompts of the usage-capture step of the
// three CLI setups (Claude, Gemini, Copilot) as the declaration carries them (spec 0256
// requirement 9; spec 0211 R1, spec 0214 R16). test-setup-usage-capture-optin.sh sections 2 and 4
// read the declaration only; the shell text they once compared against is a forwarding shim now.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SETUP_DESCRIPTORS } from "./lib/print-setup-declarations.ts";
import { declarationFacts } from "./lib/setup-declarations-facts.ts";

function declared(cli: string): { facts: Map<string, string>; steps: string[] } {
  const descriptor = SETUP_DESCRIPTORS[cli];
  assert.ok(descriptor !== undefined, `a descriptor for ${cli}`);
  const facts = new Map(declarationFacts(descriptor));
  assert.ok(facts.size > 0, `${cli}: the declaration is not empty`);
  return { facts, steps: [...descriptor.steps] };
}

for (const cli of ["claude", "gemini", "copilot"]) {
  describe(`${cli}: usage-capture after session recording, with the declared prompts`, () => {
    const { facts, steps } = declared(cli);

    it("the declaration orders the steps and the options the same way", () => {
      const rec = steps.indexOf("session-recording");
      const uc = steps.indexOf("usage-capture");
      assert.ok(rec >= 0 && uc > rec, `usage-capture (${uc}) after session-recording (${rec})`);
      assert.equal(facts.get("prompt.usage-capture.options"), "no,yes");
      assert.equal(facts.get("prompt.usage-capture-keep.options"), "keep,remove");
      assert.equal(facts.get("prompts.session-recording"), "transcripts,transcripts-confirm");
    });
  });
}

describe("gemini: the settings write precedes the usage-capture step", () => {
  const { facts, steps } = declared("gemini");

  it("the declaration puts the settings-write sub-step in a step before usage-capture", () => {
    assert.ok((facts.get("substeps.mcp") ?? "").split(",").includes("gemini-settings-write"));
    assert.ok(steps.indexOf("mcp") >= 0 && steps.indexOf("mcp") < steps.indexOf("usage-capture"));
  });
});
