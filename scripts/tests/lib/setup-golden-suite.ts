// setup-golden-suite.ts — one `node:test` test per (case x available leg) of a setup entry point
// (spec 0256 requirement 7, plan v2 step A6). Linux only (the fixtures are generated and
// compared there), needs a real `jq`. The real home is fingerprinted once and re-checked after
// EVERY case. A TypeScript leg is compared against the same fixtures as the shell baseline;
// `shellOnly` cells and `legs` restrict which legs run.

import { before, describe, test } from "node:test";

import { realHomeGuard } from "./real-home-guard.ts";
import { casesFor } from "./setup-golden-all.ts";
import { checkGolden } from "./setup-golden-regen.ts";
import { runSetupCase } from "./setup-golden-run.ts";
import type { Cli } from "./setup-golden-types.ts";
import { IMPL } from "./setup-sandbox.ts";
import type { Leg } from "./setup-sandbox.ts";
import { hasJq } from "./setup-stubs.ts";

function skipReason(): string | undefined {
  if (process.platform !== "linux")
    return "golden fixtures are generated and compared on Linux only";
  if (!hasJq()) return "a real jq is required";
  return undefined;
}

export function defineGoldenSuite(cli: Cli): void {
  const skip = skipReason();
  describe(`setup golden: ${cli}`, skip === undefined ? {} : { skip }, () => {
    let guard: ReturnType<typeof realHomeGuard> | undefined;
    before(() => {
      guard = realHomeGuard();
    });
    for (const c of skip === undefined ? casesFor(cli) : []) {
      const legs = IMPL.filter(
        (leg: Leg) =>
          (c.legs ?? IMPL).includes(leg) && (c.shellOnly === undefined || leg === "shell"),
      );
      for (const leg of legs) {
        test(`${c.id} [${leg}]`, async () => {
          try {
            checkGolden(c, await runSetupCase(c, leg), leg);
          } finally {
            guard?.assertUnchanged();
          }
        });
      }
    }
  });
}
