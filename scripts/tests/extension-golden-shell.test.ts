// extension-golden-shell.test.ts — the committed golden tree still equals the shell oracle's output
// (spec 0254 R22). Linux and macOS only: it spawns `bash`, `jq` and `yq` on purpose. It keeps the
// golden honest while the shell is the oracle and is deleted with the differential test in PR D.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, test } from "node:test";

import { buildSubjects } from "./lib/extension-trees.ts";
import {
  collectFiles,
  diffFiles,
  extensionRoot,
  outputDirs,
  runShell,
} from "./lib/extension-run.ts";

const GOLDEN = path.resolve(import.meta.dirname, "fixtures", "extension-golden");
const missing = ["bash", "jq", "yq"].filter((tool) => spawnSync(tool, ["--version"]).status !== 0);
const skip =
  process.platform === "win32"
    ? "the shell oracle needs a POSIX shell"
    : missing.length > 0
      ? `${missing.join(", ")} not available on this machine`
      : false;

describe("the golden tree equals the shell oracle", { skip }, () => {
  for (const [name, files] of Object.entries(buildSubjects())) {
    test(name, () => {
      const tree = extensionRoot({ [name]: files });
      const run = runShell(tree, "build-extension", ["--target", "all", name]);
      assert.equal(run.status, 0, run.stderr);
      for (const [label, dir] of Object.entries(outputDirs(tree, name))) {
        const golden = collectFiles(path.join(GOLDEN, name, label));
        assert.deepEqual(diffFiles(golden, collectFiles(dir)), [], `${name}/${label}`);
      }
      tree.dispose();
    });
  }
});
