// model-resolve-mapping-access.test.ts — the addressing-grammar accessors of
// scripts/lib/model-resolve/mapping-access.ts (spec 0250 R19; spec 0198 R2, R17).
//
// Each accessor is read on the four real `model-mappings/*.yml`, then on small synthetic
// documents for the edges the real files do not reach. Documented as the twin does it, not
// as parity: with two surfaces (or two items) sharing an id, the FIRST match is used where
// `yq` printed one line per match; and the awk field shift of `mapping_item_domain_range`
// (an empty `min` shifts `max` left) is a preserved shell quirk of the SHAPE of the string.

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

import * as A from "../lib/model-resolve/mapping-access.ts";
import { loadMapping } from "../lib/model-resolve/yaml-nodes.ts";
import {
  docOf,
  REPO,
  TARGETS,
  yamlText as y,
} from "./fixtures/build-components/model-resolve-kit.ts";

const real = (target: string) => loadMapping(y, path.join(REPO, "model-mappings", `${target}.yml`));
const ITEMS = ["model", "reasoning", "temperature", "max-turns"];

interface Expect {
  fm: string;
  gd: string;
  express: [boolean, boolean, boolean, boolean];
  keys: string[];
  values: string[];
  ranges: string[];
  guard: string;
  order: string;
  offerings: string[];
}
const VOCAB = "model reasoning temperature top-p top-k max-output-tokens max-turns";
const expected: Record<string, Expect> = {
  claude: {
    fm: "surfaces/frontmatter",
    gd: "surfaces/guidance",
    express: [true, true, false, false],
    keys: ["model", "effort", "", ""],
    values: ["haiku sonnet opus fable", "low medium high xhigh max", "", ""],
    ranges: ["", "", "", ""],
    guard: "withheld",
    order: VOCAB,
    offerings: [
      "haiku:1:medium:true",
      "sonnet:2:high:true",
      "opus:3:xhigh:true",
      "fable:4:xxhigh:true",
    ],
  },
  gemini: {
    fm: "surfaces/frontmatter",
    gd: "",
    express: [true, false, true, true],
    keys: ["model", "", "temperature", "max_turns"],
    values: ["gemini-3.1-flash-lite gemini-3.5-flash gemini-3.1-pro-preview", "", "", ""],
    // `integer 1 `: no max declared, so the string ends in a blank (see the file header).
    ranges: ["", "", "number 0.0 2.0", "integer 1 "],
    guard: "",
    order: "model temperature max-turns reasoning top-p top-k max-output-tokens",
    offerings: [
      "gemini-3.1-flash-lite:1:low:false",
      "gemini-3.5-flash:2:medium:false",
      "gemini-3.1-pro-preview:3:high:false",
    ],
  },
  antigravity: {
    fm: "",
    gd: "surfaces/guidance",
    express: [false, false, false, false],
    keys: ["", "", "", ""],
    values: ["", "", "", ""],
    ranges: ["", "", "", ""],
    guard: "",
    order: VOCAB,
    offerings: [
      "gemini-3.8-flash-medium:1:medium:false",
      "gemini-3.8-flash-low:2:medium:false",
      "gemini-3.8-flash-high:3:medium:false",
      "gemini-3.1-pro-high:4:high:false",
      "gemini-3.1-pro-low:5:high:false",
    ],
  },
  copilot: {
    fm: "surfaces/agent-file-model",
    gd: "",
    express: [true, false, false, false],
    keys: ["model", "", "", ""],
    values: ["", "", "", ""],
    ranges: ["", "", "", ""],
    guard: "",
    order: VOCAB,
    offerings: [],
  },
};

describe("accessors over the four real mappings", () => {
  for (const target of TARGETS) {
    const want = expected[target] as Expect;
    const doc = real(target);

    test(`${target}: surfaces by kind, expressed items and native keys`, () => {
      assert.equal(A.surfaceOfKind(y, doc, "frontmatter"), want.fm);
      assert.equal(A.surfaceOfKind(y, doc, "guidance"), want.gd);
      assert.deepEqual(
        ITEMS.map((i) => A.expressesItem(y, doc, "frontmatter", i)),
        want.express,
      );
      assert.deepEqual(
        ITEMS.map((i) => A.itemKey(y, doc, want.fm, i)),
        want.keys,
      );
    });

    test(`${target}: domain values, domain ranges, guard and item order`, () => {
      assert.deepEqual(
        ITEMS.map((i) => A.itemDomainValues(y, doc, want.fm, i)),
        want.values,
      );
      assert.deepEqual(
        ITEMS.map((i) => A.itemDomainRange(y, doc, want.fm, i)),
        want.ranges,
      );
      assert.equal(A.guardState(y, doc), want.guard);
      assert.equal(A.itemOrder(y, doc).join(" "), want.order);
    });

    test(`${target}: offerings load in file order with id, rank, tier and reasoning surface`, () => {
      const got = A.offeringsLoad(y, doc).map(
        (o) => `${o.id}:${o.rank}:${o.intelligence}:${o.supportsReasoningSurface}`,
      );
      assert.deepEqual(got, want.offerings);
    });
  }

  test("the guidance surface expresses model (and reasoning on claude only)", () => {
    const gd = (t: string) =>
      ["model", "reasoning"].map((i) => A.expressesItem(y, real(t), "guidance", i));
    assert.deepEqual(
      [gd("claude"), gd("gemini"), gd("antigravity")],
      [
        [true, true],
        [false, false],
        [true, false],
      ],
    );
  });

  test("claude: projection, template and the guard terms that hold", () => {
    const doc = real("claude");
    assert.equal(A.reasoningProjection(y, doc, "surfaces/frontmatter", "none"), "unmapped");
    assert.equal(A.reasoningProjection(y, doc, "surfaces/frontmatter", "low"), "low");
    assert.equal(A.reasoningProjection(y, doc, "surfaces/frontmatter", "bogus"), "");
    assert.equal(
      A.guidanceTemplate(y, doc, "surfaces/guidance"),
      "Run this agent on the {{model}} model.\nGive its work {{reasoning}} reasoning effort.",
    );
    assert.equal(
      A.guardHoldingTerms(y, doc),
      "defect-not-established-fixed,copilot-reader-consumes-claude-surface",
    );
  });

  test("antigravity: an offering's encoded reasoning rung is read, defaults fill the rest", () => {
    const [first] = A.offeringsLoad(y, real("antigravity"));
    assert.deepEqual(
      [
        first?.encodedReasoning,
        first?.speed,
        first?.locality,
        first?.modalities,
        first?.specialization,
      ],
      ["medium", "standard", "any", "", "general"],
    );
  });
});

