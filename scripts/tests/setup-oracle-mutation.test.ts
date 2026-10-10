// setup-oracle-mutation.test.ts — the golden oracle cannot pass vacuously (spec 0256 requirement 8,
// the oracle mutation rule of spec 0255, plan v2 step A9). Each mutant (lib/setup-mutants.ts) edits
// one file of the sandbox repo after the sandbox is built; the mutated run is compared with the
// UNMUTATED golden of the same case and the comparison MUST throw. The mutants edit the TypeScript
// implementation, which both legs run (`shell` through the forwarding shim, `ts` directly). A control run of the same case
// with no mutation must pass, so a failure is due to the mutant. Linux with a real jq only.

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { realHomeGuard } from "./lib/real-home-guard.ts";
import { casesFor } from "./lib/setup-golden-all.ts";
import { checkGolden } from "./lib/setup-golden-regen.ts";
import { runSetupCase } from "./lib/setup-golden-run.ts";
import { CLIS } from "./lib/setup-golden-types.ts";
import { MUTANTS, mutate } from "./lib/setup-mutants.ts";
import { IMPL } from "./lib/setup-sandbox.ts";
import { hasJq } from "./lib/setup-stubs.ts";

const skip =
  process.platform !== "linux"
    ? "golden fixtures are generated and compared on Linux only"
    : hasJq()
      ? undefined
      : "a real jq is required";

describe("setup oracle mutation", skip === undefined ? {} : { skip }, () => {
  let guard: ReturnType<typeof realHomeGuard> | undefined;
  before(() => {
    guard = realHomeGuard();
  });

  for (const cli of CLIS) {
    for (const leg of IMPL) {
      const control = casesFor(cli).find((c) => c.id === "default-answers");
      test(`control: ${cli}/default-answers [${leg}] passes unmutated`, async () => {
        assert.ok(control !== undefined, `no default-answers case for ${cli}`);
        try {
          checkGolden(control, await runSetupCase(control, leg), leg);
        } finally {
          guard?.assertUnchanged();
        }
      });
      for (const m of MUTANTS) {
        for (const id of m.cases[cli] ?? []) {
          const edits = m.edits(cli);
          const c = casesFor(cli).find((x) => x.id === id);
          test(`${m.id}: ${cli}/${id} [${leg}] is caught`, async () => {
            assert.ok(c !== undefined, `unknown case ${cli}/${id}`);
            assert.ok(edits !== undefined, `no mutation declared for ${m.id}/${cli}`);
            try {
              const result = await runSetupCase(mutate(c, edits), leg);
              assert.throws(() => checkGolden(c, result, leg), /golden mismatch/);
            } finally {
              guard?.assertUnchanged();
            }
          });
        }
      }
    }
  }
});
