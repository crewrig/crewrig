// check-model-mappings-rejections.test.ts — Replaces scripts/tests/test-check-model-mappings.sh
// section 1 (spec 0265, row J2, P8): a valid baseline proven green, then one single-cell
// mutation per rejection class proven red, asserting BOTH the exit code and the assertion id
// (`: <ID> `) in the output. A11 has no independent single-cell red shape (total by
// construction whenever one offering declares provides.intelligence, spec 0197 Decision 2):
// its fixture blanks provides.intelligence on EVERY offering, which co-fires A26, and the
// case asserts both ids. The former exit-2-without-yq case is covered by
// model-ci-tooling-model-mappings-d.test.ts (the twin has no yq prerequisite).

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  assertConform,
  assertRejected,
  baseDoc,
  bareRoot,
  mutate,
  nth,
  runChecker,
  writeCase,
  zeroOfferingsDoc,
  type Doc,
} from "./lib/model-mapping-fixtures.ts";

const root = bareRoot();
const check = (file: string) => runChecker(root, [file]);

const offering = (d: Doc, i: number) => nth(d.offerings, i);
const surface = (d: Doc, i: number) => nth(d.surfaces, i);
const item = (d: Doc, s: number, i: number) => nth(surface(d, s).items, i);
const term = (d: Doc, i: number) => nth(d.guard?.terms, i);

/** A valid DIRECTED guard first (both terms false, satisfying A23); A14a/A14b mutate from it. */
const directed = (d: Doc): void => {
  if (d.guard) d.guard.state = "directed";
  term(d, 0).holds = false;
};

interface Row {
  readonly label: string;
  readonly stem?: string;
  readonly edits: readonly ((d: Doc) => void)[];
  readonly ids: readonly string[];
}

