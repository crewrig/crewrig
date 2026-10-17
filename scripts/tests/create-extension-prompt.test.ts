// create-extension-prompt.test.ts — unit tests of the scaffolder's built-in multi-select prompt
// (spec 0258 R24, R37): `parseAnswer` is pure, `promptComponents` is driven with in-memory streams.
// The differential drives the prompt only through the whole flow; these cases pin its own rules.

import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, test } from "node:test";

import { OFFERED_COMPONENTS } from "../lib/create-extension/args.ts";
import { parseAnswer, promptComponents } from "../lib/create-extension/prompt.ts";

const [first, second, third] = OFFERED_COMPONENTS as readonly [string, string, string];

/**
 * Run the prompt, answering each question once it has been printed (readline drops a line that
 * arrives while no question is pending), then close the input; collect what it printed.
 */
async function run(answers: readonly string[]): Promise<{ chosen: string[]; printed: string }> {
  const input = new PassThrough();
  const output = new PassThrough();
  let printed = "";
  let asked = 0;
  output.on("data", (chunk: Buffer) => {
    printed += chunk.toString("utf8");
    const questions = printed.split("(empty for none): ").length - 1;
    while (asked < questions) {
      const answer = answers[asked++];
      setImmediate(() => (answer === undefined ? input.end() : input.write(`${answer}\n`)));
    }
  });
  const chosen = await promptComponents("demo", input, output);
  return { chosen, printed };
}

describe("parseAnswer", () => {
  test("numbers and names choose the same components", () => {
    assert.deepEqual(parseAnswer("1"), [first]);
    assert.deepEqual(parseAnswer(first), [first]);
    assert.deepEqual(parseAnswer(`2 ${third}`), [second, third]);
  });

  test("commas, spaces and mixed separators are equivalent", () => {
    const expected = [first, second];
    assert.deepEqual(parseAnswer("1,2"), expected);
    assert.deepEqual(parseAnswer("1 2"), expected);
    assert.deepEqual(parseAnswer(" 1 , ,2,, "), expected);
  });

  test("the result follows the offered order and drops duplicates", () => {
    assert.deepEqual(parseAnswer(`${second},${first},1,${second}`), [first, second]);
  });

  test("an empty or blank answer selects nothing", () => {
    assert.deepEqual(parseAnswer(""), []);
    assert.deepEqual(parseAnswer(" , ,  "), []);
  });

  test("an unknown word, number zero or number past the list makes null", () => {
    assert.equal(parseAnswer("nonsense"), null);
    assert.equal(parseAnswer(`${first},nonsense`), null);
    assert.equal(parseAnswer("0"), null);
    assert.equal(parseAnswer(String(OFFERED_COMPONENTS.length + 1)), null);
  });
});

describe("promptComponents", () => {
  test("it lists the numbered components and returns the chosen ones", async () => {
    const { chosen, printed } = await run(["2,1"]);
    assert.deepEqual(chosen, [first, second]);
    assert.match(printed, /^Components for demo:\n/);
    OFFERED_COMPONENTS.forEach((c, i) => assert.ok(printed.includes(`  ${i + 1}) ${c}\n`)));
  });

  test("an empty answer returns no component", async () => {
    assert.deepEqual((await run([""])).chosen, []);
  });

  test("an unrecognised answer is reported and asked again", async () => {
    const { chosen, printed } = await run(["nope", "3"]);
    assert.deepEqual(chosen, [third]);
    assert.match(printed, /Unrecognised answer; use the numbers or names listed above\.\n/);
  });

  test("a closed input counts as no component", async () => {
    assert.deepEqual((await run([])).chosen, []);
  });
});
