// install-file-size.test.ts — no TypeScript file the install, manage and link migration adds passes 300
// raw lines (spec 0255 R4). Oxlint's `eslint/max-lines` is only a warning (.oxlintrc.json), so this
// suite turns the threshold into a gate for the files this ticket adds.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import fs from "node:fs";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const LIMIT = 300;

const ENTRIES = new Set(
  [
    "install-extension",
    "install-extension-all",
    "install-claude-plugin",
    "install-copilot-plugin",
    "install-antigravity-extension",
    "install-workspace",
    "manage-claude-component",
    "manage-copilot-component",
    "manage-antigravity-component",
    "manage-workspace-component",
    "link-extensions",
    "unlink-extensions",
    "unlink-component",
  ].map((name) => `scripts/${name}.ts`),
);

const COVERED: readonly RegExp[] = [
  /^scripts\/lib\/link-or-copy[^/]*\.ts$/,
  /^scripts\/lib\/component-(roots|overlay|install)\.ts$/,
  /^scripts\/lib\/antigravity-migrate\.ts$/,
  /^scripts\/lib\/(manage|install)\/.+\.ts$/,
  /^scripts\/tests\/(install|manage|link-or-copy|component|marketplace|antigravity-tokens)[^/]*\.test\.ts$/,
  /^scripts\/tests\/lib\/(install-sandbox|manage-main-run|component-twins-harness|overlay-loop-box|print-manage-declarations|spawn-spy)\.ts$/,
];

function tracked(): string[] {
  const res = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "scripts"],
    {
      cwd: REPO,
      encoding: "utf8",
    },
  );
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.split("\n").filter((rel) => rel.endsWith(".ts"));
}

test("every file the install, manage and link migration adds is at most 300 lines", () => {
  const files = tracked().filter((rel) => ENTRIES.has(rel) || COVERED.some((re) => re.test(rel)));
  assert.ok(files.length > 30, `only ${files.length} files matched: the scan is vacuous`);
  for (const entry of ENTRIES) assert.ok(files.includes(entry), `${entry} is not tracked`);
  const tooLong = files
    .map((rel) => ({
      rel,
      lines: fs.readFileSync(path.join(REPO, rel), "utf8").split("\n").length - 1,
    }))
    .filter(({ lines }) => lines > LIMIT)
    .map(({ rel, lines }) => `${rel}: ${lines} lines`);
  assert.deepEqual(tooLong, []);
});
