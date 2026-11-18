// Spec 0310 R9: every `uses:` of the two framework release workflows is pinned to a full commit SHA (these
// two files only), and the publish job runs without node_modules (the guard and the publisher import only
// Node.js built-ins).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { PRE, pinDefects, REPO, STABLE } from "./lib/framework-release-workflows-kit.ts";

for (const [title, text] of [
  ["prerelease workflow", PRE],
  ["stable workflow", STABLE],
] as const) {
  describe(`${title}: action pins`, () => {
    it("pins every action to a full commit SHA", () => assert.deepEqual(pinDefects(text), []));
    it("mutant caught: a tag-only action", () => {
      const bad = text.replace(/(actions\/checkout)@[0-9a-f]{40} # v[\d.]+/, "$1@v4");
      assert.notEqual(bad, text);
      assert.ok(pinDefects(bad).length > 0);
    });
    it("mutant caught: a SHA without its version comment", () => {
      const bad = text.replace(/(actions\/checkout@[0-9a-f]{40}) # v[\d.]+/, "$1");
      assert.notEqual(bad, text);
      assert.ok(pinDefects(bad).length > 0);
    });
    it("mutant caught: a local action", () => {
      const bad = text.replace(
        /uses: actions\/checkout@\S+ # v[\d.]+/,
        "uses: ./.github/actions/ci-job",
      );
      assert.notEqual(bad, text);
      assert.ok(pinDefects(bad).length > 0);
    });
    it("mutant caught: a docker reference", () => {
      const bad = text.replace(
        /uses: actions\/checkout@\S+ # v[\d.]+/,
        "uses: docker://alpine:3.20",
      );
      assert.notEqual(bad, text);
      assert.ok(pinDefects(bad).length > 0);
    });
    it("mutant caught: a short SHA", () => {
      const bad = text.replace(/(actions\/setup-node@)[0-9a-f]{40}/, "$1abcdef0");
      assert.notEqual(bad, text);
      assert.ok(pinDefects(bad).length > 0);
    });
  });
}

describe("the publish job runs without node_modules", () => {
  /** Non-relative, non-`node:` import specifiers reachable from `entry`. */
  function externalImports(entry: string, seen = new Set<string>()): string[] {
    if (seen.has(entry)) return [];
    seen.add(entry);
    const dir = path.dirname(entry);
    const out: string[] = [];
    const src = fs.readFileSync(entry, "utf8");
    for (const m of src.matchAll(/(?:from|import\()\s*"([^"]+)"/g)) {
      const spec = m[1] ?? "";
      if (spec.startsWith(".")) out.push(...externalImports(path.resolve(dir, spec), seen));
      else if (!spec.startsWith("node:")) out.push(`${path.relative(REPO, entry)}: ${spec}`);
    }
    return out;
  }
  for (const main of ["guard-main.ts", "publish-main.ts"]) {
    it(`${main} imports only Node.js built-ins and repository files`, () => {
      assert.deepEqual(
        externalImports(path.join(REPO, "scripts", "lib", "framework-release", main)),
        [],
      );
    });
  }
});
