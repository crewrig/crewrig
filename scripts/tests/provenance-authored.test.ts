// provenance-authored.test.ts — the reader of the authored provenance block (spec 0316 R12).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { readAuthoredProvenance, stripAuthoredBlock } from "../lib/provenance-authored.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BLOCK = '<!--\nprovenance:\n  version: "1.2.3"\n  canonical: "c"\n  feedback: "f"\n-->\n';

describe("readAuthoredProvenance", () => {
  test("reads the three members", () => {
    assert.deepEqual(readAuthoredProvenance(`${BLOCK}\n# T\n`, "x.md", "html"), {
      version: "1.2.3",
      canonical: "c",
      feedback: "f",
    });
  });

  test("a CRLF file reads the same", () => {
    const crlf = `${BLOCK}\n# T\n`.replaceAll("\n", "\r\n");
    assert.equal(readAuthoredProvenance(crlf, "x.md", "html").version, "1.2.3");
    assert.equal(stripAuthoredBlock(crlf, "x.md", "html"), "# T\r\n");
  });

  test("refuses, naming the file: no block, block not at byte 0, no version, unquoted version", () => {
    const cases = [
      "# T\n",
      `\n${BLOCK}`,
      '<!--\nprovenance:\n  canonical: "c"\n-->\n',
      "<!--\nprovenance:\n  version: 1.0.0\n-->\n",
      '<!--\nprovenance:\n  version: "1"\n',
    ];
    for (const text of cases) {
      assert.throws(() => readAuthoredProvenance(text, "x.md", "html"), /^Error: x\.md: /);
    }
  });

  test("strips the block and one blank line only", () => {
    assert.equal(stripAuthoredBlock(`${BLOCK}\n\n# T\n`, "x.md", "html"), "\n# T\n");
    assert.equal(stripAuthoredBlock(`${BLOCK}\n# T\n`, "x.md", "html"), "# T\n");
  });

  test("the block-js syntax reads a hook header", () => {
    const hook = '/*\nprovenance:\n  version: "1.0.0"\n*/\n// code\n';
    assert.equal(readAuthoredProvenance(hook, "h.ts", "block-js").version, "1.0.0");
    assert.equal(stripAuthoredBlock(hook, "h.ts", "block-js"), "// code\n");
  });

  test("every real source carries a parsable block", () => {
    const sources: Array<[string, "html" | "block-js"]> = [];
    for (const dir of ["artifacts/core/rules", "artifacts/core/system-context"]) {
      for (const n of fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(".md"))) {
        sources.push([`${dir}/${n}`, "html"]);
      }
    }
    for (const n of fs.readdirSync(path.join(ROOT, "hooks")).filter((f) => f.endsWith(".ts"))) {
      sources.push([`hooks/${n}`, "block-js"]);
    }
    assert.equal(sources.length, 11);
    for (const [file, syntax] of sources) {
      const got = readAuthoredProvenance(
        fs.readFileSync(path.join(ROOT, file), "utf8"),
        file,
        syntax,
      );
      assert.equal(got.version, "1.0.0", file);
      assert.equal(got.canonical, "${CANONICAL_REPO}", file);
    }
  });
});
