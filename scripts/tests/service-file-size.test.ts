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
  "scripts/tests/switch-*.test.ts",
  "scripts/tests/doctor-sections*.test.ts",
  "scripts/tests/status-mcp-lifecycle*.test.ts",
  "scripts/tests/repair-*.test.ts",
  "scripts/tests/chroma-*.test.ts",
  "scripts/tests/stop-mcp-server-oracle.test.ts",
  "scripts/tests/uninstall-mcp-daemon-oracle.test.ts",
  "scripts/tests/lib/switch-fixture.ts",
  "scripts/tests/lib/doctor-fixture.ts",
  "scripts/tests/lib/status-mcp-fixture.ts",
  "scripts/tests/lib/uninstall-oracle-fixture.ts",
  "scripts/tests/lib/chroma-stand-in.ts",
  "scripts/tests/lib/fake-schtasks.ts",
  "scripts/tests/lib/windows-service-fixture.ts",
];

const files = [...new Set(PATTERNS.flatMap((p) => globSync(p, { cwd: ROOT })))].sort();

test("the glob finds the files of the ticket", () => {
  assert.ok(files.length >= 60, `only ${files.length} files matched`);
  assert.ok(files.includes("scripts/lib/service/program-install.ts"));
});

test(`every file is at most ${LIMIT} lines`, () => {
  const over = files
    .map((f) => ({ f, n: readFileSync(path.join(ROOT, f), "utf8").split("\n").length - 1 }))
    .filter(({ n }) => n > LIMIT)
    .map(({ f, n }) => `${f}: ${n}`);
  assert.deepEqual(over, []);
});
