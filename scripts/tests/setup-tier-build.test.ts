// setup-tier-build.test.ts — ensureTierBuilt and the staging paths of scripts/lib/setup/tier-build.ts
// against temporary directories and a fake in-process build (no `bash scripts/build-components.sh`).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { MainInput } from "../lib/build-components/types.ts";
import { SetupExit } from "../lib/setup/exit.ts";
import { ensureTierBuilt, stagingGate, stagingRoot } from "../lib/setup/tier-build.ts";
import type { BuildCtx } from "../lib/setup/tier-build.ts";

let repo: string;
let out: string[];
let err: string[];

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-tier-build-")));
  out = [];
  err = [];
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

function ctxOf(): BuildCtx {
  const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l), errRaw: () => {} };
  return { io, env: { KEEP: "1" }, platform: process.platform, repoDir: repo };
}

describe("staging paths", () => {
  it("name dist/<tier>/<cli root>, and Copilot gates on .github/skills", () => {
    assert.equal(stagingRoot(repo, "claude", "library"), path.join(repo, "dist/library/.claude"));
    assert.equal(stagingRoot(repo, "gemini", "org"), path.join(repo, "dist/org/.gemini"));
    assert.equal(
      stagingRoot(repo, "antigravity", "community"),
      path.join(repo, "dist/community/.agents"),
    );
    assert.equal(
      stagingGate(repo, "copilot", "library"),
      path.join(repo, "dist/library/.github/skills"),
    );
    assert.equal(stagingGate(repo, "claude", "library"), path.join(repo, "dist/library/.claude"));
  });
});

describe("ensureTierBuilt", () => {
  it("does nothing, builds nothing and prints nothing when the staging directory exists", async () => {
    const staging = path.join(repo, "dist/library/.claude");
    fs.mkdirSync(staging, { recursive: true });
    let calls = 0;
    await ensureTierBuilt(ctxOf(), "claude", staging, {
      build: async () => {
        calls += 1;
        return 0;
      },
    });
    assert.equal(calls, 0);
    assert.deepEqual(out, []);
    assert.deepEqual(err, []);
  });

  it("announces with the shell's line, then runs the in-process build for the target", async () => {
    const staging = path.join(repo, "dist/library/.gemini");
    let seen: MainInput | undefined;
    await ensureTierBuilt(ctxOf(), "gemini", staging, {
      build: async (input) => {
        seen = input;
        input.io.out("build output");
        fs.mkdirSync(staging, { recursive: true });
        return 0;
      },
    });
    assert.deepEqual(out, [
      `Tier not built (no ${staging}) — building automatically via 'bash scripts/build-components.sh --target gemini'...`,
      "build output",
    ]);
    assert.deepEqual(seen?.argv, ["--target", "gemini"]);
    assert.equal(seen?.env["REPO_DIR"], repo);
    assert.equal(seen?.env["KEEP"], "1");
    assert.equal(seen?.entryFile, path.join(repo, "scripts", "build-components.ts"));
    assert.deepEqual(err, []);
  });

  it("trusts a successful build even when the staging is still absent, as the shell does", async () => {
    const staging = path.join(repo, "dist/library/.claude");
    await ensureTierBuilt(ctxOf(), "claude", staging, { build: async () => 0 });
    assert.equal(fs.existsSync(staging), false);
    assert.deepEqual(err, []);
  });

  it("names the failed target on stderr and exits 1 when the build fails", async () => {
    const staging = path.join(repo, "dist/library/.agents");
    await assert.rejects(
      ensureTierBuilt(ctxOf(), "antigravity", staging, { build: async () => 2 }),
      (error: unknown) => error instanceof SetupExit && error.status === 1,
    );
    assert.deepEqual(err, ["ERROR: automatic build failed for target 'antigravity'."]);
  });

  it("treats a build that throws as a failed build", async () => {
    const staging = path.join(repo, "dist/library/.github/skills");
    await assert.rejects(
      ensureTierBuilt(ctxOf(), "copilot", staging, {
        build: async () => {
          throw new Error("boom");
        },
      }),
      (error: unknown) => error instanceof SetupExit && error.status === 1,
    );
    assert.deepEqual(err, ["Error: boom", "ERROR: automatic build failed for target 'copilot'."]);
  });
});
