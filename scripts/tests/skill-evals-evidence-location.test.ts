// skill-evals-evidence-location.test.ts — the two location rules of the evidence check (spec 0304
// R15: a `path:line` token followed by commentary; R16: a short whole line of exactly one produced
// file). Pure: validateEvidence over a given transcript and produced files. No model call.

import assert from "node:assert/strict";
import { test } from "node:test";

import { validateEvidence } from "../lib/skill-evals/evidence.ts";

const CI = ".github/workflows/ci.yml";
const ci = ["name: ci", "on: push", "permissions:", "  contents: read", "jobs: {}", ""].join("\n");
const material = {
  transcript: "Assistant: I wrote the workflow.\nUser asked: tags: ['v*']\n",
  files: [
    { rel: CI, content: ci },
    { rel: "ci.yml", content: ci },
  ],
};
const verdict = (e: string, m = material) => validateEvidence(e, m);

test("R15: a location followed by commentary is accepted as path_line when the token reaches the floor", () => {
  const v = verdict(`${CI}:5 — the job sets contents: read`);
  assert.deepEqual(v, { ok: true, rule: "path_line" });
  assert.deepEqual(
    verdict(`${CI}:4`),
    { ok: true, rule: "path_line" },
    "the bare form still works",
  );
  assert.equal(verdict(`${CI}:5\tcommentary after a tab, more than twelve characters`).ok, true);
});

test("R15: the commentary is not checked and does not count toward the floor", () => {
  const v = verdict(`${CI}:1 a remark that is not in any output at all, however long`);
  assert.equal(v.ok, true, "the commentary may say anything");
  // `ci.yml:1` is 8 non-whitespace characters: no commentary, however long, lifts it to the floor
  const short = verdict("ci.yml:1 an unrelated remark of more than twelve characters");
  assert.equal(short.ok, false);
  assert.equal(verdict("ci.yml:1").ok, false, "refused as the bare form is today");
});

test("R15: a line number beyond the file is refused, even with a token that reaches the floor", () => {
  assert.equal(verdict(`${CI}:99 the job sets contents: read`).ok, false);
  assert.equal(verdict(`${CI}:0 line zero does not exist`).ok, false);
  // the file has 6 split elements (the last is the empty tail after the final newline)
  assert.equal(verdict(`${CI}:7 beyond the end`).ok, false);
});

test("R15: the path must name a produced file", () => {
  const v = verdict("other/workflows/ci.yml:2 an excerpt about the workflow");
  assert.equal(v.ok, false);
  assert.match((v as { reason: string }).reason, /neither the transcript nor a produced file/);
});

test("R15: a path with leading ./ or outputs/ resolves like the bare reference", () => {
  assert.equal(verdict(`./${CI}:2 remark`).ok, true);
  assert.equal(verdict(`outputs/${CI}:2 remark`).ok, true);
});

test("R16: a short whole line of exactly one produced file is accepted as short_line", () => {
  const m = { transcript: "", files: [{ rel: "ci.yml", content: "name: ci\ntags: ['v*']\n" }] };
  assert.deepEqual(verdict("tags: ['v*']", m), { ok: true, rule: "short_line" });
  assert.deepEqual(verdict("  tags: ['v*']  ", m), { ok: true, rule: "short_line" }, "trimmed");
});

test("R16: the transcript never serves as the source of a short line", () => {
  const onlyTranscript = { transcript: "tags: ['v*']\n", files: [{ rel: "a.md", content: "x\n" }] };
  assert.equal(verdict("tags: ['v*']", onlyTranscript).ok, false);
  // the transcript holding it too does not turn it into a second holder
  const both = {
    transcript: "tags: ['v*']\n",
    files: [{ rel: "a.yml", content: "tags: ['v*']\n" }],
  };
  assert.deepEqual(verdict("tags: ['v*']", both), { ok: true, rule: "short_line" });
});

test("R16: a short line in two produced files, or only part of a longer line, is refused", () => {
  const two = {
    transcript: "",
    files: [
      { rel: "a.yml", content: "tags: ['v*']\n" },
      { rel: "b.yml", content: "x\ntags: ['v*']\n" },
    ],
  };
  assert.equal(verdict("tags: ['v*']", two).ok, false);
  const part = { transcript: "", files: [{ rel: "a.yml", content: "  tags: ['v*'] # release\n" }] };
  assert.equal(verdict("tags: ['v*']", part).ok, false);
});

test("R16: the floors are 6 and 12 non-whitespace characters", () => {
  const f = (content: string) => ({ transcript: "", files: [{ rel: "a.txt", content }] });
  assert.equal(verdict("on:", f("on:\n")).ok, false, "3 characters");
  assert.equal(verdict("abcde", f("abcde\n")).ok, false, "5 characters: refused as today");
  assert.deepEqual(verdict("abcdef", f("abcdef\n")), { ok: true, rule: "short_line" }, "6");
  assert.deepEqual(verdict("a b c d e f g h i j k", f("a b c d e f g h i j k\n")), {
    ok: true,
    rule: "short_line",
  });
  assert.deepEqual(
    verdict("abcdefghijkl", f("abcdefghijkl\n")),
    { ok: true, rule: "exact" },
    "12 characters go through the ordinary rules",
  );
});
