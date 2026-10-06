// mempalace-transcript-stop-summary.test.ts — the summary of a `Stop` entry
// (spec 0247 R11), built as hooks/mempalace-transcript.sh:205-207 (a7468111)
// built it:
//
//   tail -n 20 | jq -r 'select(.type==…RESPONSE) | .content // (.tool_calls[].name // empty)'
//     | tail -n 5 | tr '\n' ' ' | head -c 500
//
// with the R30 deviations: a line that does not parse is skipped (the shell
// ended with jq's status 5), and a selected object, array or boolean is
// skipped (`jq -r` printed it). Unit tests over
// scripts/lib/mempalace-transcript/stop-summary.ts against files in a temp dir,
// a 50 MB transcript included (R19(c)).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { recordLines, stopSummary, tailLines } from "../lib/mempalace-transcript/stop-summary.ts";
import { cleanupAll, realTmp } from "./lib/worktree-fixtures.ts";

after(cleanupAll);

const dir = realTmp("crewrig-mt-stop-");
let n = 0;

function file(lines: readonly (string | object)[], trailer = "\n"): string {
  n += 1;
  const target = path.join(dir, `t${n}.jsonl`);
  const text = lines
    .map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
    .join("\n");
  fs.writeFileSync(target, lines.length === 0 ? "" : `${text}${trailer}`);
  return target;
}

const said = (content: unknown, type = "ASSISTANT_RESPONSE"): object => ({ type, content });

describe("selection (R11)", () => {
  test("the three response types, in order, each followed by one space", () => {
    const t = file([
      said("a", "PLANNER_RESPONSE"),
      said("b"),
      said("c", "RESPONSE"),
      said("u", "USER_INPUT"),
    ]);
    assert.equal(stopSummary(t), "a b c ");
  });

  test("a record without a string type, or not an object, is skipped", () => {
    const t = file([
      { content: "x" },
      { type: 5, content: "y" },
      "[1,2]",
      '"text"',
      "42",
      said("ok"),
    ]);
    assert.equal(stopSummary(t), "ok ");
  });

  test("content, else each tool_calls[].name", () => {
    const t = file([
      { type: "RESPONSE", tool_calls: [{ name: "Read" }, { name: "Bash" }] },
      { type: "RESPONSE", content: "text", tool_calls: [{ name: "Ignored" }] },
      { type: "RESPONSE", content: null, tool_calls: [{ name: "AfterNull" }] },
      { type: "RESPONSE", content: false, tool_calls: [{ name: "AfterFalse" }] },
    ]);
    assert.equal(stopSummary(t), "Read Bash text AfterNull AfterFalse ");
  });

  test("tool_calls: an object's values are iterated; unnamed and non-object calls give nothing", () => {
    const t = file([
      { type: "RESPONSE", tool_calls: { a: { name: "FromObject" } } },
      {
        type: "RESPONSE",
        tool_calls: [{ name: null }, { name: false }, "str", [], { id: 1 }, { name: "Kept" }],
      },
      { type: "RESPONSE", tool_calls: "not iterable" },
    ]);
    assert.equal(stopSummary(t), "FromObject Kept ");
  });

  test("a number is rendered in its JSON decimal form", () => {
    const t = file([said(42), said(-1.5), { type: "RESPONSE", tool_calls: [{ name: 7 }] }]);
    assert.equal(stopSummary(t), "42 -1.5 7 ");
  });

  test("an object, an array or a boolean selected is skipped (R30)", () => {
    const t = file([
      said({ a: 1 }),
      said(["x"]),
      said(true),
      { type: "RESPONSE", tool_calls: [{ name: { n: 1 } }] },
      said("kept"),
    ]);
    assert.equal(stopSummary(t), "kept ");
  });

  test("a multi-line content gives one line per line, each followed by a space", () => {
    const t = file([said("first\nsecond\n\nfourth")]);
    assert.equal(stopSummary(t), "first second  fourth ");
  });

  test("an empty content string is one empty line", () => {
    assert.equal(stopSummary(file([said(""), said("x")])), " x ");
  });
});

