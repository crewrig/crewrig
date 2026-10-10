// setup-retarget-gemini-overlays.test.ts — the pin of scripts/check-gemini-overlay-enrollment.sh
// (ticket #1335, spec 0256 requirement 9, PR D1). The guard reads the DECLARATION of the Gemini
// setup instead of the text of scripts/setup-gemini-interactive.sh; this test keeps the two
// agreeing while the shell exists: the deployed `NN_NAME.md` set the shell deploys (the literal
// `"$GEMINI_HOME/NN_NAME.md"` tokens the guard used to grep) equals the set the declaration names.
// It also proves the guard's vacuity guard: an emptied descriptor makes the printer fail with
// nothing on stdout. Retired with the shell, at the switch PR (E).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { geminiDescriptor } from "../lib/setup/cli-gemini.ts";
import { main } from "./lib/print-setup-declarations.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SHELL = path.join(ROOT, "scripts", "setup-gemini-interactive.sh");
const ENTRY = path.join(import.meta.dirname, "lib", "print-setup-declarations.ts");

/** What the guard used to read: every literal `"$GEMINI_HOME/NN_NAME.md"` token of the shell. */
function shellDeployed(): string[] {
  const text = fs.readFileSync(SHELL, "utf8");
  const tokens = text.match(/"\$GEMINI_HOME\/[0-9]{2}_[A-Za-z0-9_]+\.md"/g) ?? [];
  return [...new Set(tokens.map((t) => t.replace(/^.*\//, "").replace(/"$/, "")))].sort();
}

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

describe("the Gemini overlay-enrollment guard reads the declaration, which agrees with the shell", () => {
  it("names the same deployed overlays as the shell tokens, and not none", () => {
    const fromShell = shellDeployed();

    const fromDeclaration = declaredDeployed();

    assert.ok(fromShell.length >= 9, "vacuity: the shell deploys no overlay token");
    assert.deepEqual(fromDeclaration, fromShell);
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