describe("synthetic documents", () => {
  test("a null document degrades every accessor to its empty result", () => {
    assert.equal(A.surfaceOfKind(y, null, "frontmatter"), "");
    assert.equal(A.expressesItem(y, null, "frontmatter", "model"), false);
    assert.equal(A.guardState(y, null), "");
    assert.equal(A.guardHoldingTerms(y, null), "");
    assert.deepEqual(A.offeringsLoad(y, null), []);
    assert.equal(A.itemOrder(y, null).join(" "), VOCAB);
  });

  test("two surfaces sharing an id: the first one answers", () => {
    const doc = docOf(
      "surfaces:\n  - {id: s, kind: frontmatter, items: [{item: model, key: first}]}\n  - {id: s, kind: frontmatter, items: [{item: model, key: second}]}\n",
    );
    assert.equal(A.itemKey(y, doc, "surfaces/s", "model"), "first");
  });

  test("two items sharing a name on one surface: the first one answers", () => {
    const doc = docOf(
      "surfaces:\n  - id: s\n    kind: frontmatter\n    items:\n      - {item: model, key: a}\n      - {item: model, key: b}\n",
    );
    assert.equal(A.itemKey(y, doc, "surfaces/s", "model"), "a");
  });

  test("a surface of the wanted kind with no id is skipped for the next one", () => {
    const doc = docOf("surfaces:\n  - {kind: guidance}\n  - {id: g2, kind: guidance}\n");
    assert.equal(A.surfaceOfKind(y, doc, "guidance"), "surfaces/g2");
  });

  test("addrSurfaceId reads the id out of a surface or template address", () => {
    assert.equal(A.addrSurfaceId("surfaces/a/template"), "a");
    assert.equal(A.addrSurfaceId("surfaces/b"), "b");
    assert.equal(A.addrSurfaceId("x/y"), "x");
  });

  test("offering defaults: speed standard, locality any, reasoning surface false, modalities joined", () => {
    const doc = docOf(
      "offerings:\n  - id: a\n  - {id: b, provides: {speed: fast, locality: local, modalities: [text, image]}, supports-reasoning-surface: true}\n",
    );
    const [a, b] = A.offeringsLoad(y, doc);
    assert.deepEqual(
      [a?.speed, a?.locality, a?.supportsReasoningSurface, a?.modalities],
      ["standard", "any", "false", ""],
    );
    assert.deepEqual(
      [b?.speed, b?.locality, b?.supportsReasoningSurface, b?.modalities],
      ["fast", "local", "true", "text image"],
    );
  });

  test("an empty rank reads as the empty text, a hex rank as written", () => {
    const [a, b] = A.offeringsLoad(
      y,
      docOf("offerings:\n  - {id: a, rank: }\n  - {id: b, rank: 0x10}\n"),
    );
    assert.deepEqual([a?.rank, b?.rank], ["", "0x10"]);
  });

  test("guard terms: only a term recorded holds is listed; a guard without terms lists none", () => {
    const doc = docOf(
      "guard:\n  state: withheld\n  terms:\n    - {id: t1, holds: true}\n    - {id: t2, holds: false}\n    - {id: t3}\n    - {id: t4, holds: 'true'}\n",
    );
    assert.equal(A.guardHoldingTerms(y, doc), "t1,t4");
    assert.equal(A.guardHoldingTerms(y, docOf("guard:\n  state: directed\n")), "");
    assert.equal(A.guardState(y, docOf("guard:\n  id: g\n")), "");
  });

  test("item order: frontmatter first, then guidance extras, then the unnamed vocabulary", () => {
    const doc = docOf(
      "surfaces:\n  - {id: f, kind: frontmatter, items: [{item: max-turns}, {item: model}]}\n  - {id: g, kind: guidance, items: [{item: reasoning}, {item: model}]}\n",
    );
    assert.deepEqual(A.itemOrder(y, doc), [
      "max-turns",
      "model",
      "reasoning",
      "temperature",
      "top-p",
      "top-k",
      "max-output-tokens",
    ]);
  });

  test("an item outside the vocabulary stays in the declared order (the resolver skips it later)", () => {
    const doc = docOf(
      "surfaces:\n  - {id: f, kind: frontmatter, items: [{item: context}, {item: model}]}\n",
    );
    assert.equal(A.itemOrder(y, doc)[0], "context");
  });

  test("words splits on blanks, tabs and line feeds and drops empties", () => {
    assert.deepEqual(A.words(" a  b\tc\nd "), ["a", "b", "c", "d"]);
    assert.deepEqual(A.words(""), []);
  });
});
