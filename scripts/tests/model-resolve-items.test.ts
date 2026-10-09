// model-resolve-items.test.ts — every branch of the per-item gate `resolveItem` and of
// `valueInDomain` (spec 0250 R19; spec 0198 rule (g), R13-R16, R20, R23, R24, R31; D2, D12, D16).
// A synthetic target `t` exposes each branch in isolation; the expected strings were checked
// against the shell library (`resolve_agent`) while writing.
//
// PRESERVED shell quirks asserted on purpose, not as a recommendation: the awk field shift of
// `_value_in_domain` (a range with an empty `min` shifts `max` into the `min` slot, so `max` is
// never enforced), a value of digits and dots is a number whatever its shape (`1.2.3`), and a
// declared reasoning rung outside the projection emits an empty `effort:` line.

import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { valueInDomain } from "../lib/model-resolve/resolve-item.ts";
import {
  cleanupTmp,
  docOf,
  FM_ENTRY,
  gdEntry,
  makeRun,
  miniRoot,
  mkTmp,
  resolveProbe,
  tab,
  writeProfile,
  yamlText as y,
} from "./fixtures/build-components/model-resolve-kit.ts";

after(cleanupTmp);
const dir = mkTmp();
const O = (srs: string): string =>
  `{id: a, rank: 1, native-value: n-a, provides: {intelligence: high}, supports-reasoning-surface: ${srs}}`;
const GD = gdEntry("Run on {{model}}.", "Effort {{reasoning}}.");
const GUARD =
  "guard:\n  id: g\n  state: withheld\n  terms:\n    - {id: t1, holds: true}\n    - {id: t2, holds: false}\n    - {id: t3, holds: true}";
const go = (root: string, ...profile: string[]) =>
  resolveProbe(makeRun(root), writeProfile(dir, "intelligence: high", ...profile), "t");
const reasons = (lines: readonly string[]): string[] =>
  lines.map((l) => l.split("\t").slice(3).join("|"));
const knob = (name: string, value: string): string => `tuning:\n  ${name}: ${value}`;

describe("resolveItem: eligibility and direction", () => {
  const root = miniRoot([O("true")]);

  test("a declared model, reasoning and knob are directed in the surface's own item order", () => {
    const r = go(root, "reasoning: medium", knob("temperature", "0.5"));
    assert.deepEqual(
      [r.fmLines, r.diagLines],
      [["model: n-a", "effort: medium", "temperature: 0.5"], []],
    );
  });

  test("an undeclared item records nothing and emits nothing", () => {
    assert.deepEqual([go(root).fmLines, go(root).diagLines], [["model: n-a"], []]);
  });

  test("a tuning key outside the seven-token vocabulary is skipped silently", () => {
    const r = go(root, knob("bogus", "1"));
    assert.deepEqual([r.fmLines, r.diagLines], [["model: n-a"], []]);
  });

  test("(g)(3) a knob the frontmatter surface does not declare is unsupported-on-cli", () => {
    assert.deepEqual(reasons(go(root, knob("top-p", "0.9")).diagLines), [
      "metadata.model.tuning.top-p|0.9|unsupported-on-cli",
    ]);
  });

  test("(g)(3) D16: a knob is frontmatter-only, even when a guidance surface exists", () => {
    const r = go(miniRoot([O("true")], "", [GD]), knob("temperature", "1"));
    assert.deepEqual(reasons(r.diagLines), [
      "metadata.model.tuning.temperature|1|unsupported-on-cli",
    ]);
    assert.equal(r.prose, "Run on n-a.");
  });
});

describe("resolveItem: D16, a knob is frontmatter-only even when guidance declares it", () => {
  test("(g)(3) a guidance surface that names the knob does not carry it", () => {
    const guidance =
      "  - id: gd\n    kind: guidance\n    template: |\n      Run on {{model}}.\n    items:\n      - {item: model}\n      - {item: top-p}";
    const r = go(miniRoot([O("true")], "", [FM_ENTRY, guidance]), knob("top-p", "0.9"));
    assert.deepEqual(reasons(r.diagLines), ["metadata.model.tuning.top-p|0.9|unsupported-on-cli"]);
    assert.deepEqual([r.fmLines, r.prose], [["model: n-a"], "Run on n-a."]);
  });
});

describe("resolveItem: reasoning", () => {
  test("(g)(4) an offering refusing the reasoning surface drops it unsupported-on-model", () => {
    const r = go(miniRoot([O("false")]), "reasoning: medium");
    assert.deepEqual(
      [r.fmLines, reasons(r.diagLines)],
      [["model: n-a"], ["metadata.model.reasoning|medium|unsupported-on-model"]],
    );
  });

  test("(g)(5) a rung the projection declares unmapped is dropped out-of-range-for-target", () => {
    const r = go(miniRoot([O("true")]), "reasoning: none");
    assert.deepEqual(reasons(r.diagLines), [
      "metadata.model.reasoning|none|out-of-range-for-target",
    ]);
  });

  test("PRESERVED shell quirk: a rung outside the projection emits an empty effort line", () => {
    assert.deepEqual(go(miniRoot([O("true")]), "reasoning: bogus").fmLines, [
      "model: n-a",
      "effort: ",
    ]);
  });

  test("D2/D12: with no offering declared, reasoning drops unsupported-on-model after model drops", () => {
    const r = go(miniRoot([]), "reasoning: medium");
    assert.deepEqual(reasons(r.diagLines), [
      "metadata.model.intelligence|high|unsupported-on-cli",
      "metadata.model.reasoning|medium|unsupported-on-model",
    ]);
  });

  test("D2: with no offering, a guidance surface still carries reasoning and model is dropped", () => {
    const r = go(miniRoot([], "", [FM_ENTRY, GD]), "reasoning: medium");
    assert.deepEqual(
      [r.prose, reasons(r.diagLines)],
      ["", ["metadata.model.reasoning|medium|unsupported-on-model"]],
    );
  });
});

