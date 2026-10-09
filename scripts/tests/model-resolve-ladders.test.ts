// model-resolve-ladders.test.ts — the rung ladders, the item vocabulary and the index helpers
// of scripts/lib/model-resolve/ladders.ts (spec 0250 R19; spec 0195 R6, R10).
//
// The tables are asserted as literals, not re-derived from the module, so a reordered or
// renamed rung fails here. `bashInteger` is the one place the twin models a shell behaviour
// (bash's `[ a -lt b ]` operand grammar); its cases were checked against bash 5.3.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";

import {
  bashInteger,
  INTELLIGENCE_RUNGS,
  intOrZero,
  ITEM_VOCAB_ORDER,
  itemIdx,
  REASONING_RUNGS,
  rungIndex,
  rungName,
} from "../lib/model-resolve/ladders.ts";

const bashOk =
  (process.platform === "linux" || process.env["CREWRIG_SHELL_PARITY"] === "1") &&
  spawnSync("bash", ["--version"]).status === 0;
const noBash = bashOk ? undefined : "skipped: needs Linux with bash (or CREWRIG_SHELL_PARITY=1)";

describe("ladders and vocabulary", () => {
  test("the intelligence ladder has seven rungs from minimal to max", () => {
    assert.deepEqual(
      [...INTELLIGENCE_RUNGS],
      ["minimal", "low", "medium", "high", "xhigh", "xxhigh", "max"],
    );
  });

  test("the reasoning ladder starts at none and has no xxhigh", () => {
    assert.deepEqual([...REASONING_RUNGS], ["none", "low", "medium", "high", "xhigh", "max"]);
  });

  test("the item vocabulary is the seven tokens in the canonical fallback order", () => {
    assert.deepEqual(
      [...ITEM_VOCAB_ORDER],
      ["model", "reasoning", "temperature", "top-p", "top-k", "max-output-tokens", "max-turns"],
    );
  });

  test("the shell library declares the same three tables", { skip: noBash }, () => {
    const script = `. scripts/lib/model-resolve.sh; echo "$INTELLIGENCE_RUNGS|$REASONING_RUNGS|$ITEM_VOCAB_ORDER"`;
    const run = spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      cwd: `${import.meta.dirname}/../..`,
    });
    const want = [INTELLIGENCE_RUNGS, REASONING_RUNGS, ITEM_VOCAB_ORDER].map((t) => t.join(" "));
    assert.equal(run.stdout.trim(), want.join("|"));
  });
});

describe("rungIndex and rungName", () => {
  test("rungIndex is 1-based, so the first rung is 1 and the last is the length", () => {
    assert.equal(rungIndex(INTELLIGENCE_RUNGS, "minimal"), 1);
    assert.equal(rungIndex(INTELLIGENCE_RUNGS, "max"), 7);
    assert.equal(rungIndex(REASONING_RUNGS, "none"), 1);
    assert.equal(rungIndex(REASONING_RUNGS, "max"), 6);
  });

  test("an unknown, empty or differently-cased rung has index 0", () => {
    for (const rung of ["", "xxhigh-ish", "High", "none"])
      assert.equal(rungIndex(INTELLIGENCE_RUNGS, rung), 0, rung);
    assert.equal(rungIndex(REASONING_RUNGS, "xxhigh"), 0);
  });

  test("rungName inverts rungIndex and is empty outside 1..length", () => {
    for (const ladder of [INTELLIGENCE_RUNGS, REASONING_RUNGS])
      for (const rung of ladder) assert.equal(rungName(ladder, rungIndex(ladder, rung)), rung);
    for (const bad of [0, -1, 7, 99]) assert.equal(rungName(REASONING_RUNGS, bad), "");
  });
});

describe("intOrZero and itemIdx", () => {
  test("intOrZero keeps a digit run, leading zeros included, as a number", () => {
    assert.equal(intOrZero("12"), 12);
    assert.equal(intOrZero("007"), 7);
    assert.equal(intOrZero("0"), 0);
  });

  test("intOrZero turns anything else into 0", () => {
    for (const text of ["", "1.5", "-3", "+3", "12a", " 1", "0x10", "1e3"])
      assert.equal(intOrZero(text), 0, JSON.stringify(text));
  });

  test("itemIdx is the vocabulary position, -1 for a non-member", () => {
    assert.equal(itemIdx("model"), 0);
    assert.equal(itemIdx("max-turns"), 6);
    for (const item of ["", "Model", "temperature ", "top_p", "context"])
      assert.equal(itemIdx(item), -1, JSON.stringify(item));
  });
});

describe("bashInteger: the operand grammar of the shell's [ -lt ]", () => {
  const accepted: ReadonlyArray<readonly [string, bigint]> = [
    ["5", 5n],
    ["007", 7n],
    ["08", 8n],
    ["+5", 5n],
    ["-5", -5n],
    [" 5", 5n],
    ["5\t", 5n],
    ["9223372036854775807", 9223372036854775807n],
    ["-9223372036854775808", -9223372036854775808n],
  ];
  for (const [text, want] of accepted)
    test(`${JSON.stringify(text)} is the integer ${want}`, () =>
      assert.equal(bashInteger(text), want));

  // null is the shell's "integer expression expected": the test is false, never an error.
  for (const text of [
    "",
    "0x10",
    "1e3",
    "5.0",
    "5 5",
    "abc",
    "9223372036854775808",
    "-9223372036854775809",
  ])
    test(`${JSON.stringify(text)} is no integer`, () => assert.equal(bashInteger(text), null));

  test("every accepted and rejected sample agrees with bash itself", { skip: noBash }, () => {
    const samples = ["5", "007", "08", "+5", "-5", " 5", "5\t", "", "0x10", "1e3", "5.0", "5 5"];
    samples.push("9223372036854775807", "9223372036854775808", "-9223372036854775808");
    samples.push("-9223372036854775809");
    for (const text of samples) {
      // status 2 is the shell's "integer expression expected"; 0 and 1 are valid comparisons.
      const script = '[ "$1" -lt 9223372036854775807 ] 2>/dev/null; echo $?';
      const run = spawnSync("bash", ["-c", script, "x", text], { encoding: "utf8" });
      assert.equal(bashInteger(text) !== null, run.stdout.trim() !== "2", JSON.stringify(text));
    }
  });
});
