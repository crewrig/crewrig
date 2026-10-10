// setup-retarget-usage-order.test.ts — the order and prompts of the usage-capture step of the
// three CLI setups (Claude, Gemini, Copilot) read from the shell AND from the declaration (spec
// 0256 requirement 9, PR D1; spec 0211 R1, spec 0214 R16). Retired with the shell (PR E):
// test-setup-usage-capture-optin.sh sections 2 and 4 read the declaration only; this file asserts,
// while the shell exists, that the shell and the declaration agree.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { SETUP_DESCRIPTORS } from "./lib/print-setup-declarations.ts";
import { declarationFacts } from "./lib/setup-declarations-facts.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The 1-based line of the first non-comment line matching `re`, or 0. */
function lineOf(lines: readonly string[], re: RegExp, after = 0): number {
  const i = lines.findIndex((l, n) => n >= after && !/^\s*#/.test(l) && re.test(l));
  return i + 1;
}

function declared(cli: string): { facts: Map<string, string>; steps: string[] } {
  const descriptor = SETUP_DESCRIPTORS[cli];
  assert.ok(descriptor !== undefined, `a descriptor for ${cli}`);
  const facts = new Map(declarationFacts(descriptor));
  assert.ok(facts.size > 0, `${cli}: the declaration is not empty`);
  return { facts, steps: [...descriptor.steps] };
}

for (const cli of ["claude", "gemini", "copilot"]) {
  describe(`${cli}: usage-capture after session recording, with the declared prompts`, () => {
    const lines = fs
      .readFileSync(path.join(REPO, "scripts", `setup-${cli}-interactive.sh`), "utf8")
      .split("\n");
    const { facts, steps } = declared(cli);

    it("the shell asks the capture questions after the session-recording block, no first, keep first", () => {
      const start = lineOf(lines, /^ENABLE_TRANSCRIPTS=/);
      assert.ok(start > 0, "the session-recording block starts at column 0");
      const end = lines.findIndex((l, n) => n >= start && /^fi([\s;#]|$)/.test(l)) + 1;
      assert.ok(end > start, "the session-recording block closes with a top-level fi");
      const enable = lineOf(lines, /(printf|echo -e|echo)\s+['"]no\\nyes/, end);
      const keep = lineOf(lines, /(printf|echo -e|echo)\s+['"]keep\\nremove/, end);
      assert.ok(
        enable > end,
        `the enable prompt (no,yes) at l${enable} follows the block (l${end})`,
      );
      assert.ok(
        keep > end,
        `the keep prompt (keep,remove) at l${keep} follows the block (l${end})`,
      );
    });

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
  const lines = fs
    .readFileSync(path.join(REPO, "scripts", "setup-gemini-interactive.sh"), "utf8")
    .split("\n");
  const { facts, steps } = declared("gemini");

  it("the shell writes the settings before the usage_capture_state call", () => {
    const write = lineOf(lines, /^\s*gemini_settings_write\s/);
    const state = lineOf(lines, /usage_capture_state\s+gemini/);
    assert.ok(write > 0 && state > 0, "both lines exist");
    assert.ok(write < state, `settings write (l${write}) precedes usage capture (l${state})`);
  });

  it("the declaration puts the settings-write sub-step in a step before usage-capture", () => {
    assert.ok((facts.get("substeps.mcp") ?? "").split(",").includes("gemini-settings-write"));
    assert.ok(steps.indexOf("mcp") >= 0 && steps.indexOf("mcp") < steps.indexOf("usage-capture"));
  });
});
