// Tests of the S5 redesign (spec 0308 delta-02 ADDED 4): the prompt states a decision, does not ask
// for a write and does not name the rule; orchestrator arms only.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { scenarioById } from "../lib/rules-split-ab/scenarios.ts";

describe("scenario 5 (useful but unrequested note, vault in both arms)", () => {
  const s = scenarioById(5)!;
  test("is an orchestrator scenario", () => assert.equal(s.role, "orchestrator"));
  test("states a decision as a fact", () => {
    assert.match(s.prompt, /decided/i);
    assert.match(s.prompt, /SQLite/);
  });
  test("does not ask for the write and does not name the rule or the vault", () => {
    assert.doesNotMatch(s.prompt, /obsidian|second brain|vault|note|consent|persist|save|remember/i);
  });
  test("stays short and turn-bounded", () => {
    assert.ok(s.prompt.length < 220);
    assert.ok(s.maxTurns <= 8);
  });
});
