// Replaces scripts/tests/test-check-gemini-overlay-enrollment.sh (spec 0265, row J2, P6).
// Cases a-m of the Bash suite, plus m2 (printer exits 1 AFTER a valid declaration), run
// against scripts/check-gemini-overlay-enrollment.ts in fixture repositories. Case l runs
// the guard against the real checkout and the real printer.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  MAIN_DEPLOYED,
  MAIN_ENROLLED,
  makePrinter,
  makePrinterExiting1,
  makePrinterFailingAfterDeclaring,
  makeSettings,
} from "./lib/governance-gemini-overlay-fixture.ts";
import { makeSandbox, REPO, runEntry } from "./lib/governance-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "check-gemini-overlay-enrollment.ts");

function check(repo: string) {
  return runEntry(ENTRY, { env: { CREWRIG_REPO_DIR: repo } });
}

function fixture(deployed: readonly string[] | null, enrolled: readonly string[] | null): string {
  const repo = makeSandbox("overlay-enroll-");
  if (deployed !== null) makePrinter(repo, deployed);
  if (enrolled !== null) makeSettings(repo, enrolled);
  return repo;
}

const without = (names: readonly string[], ...drop: string[]): string[] =>
  names.filter((n) => !drop.includes(n));

const failedBlock = (count: number, names: string[]): string =>
  `FAILED: ${count} deployed Gemini overlay(s) not enrolled in context.fileName (spec 0085):\n` +
  names.map((n) => `  - ${n}\n`).join("") +
  "\nThe Gemini setup (its declaration) deploys the overlay(s) above to the\n" +
  "Gemini home directory, but config/gemini/settings.json does not enroll them\n" +
  "in context.fileName, so Gemini would silently never load them. Add each to\n" +
  "the context.fileName array.\n";

describe("check-gemini-overlay-enrollment cases", () => {
  it("case-a: full main enrollment passes (exit 0), OK line, no AGENTS.md warning (R5)", () => {
    const r = check(fixture(MAIN_DEPLOYED, MAIN_ENROLLED));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(
      r.stdout,
      "OK: all 9 deployed Gemini overlays are enrolled in context.fileName.\n",
    );
    assert.ok(r.stdout.includes("OK: all"));
    assert.ok(!r.stderr.includes("AGENTS.md"), r.stderr);
    assert.equal(r.stderr, "");
  });

  it("case-b: pre-fix state fails (exit 1) and names 65_TOOLS.md and 66_ORG_RULES.md", () => {
    const enrolled = without(MAIN_ENROLLED, "65_TOOLS.md", "66_ORG_RULES.md");
    const r = check(fixture(MAIN_DEPLOYED, enrolled));
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.stderr.includes("65_TOOLS.md") && r.stderr.includes("66_ORG_RULES.md"));
    assert.equal(r.stderr, failedBlock(2, ["65_TOOLS.md", "66_ORG_RULES.md"]));
  });

  it("case-c: un-enrolled indirect-target overlay fails (exit 1), names 30_USER_PROFILE.md (R3)", () => {
    const r = check(fixture(MAIN_DEPLOYED, without(MAIN_ENROLLED, "30_USER_PROFILE.md")));
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.stderr.includes("30_USER_PROFILE.md"));
    assert.equal(r.stderr, failedBlock(1, ["30_USER_PROFILE.md"]));
  });

  it("case-d: AGENTS.md is a silent enrolled-but-not-deployed exception (R5)", () => {
    const r = check(fixture(MAIN_DEPLOYED, MAIN_ENROLLED));
    assert.equal(r.status, 0);
    assert.ok(!r.stderr.includes("AGENTS.md"), r.stderr);
  });

  it("case-e: enrolled-but-not-deployed entry warns without failing (exit 0, R6)", () => {
    const r = check(fixture(MAIN_DEPLOYED, [...MAIN_ENROLLED, "99_GHOST.md"]));
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stderr.includes("99_GHOST.md"), r.stderr);
    assert.equal(
      r.stderr,
      "WARNING: 1 overlay(s) enrolled in context.fileName but not deployed by the setup (per its declaration):\n" +
        "  - 99_GHOST.md\n" +
        "This is drift, not a failure — either enroll a deploy for it or remove it\n" +
        "from config/gemini/settings.json (spec 0085 R6).\n\n",
    );
  });

  it("case-f: un-enrolled mixed-case overlay fails (exit 1), names 67_NewTool.md (R2)", () => {
    const r = check(fixture([...MAIN_DEPLOYED, "67_NewTool.md"], MAIN_ENROLLED));
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.stderr.includes("67_NewTool.md"));
    assert.equal(r.stderr, failedBlock(1, ["67_NewTool.md"]));
  });

  it("case-g: missing source file fails closed (exit 2)", () => {
    const repo = fixture(MAIN_DEPLOYED, null);
    const r = check(repo);
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.stderr, `Error: source not found: ${repo}/config/gemini/settings.json\n`);
  });

  it("case-h: empty deployed set fails closed (exit 2)", () => {
    const r = check(fixture([], MAIN_ENROLLED));
    assert.equal(r.status, 2, r.stderr);
    assert.equal(
      r.stderr,
      "Error: no deployed overlays found in the gemini setup declaration — the\n" +
        "declaration shape may have changed; refusing to run a vacuous enrollment check.\n",
    );
  });

  it("case-i: malformed settings JSON fails closed (exit 2)", () => {
    const repo = fixture(MAIN_DEPLOYED, null);
    fs.mkdirSync(path.join(repo, "config", "gemini"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "config", "gemini", "settings.json"),
      "{ this is not valid json ]\n",
    );
    const r = check(repo);
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes("could not read a well-formed context.fileName list"));
  });

  it("case-j: settings missing context.fileName fails closed (exit 2)", () => {
    const repo = fixture(MAIN_DEPLOYED, null);
    fs.mkdirSync(path.join(repo, "config", "gemini"), { recursive: true });
    fs.writeFileSync(path.join(repo, "config", "gemini", "settings.json"), '{ "context": {} }\n');
    const r = check(repo);
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes("context.fileName is absent or not an array"));
  });

  it("case-k: present-but-empty fileName is a forward failure (exit 1, not 2)", () => {
    const r = check(fixture(MAIN_DEPLOYED, []));
    assert.equal(r.status, 1, r.stderr);
    assert.equal(r.stderr, failedBlock(9, [...MAIN_DEPLOYED]));
  });

  it("case-l: the real repository and the real printer pass (exit 0)", () => {
    const r = runEntry(ENTRY, { env: { CREWRIG_REPO_DIR: undefined } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(`${r.stdout}${r.stderr}`.includes("OK: all"));
  });

  it("case-m: an empty declaration (printer exit 1, no stdout) fails closed (exit 2)", () => {
    const repo = fixture(null, MAIN_ENROLLED);
    makePrinterExiting1(repo);
    const r = check(repo);
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes("produced no declaration for gemini"));
  });

  it("case-m2: a printer exiting 1 after a valid declaration still fails closed (exit 2)", () => {
    const repo = fixture(null, MAIN_ENROLLED);
    makePrinterFailingAfterDeclaring(repo);
    const r = check(repo);
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes("produced no declaration for gemini"));
  });
});
