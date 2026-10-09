// model-resolve-narrowing.test.ts — selection-axis narrowing (rule (d)) and encoded-reasoning
// narrowing (rule (e)) of scripts/lib/model-resolve/narrowing.ts (spec 0250 R19; spec 0198
// R9-R11, R22).
//
// The predicates and the two narrowing functions are driven directly on a hand-built
// `ResolveState`; the order in which the axes narrow and drop is then read through
// `resolveAgent` on a synthetic mapping. Documented as the twin does it: `_pred_context`
// holds only for digit-only operands that fit 64 bits, and bash's own overflow diagnostic is
// not reproduced (plan finding S3), so an overflowing `context` simply never satisfies.

import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import {
  narrowAxis,
  narrowEncodedReasoning,
  predContext,
  predLocality,
  predModalities,
  predSpecialization,
  predSpeed,
} from "../lib/model-resolve/narrowing.ts";
import type { Offering, ResolveState } from "../lib/model-resolve/types.ts";
import { itemIdx } from "../lib/model-resolve/ladders.ts";
import { EMPTY_PROFILE } from "../lib/model-resolve/profile.ts";
import {
  cleanupTmp,
  makeRun,
  miniRoot,
  mkTmp,
  resolveProbe,
  tab,
  writeProfile,
} from "./fixtures/build-components/model-resolve-kit.ts";

after(cleanupTmp);

/** An offering with the shell's blanks for everything a test does not name. */
const off = (id: string, over: Partial<Offering> = {}): Offering => ({
  id,
  rank: "1",
  native: id,
  intelligence: "high",
  specialization: "",
  context: "",
  speed: "standard",
  locality: "any",
  modalities: "",
  encodedReasoning: "",
  supportsReasoningSurface: "false",
  ...over,
});

function stateOf(offerings: Offering[], reasoning = ""): ResolveState {
  const flags = (): boolean[] => Array.from({ length: 7 }, () => false);
  const none = { has: false, value: "" };
  return {
    offeringId: "",
    nativeValue: "",
    offeringSrs: "false",
    fmLines: [],
    prose: "",
    diag: [],
    disposed: flags(),
    directed: flags(),
    fm: flags(),
    gd: flags(),
    value: flags().map(() => ""),
    profile: {
      ...EMPTY_PROFILE,
      axes: {
        ...EMPTY_PROFILE.axes,
        reasoning: reasoning === "" ? none : { has: true, value: reasoning },
      },
    },
    offerings,
    candidates: offerings.map((_, i) => i),
  };
}

describe("the five predicates", () => {
  test("context: digit-only operands, offering at least the floor", () => {
    assert.equal(predContext(off("a", { context: "200" }), "150"), true);
    assert.equal(predContext(off("a", { context: "150" }), "150"), true);
    assert.equal(predContext(off("a", { context: "100" }), "150"), false);
    assert.equal(predContext(off("a", { context: "0100" }), "99"), true);
  });

  test("context: an empty or non-digit operand on either side never satisfies", () => {
    for (const [have, want] of [
      ["", "1"],
      ["1", ""],
      ["5k", "1"],
      ["10", "1e3"],
      ["-1", "0"],
      ["1.5", "1"],
    ])
      assert.equal(predContext(off("a", { context: have }), want), false, `${have} vs ${want}`);
  });

  test("context: a value past 64 bits never satisfies (bash's own error line is not reproduced)", () => {
    const huge = "99999999999999999999";
    assert.equal(predContext(off("a", { context: huge }), "1"), false);
    assert.equal(predContext(off("a", { context: "1" }), huge), false);
  });

  test("locality, specialization and speed default to any, general and standard", () => {
    assert.equal(predLocality(off("a", { locality: "" }), "any"), true);
    assert.equal(predLocality(off("a", { locality: "local" }), "any"), false);
    assert.equal(predSpecialization(off("a"), "general"), true);
    assert.equal(predSpecialization(off("a", { specialization: "code" }), "general"), false);
    assert.equal(predSpeed(off("a", { speed: "" }), "standard"), true);
    assert.equal(predSpeed(off("a", { speed: "fast" }), "standard"), false);
  });

  test("modalities: every wanted modality is provided, an offering naming none provides text", () => {
    assert.equal(predModalities(off("a"), "text"), true);
    assert.equal(predModalities(off("a"), "text image"), false);
    assert.equal(predModalities(off("a", { modalities: "text image" }), "image text"), true);
    assert.equal(predModalities(off("a", { modalities: "text" }), "audio"), false);
    assert.equal(predModalities(off("a", { modalities: "text" }), ""), true);
  });
});