describe("resolveItem: the withheld guard and unreadable cells", () => {
  const withheld = (entries: string[]) => miniRoot([O("true")], GUARD, entries);

  test("a withheld guard moves model to guidance only, with one note naming the holding terms", () => {
    const r = go(withheld([FM_ENTRY, GD]), "reasoning: medium");
    assert.deepEqual(r.fmLines, ["effort: medium"]);
    assert.equal(r.prose, "Run on n-a. Effort medium.");
    assert.deepEqual(r.diagLines, [
      tab("model-note", "probe", "t", "guard-withheld", "terms=t1,t3 surface=guidance"),
    ]);
  });

  test("a withheld guard with no guidance surface drops model unsupported-on-cli", () => {
    const r = go(withheld([FM_ENTRY]), "reasoning: medium");
    assert.deepEqual(
      [r.fmLines, reasons(r.diagLines)],
      [["effort: medium"], ["metadata.model.intelligence|high|unsupported-on-cli"]],
    );
  });

  test("a guard directed (not withheld) behaves as no guard", () => {
    const r = go(miniRoot([O("true")], GUARD.replace("withheld", "directed"), [FM_ENTRY, GD]));
    assert.deepEqual([r.fmLines, r.diagLines], [["model: n-a"], []]);
  });

  const DOMAIN =
    "  - id: fm\n    kind: frontmatter\n    items:\n      - {item: model, key: model, domain: {values: [x, y]}}";
  const NOTE = tab(
    "model-note",
    "probe",
    "t",
    "unreadable-cell",
    "offering=a native-value=n-a outside the frontmatter model key's declared domain",
  );

  test("a native value outside the model key's domain is not emitted in frontmatter, one note", () => {
    const r = go(miniRoot([O("true")], "", [DOMAIN]));
    assert.deepEqual([r.fmLines, r.diagLines], [[], [NOTE]]);
  });

  test("an unreadable cell is still carried by the guidance surface", () => {
    const r = go(miniRoot([O("true")], "", [DOMAIN, GD]));
    assert.deepEqual([r.fmLines, r.prose, r.diagLines], [[], "Run on n-a.", [NOTE]]);
  });
});

describe("valueInDomain", () => {
  const mapping = docOf(
    "surfaces:\n  - id: fm\n    items:\n" +
      "      - {item: temperature, domain: {type: number, min: 0.0, max: 2.0}}\n" +
      "      - {item: top-p, domain: {type: number, max: 5}}\n" +
      "      - {item: top-k, domain: {type: integer, min: 3}}\n" +
      "      - {item: max-turns, domain: {values: [a, b]}}\n" +
      "      - {item: max-output-tokens}\n",
  );
  const inDomain = (item: string, value: string): boolean =>
    valueInDomain(y, mapping, "surfaces/fm", item, value);

  test("a ranged domain admits the bounds and what lies between", () => {
    for (const value of ["0", "0.0", "1", "2.0", "2", ".5"])
      assert.equal(inDomain("temperature", value), true, value);
  });

  test("a ranged domain refuses beyond the bounds, and anything not digits and dots", () => {
    for (const value of ["2.1", "5", "-1", "1e1", "abc", "", "1,5", " 1"])
      assert.equal(inDomain("temperature", value), false, JSON.stringify(value));
  });

  test("PRESERVED shell quirk: digits and dots is a number whatever the shape", () => {
    assert.equal(inDomain("temperature", "1.2.3"), true);
    // awk reads the longest numeric prefix: 2.0.1 is 2.0 (in range), 2.1.1 is 2.1 (out)
    assert.equal(inDomain("temperature", "2.0.1"), true);
    assert.equal(inDomain("temperature", "2.1.1"), false);
  });

  test("PRESERVED shell quirk: an empty min shifts max into its place, so max is never enforced", () => {
    assert.deepEqual(
      ["3", "4", "5", "9"].map((v) => inDomain("top-p", v)),
      [false, false, true, true],
    );
  });

  test("a one-sided range enforces its own bound", () => {
    assert.deepEqual(
      ["2", "3", "999"].map((v) => inDomain("top-k", v)),
      [false, true, true],
    );
  });

  test("a values domain needs membership; no domain at all admits anything, even the empty text", () => {
    assert.deepEqual(
      [inDomain("max-turns", "a"), inDomain("max-turns", "c"), inDomain("max-turns", "")],
      [true, false, false],
    );
    assert.deepEqual(
      [inDomain("max-output-tokens", "x"), inDomain("max-output-tokens", "")],
      [true, true],
    );
  });
});