const rows: readonly Row[] = [
  {
    label: "A1 — target outside vocabulary",
    edits: [(d) => void (d.target = "bogus")],
    ids: ["A1"],
  },
  { label: "A2 — target disagrees with filename stem", stem: "other", edits: [], ids: ["A2"] },
  {
    label: "A3 — unknown top-level key",
    edits: [(d) => void (d["bogus-top-level"] = "x")],
    ids: ["A3"],
  },
  {
    label: "A4 — empty grounds list",
    edits: [(d) => void (offering(d, 0).grounds = [])],
    ids: ["A4"],
  },
  {
    label: "A5 — grounds entry carries both marks",
    edits: [(d) => void (nth(offering(d, 0).grounds, 0).assumption = "also-assumed")],
    ids: ["A5"],
  },
  {
    label: "A6 — duplicate offering id",
    edits: [(d) => void (offering(d, 1).id = "alpha")],
    ids: ["A6"],
  },
  {
    label: "A7 — duplicate offering rank",
    edits: [(d) => void (offering(d, 1).rank = 1)],
    ids: ["A7"],
  },
  {
    label: "A8 — provides value outside domain",
    edits: [(d) => void (offering(d, 0).provides.intelligence = "nope")],
    ids: ["A8"],
  },
  {
    label: "A9 — native-value outside declared domain",
    edits: [(d) => void (offering(d, 0)["native-value"] = "gamma")],
    ids: ["A9"],
  },
  {
    label: "A10 — encodes names a characteristic not provided",
    edits: [(d) => void (offering(d, 0).encodes = { reasoning: "alpha" })],
    ids: ["A10"],
  },
  {
    label: "A11 — no offering selectable at any rung (co-fires A26)",
    edits: [
      (d) => void delete offering(d, 0).provides.intelligence,
      (d) => void delete offering(d, 1).provides.intelligence,
    ],
    ids: ["A11", "A26"],
  },
  {
    label: "A12 — projection missing a reasoning rung",
    edits: [(d) => void delete item(d, 0, 1).projection?.["medium"]],
    ids: ["A12"],
  },
  {
    label: "A13 — claude target with no guard block",
    edits: [(d) => void delete d.guard],
    ids: ["A13"],
  },
  {
    label: "A14a — directed guard term's evidence is blank",
    edits: [directed, (d) => void (term(d, 0).evidence = "   ")],
    ids: ["A14a"],
  },
  {
    label: "A14b — directed guard term's holds ground is an assumption",
    edits: [
      directed,
      (d) => void delete nth(term(d, 0).grounds, 0).citation,
      (d) => void (nth(term(d, 0).grounds, 0).assumption = "not-a-citation"),
    ],
    ids: ["A14b"],
  },
  {
    label: "A15 — offering missing a required key",
    edits: [(d) => void delete offering(d, 0).rank],
    ids: ["A15"],
  },
  {
    label: "A16 — grounds mark text is whitespace-only",
    edits: [(d) => void (nth(offering(d, 0).grounds, 0).citation = "   ")],
    ids: ["A16"],
  },
  {
    label: "A17 — supports-reasoning-surface true with no reasoning item",
    edits: [
      (d) => void surface(d, 0).items.splice(1, 1),
      (d) => void (offering(d, 0)["supports-reasoning-surface"] = true),
    ],
    ids: ["A17"],
  },
  {
    label: "A18 — guidance item declares a frontmatter-only field",
    edits: [(d) => void (item(d, 1, 0).key = "model")],
    ids: ["A18"],
  },
  {
    label: "A19 — surface kind outside vocabulary",
    edits: [(d) => void (surface(d, 0).kind = "bogus")],
    ids: ["A19"],
  },
  {
    label: "A20a — placeholder set differs from carries",
    edits: [(d) => void (surface(d, 1).carries = ["model"])],
    ids: ["A20a"],
  },
  {
    label: "A20b — two placeholders in one sentence",
    edits: [(d) => void (surface(d, 1).template = "Run on {{model}} with {{reasoning}} effort.")],
    ids: ["A20b"],
  },
  {
    label: "A21 — second frontmatter surface",
    edits: [(d) => void d.surfaces?.push({ id: "frontmatter2", kind: "frontmatter", items: [] })],
    ids: ["A21"],
  },
  {
    label: "A22 — guard state outside vocabulary",
    edits: [(d) => void (d.guard && (d.guard.state = "bogus"))],
    ids: ["A22"],
  },
  {
    label: "A23 — withheld guard with no term holding",
    edits: [(d) => void (term(d, 0).holds = false)],
    ids: ["A23"],
  },
  {
    label: "A24 — two grounds disagree on one target",
    edits: [
      (d) => void offering(d, 0).grounds.push({ declares: "native-value", assumption: "conflict" }),
    ],
    ids: ["A24"],
  },
  {
    label: "A25 — grounds declares an unresolvable target",
    edits: [
      (d) => void offering(d, 0).grounds.push({ declares: "totally-bogus-field", citation: "x" }),
    ],
    ids: ["A25"],
  },
  {
    label: "A26 — one offering has no provides.intelligence",
    edits: [(d) => void delete offering(d, 0).provides.intelligence],
    ids: ["A26"],
  },
  {
    label: "A27 — item value outside closed vocabulary",
    edits: [
      (d) =>
        void surface(d, 1).items.push({
          item: "bogus-item",
          grounds: [{ declares: "item", citation: "x" }],
        }),
    ],
    ids: ["A27"],
  },
];

describe("check-model-mappings rejections (section 1)", () => {
  test("baseline conforms", () => {
    assertConform(check(writeCase("claude", baseDoc())));
  });

  for (const row of rows) {
    test(row.label, () => {
      assertRejected(
        check(writeCase(row.stem ?? "claude", mutate(baseDoc(), ...row.edits))),
        row.ids,
      );
    });
  }

  test("A25 regression — open aspect vocabulary closed (v2-F3), A24 does not co-fire", () => {
    const doc = mutate(baseDoc(), (d) =>
      offering(d, 0).grounds.push({
        declares: "provides.intelligence.rung",
        assumption: "contradicts the citation above",
      }),
    );
    const res = runChecker(root, [writeCase("claude", doc)]);
    assertRejected(res, ["A25"]);
    assert.ok(!`${res.stdout}${res.stderr}`.includes(": A24 "), res.stderr);
  });

  test("A0 — file does not parse as YAML", () => {
    // Exit 1 and the id only: the parser message text differs from yq (delta-03).
    assertRejected(check(writeCase("claude", "target: claude\nsurfaces: [\nofferings: []\n")), [
      "A0",
    ]);
  });

  test("zero-offerings mapping conforms", () => {
    assertConform(check(writeCase("gemini", zeroOfferingsDoc())));
  });
});
