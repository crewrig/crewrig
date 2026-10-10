// setup-differential-suite.ts — one `node:test` suite per CLI of the parity proof of spec 0256
// requirement 10: every cell that runs on both legs is run on the shell setup and on the TypeScript
// setup, in separate sandboxes, and the two results (status, stdout, stderr, tree, bak counts) are
// compared DIRECTLY with each other through the tagged deviations (setup-golden-deviations.ts). An
// untagged difference fails the cell and names the first differing lines. Linux only, needs a real
// `jq`; both legs must be available (a `SETUP_GOLDEN_LEGS` that narrows to one leg skips the proof).
// One file per CLI (setup-differential-<cli>.test.ts) so that CI runs them as parallel shards.

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { legDifference } from "./setup-differential.ts";
import { realHomeGuard } from "./real-home-guard.ts";
import { casesFor } from "./setup-golden-all.ts";
import { runSetupCase } from "./setup-golden-run.ts";
import type { Cli, GoldenCase } from "./setup-golden-types.ts";
import { IMPL } from "./setup-sandbox.ts";
import { hasJq } from "./setup-stubs.ts";

function skipReason(): string | undefined {
  if (process.platform !== "linux") return "the legs are compared on Linux only";
  if (!hasJq()) return "a real jq is required";
  if (!IMPL.includes("shell") || !IMPL.includes("ts")) return "both legs are needed";
  return undefined;
}

/** A cell takes part when it runs on both legs and is not the shell baseline only. */
const onBothLegs = (c: GoldenCase): boolean =>
  c.shellOnly === undefined &&
  (c.legs === undefined || (c.legs.includes("shell") && c.legs.includes("ts")));

export function defineDifferentialSuite(cli: Cli): void {
  const skip = skipReason();
  describe(`setup differential: ${cli}`, skip === undefined ? {} : { skip }, () => {
    let guard: ReturnType<typeof realHomeGuard> | undefined;
    before(() => {
      guard = realHomeGuard();
    });
    for (const c of skip === undefined ? casesFor(cli).filter(onBothLegs) : []) {
      test(`${cli}/${c.id}`, async () => {
        try {
          const shell = await runSetupCase(c, "shell");
          const ts = await runSetupCase(c, "ts");
          const difference = legDifference(c, shell, ts);
          assert.equal(difference, undefined, difference);
        } finally {
          guard?.assertUnchanged();
        }
      });
    }
  });
}
