// extension-check-scan.test.ts — the `--check` scans (spec 0254 R14).
// Twins `ext_name_axis_scan` / `_ext_name_axis_matches` (scripts/build-extension.sh:163-212).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  classScan,
  nameAxisMatches,
  nameAxisScan,
  nameAxisTokens,
} from "../lib/extension/check-scan.ts";
import { readGeneratedClass } from "../lib/extension/descriptors.ts";
import { LIB_DIR } from "./lib/shell-extension-harness.ts";

const TOKENS = ["gemini", "claude", "copilot", "antigravity"];

describe("nameAxisMatches", () => {
  test("prefix rule on any segment, one leading dot stripped, case-insensitive", () => {
    for (const rel of [
      ".geminiignore",
      "GEMINI.md",
      "copilot-instructions.md",
      "a/.claude-plugin/x.json",
      "deep/dir/Antigravity.txt",
    ]) {
      assert.equal(nameAxisMatches(rel, TOKENS), true, rel);
    }
  });
  test("near-misses are not charged", () => {
    for (const rel of ["regeminate.md", "notes/myclaude.md", "..gemini", "a/b/c.txt", ""]) {
      assert.equal(nameAxisMatches(rel, TOKENS), false, rel);
    }
  });
  test("only ONE leading dot is stripped", () => {
    assert.equal(nameAxisMatches("..claude", TOKENS), false);
  });
  test("a directory segment charges every file under it", () => {
    assert.equal(nameAxisMatches("claude/readme.md", TOKENS), true);
  });
});

describe("nameAxisTokens", () => {
  test("the descriptor's keys minus _readme", () => {
    assert.deepEqual([...nameAxisTokens(LIB_DIR)].sort(), [...TOKENS].sort());
  });
});

describe("scans over a tree", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ext-scan-"));
  for (const rel of ["b.md", "GEMINI.md", "sub/.claude/x", "sub/ok.txt", "regeminate.md"]) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), "");
  }
  test("nameAxisScan lists relative paths in code-unit order", () => {
    assert.deepEqual(nameAxisScan(dir, TOKENS), ["GEMINI.md", "sub/.claude/x"]);
  });
  test("a missing directory yields nothing", () => {
    assert.deepEqual(nameAxisScan(path.join(dir, "nope"), TOKENS), []);
    assert.deepEqual(classScan(path.join(dir, "nope"), readGeneratedClass(LIB_DIR)), []);
  });
  test("classScan is the generated-class scan", () => {
    const cls = { manifestClass: ["b.md"], generatedGlobs: ["sub/*.txt"] };
    assert.deepEqual(classScan(dir, cls), ["b.md", "sub/ok.txt"]);
  });
});
