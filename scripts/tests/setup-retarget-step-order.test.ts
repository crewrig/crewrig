// setup-retarget-step-order.test.ts — the literal pin of two step-order properties of the four
// setups (ticket #1335, spec 0256 requirement 9). hook-guard-setup.test.ts and
// setup-dependency-step.test.ts read the DECLARATION (the `step N: <id>` lines) for them; this test
// states the expected order literally, so a regenerated declaration golden cannot move it silently:
//   1. hooks-rewrite-installed runs before the session-recording question;
//   2. tls-offer, deps-install and tiers run in that order.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderDeclaration, SETUP_DESCRIPTORS } from "./lib/print-setup-declarations.ts";

/** The literal order of the watched steps, identical on the four CLIs. */
const EXPECTED = [
  "tls-offer",
  "deps-install",
  "tiers",
  "hooks-rewrite-installed",
  "session-recording",
];

function declaredSteps(cli: string): string[] {
  const descriptor = SETUP_DESCRIPTORS[cli];
  assert.ok(descriptor !== undefined, cli);
  return renderDeclaration(descriptor, "lines")
    .split("\n")
    .flatMap((line) => /^step \d+: (.+)$/.exec(line)?.[1] ?? []);
}

describe("the declared step order", () => {
  for (const cli of ["claude", "gemini", "copilot", "antigravity"]) {
    it(`${cli}: the watched steps appear once each, in the expected order`, () => {
      const watched = declaredSteps(cli).filter((id) => EXPECTED.includes(id));

      assert.deepEqual(watched, EXPECTED);
    });
  }
});
