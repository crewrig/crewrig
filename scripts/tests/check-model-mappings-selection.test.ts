// check-model-mappings-selection.test.ts — Replaces scripts/tests/test-check-model-mappings.sh
// section 2 (spec 0265, row J2, P8): the golden per-rung selection tables of the four COMMITTED
// mappings, pinned literally and compared with `--print-selection`, plus two single-offering
// mutations of a copy of claude.yml proving the table is falsifiable.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { runEntry } from "./lib/governance-sandbox.ts";
import { ENTRY, REPO, writeCase, yamlLib } from "./lib/model-mapping-fixtures.ts";

const RUNGS = ["minimal", "low", "medium", "high", "xhigh", "xxhigh", "max"] as const;

/** The offering id selected at each of the seven rungs (empty string when none). */
function table(file: string): string[] {
  const res = runEntry(ENTRY, { args: ["--print-selection", file] });
  assert.equal(res.status, 0, res.stderr);
  const rows = res.stdout
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => l.split("\t"));
  return RUNGS.map((rung) => rows.find((r) => r[1] === rung)?.[2] ?? "");
}

const committed = (name: string): string => path.join(REPO, "model-mappings", name);

/** claude.yml with its offerings filtered by `keep`, written outside the checkout. */
function claudeWith(keep: (id: unknown) => boolean): string {
  const doc = yamlLib.load(fs.readFileSync(committed("claude.yml"), "utf8")) as {
    offerings: { id: unknown }[];
  };
  doc.offerings = doc.offerings.filter((o) => keep(o.id));
  return writeCase("claude", doc);
}

describe("check-model-mappings golden selection tables (section 2)", () => {
  test("claude.yml golden per-rung table", () => {
    assert.deepEqual(table(committed("claude.yml")), [
      "haiku",
      "haiku",
      "haiku",
      "sonnet",
      "opus",
      "fable",
      "fable",
    ]);
  });

  test("gemini.yml golden per-rung table", () => {
    assert.deepEqual(table(committed("gemini.yml")), [
      "gemini-3.1-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-3.5-flash",
      "gemini-3.1-pro-preview",
      "gemini-3.1-pro-preview",
      "gemini-3.1-pro-preview",
      "gemini-3.1-pro-preview",
    ]);
  });

  test("antigravity.yml golden per-rung table", () => {
    assert.deepEqual(table(committed("antigravity.yml")), [
      "gemini-3.8-flash-medium",
      "gemini-3.8-flash-medium",
      "gemini-3.8-flash-medium",
      "gemini-3.1-pro-high",
      "gemini-3.1-pro-high",
      "gemini-3.1-pro-high",
      "gemini-3.1-pro-high",
    ]);
  });

  test("copilot.yml golden per-rung table (zero offerings, all empty)", () => {
    assert.deepEqual(table(committed("copilot.yml")), ["", "", "", "", "", "", ""]);
  });

  test("golden table falsifiable — deleting haiku flips 3 rows (minimal, low, medium -> sonnet)", () => {
    assert.deepEqual(table(claudeWith((id) => id !== "haiku")), [
      "sonnet",
      "sonnet",
      "sonnet",
      "sonnet",
      "opus",
      "fable",
      "fable",
    ]);
  });

  test("golden table falsifiable — keeping only haiku flips 4 rows (high, xhigh, xxhigh, max -> haiku)", () => {
    assert.deepEqual(table(claudeWith((id) => id === "haiku")), Array<string>(7).fill("haiku"));
  });
});
