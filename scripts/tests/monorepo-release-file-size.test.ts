// monorepo-release-file-size.test.ts — no TypeScript file the release driver migration (and spec 0310) adds passes
// 300 raw lines (spec 0257, repo convention of spec 0255 R4). Oxlint's `eslint/max-lines` is only a
// warning (.oxlintrc.json), so this suite turns the threshold into a gate for the covered files.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const LIMIT = 300;

const COVERED = {
  directories: ["scripts/lib/monorepo-release", "scripts/lib/framework-release"],
  patterns: [
    /^scripts\/tests\/monorepo-release-[a-z-]+\.test\.ts$/,
    /^scripts\/tests\/lib\/release-[a-z-]+\.ts$/,
    /^scripts\/monorepo-release\.ts$/,
    /^scripts\/framework-release-[a-z-]+\.ts$/,
    /^scripts\/tests\/framework-release-[a-z-]+\.test\.ts$/,
    /^scripts\/tests\/lib\/framework-release-[a-z-]+\.ts$/,
  ] as readonly RegExp[],
};

function tracked(): string[] {
  const res = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "scripts"],
    { cwd: REPO, encoding: "utf8" },
  );
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.split("\n").filter((rel) => rel.endsWith(".ts"));
}

function covered(rel: string): boolean {
  return (
    COVERED.directories.some((dir) => rel.startsWith(`${dir}/`)) ||
    COVERED.patterns.some((re) => re.test(rel))
  );
}

test("every file the release driver migration adds is at most 300 lines", () => {
  for (const dir of COVERED.directories) {
    assert.ok(fs.statSync(path.join(REPO, dir)).isDirectory(), `${dir} does not exist`);
  }
  const files = tracked().filter(covered);
  assert.ok(files.length > 0, "the covered set is empty: the scan is vacuous");
  const tooLong = files
    .map((rel) => ({
      rel,
      lines: fs.readFileSync(path.join(REPO, rel), "utf8").split("\n").length - 1,
    }))
    .filter(({ lines }) => lines > LIMIT)
    .map(({ rel, lines }) => `${rel}: ${lines} lines`);
  assert.deepEqual(tooLong, []);
});
