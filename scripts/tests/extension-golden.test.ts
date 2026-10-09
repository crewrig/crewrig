// extension-golden.test.ts — the TypeScript build equals the committed golden tree, byte for byte, on
// Linux, macOS and Windows (spec 0254 R22, R23). The golden was written by the shell oracle
// (scripts/tests/lib/extension-golden-regen.ts); this suite never spawns a POSIX tool.

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

import { buildSubjects } from "./lib/extension-trees.ts";
import {
  collectFiles,
  collectGolden,
  diffFiles,
  extensionRoot,
  outputDirs,
  runTs,
} from "./lib/extension-run.ts";

const GOLDEN = path.resolve(import.meta.dirname, "fixtures", "extension-golden");

describe("build-extension --target all equals the golden tree", () => {
  for (const [name, files] of Object.entries(buildSubjects())) {
    test(name, () => {
      const tree = extensionRoot({ [name]: files });
      const run = runTs(tree, "build-extension", ["--target", "all", name]);
      assert.equal(run.status, 0, run.stderr);
      for (const [label, dir] of Object.entries(outputDirs(tree, name))) {
        const golden = collectGolden(path.join(GOLDEN, name, label));
        assert.ok(golden.size > 0, `${name}/${label}: the golden is empty`);
        const built = collectFiles(dir);
        assert.deepEqual(diffFiles(golden, built), [], `${name}/${label}`);
        for (const [rel, bytes] of built) {
          assert.ok(!bytes.includes(13), `${name}/${label}/${rel} holds a carriage return`);
        }
      }
      tree.dispose();
    });
  }
});
