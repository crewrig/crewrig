// setup-retarget-tier-resolution.test.ts — the pin of the R20 relational arm of
// scripts/tests/test-component-tier-resolution.sh (ticket #1335, spec 0256 requirement 9, PR D1).
// The suite compares each manage command's landing zone and staging root with its assisted setup's;
// it used to parse the setup side out of the text of the setup-*-interactive.sh scripts and now
// reads the setup's DECLARATION (print-setup-declarations.ts) beside the manage one
// (print-manage-declarations.ts). This test keeps the two declarations agreeing, and pins the
// staging root of each CLI literally (the shell the root used to be compared with is a shim now).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

import { claudeDescriptor } from "../lib/setup/cli-claude.ts";
import { manageDeclarationFacts } from "./lib/print-manage-declarations.ts";
import { main } from "./lib/print-setup-declarations.ts";

const ENTRY = path.join(import.meta.dirname, "lib", "print-setup-declarations.ts");

/** The covered pairs of the suite's CLI_ROWS: exhaustive, `skills` on all four, `agents` on Gemini. */
const PAIRS: readonly (readonly [cli: string, type: string])[] = [
  ["claude", "skills"],
  ["gemini", "skills"],
  ["gemini", "agents"],
  ["copilot", "skills"],
  ["antigravity", "skills"],
];

function setupFacts(cli: string): Map<string, string> {
  const run = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, cli],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const facts = new Map<string, string>();
  for (const line of run.stdout.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0 && !line.startsWith("step ")) facts.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return facts;
}

/** `<cli>` -> `<key>` -> every value of the manage declaration (the printer's TAB-separated lines). */
function manageFacts(): Map<string, Map<string, string[]>> {
  const out = new Map<string, Map<string, string[]>>();
  for (const line of manageDeclarationFacts()) {
    const [cli, key, value] = line.split("\t");
    if (cli === undefined || key === undefined || value === undefined) continue;
    const byKey = out.get(cli) ?? new Map<string, string[]>();
    byKey.set(key, [...(byKey.get(key) ?? []), value]);
    out.set(cli, byKey);
  }
  return out;
}

/** The one value of `<prefix>.<name>` whose command-side type name is `type` or `<cli>-<type>` (Claude's `claude-skills`). */
function oneOf(byKey: Map<string, string[]>, prefix: string, type: string): string[] | undefined {
  const keys = [...byKey.keys()].filter(
    (k) => k.startsWith(`${prefix}.`) && (k.endsWith(`.${type}`) || k.endsWith(`-${type}`)),
  );
  assert.equal(keys.length, 1, `${prefix}.*${type}: ${keys.length} facts`);
  return byKey.get(keys[0] as string);
}

/** The literal staging root (the last segment of `tiers.staging`) of each CLI's setup. */
const STAGING_ROOT: Readonly<Record<string, string>> = {
  claude: ".claude",
  gemini: ".gemini",
  copilot: ".github",
  antigravity: ".agents",
};

describe("the setup declaration agrees with the manage declaration", () => {
  const manage = manageFacts();

  for (const [cli, type] of PAIRS) {
    it(`${cli}/${type}: landing zone and staging root are the same in both declarations`, () => {
      const setup = setupFacts(cli);
      const zone = setup.get(`home.${type}`);
      const staging = setup.get("tiers.staging");
      const byKey = manage.get(cli);

      // Vacuity: a missing fact on either side fails instead of matching `undefined === undefined`.
      assert.ok(
        zone !== undefined && zone !== "",
        `no home.${type} in the ${cli} setup declaration`,
      );
      assert.ok(
        staging !== undefined && staging !== "",
        `no tiers.staging in the ${cli} setup declaration`,
      );
      assert.ok(byKey !== undefined, `no manage declaration for ${cli}`);

      assert.deepEqual(oneOf(byKey, "dest", type), [zone]);
      assert.deepEqual(oneOf(byKey, "staging", type), [`${staging}/${type}`]);
      const root = staging.replace(/^<REPO>\/dist\/<TIER>\//, "");
      assert.notEqual(root, staging, "tiers.staging is not in the <REPO>/dist/<TIER>/<root> form");
      assert.deepEqual(oneOf(byKey, "staging-root", type), [`${root}/${type}`]);
    });
  }

  for (const [cli, root] of Object.entries(STAGING_ROOT)) {
    it(`${cli}: the declared staging is <REPO>/dist/<TIER>/${root}`, () => {
      assert.equal(setupFacts(cli).get("tiers.staging"), `<REPO>/dist/<TIER>/${root}`);
    });
  }

  it("makes the setup printer fail with nothing on stdout when the descriptor is emptied", () => {
    let stdout = "";
    let stderr = "";

    const status = main(
      ["claude"],
      { write: (t) => (stdout += t) },
      { write: (t) => (stderr += t) },
      { claude: { ...claudeDescriptor, steps: [] } },
    );

    assert.equal(status, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /empty/);
  });
});
