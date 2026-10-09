// service-file-size.test.ts — no file this ticket adds exceeds 300 lines
// (spec 0252 requirement 1; the files are listed by glob).

import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LIMIT = 300;
const PATTERNS = [
  "scripts/lib/service/**/*.ts",
  "scripts/lib/mempalace-python.ts",
  "scripts/lib/mempalace-pin.ts",
  "scripts/tests/service-*.test.ts",
  "scripts/tests/mempalace-python*.test.ts",
  "scripts/tests/mempalace-pin.test.ts",
  "scripts/tests/mcp-launcher-lifecycle.test.ts",
  "scripts/tests/lib/supervisor-stand-in.ts",
];

const files = [...new Set(PATTERNS.flatMap((p) => globSync(p, { cwd: ROOT })))].sort();

test("the glob finds the files of the ticket", () => {
  assert.ok(files.length >= 20, `only ${files.length} files matched`);
  assert.ok(files.includes("scripts/lib/service/program-install.ts"));
});

test(`every file is at most ${LIMIT} lines`, () => {
  const over = files
    .map((f) => ({ f, n: readFileSync(path.join(ROOT, f), "utf8").split("\n").length - 1 }))
    .filter(({ n }) => n > LIMIT)
    .map(({ f, n }) => `${f}: ${n}`);
  assert.deepEqual(over, []);
});
