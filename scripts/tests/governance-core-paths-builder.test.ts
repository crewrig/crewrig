// governance-core-paths-builder.test.ts — Replaces scripts/tests/test-check-core-paths.sh
// (case i: the REAL builder against a bare manifest). Spec 0265 (row J2), spec 0250 R26.
//
// The sandbox repository holds the entry, scripts/lib/ (the builder imports sibling modules
// beyond scripts/lib/build-components/) and package.json, copied untracked; never all of
// scripts/ (scripts/tests is the bulk). The `9 of 9`
// count is a forcing function: update it when a built-output directory is legitimately added.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  initGitRepo,
  makeInitialCommit,
  runCorePaths,
  writeManifest,
} from "./lib/governance-core-paths-fixtures.ts";
import { copyTracked, makeSandbox } from "./lib/governance-sandbox.ts";

test(
  "case-i: the real build script against a bare manifest fails, naming the real directories",
  { timeout: 60_000 },
  () => {
    const repo = makeSandbox("core-paths-real-");
    initGitRepo(repo);
    makeInitialCommit(repo, { "real.txt": "tracked content" });
    copyTracked(repo, ["scripts/build-components.ts", "scripts/lib", "package.json"]);
    writeManifest(repo, "real.txt\tstrict\n");
    const r = runCorePaths(repo);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(r.stderr.includes("- .agents/skills"), r.stderr);
    assert.ok(r.stderr.includes("- .agents/agents"), r.stderr);
    assert.ok(r.stderr.includes("9 of 9 built-output"), r.stderr);
  },
);
