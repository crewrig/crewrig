// Tests for the GIT_* scrub in the shared git-backed test helpers (spec 0279 delta-02 R21(c)).
// Git exports GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE and GIT_PREFIX to a hook; a helper that copies
// process.env into a fixture child would let that child act on the real repository. Each test pollutes
// process.env with sentinels, calls the helper's env builder and asserts no sentinel survives. Git is
// never run here.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { childEnv as ciParityChildEnv } from "./lib/ci-parity-fixture.ts";
import { cleanEnv as differentialCleanEnv } from "./lib/differential-sandbox.ts";
import { gitEnv as corePathsGitEnv } from "./lib/governance-core-paths-fixtures.ts";
import { childEnv as governanceChildEnv } from "./lib/governance-sandbox.ts";
import { gitEnv as rangeScanGitEnv } from "./lib/mempalace-range-scan.ts";
import { childEnv as reserveChildEnv } from "./lib/reserve-spec-id-fixture.ts";
import { childEnv as specIdChildEnv } from "./lib/spec-id-fixture.ts";
import { lintEnv } from "./lib/spec-linter-fixtures.ts";
import { createSyncRoot } from "./lib/sync-fixture.ts";
import { cleanEnv as worktreeCleanEnv } from "./lib/worktree-fixtures.ts";

const SENTINELS: Readonly<Record<string, string>> = {
  GIT_DIR: "/nonexistent/sentinel/git-dir",
  GIT_WORK_TREE: "/nonexistent/sentinel/work-tree",
  GIT_INDEX_FILE: "/nonexistent/sentinel/index",
  GIT_PREFIX: "sentinel-prefix/",
};

/** Run `body` with the sentinels set in process.env; the previous values come back in `finally`. */
function polluted<T>(body: () => T): T {
  const before = Object.fromEntries(Object.keys(SENTINELS).map((k) => [k, process.env[k]]));
  Object.assign(process.env, SENTINELS);
  try {
    return body();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** No sentinel key, and no sentinel value under any key, in `env`. */
function assertClean(env: NodeJS.ProcessEnv, who: string): void {
  for (const [key, value] of Object.entries(SENTINELS)) {
    assert.equal(env[key], undefined, `${who}: ${key} leaked`);
    assert.ok(!Object.values(env).includes(value), `${who}: sentinel value of ${key} leaked`);
  }
}

const FAKE_FIXTURE = {
  root: "/nonexistent/sentinel-root",
  bare: "/nonexistent/sentinel-root/bare.git",
  work: "/nonexistent/sentinel-root/work",
  home: "/nonexistent/sentinel-root/home",
  bin: "/nonexistent/sentinel-root/bin",
  dir: "/nonexistent/sentinel-root",
};

describe("test helpers scrub the inherited GIT_* environment (R21(c))", () => {
  it("governance-sandbox childEnv", () => {
    const env = polluted(() => governanceChildEnv());
    assertClean(env, "governance-sandbox childEnv");
    assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
  });

  it("governance-sandbox childEnv still forwards an explicit extra GIT_ value", () => {
    const env = polluted(() => governanceChildEnv({ GIT_AUTHOR_NAME: "Explicit" }));
    assert.equal(env.GIT_AUTHOR_NAME, "Explicit");
    assertClean(env, "governance-sandbox childEnv extra");
  });

  it("worktree-fixtures cleanEnv", () => {
    assertClean(
      polluted(() => worktreeCleanEnv()),
      "worktree-fixtures cleanEnv",
    );
  });

  it("spec-linter-fixtures lintEnv", () => {
    const env = polluted(() => lintEnv());
    assertClean(env, "spec-linter-fixtures lintEnv");
    assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
    assert.ok(env.GIT_CONFIG_GLOBAL !== undefined, "lintEnv sets its own GIT_CONFIG_GLOBAL");
  });

  it("ci-parity-fixture childEnv", () => {
    assertClean(
      polluted(() => ciParityChildEnv("/nonexistent/sentinel-fixture")),
      "ci-parity-fixture childEnv",
    );
  });

  it("governance-core-paths-fixtures gitEnv", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "git-env-helpers-"));
    try {
      const env = polluted(() => corePathsGitEnv(path.join(parent, "repo")));
      assertClean(env, "governance-core-paths-fixtures gitEnv");
      assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
    } finally {
      // The directory was created by this test with mkdtemp, nothing else is removed.
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("sync-fixture createSyncRoot env", () => {
    const sr = polluted(() => createSyncRoot("git-env-helpers-sync-"));
    try {
      assertClean(sr.env, "sync-fixture createSyncRoot");
      assert.equal(sr.env.GIT_CONFIG_NOSYSTEM, "1");
    } finally {
      sr.dispose(); // removes only the mkdtemp root createSyncRoot made
    }
  });

  it("mempalace-range-scan gitEnv", () => {
    const env = polluted(() => rangeScanGitEnv());
    assertClean(env, "mempalace-range-scan gitEnv");
    assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
  });

  it("differential-sandbox cleanEnv", () => {
    const env = polluted(() => differentialCleanEnv("/nonexistent/sentinel-home"));
    assertClean(env, "differential-sandbox cleanEnv");
    assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
  });

  it("reserve-spec-id-fixture childEnv", () => {
    const env = polluted(() => reserveChildEnv(FAKE_FIXTURE));
    assertClean(env, "reserve-spec-id-fixture childEnv");
    assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
  });

  it("spec-id-fixture childEnv", () => {
    const env = polluted(() => specIdChildEnv(FAKE_FIXTURE));
    assertClean(env, "spec-id-fixture childEnv");
    assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
  });

  it("spec-id-fixture childEnv scrubs an explicit ambient argument too", () => {
    assertClean(specIdChildEnv(FAKE_FIXTURE, {}, { ...SENTINELS }), "spec-id-fixture ambient");
  });
});

// Helpers whose env is built inside a function that spawns (no env builder to call without running a
// child, a git or a heavy rig): covered by a source assertion that the helper routes the inherited
// environment through scrubGitEnv( and no longer deletes GIT_ keys by hand.
describe("helpers covered by a source assertion (R21(c))", () => {
  const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), "lib");
  const HELPERS = [
    "host-safety-fixtures.ts", // runCheck: spawns the checker
    "scratch-remote.ts", // git(): spawns git
    "setup-sandbox.ts", // buildRepo(): spawns git init
    "release-main-fixture.ts", // makeCheckout git(): spawns git
    "extension-sandbox.ts", // runEntry(): spawns the build entry in a git-initialised sandbox
    "windows-build-proof.ts", // entry() and the git ls-files listing
    "windows-proof-support.ts", // spawnEntry(): spawns the entry under test
  ];
  for (const name of HELPERS) {
    it(`${name} contains scrubGitEnv(`, () => {
      const source = fs.readFileSync(path.join(LIB, name), "utf8");
      assert.match(source, /scrubGitEnv\(/);
      assert.doesNotMatch(source, /delete\s+\w+\[\s*"GIT_(DIR|WORK_TREE|INDEX_FILE)"\s*\]/);
    });
  }
});
