// docs-index-walk.test.ts — the docs-index walker skips the CLI matrix source directory
// `docs/cli-matrix/` and nothing wider (spec 0272 R15; the sources are not published pages).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { listPages } from "../lib/docs-index/walk.ts";

describe("docs/cli-matrix source directory (spec 0272)", () => {
  function tree(files: string[]): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-index-walk-"));
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      fs.writeFileSync(path.join(root, f), "# x\n");
    }
    return root;
  }

  test("nothing under docs/cli-matrix/ is listed", () => {
    const root = tree(["docs/a.md", "docs/cli-matrix/intro.md", "docs/cli-matrix/rows/3.md"]);
    try {
      assert.deepEqual(listPages(root), ["docs/a.md"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("the exception does not widen to look-alikes", () => {
    const files = [
      "docs/cli-matrix.md",
      "docs/cli-matrix-maintenance.md",
      "docs/x/cli-matrix/y.md",
    ];
    const root = tree(files);
    try {
      assert.deepEqual(listPages(root), files.toSorted());
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