describe("the `{bad` scenario: an unparsable line is skipped, the rest kept (R6, R11, R30)", () => {
  test("a line that is not JSON among records", () => {
    const t = file([said("before"), "{bad", said("after"), "not json at all", ""]);
    assert.equal(stopSummary(t), "before after ");
  });

  test("a file of unparsable lines only gives no summary", () => {
    assert.equal(stopSummary(file(["{bad", "}{"])), "");
  });

  test("recordLines of a bad line is empty", () => {
    assert.deepEqual(recordLines("{bad"), []);
  });
});

describe("windows: the last 20 lines, the last 5 printed lines, 500 bytes (R11, R12)", () => {
  test("only the last 20 lines of the file are read", () => {
    const early = Array.from({ length: 5 }, (_, i) => said(`early${i}`));
    const filler = Array.from({ length: 19 }, () => ({ type: "USER_INPUT" }));
    assert.equal(stopSummary(file([...early, ...filler, said("last")])), "last ");
  });

  test("only the last 5 printed lines are kept, counting lines of multi-line content", () => {
    const t = file([said("a"), said("b"), said("c\nd"), said("e"), said("f\ng")]);
    assert.equal(stopSummary(t), "c d e f g ");
  });

  test("a final line without a line feed counts as a line", () => {
    assert.equal(stopSummary(file([said("x"), said("y")], "")), "x y ");
  });

  test("CRLF line endings are tolerated", () => {
    n += 1;
    const t = path.join(dir, `crlf${n}.jsonl`);
    fs.writeFileSync(t, `${JSON.stringify(said("a"))}\r\n${JSON.stringify(said("b"))}\r\n`);
    assert.equal(stopSummary(t), "a b ");
  });

  test("the summary is cut to 500 bytes on a character boundary", () => {
    for (const ch of ["a", "é", "€", "😀"]) {
      const summary = stopSummary(file([said(ch.repeat(600))]));
      const bytes = Buffer.byteLength(summary);
      assert.ok(bytes <= 500 && bytes > 500 - Buffer.byteLength(ch), `${ch}: ${bytes}`);
      assert.ok(`${ch.repeat(600)} `.startsWith(summary));
      assert.doesNotMatch(summary, /�/);
    }
  });
});

describe("the path (R11)", () => {
  test("absent, missing, a directory or an empty file: no summary", () => {
    assert.equal(stopSummary(undefined), "");
    assert.equal(stopSummary(path.join(dir, "absent.jsonl")), "");
    assert.equal(stopSummary(dir), "");
    assert.equal(stopSummary(file([])), "");
  });
});

describe("tailLines reads backwards across chunk boundaries", () => {
  test("lines longer than one 64 KiB chunk, and a partial first line dropped", () => {
    const long = said("L".repeat(200_000));
    const t = file([said("head"), long, said("mid"), long, said("tail")]);
    const tail = tailLines(t, 3);
    assert.equal(tail.length, 3);
    assert.equal(tail[2], JSON.stringify(said("tail")));
    assert.equal(tail[1], JSON.stringify(long));
    assert.equal(tail[0], JSON.stringify(said("mid")));
    assert.deepEqual(tailLines(t, 50).length, 5);
  });

  test("blank lines are lines, as tail counts them", () => {
    assert.deepEqual(tailLines(file(["a", "", "b"]), 2), ["", "b"]);
  });
});

describe("a 50 MB transcript (R11, budget R19(c))", () => {
  test("the summary comes from the tail, quickly", () => {
    n += 1;
    const big = path.join(dir, `big${n}.jsonl`);
    const filler = `${JSON.stringify(said("F".repeat(1000), "USER_INPUT"))}\n`;
    const fd = fs.openSync(big, "w");
    const block = filler.repeat(1024);
    while (fs.fstatSync(fd).size < 50 * 1024 * 1024) fs.writeSync(fd, block);
    fs.writeSync(fd, `${["one", "two", "three"].map((c) => JSON.stringify(said(c))).join("\n")}\n`);
    fs.closeSync(fd);
    assert.ok(fs.statSync(big).size >= 50 * 1024 * 1024);
    const start = performance.now();
    const summary = stopSummary(big);
    const elapsed = performance.now() - start;
    assert.equal(summary, "one two three ");
    assert.ok(elapsed < 500, `${elapsed.toFixed(0)} ms`);
  });
});
