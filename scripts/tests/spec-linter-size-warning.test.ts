// spec-linter-size-warning.test.ts — spec 0273 R8-R11: the non-failing size warning.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { newFixture, renderSpec, runLinter } from "./lib/spec-linter-fixtures.ts";

const T = { timeout: 60_000 };
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A lint-clean spec of exactly `size` bytes (the filler is a plain paragraph). */
function specOfSize(size: number): string {
  let text = `${renderSpec({ id: "0001", slug: "sized" })}\n`;
  let remaining = size - Buffer.byteLength(text);
  while (remaining > 0) {
    const len = remaining > 160 ? 79 : remaining >= 82 ? remaining - 81 : remaining - 1;
    const line = `${"x".repeat(Math.max(len, 1))}\n`;
    text += line;
    remaining -= line.length;
  }
  assert.equal(Buffer.byteLength(text), size);
  return text;
}

describe("spec linter size warning (spec 0273)", () => {
  test("40961 bytes warns, names file, size and doc, exit 0", T, () => {
    const fx = newFixture();
    fx.put("specs/0001-sized.md", specOfSize(40961));
    const r = runLinter(fx.root, ["specs/0001-sized.md"]);
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /\[WARN\] specs\/0001-sized\.md is 40961 bytes/);
    assert.match(r.output, /docs\/spec-format\.md -> Splitting an oversized spec/);
  });

  test("full scan (no argument) warns and exits 0", T, () => {
    const fx = newFixture();
    fx.put("specs/0001-sized.md", specOfSize(40961));
    const r = runLinter(fx.root);
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /\[WARN\] specs\/0001-sized\.md is 40961 bytes/);
  });

  test("exactly 40960 bytes does not warn", T, () => {
    const fx = newFixture();
    fx.put("specs/0001-sized.md", specOfSize(40960));
    const r = runLinter(fx.root, ["specs/0001-sized.md"]);
    assert.equal(r.status, 0, r.output);
    assert.doesNotMatch(r.output, /bytes, above/);
  });

  test("the warning does not change the error count of a failing run", T, () => {
    const fx = newFixture();
    fx.put("specs/0001-sized.md", specOfSize(40961).replace('id: "0001"', 'id: "0009"'));
    const r = runLinter(fx.root, ["specs/0001-sized.md"]);
    assert.equal(r.status, 1, r.output);
    assert.match(r.output, /\[WARN\] specs\/0001-sized\.md/);
  });

  test("real oversized specs (0263, 0265, by glob) warn without failing", T, () => {
    const names = fs
      .readdirSync(path.join(REPO, "specs"))
      .filter((n) => /^(0263|0265)-.*\.md$/.test(n) && !n.includes(".delta-"));
    for (const name of names) {
      const size = fs.statSync(path.join(REPO, "specs", name)).size;
      if (size <= 40960) continue; // legitimately split by a later ticket
      const fx = newFixture();
      fx.put(`specs/${name}`, fs.readFileSync(path.join(REPO, "specs", name), "utf8"));
      const r = runLinter(fx.root, [`specs/${name}`]);
      assert.match(r.output, new RegExp(`\\[WARN\\] specs/${name} is ${size} bytes`));
    }
  });

  test("docs/spec-format.md carries the section and the linter bullet", T, () => {
    const doc = fs.readFileSync(path.join(REPO, "docs/spec-format.md"), "utf8");
    assert.match(doc, /^## Splitting an oversized spec$/m);
    assert.match(doc, /40960 bytes draws a `\[WARN\]`/);
    assert.match(doc, /task spec:view -- <id>/);
  });
});
