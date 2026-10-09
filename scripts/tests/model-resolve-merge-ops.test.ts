// model-resolve-merge-ops.test.ts — the offering and `remove:` operations of the organisation
// override merge (scripts/lib/model-resolve/merge-ops.ts, merge-mapping.ts; spec 0250 R20; spec
// 0199 R10-R12, R14, R19-R21, R26, R34). Bash cases covered: O2, O3, O4, O7 (ordering half),
// O9, O12. Dispositions are read from the standard-error lines, effects from the merged document
// read back through the CORE schema. Every expected line was checked against the shell library.
//
// Documented as the twin does it, never as parity: offerings sort by rank NUMERICALLY, then by
// id in code-point order (yq's UTF-8 byte order); an offering with no `rank` sorts FIRST (yq put
// it last, unspecified input); a hex rank is kept as written and sorts by its value; duplicate-rank
// notes come out in first-appearance order of the rank.

import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import {
  cleanupTmp,
  idsOf,
  loadFile,
  makeRun,
  mergeOf,
  mkTmp,
  offering,
  orgRoot,
  resolveProbe,
  tab,
  writeProfile,
} from "./fixtures/build-components/model-resolve-kit.ts";

after(cleanupTmp);
const org = (body: string): string => orgRoot("claude", `target: claude\n${body}`);
const line = (address: string, disposition: string): string =>
  tab("mapping-merge", "claude", address, disposition);
const CORE = ["haiku", "sonnet", "opus", "fable"];
const merged = (body: string) => mergeOf(org(body));

describe("offerings: whole-node replace or add", () => {
  test("O2 an offering with a core id replaces the core node whole, in place by rank", () => {
    const m = merged(`offerings:\n${offering("opus", 3, "opus-org-o2", "xhigh")}`);
    const opus = (loadFile(m.handle)["offerings"] as Array<Record<string, unknown>>)[2];
    assert.deepEqual(m.err, [line("offerings/opus", "replaced")]);
    assert.deepEqual(idsOf(m.handle), CORE);
    assert.equal(opus?.["native-value"], "opus-org-o2");
    assert.equal(
      JSON.stringify(opus).includes("Declaration surface"),
      false,
      "no core field survives",
    );
  });

  test("O3 an offering with a new id is added and sorts after every lower rank", () => {
    const m = merged(`offerings:\n${offering("o3-super", 10, "o3-native", "max")}`);
    assert.deepEqual(m.err, [line("offerings/o3-super", "added")]);
    assert.deepEqual(idsOf(m.handle), [...CORE, "o3-super"]);
  });

  test("dispositions are written in the org file's order, one per offering", () => {
    const m = merged(
      `offerings:\n${offering("b-new", 8, "b", "low")}\n${offering("haiku", 1, "h", "low")}\n${offering("a-new", 9, "a", "low")}`,
    );
    assert.deepEqual(m.err, [
      line("offerings/b-new", "added"),
      line("offerings/haiku", "replaced"),
      line("offerings/a-new", "added"),
    ]);
  });
});

describe("ordering of the merged offerings", () => {
  const order = (...rows: Array<[string, number | string]>): string[] =>
    idsOf(
      merged(`offerings:\n${rows.map(([id, rank]) => offering(id, rank, id, "low")).join("\n")}`)
        .handle,
    );

  test("rank is numeric, not lexical: 10 sorts after 4", () => {
    assert.deepEqual(order(["ten", 10]), [...CORE, "ten"]);
  });

  test("a rank below the core's sorts first, a negative one before zero", () => {
    assert.deepEqual(order(["zero", 0], ["neg", -1]).slice(0, 2), ["neg", "zero"]);
  });

  test("equal ranks order by id in code-point order: uppercase before lowercase, shorter prefix first", () => {
    assert.deepEqual(order(["b", 20], ["a", 20], ["B", 20], ["ab", 20]).slice(4), [
      "B",
      "a",
      "ab",
      "b",
    ]);
  });

  test("a rank equal to a core rank orders by id against the core offering", () => {
    assert.deepEqual(order(["aaa", 2]).slice(0, 3), ["haiku", "aaa", "sonnet"]);
  });

  test("an offering with no rank sorts first (documented: yq put it last)", () => {
    const m = merged("offerings:\n  - id: norank\n    native-value: x\n");
    assert.deepEqual(idsOf(m.handle), ["norank", ...CORE]);
  });

  test("a hex rank is kept as written and sorts by its value", () => {
    const m = merged(`offerings:\n${offering("hexr", "0x10", "x", "low")}`);
    const list = loadFile(m.handle)["offerings"] as Array<Record<string, unknown>>;
    assert.deepEqual(idsOf(m.handle), [...CORE, "hexr"]);
    assert.equal(list.at(-1)?.["rank"], 16);
  });
});

