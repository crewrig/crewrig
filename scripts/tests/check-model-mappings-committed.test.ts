// check-model-mappings-committed.test.ts — Replaces scripts/tests/test-check-model-mappings.sh
// section 3 (spec 0265, row J2, P8): the four real committed mapping files run green against the
// checkout itself (CREWRIG_REPO_DIR = the checkout, read-only), plus the 26 content assertions
// that pin what the generic checker cannot know, as data-driven rows over js-yaml loads
// (formerly `assert_yq` with `yq -r`).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { assertConform, at, REPO, runChecker, yamlLib } from "./lib/model-mapping-fixtures.ts";

const load = (name: string): unknown =>
  yamlLib.load(fs.readFileSync(path.join(REPO, "model-mappings", name), "utf8"));
const docs = {
  claude: load("claude.yml"),
  gemini: load("gemini.yml"),
  copilot: load("copilot.yml"),
  antigravity: load("antigravity.yml"),
};

const has = (value: unknown, key: string): string =>
  String(value !== null && typeof value === "object" && key in value);
const len = (value: unknown): string => String(Array.isArray(value) ? value.length : "n/a");
/** The first `grounds` entry of `list` whose `field` equals `name`. */
const groundOf = (list: unknown, field: string, name: string, declares?: string): unknown => {
  const found = (Array.isArray(list) ? list : []).filter((e) => at(e, field) === name);
  const entry: unknown = found[0];
  if (declares === undefined) return at(entry, "grounds", 0);
  return (at(entry, "grounds") as unknown[]).filter((g) => at(g, "declares") === declares)[0];
};
const offer = (d: unknown, i: number): unknown => at(d, "offerings", i);
const trio = (d: unknown, i: number): string =>
  `${String(at(offer(d, i), "id"))}|${String(at(offer(d, i), "rank"))}|${String(at(offer(d, i), "provides", "intelligence"))}`;
const reasoning = (i: number): string =>
  `${String(at(offer(docs.antigravity, i), "encodes", "reasoning"))}|${String(at(offer(docs.antigravity, i), "provides", "reasoning"))}`;

const c = docs.claude;
const g = docs.gemini;
const a = docs.antigravity;
const guidance = (d: unknown, name: string): unknown =>
  groundOf(at(d, "surfaces", 1, "items"), "item", name);

const rows: readonly (readonly [string, string, string])[] = [
  ["claude offering 1 is haiku, rank 1, rung medium", trio(c, 0), "haiku|1|medium"],
  ["claude offering 2 is sonnet, rank 2, rung high", trio(c, 1), "sonnet|2|high"],
  ["claude offering 3 is opus, rank 3, rung xhigh", trio(c, 2), "opus|3|xhigh"],
  ["claude offering 4 is fable, rank 4, rung xxhigh", trio(c, 3), "fable|4|xxhigh"],
  [
    "claude haiku supports-reasoning-surface is true",
    String(at(offer(c, 0), "supports-reasoning-surface")),
    "true",
  ],
  [
    "claude haiku carries a citation ground on supports-reasoning-surface",
    has(groundOf([offer(c, 0)], "id", "haiku", "supports-reasoning-surface"), "citation"),
    "true",
  ],
  [
    "claude haiku carries a citation ground on supports-reasoning-surface.behavior",
    has(groundOf([offer(c, 0)], "id", "haiku", "supports-reasoning-surface.behavior"), "citation"),
    "true",
  ],
  [
    "claude reasoning projection: none is unmapped",
    String(at(c, "surfaces", 0, "items", 1, "projection", "none")),
    "unmapped",
  ],
  ["claude guard state is withheld", String(at(c, "guard", "state")), "withheld"],
  ["claude guard has exactly two terms", len(at(c, "guard", "terms")), "2"],
  [
    "claude guidance model item carries an assumption, not a citation",
    has(guidance(c, "model"), "assumption"),
    "true",
  ],
  [
    "claude guidance reasoning item carries an assumption, not a citation",
    has(guidance(c, "reasoning"), "assumption"),
    "true",
  ],
  ["gemini has exactly three offerings", len(at(g, "offerings")), "3"],
  ...[0, 1, 2].map(
    (i) =>
      [
        `gemini offering ${i + 1} declares supports-reasoning-surface explicitly`,
        has(offer(g, i), "supports-reasoning-surface"),
        "true",
      ] as const,
  ),
  ["copilot has zero offerings", len(at(docs.copilot, "offerings")), "0"],
  ["copilot declares a zero-offerings block", has(docs.copilot, "zero-offerings"), "true"],
  ["antigravity has exactly five offerings", len(at(a, "offerings")), "5"],
  ...(["medium", "low", "high", "high", "low"] as const).map(
    (rung, i) =>
      [
        `antigravity offering ${i + 1} encodes and provides matching reasoning (${rung})`,
        reasoning(i),
        `${rung}|${rung}`,
      ] as const,
  ),
  [
    "antigravity guidance model item carries an assumption, not a citation",
    has(at(a, "surfaces", 0, "items", 0, "grounds", 0), "assumption"),
    "true",
  ],
  [
    "antigravity records nine observed-not-declared identifiers",
    len(at(a, "observed-not-declared")),
    "9",
  ],
];

describe("check-model-mappings committed content (section 3)", () => {
  test("four mappings conform", () => {
    // The root is the checkout itself, not a copy: pass 3 resolves the real mapping in force.
    for (const name of ["claude", "gemini", "copilot", "antigravity"]) {
      assertConform(runChecker(REPO, [path.join(REPO, "model-mappings", `${name}.yml`)]));
    }
  });

  test("the content table has its 26 rows", () => {
    assert.equal(rows.length, 26);
  });

  for (const [name, got, expected] of rows) {
    test(name, () => assert.equal(got, expected));
  }
});
