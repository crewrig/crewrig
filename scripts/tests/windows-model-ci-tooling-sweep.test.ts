// windows-model-ci-tooling-sweep.test.ts — the cross-system proof of sweep-en-us.ts (spec 0262
// R23). The sweep modes run from PowerShell on Windows against a scratch git repo that holds one
// markdown file with a British spelling and one with none; off Windows they run from the default
// shell so the file also passes in Linux CI. The entry resolves its repository from its own
// location, so it is copied into the scratch repo with the maps and the engine. Fixtures are built
// at runtime. Interpreters are resolved from the PARENT PATH before the child PATH is narrowed.
// The `windows-model-ci-tooling` job runs every `windows-model-ci-tooling-*.test.ts` file.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

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

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
}

/** A scratch repo: the entry, its maps and engine, `british.md` and `clean.md`, all committed. */
function withBox<T>(body: (root: string, work: string, bin: string) => T): T {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "windows-model-ci-tooling-")),
  );
  try {
    const bin = path.join(root, "bin");
    const work = path.join(root, "work");
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(work, "scripts", "lib"), { recursive: true });
    fs.copyFileSync(
      path.join(repo, "scripts", "sweep-en-us.ts"),
      path.join(work, "scripts", "sweep-en-us.ts"),
    );
    fs.cpSync(
      path.join(repo, "scripts", "lib", "en-us-sweep"),
      path.join(work, "scripts", "lib", "en-us-sweep"),
      { recursive: true },
    );
    for (const f of ["en-gb-us-map.txt", "en-gb-detect.txt"])
      fs.copyFileSync(path.join(repo, "scripts", "lib", f), path.join(work, "scripts", "lib", f));
    git(work, "init", "-q");
    git(work, "config", "user.email", "t@example.com");
    git(work, "config", "user.name", "t");
    git(work, "config", "core.autocrlf", "false");
    fs.writeFileSync(path.join(work, "british.md"), "Organise the colour.\n");
    fs.writeFileSync(path.join(work, "clean.md"), "Organize the color.\n");
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", "fixtures");
    return body(root, work, bin);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Directory of `git`, resolved from the parent PATH (the child PATH is narrowed). */
function gitDir(): string[] {
  const r = spawnSync(WIN ? "where" : "which", ["git"], { encoding: "utf8" });
  const first = r.status === 0 ? r.stdout.split(/\r?\n/)[0] : undefined;
  return first ? [path.dirname(first)] : [];
}

function run(mode: string, root: string, work: string, bin: string): Run {
  // Resolved from the parent environment, before spawnEntry narrows the child PATH.
  const interpreters = resolveInterpreters({
    platform: process.platform,
    env: process.env,
    isFile: defaultIsFile,
  });
  console.log(`windows-model-ci-tooling-sweep: ${mode}: ${interpreters.notes.join("; ")}`);
  return spawnEntry({
    entry: `sweep-en-us ${mode}`,
    script: path.join(work, "scripts", "sweep-en-us.ts"),
    args: [mode],
    shell: "pwsh",
    env: {
      GIT_CONFIG_NOSYSTEM: "1",
      NODE_OPTIONS: "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    },
    home: root,
    bin,
    cwd: work,
    extraPath: gitDir(),
    interpreters,
  });
}

const lf = (text: string): string => text.replaceAll("\r\n", "\n");

describe("windows model-ci-tooling: sweep-en-us", () => {
  it("--check exits 1 and prints the shell's diagnostic for a British spelling", () => {
    withBox((root, work, bin) => {
      const r = run("--check", root, work, bin);
      expectStatus(r, 1);
      assert.match(
        lf(r.out),
        /^\[superset\] PASS: all \d+ map keys present in detect list/,
        why(r, "superset"),
      );
      assert.ok(lf(r.out).includes("R6 VIOLATION: british.md:1: Organise\n"), why(r, "Organise"));
      assert.ok(lf(r.out).includes("R6 VIOLATION: british.md:1: colour\n"), why(r, "colour"));
      assert.ok(
        lf(r.out).includes("[R6] FAIL: 2 residual British spelling(s) in scope\n"),
        why(r, "FAIL line"),
      );
      assert.ok(!r.out.includes("clean.md"), why(r, "clean file not reported"));
    });
  });

  it("--list prints both in-scope files and not the entry itself", () => {
    withBox((root, work, bin) => {
      const r = run("--list", root, work, bin);
      expectStatus(r, 0);
      assert.equal(lf(r.out), "british.md\nclean.md\n", why(r, "in-scope set"));
    });
  });

  it("--apply rewrites the British file with LF endings and leaves the clean one", () => {
    withBox((root, work, bin) => {
      const r = run("--apply", root, work, bin);
      expectStatus(r, 0);
      assert.ok(lf(r.out).includes("[sweep] files changed: 1\n"), why(r, "files changed"));
      assert.ok(lf(r.out).includes("[sweep] total replacements: 2\n"), why(r, "replacements"));
      const after = fs.readFileSync(path.join(work, "british.md"));
      assert.equal(after.toString("utf8"), "Organize the color.\n", why(r, "rewritten bytes"));
      assert.ok(!after.includes(0x0d), "the TS entry writes \\n, never \\r\\n");
      assert.equal(
        fs.readFileSync(path.join(work, "clean.md"), "utf8"),
        "Organize the color.\n",
        why(r, "clean file untouched"),
      );
    });
  });

  it("--check exits 0 on a repo without British spellings", () => {
    withBox((root, work, bin) => {
      fs.writeFileSync(path.join(work, "british.md"), "Organize the color.\n");
      git(work, "commit", "-q", "-am", "clean");
      const r = run("--check", root, work, bin);
      expectStatus(r, 0);
      assert.ok(
        lf(r.out).includes("[R6] PASS: zero British spellings remain in the in-scope set\n"),
        why(r, "PASS line"),
      );
    });
  });
});
