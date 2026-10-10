// setup-retarget-gemini-overlays.test.ts — the pin of scripts/check-gemini-overlay-enrollment.sh
// (ticket #1335, spec 0256 requirement 9). The guard reads the DECLARATION of the Gemini setup
// instead of the text of scripts/setup-gemini-interactive.sh (a forwarding shim now): this test
// pins the deployed `NN_NAME.md` set the declaration names against the literal list of overlays the
// setup deploys. It also proves the guard's vacuity guard: an emptied descriptor makes the printer
// fail with nothing on stdout.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

import { geminiDescriptor } from "../lib/setup/cli-gemini.ts";
import { main } from "./lib/print-setup-declarations.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ENTRY = path.join(import.meta.dirname, "lib", "print-setup-declarations.ts");

/** The overlays the Gemini setup deploys to the Gemini home, ordered by priority. */
const DEPLOYED = [
  "00_SOUL.md",
  "10_USER_LEVEL.md",
  "20_ORGANIZATION.md",
  "30_USER_PROFILE.md",
  "40_USER_EXPERTISE.md",
  "50_USER_TEAM.md",
  "60_TOOLS.md",
  "65_TOOLS.md",
  "66_ORG_RULES.md",
];

/** What the guard reads now: the overlay names of the printed JSON declaration. */
function declaredDeployed(): string[] {
  const run = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, "gemini", "--format", "json"],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const facts = (JSON.parse(run.stdout) as { facts: Record<string, string> }).facts;
  const names = new Set<string>();
  for (const [key, value] of Object.entries(facts)) {
    if (!/^rules\.(shared\.[0-9]+|selection\.[A-Za-z0-9_-]+|profile)$/.test(key)) continue;
    const base = path.basename(
      value
        .replace(/ \(optional\)$/, "")
        .split(" -> ")
        .pop() ?? "",
    );
    if (/^[0-9]{2}_[A-Za-z0-9_]+\.md$/.test(base)) names.add(base);
  }
  return [...names].sort();
}

describe("the Gemini overlay-enrollment guard reads the declaration", () => {
  it("the declaration names exactly the nine overlays the setup deploys", () => {
    const fromDeclaration = declaredDeployed();

    assert.deepEqual(fromDeclaration, DEPLOYED);
  });

  it("makes the printer fail with nothing on stdout when the descriptor is emptied", () => {
    const emptied = { ...geminiDescriptor, steps: [] };
    let stdout = "";
    let stderr = "";

    const status = main(
      ["gemini", "--format", "json"],
      { write: (t) => (stdout += t) },
      { write: (t) => (stderr += t) },
      { gemini: emptied },
    );

    assert.equal(status, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /empty/);
  });
});
