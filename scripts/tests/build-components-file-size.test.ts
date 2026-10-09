// build-components-file-size.test.ts — the 300-line ceiling of the component build
// (spec 0250, plan step 16).
//
// Oxlint's `eslint/max-lines` only warns (`.oxlintrc.json`), so this suite turns it
// into a gate: every file of the build, wherever it exists yet, is at most 300 raw
// lines (the count `wc -l` and Oxlint give: one per line feed, no phantom line after
// the final one). A file that does not exist yet is skipped, because the build lands
// across several pull requests; an empty set is a failure, so the suite cannot pass
// vacuously.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAX_LINES = 300;

/** Every file under these directories, at any depth. */
const DIRECTORIES = ["scripts/lib/build-components", "scripts/lib/model-resolve"];
/** Single files; each is checked when it exists. */
const FILES = [
  "scripts/build-components.ts",
  "scripts/lib/yaml-text.ts",
  "scripts/lib/render-command.ts",
  "scripts/lib/component-resolve.ts",
  "scripts/lib/model-resolve.ts",
];

function filesUnder(relDir: string): string[] {
  const abs = path.join(REPO, relDir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(REPO, path.join(entry.parentPath, entry.name)));
}

/** Raw lines: line feeds, plus one for a final line that has none. */
function rawLines(text: string): number {
  if (text === "") return 0;
  const feeds = text.split("\n").length - 1;
  return text.endsWith("\n") ? feeds : feeds + 1;
}

const checked = [
  ...new Set([
    ...DIRECTORIES.flatMap(filesUnder),
    ...FILES.filter((rel) => fs.existsSync(path.join(REPO, rel))),
  ]),
]
  .map((rel) => rel.split(path.sep).join("/"))
  .sort();

describe(`build files stay within ${MAX_LINES} raw lines`, () => {
  test("the checked set is not empty and covers scripts/lib/yaml-text.ts", () => {
    assert.ok(checked.length > 0, "no build file found: the suite would pass vacuously");
    assert.ok(checked.includes("scripts/lib/yaml-text.ts"), `checked: ${checked.join(", ")}`);
  });

  test("raw line counting follows wc -l", () => {
    assert.equal(rawLines(""), 0);
    assert.equal(rawLines("a"), 1);
    assert.equal(rawLines("a\n"), 1);
    assert.equal(rawLines("a\n\n"), 2);
    assert.equal(rawLines("a\r\nb\r\n"), 2);
  });

  for (const rel of checked) {
    test(`${rel} is at most ${MAX_LINES} lines`, () => {
      const lines = rawLines(fs.readFileSync(path.join(REPO, rel), "utf8"));
      assert.ok(lines <= MAX_LINES, `${rel} has ${lines} raw lines (maximum ${MAX_LINES})`);
    });
  }
});
