// install-extension-all-real.test.ts — what test-install-extension-all.ts pinned beyond the
// stubbed contract of install-all.test.ts (spec 0263, row C): the REAL shim with the REAL
// children under a restricted PATH, and the Taskfile declarations the umbrella installer relies
// on. Help, missing argument and unknown extension stay in install-all.test.ts.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { loadTaskfileTree } from "../lib/taskfile-tree.ts";

const POSIX = process.platform !== "win32";
const roots: string[] = [];
after(() => roots.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

/** Run the real shim with only `node` on PATH next to /usr/bin:/bin (a symlink, never the real dir). */
function runShim(geminiHome: (root: string) => string) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "install-all-real-")));
  roots.push(root);
  const fakeBin = path.join(root, "bin");
  const home = path.join(root, "home");
  fs.mkdirSync(fakeBin);
  fs.mkdirSync(home);
  fs.symlinkSync(process.execPath, path.join(fakeBin, "node"));
  const gemini = geminiHome(root);
  const res = spawnSync(
    process.execPath,
    [path.join(REPO, "scripts", "install-extension-all.ts"), "hello-world"],
    {
      encoding: "utf8",
      cwd: REPO,
      env: {
        PATH: `/usr/bin:/bin:${fakeBin}`,
        HOME: home,
        USERPROFILE: home,
        GEMINI_HOME: gemini,
        LC_ALL: "C",
      },
    },
  );
  return { status: res.status, out: `${res.stdout}${res.stderr}`, gemini };
}

describe(
  "install-extension-all (real children, restricted PATH)",
  { skip: !POSIX && "POSIX PATH and .sh shim" },
  () => {
    it("exits 1 when every target is skipped", () => {
      const { status, out } = runShim((root) => path.join(root, "nonexistent_gemini"));
      assert.equal(status, 1);
      assert.ok(out.includes("[SKIPPED]"), out);
      assert.ok(out.includes("all 4 target(s) were skipped"), out);
    });

    it("installs Gemini only from a real partial install", () => {
      const { status, out } = runShim((root) => {
        const dir = path.join(root, "gemini_home");
        fs.mkdirSync(dir);
        return dir;
      });
      assert.equal(status, 0, out);
      assert.ok(out.includes("[INSTALLED] Gemini CLI"), out);
      assert.ok(out.includes("[SKIPPED]   Claude Code"), out);
      assert.ok(out.includes("[SKIPPED]   GitHub Copilot CLI"), out);
      assert.ok(out.includes("[SKIPPED]   Antigravity CLI"), out);
    });
  },
);

describe("Taskfile tree umbrella-installer declarations", () => {
  const tree = loadTaskfileTree(REPO);
  // The deprecation notices are echoed text, so the check serialises every task definition.
  const text = tree.tasks.map((t) => JSON.stringify(t.definition)).join("\n");

  it("declares the six extension tasks", () => {
    for (const name of [
      "install-gemini-extension",
      "install-gemini-extensions",
      "link-gemini-extensions",
      "link-gemini-extension-build",
      "unlink-gemini-extensions",
      "install-extension-all",
    ]) {
      assert.ok(tree.byName.has(name), `missing task ${name}`);
    }
  });

  it("keeps the four deprecation notices of the legacy aliases", () => {
    for (const name of [
      "install-extension",
      "install-extensions",
      "link-extensions",
      "unlink-extensions",
    ]) {
      assert.ok(text.includes(`[DEPRECATION] 'task ${name}' is deprecated`), name);
    }
  });
});
