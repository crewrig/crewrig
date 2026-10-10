// setup-retarget-step-order.test.ts — the pin of two retargeted order assertions (ticket #1335,
// spec 0256 requirement 9, PR D1). hook-guard-setup.test.ts and setup-dependency-step.test.ts used
// to read the TEXT of the four setup scripts for the order of their steps; they now read the
// DECLARATION (the `step N: <id>` lines). This test keeps the two agreeing while the shell exists:
// for each CLI, the order the shell runs the steps in is the order the declaration lists them in,
// for the two properties the retargeted suites assert. Retired with the shell, at the switch PR (E).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { renderDeclaration, SETUP_DESCRIPTORS } from "./lib/print-setup-declarations.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CLIS = ["claude", "gemini", "copilot", "antigravity"] as const;

function declaredSteps(cli: string): string[] {
  const descriptor = SETUP_DESCRIPTORS[cli];
  assert.ok(descriptor !== undefined, cli);
  return renderDeclaration(descriptor, "lines")
    .split("\n")
    .flatMap((line) => /^step \d+: (.+)$/.exec(line)?.[1] ?? []);
}

function shellLines(cli: string): string[] {
  return fs
    .readFileSync(path.join(ROOT, "scripts", `setup-${cli}-interactive.sh`), "utf8")
    .split("\n");
}

/** Line index of the first non-comment line matching `re` (as setup-dependency-step's first_call). */
function firstCall(lines: string[], re: RegExp): number {
  return lines.findIndex((l) => re.test(l) && !/^\s*#/.test(l));
}

describe("the order the shell runs the steps in is the order the declaration lists", () => {
  for (const cli of CLIS) {
    it(`${cli}: hooks-rewrite-installed precedes session-recording in both`, () => {
      const lines = shellLines(cli);
      const steps = declaredSteps(cli);

      const shellCall = firstCall(lines, /^\s*guard_rewrite_installed /);
      const shellQuestion = lines.findIndex((l) =>
        l.includes("Enable automatic session recording"),
      );
      const declCall = steps.indexOf("hooks-rewrite-installed");
      const declQuestion = steps.indexOf("session-recording");

      assert.ok(
        shellCall >= 0 && shellQuestion >= 0 && declCall >= 0 && declQuestion >= 0,
        "vacuity",
      );
      assert.equal(shellCall < shellQuestion, true);
      assert.equal(declCall < declQuestion, true);
    });

    it(`${cli}: tls-offer, deps-install, tiers run in that order in both`, () => {
      const lines = shellLines(cli);
      const steps = declaredSteps(cli);

      const shell = [
        firstCall(lines, /^\s*offer_tls_delegation(\s|$)/),
        firstCall(lines, /^\s*install_production_dependencies\s/),
        firstCall(lines, /^\s*ensure_tier_built\s/),
      ];
      const decl = ["tls-offer", "deps-install", "tiers"].map((id) => steps.indexOf(id));

      assert.ok(
        [...shell, ...decl].every((i) => i >= 0),
        `vacuity: ${shell} ${decl}`,
      );
      assert.ok(shell[0]! < shell[1]! && shell[1]! < shell[2]!, `shell order ${shell}`);
      assert.ok(decl[0]! < decl[1]! && decl[1]! < decl[2]!, `declaration order ${decl}`);
    });
  }
});
