// setup-prompt-table.test.ts — the pin table of the setup question inventory (spec 0256 req. 12):
// ids, option order, defaults, askers and cancel classes, compared to what the shell does as
// recorded by the oracle (`prompt-inventory.json.golden`). Changing a row here is a spec delta.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { CLIS } from "../lib/setup/context.ts";
import type { Cli } from "../lib/setup/context.ts";
import { PROMPT_INVENTORY, cancelClassOf, isPromptId, rowOf } from "../lib/setup/prompt-ids.ts";

const GOLDEN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/setup-golden/prompt-inventory.json.golden",
);

interface GoldenRow {
  readonly id: string;
  readonly options: readonly string[];
  readonly clis: readonly string[];
  readonly cancel: Readonly<Record<string, string>>;
}

function readGolden(): GoldenRow[] {
  const raw: unknown = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
  assert.ok(Array.isArray(raw));
  return raw as GoldenRow[];
}

const ALL: readonly Cli[] = CLIS;
const CGA: readonly Cli[] = ["claude", "gemini", "antigravity"];
const AG_ABORT = { claude: "decline", gemini: "decline", copilot: "decline", antigravity: "abort" };
const same = (cancel: string, clis: readonly Cli[]) =>
  Object.fromEntries(clis.map((c) => [c, cancel]));

// id -> [options, askers, cancel per asker]; catalogue ids list no options.
const PIN: Readonly<Record<string, readonly [readonly string[], readonly Cli[], object]>> = {
  "link-confirm": [["no", "yes"], CGA, same("none", CGA)],
  "rules-action": [["keep", "refresh"], ALL, same("abort", ALL)],
  "validation.backend": [["internal", "plannotator"], ALL, same("default", ALL)],
  "validation.translate": [["off", "on"], ALL, same("default", ALL)],
  "validation.pedagogy": [["contextual", "simple", "professor"], ALL, same("default", ALL)],
  "validation.illustration": [["off", "on"], ALL, same("default", ALL)],
  "tls-delegation": [["no", "yes"], ALL, same("decline", ALL)],
  "mempalace-install": [["no", "yes"], ALL, same("decline", ALL)],
  "install-seqthink": [
    ["yes", "no"],
    ["claude", "antigravity"],
    same("abort", ["claude", "antigravity"]),
  ],
  "legacy-mcp-removal": [["no", "yes"], ["claude"], { claude: "abort" }],
  "install-settings": [["yes", "no"], ["claude"], { claude: "abort" }],
  "catalogue.team": [[], ALL, same("decline", ALL)],
  "catalogue.expertise": [[], ALL, same("decline", ALL)],
  "catalogue.level": [[], ALL, same("decline", ALL)],
  "profile-method": [["keep-local", "overwrite"], CGA, same("abort", CGA)],
  "overlay.community": [["no", "yes"], ALL, same("abort", ALL)],
  "overlay.org": [["no", "yes"], ALL, same("abort", ALL)],
  transcripts: [["no", "yes"], ALL, AG_ABORT],
  "transcripts-confirm": [["yes", "no"], ALL, AG_ABORT],
  "usage-capture": [["no", "yes"], ALL, AG_ABORT],
  "usage-capture-keep": [["keep", "remove"], ALL, AG_ABORT],
};

test("the inventory has exactly 21 ids and no duplicate", () => {
  const ids = PROMPT_INVENTORY.map((r) => r.id);
  assert.equal(ids.length, 21);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), Object.keys(PIN).sort());
});

test("each row pins its options (first = default), askers and cancel classes", () => {
  for (const r of PROMPT_INVENTORY) {
    const [options, clis, cancel] = PIN[r.id] ?? [[], [], {}];
    assert.deepEqual(r.options, options, `${r.id} options`);
    assert.deepEqual([...r.clis].sort(), [...clis].sort(), `${r.id} askers`);
    assert.deepEqual(r.cancel, cancel, `${r.id} cancel`);
    for (const cli of CLIS) {
      assert.equal(
        cancelClassOf(r.id, cli),
        (cancel as Record<string, string>)[cli],
        `${r.id}/${cli}`,
      );
    }
  }
});

test("the rows agree with the oracle's recorded shell inventory", () => {
  const golden = readGolden();
  assert.deepEqual(golden.map((g) => g.id).sort(), PROMPT_INVENTORY.map((r) => r.id).sort());
  for (const g of golden) {
    const r = rowOf(g.id);
    const expected = r.catalogue === undefined ? r.options : [`@catalogue:${r.catalogue}`];
    assert.deepEqual(g.options, expected, `${g.id} options`);
    assert.deepEqual([...g.clis].sort(), [...r.clis].sort(), `${g.id} askers`);
    assert.deepEqual(g.cancel, r.cancel, `${g.id} cancel`);
  }
});

test("link-confirm and profile-method are not asked by Copilot (delta-02)", () => {
  for (const id of ["link-confirm", "profile-method"]) {
    assert.equal(rowOf(id).clis.includes("copilot"), false);
    assert.equal(cancelClassOf(id, "copilot"), undefined);
  }
});

test("rowOf and isPromptId agree; the table is frozen", () => {
  assert.equal(isPromptId("transcripts"), true);
  assert.equal(isPromptId("nope"), false);
  assert.equal(isPromptId(7), false);
  assert.throws(() => rowOf("nope"));
  assert.ok(Object.isFrozen(PROMPT_INVENTORY) && Object.isFrozen(rowOf("rules-action")));
  assert.ok(Object.isFrozen(rowOf("rules-action").options));
});
