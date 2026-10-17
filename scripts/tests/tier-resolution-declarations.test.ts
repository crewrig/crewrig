// Spec 0119 requirement 20, relational arm (ported from test-component-tier-resolution.sh cases
// 18 and 19): each command's declared landing zone, staging root and served tiers equal its
// assisted setup's, read by EVALUATING the TypeScript declarations, never as text.
// A declaration that yields nothing fails the test instead of passing vacuously.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { manageFacts, setupFact } from "./lib/tier-landing.ts";

/** The covered pairs: skills on all four commands, agents on the Gemini one. */
const ROWS: readonly (readonly [string, string])[] = [
  ["claude", "skills"],
  ["gemini", "skills"],
  ["gemini", "agents"],
  ["copilot", "skills"],
  ["antigravity", "skills"],
];

const facts = manageFacts();
const values = (cli: string, key: RegExp): string[] =>
  facts.filter((f) => f.cli === cli && key.test(f.key)).map((f) => f.value);
const uniq = (xs: string[]): string[] => [...new Set(xs)].sort();

describe("tier resolution: declarations vs assisted setup", () => {
  test("the manage declaration helper prints facts", () => {
    assert.ok(facts.length > 0, "the declaration helper printed nothing");
  });

  test("R20/R1: every command's landing zone for each covered type equals its setup's", () => {
    for (const [cli, type] of ROWS) {
      const setupZone = setupFact(cli, `home.${type}`);
      assert.match(setupZone, new RegExp(`^<HOME>.*/${type}$`), `${cli}/${type}: setup zone`);
      const cmdZone = uniq(values(cli, /^dest[.]/).filter((v) => v.endsWith(`/${type}`)));
      assert.equal(cmdZone.length, 1, `${cli}/${type}: command zones ${cmdZone.join(" ")}`);
      assert.equal(cmdZone[0], setupZone, `${cli}/${type}: landing zones diverge`);
    }
  });

  test("R20/R2+R5: every command resolves each covered type from its setup's staging root over all three tiers", () => {
    for (const [cli, type] of ROWS) {
      const staging = setupFact(cli, "tiers.staging");
      const m = /^<REPO>\/dist\/<TIER>\/(.+)$/.exec(staging);
      assert.ok(m, `${cli}/${type}: setup tiers.staging='${staging}'`);
      const declared = uniq(values(cli, /^staging-root[.]/));
      assert.ok(declared.length > 0, `${cli}/${type}: no staging root declared by the command`);
      assert.ok(
        declared.includes(`${m[1]}/${type}`),
        `${cli}/${type}: no staging root equal to ${m[1]}/${type}; declared: ${declared.join(" ")}`,
      );
      const served = values(cli, /^tiers$/);
      assert.equal(served.length, 1, `${cli}/${type}: expected exactly one tiers fact`);
      const set = (served[0] ?? "").split(" ");
      for (const tier of ["library", "community", "org"])
        assert.ok(set.includes(tier), `${cli}/${type}: served set lacks ${tier}: ${set.join(" ")}`);
    }
  });
});
