// check-component-metadata-keys.test.ts — black-box edge cases of
// scripts/check-component-metadata-keys.ts that the Bash suite does not cover (spec 0259):
// document-order keys, empty and quoted keys, null/scalar/sequence `metadata:`, a missing
// or CRLF front matter, a non-mapping document, an unreadable file (deviation (d)).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ENTRY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "check-component-metadata-keys.ts",
);
const tmp = mkdtempSync(path.join(tmpdir(), "metadata-keys-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

let counter = 0;
/** Write `text` as a governed source and run the entry on it. */
function runOn(text: string, mode?: number) {
  counter += 1;
  const file = path.join(tmp, `c${counter}`, "artifacts", "core", "skills", "s", "SKILL.md");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  if (mode !== undefined) chmodSync(file, mode);
  const r = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, file],
    { encoding: "utf8" },
  );
  return { file, status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const keysOf = (stderr: string): string[] =>
  [...stderr.matchAll(/: K1 metadata\.(.*?) is not admitted/g)].map((m) => m[1] ?? "");

describe("check-component-metadata-keys edge cases", () => {
  it("lists offending keys in document order, not sorted", () => {
    const r = runOn("---\nmetadata:\n  zed: 1\n  model: x\n  alpha: 2\n---\n");
    assert.equal(r.status, 1);
    assert.deepEqual(keysOf(r.stderr), ["zed", "alpha"]);
    assert.match(r.stderr, /\nFAILED: 2 rejection\(s\) across 1 source\(s\) \(spec 0200 R8\)\.\n$/);
  });

  it("skips an empty key, keeps quoted and null-spelled keys", () => {
    const r = runOn('---\nmetadata:\n  "q k": 1\n  ? ~\n  : 2\n  "": y\n---\n');
    assert.deepEqual(keysOf(r.stderr), ["q k", "~"]);
  });

  it("aborts silently with status 1 on a null or scalar metadata value", () => {
    for (const value of ["", " ~", " foo"]) {
      const r = runOn(`---\nmetadata:${value}\n---\n`);
      assert.deepEqual([r.status, r.stdout, r.stderr], [1, "", ""], JSON.stringify(value));
    }
  });

  it("reports the indices of a sequence-valued metadata", () => {
    assert.deepEqual(keysOf(runOn("---\nmetadata:\n  - a\n  - b\n---\n").stderr), ["0", "1"]);
  });

  it("treats a missing, CRLF or non-mapping front matter as clean", () => {
    const clean = [
      "no front matter\n",
      "---\r\nmetadata:\r\n  zed: 1\r\n---\r\n",
      "---\n- a\n- b\n---\n",
      "---\nfoo\n---\n",
      "---\n---\n",
      "---\nmetadata: [\n---\n",
    ];
    for (const text of clean) {
      const r = runOn(text);
      assert.equal(r.status, 0, JSON.stringify(text));
      assert.equal(r.stderr, "");
      assert.match(r.stdout, /^OK: 1 source\(s\) checked;/);
    }
  });

  it("an empty metadata mapping and an admitted-only mapping are clean", () => {
    assert.equal(runOn("---\nmetadata: {}\n---\n").status, 0);
    assert.equal(runOn("---\nmetadata:\n  provenance: {}\n  model: x\n---\n").status, 0);
  });

  it(
    "prints one Error line and exits 1 for an unreadable governed source",
    { skip: process.platform === "win32" || process.getuid?.() === 0 },
    () => {
      const r = runOn("---\nmetadata: {}\n---\n", 0o000);
      assert.equal(r.status, 1);
      assert.equal(r.stdout, "");
      assert.equal(r.stderr, `Error: ${r.file}: Permission denied\n`);
    },
  );

  it("rejects a duplicated mapping key instead of passing (deviation (e))", () => {
    const r = runOn("---\nmetadata:\n  a: 1\n  a: 2\n---\n");
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.equal(
      r.stderr,
      `Error: ${r.file}: duplicated mapping key in front matter\n\nFAILED: 1 rejection(s) across 1 source(s) (spec 0200 R8).\n`,
    );
  });
});

describe("the R17 sentence as amended by spec 0291 delta 01 is pinned in the docs", () => {
  const ROOT = path.resolve(path.dirname(ENTRY), "..");
  const NEW =
    "an allowlist withholds every tool it does not name, so an editing agent's allowlist names skill";
  const OLD = "an allowlist is declared only for an agent whose classes exclude execute and edit";
  for (const doc of ["artifacts/FORMAT.md", "docs/authoring.md"]) {
    it(`${doc} carries the new sentence and not the removed one`, () => {
      const text = readFileSync(path.join(ROOT, doc), "utf8");
      assert.ok(text.includes(NEW), `${doc} lacks: ${NEW}`);
      assert.ok(!text.includes(OLD), `${doc} still carries the removed sentence`);
    });
  }
});
