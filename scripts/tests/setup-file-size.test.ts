// setup-file-size.test.ts — no TypeScript file the setup migration adds passes 300 lines (spec 0256
// requirement 3). Oxlint's `eslint/max-lines` is only a warning (.oxlintrc.json), so this suite turns
// the threshold into a gate for the modules under scripts/lib/setup/, the four entries
// scripts/setup-<cli>-interactive.ts (absent until their PR lands: the scan simply does not see them)
// and the test files scripts/tests/setup-*.test.ts. Every line counts, blank lines and comments included.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { listMatching, listTsFiles, REPO } from "./lib/setup-source-scan.ts";

const LIMIT = 300;

function scanned(): string[] {
  return [
    ...listTsFiles("scripts/lib/setup"),
    ...listMatching("scripts", /^setup-[a-z]+-interactive\.ts$/),
    ...listMatching("scripts/tests", /^setup-.*\.test\.ts$/),
  ];
}

/** Lines of a file: a final line feed ends the last line, it does not open another one. */
function lineCount(text: string): number {
  if (text === "") return 0;
  const parts = text.split("\n");
  return text.endsWith("\n") ? parts.length - 1 : parts.length;
}

test("the line counter treats a trailing line feed as the end of the last line", () => {
  assert.equal(lineCount(""), 0);
  assert.equal(lineCount("a\n"), 1);
  assert.equal(lineCount("a\nb"), 2);
  assert.equal(lineCount("a\n\n"), 2);
});

test("every setup module, entry and test file is at most 300 lines", () => {
  const files = scanned();
  assert.ok(files.length >= 15, `only ${files.length} files scanned: the scan is vacuous`);
  assert.ok(files.includes("scripts/lib/setup/context.ts"), "scripts/lib/setup/ was not scanned");
  assert.ok(files.includes("scripts/tests/setup-file-size.test.ts"), "tests were not scanned");
  const offenders = files
    .map((rel) => ({ rel, lines: lineCount(fs.readFileSync(path.join(REPO, rel), "utf8")) }))
    .filter(({ lines }) => lines > LIMIT)
    .map(({ rel, lines }) => `${rel}: ${lines} lines (limit ${LIMIT})`);
  assert.deepEqual(offenders, []);
});
