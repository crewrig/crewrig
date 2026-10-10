// Tests of scripts/lib/setup/store-guidance.ts (spec 0256 requirements 25 and 32, delta-01 G9).
// The text is diffed against the shell source so a drift on either side fails.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { CLIS } from "../lib/setup/context.ts";
import type { Cli } from "../lib/setup/context.ts";
import { printStoreAccessGuidance } from "../lib/setup/store-guidance.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const shell = readFileSync(path.join(repo, "scripts", "lib", "common.sh"), "utf8");

/** The echoed lines of one region of the shell function, `$store` expanded. */
function echoes(region: string): string[] {
  const out: string[] = [];
  for (const m of region.matchAll(/^\s*echo "(.*)"\s*$/gm)) {
    out.push((m[1] ?? "").replaceAll("$store", "~/.crewrig/system-context"));
  }
  return out;
}

function shellLines(cli: Cli): string[] {
  const start = shell.indexOf("print_store_access_guidance() {");
  assert.notEqual(start, -1, "the shell function moved: update this test");
  const body = shell.slice(start, shell.indexOf("\n}\n", start));
  const caseAt = body.indexOf('case "$cli" in');
  const head = echoes(body.slice(0, caseAt));
  const arm = new RegExp(`^\\s*${cli}\\)\\n([\\s\\S]*?)^\\s*;;`, "m").exec(body);
  return arm === null ? [] : [...head, ...echoes(arm[1] ?? "")];
}

function printed(cli: Cli): string[] {
  const lines: string[] = [];
  printStoreAccessGuidance({ out: (l) => void lines.push(l) }, cli);
  return lines;
}

test("the text equals the shell text for gemini and copilot (vacuity guard: not empty)", () => {
  for (const cli of ["gemini", "copilot"] as const) {
    const expected = shellLines(cli);
    assert.ok(expected.length > 10, `shell extraction for ${cli} is vacuous`);
    assert.deepEqual(printed(cli), expected);
  }
});

test("claude and antigravity print nothing, as the shell's case has no arm for them", () => {
  for (const cli of CLIS.filter((c) => c !== "gemini" && c !== "copilot")) {
    assert.deepEqual(printed(cli), []);
  }
  assert.deepEqual(shellLines("claude"), []);
  assert.deepEqual(shellLines("antigravity"), []);
});

test("the guidance names the flags of its CLI and writes nothing", () => {
  assert.ok(printed("gemini").includes("    gemini --skip-trust ..."));
  assert.ok(printed("copilot").includes("    copilot --allow-all-paths"));
  assert.equal(printed("gemini")[0], "");
});