describe("narrowAxis", () => {
  test("an axis the profile does not declare leaves the candidates alone and records nothing", () => {
    const st = stateOf([off("a"), off("b", { speed: "fast" })]);
    narrowAxis(st, "p", "t", "speed", "fast", predSpeed, false);
    assert.deepEqual([st.candidates, st.diag], [[0, 1], []]);
  });

  test("a narrowing that keeps some candidates replaces the set, in order", () => {
    const st = stateOf([off("a", { speed: "fast" }), off("b"), off("c", { speed: "fast" })]);
    narrowAxis(st, "p", "t", "speed", "fast", predSpeed, true);
    assert.deepEqual([st.candidates, st.diag], [[0, 2], []]);
  });

  test("a narrowing that would empty the set is abandoned with one unserved-value drop", () => {
    const st = stateOf([off("a"), off("b")]);
    narrowAxis(st, "p", "t", "speed", "slow", predSpeed, true);
    assert.deepEqual(st.candidates, [0, 1]);
    assert.deepEqual(st.diag, [
      tab("model-drop", "p", "t", "metadata.model.speed", "slow", "unserved-value"),
    ]);
  });

  test("the drop names the display value when one is given, the declared value otherwise", () => {
    const st = stateOf([off("a")]);
    narrowAxis(st, "p", "t", "modalities", "audio", predModalities, true, "[audio]");
    assert.equal(
      st.diag[0],
      tab("model-drop", "p", "t", "metadata.model.modalities", "[audio]", "unserved-value"),
    );
  });
});

describe("narrowEncodedReasoning", () => {
  const enc = (...rungs: string[]): Offering[] =>
    rungs.map((r, i) => off(`o${i}`, { encodedReasoning: r }));
  const run = (reasoning: string, offerings: Offering[]): ResolveState => {
    const st = stateOf(offerings, reasoning);
    narrowEncodedReasoning(st, "p", "t");
    return st;
  };
  const reasoningIdx = itemIdx("reasoning");

  test("an exact rung is selected, marks reasoning directed, and records no note", () => {
    const st = run("medium", enc("low", "medium", "high"));
    assert.deepEqual([st.candidates, st.diag], [[1], []]);
    assert.deepEqual([st.disposed[reasoningIdx], st.directed[reasoningIdx]], [true, true]);
  });

  test("with no exact rung the nearest rung below wins and one substitution note is recorded", () => {
    const st = run("medium", enc("none", "low", "high", "max"));
    assert.deepEqual(st.candidates, [1]);
    assert.deepEqual(st.diag, [
      tab("model-note", "p", "t", "reasoning-rung-substituted", "declared=medium encoded=low"),
    ]);
  });

  test("with nothing below, the nearest rung above wins", () => {
    const st = run("low", enc("high", "max"));
    assert.deepEqual(st.candidates, [0]);
    assert.match(st.diag[0] ?? "", /declared=low encoded=high$/);
  });

  test("every candidate at the winning rung stays", () => {
    assert.deepEqual(run("high", enc("high", "low", "high")).candidates, [0, 2]);
  });

  test("candidates encoding no reasoning are ignored; none encoding any is a no-op", () => {
    assert.deepEqual(run("high", enc("", "high")).candidates, [1]);
    const st = run("high", enc("", ""));
    assert.deepEqual([st.candidates, st.diag, st.disposed[reasoningIdx]], [[0, 1], [], false]);
  });

  test("a declared rung outside the reasoning ladder narrows nothing", () => {
    const st = run("xxhigh", enc("low", "high"));
    assert.deepEqual([st.candidates, st.diag, st.directed[reasoningIdx]], [[0, 1], [], false]);
  });
});

describe("rule (d) through resolveAgent: order of narrowing and of drops", () => {
  const dir = mkTmp();
  const O = (id: string, rank: number, more: string): string =>
    `{id: ${id}, rank: ${rank}, native-value: n-${id}, provides: {intelligence: high${more}}}`;
  const root = miniRoot([
    O("a", 1, ", context: 100"),
    O(
      "b",
      2,
      ", context: 200, speed: fast, locality: local, specialization: code, modalities: [text, image]",
    ),
  ]);
  const go = (...lines: string[]) =>
    resolveProbe(makeRun(root), writeProfile(dir, "intelligence: high", ...lines), "t");

  test("every declared axis that the first offering cannot meet moves the selection to the second", () => {
    for (const line of [
      "context: 150",
      "speed: fast",
      "locality: local",
      "specialization: code",
      "modalities: [image]",
    ])
      assert.equal(go(line).offeringId, "b", line);
  });

  test("an axis nobody serves is dropped and the selection is unchanged", () => {
    for (const line of [
      "context: 9999",
      "speed: slow",
      "locality: remote",
      "specialization: other",
      "modalities: [audio]",
    ]) {
      const result = go(line);
      assert.equal(result.offeringId, "a", line);
      assert.equal(result.diagLines.length, 1, line);
    }
  });

  test("narrowing applies context, modalities, locality, specialization, speed in that order", () => {
    const result = go(
      "context: 150",
      "speed: slow",
      "locality: remote",
      "specialization: other",
      "modalities: [audio, text]",
    );
    const paths = result.diagLines.map((l) => l.split("\t")[3]);
    assert.deepEqual(paths, [
      "metadata.model.modalities",
      "metadata.model.locality",
      "metadata.model.specialization",
      "metadata.model.speed",
    ]);
    assert.equal(result.offeringId, "b");
  });
});
