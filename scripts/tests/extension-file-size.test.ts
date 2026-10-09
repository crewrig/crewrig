// extension-file-size.test.ts — no TypeScript file of the extension builders passes 300 raw
// lines (spec 0254 R1). Oxlint's `eslint/max-lines` is only a warning (.oxlintrc.json), so this
// suite turns the threshold into a gate for the files this ticket adds.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const LIMIT = 300;

const ENTRIES = [
  "scripts/build-extension.ts",
  "scripts/build-claude-plugin.ts",
  "scripts/build-copilot-plugin.ts",
  "scripts/build-antigravity-extension.ts",
  "scripts/migrate-extension.ts",
];

function tsFilesUnder(dir: string): string[] {
  const root = path.join(REPO, dir);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.relative(REPO, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
}

test("every file the extension builders add is at most 300 lines", () => {
  const files = [
    ...tsFilesUnder("scripts/lib/extension"),
    "scripts/lib/org-mcp.ts",
    ...ENTRIES.filter((rel) => fs.existsSync(path.join(REPO, rel))),
  ];
  assert.ok(files.length > 1, "no extension builder file found");
  const tooLong = files
    .map((rel) => ({ rel, lines: fs.readFileSync(path.join(REPO, rel), "utf8").split("\n").length - 1 }))
    .filter(({ lines }) => lines > LIMIT)
    .map(({ rel, lines }) => `${rel}: ${lines} lines`);
  assert.deepEqual(tooLong, []);
});
