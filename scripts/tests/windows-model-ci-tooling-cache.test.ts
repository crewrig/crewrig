// windows-model-ci-tooling-cache.test.ts — the cross-system proof of ci-cache-guard.ts (spec 0262
// R21-R23). The option rejections run from PowerShell on Windows; off Windows they run from the
// default shell so the file also passes in Linux CI. The cache cases wrap a command through
// `bash -c` (the one permitted shell spawn) and are POSIX-only where no bash exists. The cache
// directory lives inside the test's own mkdtemp. The `windows-model-ci-tooling` job runs every
// `windows-model-ci-tooling-*.test.ts` file.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { bashPath } from "../lib/ci-cache-guard/shell.ts";
import { defaultIsFile } from "../lib/worktree-claim/launch-windows.ts";
import {
  expectStatus,
  resolveInterpreters,
  spawnEntry,
  WIN,
  why,
} from "./lib/windows-proof-support.ts";
import type { Run } from "./lib/windows-proof-support.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = path.join(repo, "scripts", "ci-cache-guard.ts");

function withBox<T>(body: (root: string, bin: string) => T): T {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "windows-model-ci-tooling-")),
  );
  try {
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    return body(root, bin);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Directory of the `bash` the twin will use, resolved from the parent environment by the twin's own
 * resolver (never the System32 WSL launcher); empty when none exists, so the cache cases skip.
 */
function bashDir(): string[] {
  if (!WIN) {
    const r = spawnSync("which", ["bash"], { encoding: "utf8" });
    const first = r.status === 0 ? r.stdout.split(/\r?\n/)[0] : undefined;
    return first ? [path.dirname(first)] : [];
  }
  const found = bashPath(process.env);
  return found === null ? [] : [path.dirname(found)];
}

function run(entry: string, args: string[], root: string, bin: string): Run {
  const interpreters = resolveInterpreters({
    platform: process.platform,
    env: process.env,
    isFile: defaultIsFile,
  });
  console.log(`windows-model-ci-tooling-cache: ${entry}: ${interpreters.notes.join("; ")}`);
  return spawnEntry({
    entry,
    script,
    args,
    shell: "pwsh",
    env: { NODE_OPTIONS: "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON" },
    home: root,
    bin,
    cwd: root,
    extraPath: bashDir(),
    interpreters,
  });
}

describe("windows model-ci-tooling: ci-cache-guard", () => {
  it("rejects an unknown option with status 2", () => {
    withBox((root, bin) => {
      const r = run("cache-guard unknown", ["--bogus", "--", "x"], root, bin);
      expectStatus(r, 2);
      assert.equal(
        r.err.replaceAll("\r\n", "\n"),
        "Error: unknown option '--bogus'\n",
        why(r, "diagnostic"),
      );
    });
  });

  it("rejects --stray-scan combined with a cache option", () => {
    withBox((root, bin) => {
      const r = run(
        "cache-guard exclusive",
        ["--stray-scan", "--cache-dir", "c", "--", "x"],
        root,
        bin,
      );
      expectStatus(r, 2);
      assert.match(r.err, /--stray-scan cannot be combined/);
    });
  });

  it("misses, writes the marker, then hits", { skip: bashDir().length === 0 }, () => {
    withBox((root, bin) => {
      const args = ["--cache-dir", "cache", "--", "bash", "-c", "exit 0"];
      const miss = run("cache-guard miss", args, root, bin);
      expectStatus(miss, 0);
      assert.match(
        miss.out,
        /cache miss, running: bash -c exit 0\r?\nci-cache-guard: wrote marker cache\/[0-9a-f]{64}\/[0-9a-f]{64}\.marker/,
      );
      const hit = run("cache-guard hit", args, root, bin);
      expectStatus(hit, 0);
      assert.match(hit.out, /^ci-cache-guard: cache hit for: bash -c exit 0/);
    });
  });
});
