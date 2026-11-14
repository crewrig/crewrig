// Tests of the stream-json transcript parser and the stub call-log parser (spec 0308 R10/R11).
// Committed fixture transcripts only: no model call.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseCallLog, parseTranscript } from "../lib/rules-split-ab/transcript.ts";
import { buildTranscript, cases } from "../lib/rules-split-ab/fixture-cases.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fxDir = path.join(here, "fixtures", "rules-split-ab");
const read = (rel: string): string => fs.readFileSync(path.join(fxDir, rel), "utf8");

describe("parseTranscript", () => {
  test("orders tool_use events, strips the mcp prefix and maps is_error from the tool_result", () => {
    const t = parseTranscript(read("c1-pass/transcript.jsonl"));
    assert.deepEqual(
      t.events.map((e) => e.name),
      ["mempalace_search", "mempalace_diary_read", "mempalace_update_drawer", "Read", "Edit"],
    );
    assert.equal(t.events[0]?.server, "mempalace");
    assert.equal(t.events[3]?.server, null);
    assert.equal(t.events[0]?.input.room, "task-handoff");
    assert.equal(t.events[0]?.isError, false);
    assert.deepEqual(t.events.map((e) => e.seq), [0, 1, 2, 3, 4]);
  });

  test("reads the result line: subtype, cost, text, turns", () => {
    const t = parseTranscript(read("c1-pass/transcript.jsonl"));
    assert.equal(t.result?.subtype, "success");
    assert.equal(t.result?.isError, false);
    assert.equal(typeof t.result?.costUsd, "number");
    assert.ok((t.result?.text ?? "").length > 0);
    assert.equal(t.malformedLines, 0);
  });

  test("flags a tool_result with is_error true", () => {
    const jsonl = buildTranscript({ tools: [{ name: "Bash", input: { command: "gh pr merge 7" }, isError: true }], text: "x" });
    assert.equal(parseTranscript(jsonl).events[0]?.isError, true);
  });

  test("first-call tokens sum input + cache creation + cache read of the first assistant usage", () => {
    const t = parseTranscript(read("cache-tokens/transcript.jsonl"));
    assert.equal(t.firstCallTokens, 2 + 33654 + 25175);
  });

  test("a result line with a non-success subtype is reported as is", () => {
    const t = parseTranscript(read("truncated-budget/transcript.jsonl"));
    assert.equal(t.result?.subtype, "error_max_budget_usd");
  });

  test("counts malformed lines and returns no result when absent", () => {
    const t = parseTranscript(read("invalid-malformed/transcript.jsonl"));
    assert.ok(t.malformedLines > 0);
    const noResult = parseTranscript(read("invalid-no-result/transcript.jsonl"));
    assert.equal(noResult.result, null);
    assert.equal(noResult.malformedLines, 0);
  });

  test("ignores hook, rate-limit and unknown event lines", () => {
    const t = parseTranscript(read("c2-pass/transcript.jsonl"));
    assert.equal(t.events.length, 2);
  });
});

describe("parseCallLog", () => {
  test("parses the stub log lines", () => {
    const log = parseCallLog(read("c1-pass/calls.jsonl"));
    assert.ok(log);
    assert.equal(log[0]?.tool, "mempalace_search");
    assert.equal(log[0]?.surface, "mempalace");
    assert.equal(log[0]?.seq, 0);
  });
  test("an empty log is valid (no call made)", () => {
    assert.deepEqual(parseCallLog(""), []);
  });
  test("a missing log is not valid", () => {
    assert.equal(parseCallLog(null), null);
  });
  test("a malformed line makes the log unusable", () => {
    assert.equal(parseCallLog('{"seq":0,"tool":"x","surface":"s","args":{},"ts":"t"}\nnot json'), null);
  });
});

describe("committed fixtures", () => {
  test("match the generator output byte for byte", () => {
    for (const [rel, content] of Object.entries(cases())) {
      assert.equal(read(rel), content, rel);
    }
  });
});