describe("duplicate-rank notes", () => {
  const note = (detail: string): string =>
    tab("mapping-merge-note", "claude", "duplicate-rank", detail);

  test("O9 a rank shared across core and org is noted once, ids ascending", () => {
    const m = merged(`offerings:\n${offering("zzz-dup", 2, "z", "high")}`);
    assert.deepEqual(m.err.slice(-1), [note("rank=2 offerings=sonnet,zzz-dup")]);
    assert.equal(m.err.filter((l) => l.includes("duplicate-rank")).length, 1);
  });

  test("ids are listed ascending whatever the file order, after every disposition line", () => {
    const m = merged(
      `offerings:\n${offering("zzz", 2, "z", "low")}\n${offering("aaa", 2, "a", "low")}`,
    );
    assert.deepEqual(m.err, [
      line("offerings/zzz", "added"),
      line("offerings/aaa", "added"),
      note("rank=2 offerings=aaa,sonnet,zzz"),
    ]);
  });

  test("several colliding ranks give one note each, in first-appearance order of the rank", () => {
    const m = merged(
      `offerings:\n${offering("x4", 4, "x", "low")}\n${offering("x1", 1, "x", "low")}`,
    );
    const notes = m.err.filter((l) => l.includes("duplicate-rank"));
    assert.deepEqual(notes, [note("rank=1 offerings=haiku,x1"), note("rank=4 offerings=fable,x4")]);
  });

  test("O9 across two resolutions with one merge root: the merge, and so the note, happens once", () => {
    const root = org(`offerings:\n${offering("zzz-dup", 2, "z", "high")}`);
    const run = makeRun(root, { MAPPING_MERGE_DIR: mkTmp("o9") });
    const src = writeProfile(mkTmp(), "intelligence: high");
    const first = resolveProbe(run, src, "claude").offeringId;
    const second = resolveProbe(run, src, "claude").offeringId;
    assert.deepEqual([first, second], ["sonnet", "sonnet"]);
    assert.equal(run.err.filter((l) => l.includes("duplicate-rank")).length, 1);
  });

  // Finding T4-F1, fixed: JS `sort` puts an `undefined` element last without calling the
  // comparator, the shell lists an offering with no `id` FIRST (`offerings=,haiku`).
  test("an offering with no id is listed first in the note, as the shell does", () => {
    const m = merged("offerings:\n  - rank: 1\n    native-value: x\n");
    assert.deepEqual(m.err.slice(-1), [note("rank=1 offerings=,haiku")]);
  });
});

describe("remove:", () => {
  const removed = (...entries: string[]) => merged(`remove: [${entries.join(", ")}]`);

  test("O4 remove: [offerings/sonnet] removes it, and selection stays total at every rung", () => {
    const m = removed("offerings/sonnet");
    assert.deepEqual(m.err, [line("offerings/sonnet", "removed")]);
    assert.deepEqual(idsOf(m.handle), ["haiku", "opus", "fable"]);
    for (const rung of ["medium", "high", "xhigh", "xxhigh", "max"]) {
      const picked = resolveProbe(
        makeRun(m.run.ctx.repoDir, { MAPPING_MERGE_DIR: m.mergeDir }),
        writeProfile(mkTmp(), `intelligence: ${rung}`),
        "claude",
      ).offeringId;
      assert.ok(picked !== "" && picked !== "sonnet", `${rung} -> ${picked}`);
    }
  });

  test("an address the composed document does not declare is recorded no-effect", () => {
    const m = removed("offerings/nope", "surfaces/nope", "surfaces/nope/template");
    assert.deepEqual(m.err, [
      line("offerings/nope", "no-effect"),
      line("surfaces/nope", "no-effect"),
      line("surfaces/nope/template", "no-effect"),
    ]);
  });

  test("surfaces/<id> removes a surface, surfaces/<id>/template only its template, guard/state only its state", () => {
    const m = removed("surfaces/frontmatter", "surfaces/guidance/template", "guard/state");
    const doc = loadFile(m.handle);
    const surfaces = doc["surfaces"] as Array<Record<string, unknown>>;
    assert.deepEqual(m.err, [
      line("surfaces/frontmatter", "removed"),
      line("surfaces/guidance/template", "removed"),
      line("guard/state", "removed"),
    ]);
    assert.deepEqual(
      [
        surfaces.map((s) => s["id"]),
        "template" in (surfaces[0] ?? {}),
        "state" in (doc["guard"] as object),
      ],
      [["guidance"], false, false],
    );
  });

  test("a second removal of the same address is no-effect", () => {
    assert.deepEqual(removed("offerings/opus", "offerings/opus").err, [
      line("offerings/opus", "removed"),
      line("offerings/opus", "no-effect"),
    ]);
  });

  test("the remove: list is applied after the offerings of the same file", () => {
    const m = merged(`offerings:\n${offering("opus", 3, "o", "high")}\nremove: [offerings/opus]`);
    assert.deepEqual(m.err, [
      line("offerings/opus", "replaced"),
      line("offerings/opus", "removed"),
    ]);
    assert.deepEqual(idsOf(m.handle), ["haiku", "sonnet", "fable"]);
  });

  test("O12 guard, guard/terms/<id> and unknown forms are ignored: no line, the guard survives", () => {
    const m = removed("guard", "guard/terms/x", "bogus");
    assert.deepEqual(m.err, []);
    assert.equal("guard" in loadFile(m.handle), true);
    const r = resolveProbe(
      makeRun(m.run.ctx.repoDir, { MAPPING_MERGE_DIR: m.mergeDir }),
      writeProfile(mkTmp(), "intelligence: medium", "reasoning: medium"),
      "claude",
    );
    assert.equal(r.offeringId, "haiku");
    assert.match(r.diagLines.join("\n"), /guard-withheld/);
  });

  test("a remove: that is not a list is ignored", () => {
    for (const shape of ["offerings/sonnet", "{a: b}"])
      assert.deepEqual(mergeOf(org(`remove: ${shape}`)).err, [], shape);
  });
});
