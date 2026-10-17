// system-context-install-dir-common-sh.test.ts — install_dir and print_store_access_guidance of
// scripts/lib/common.sh, driven through a sourced bash (ported from test-system-context-store.sh
// groups 2 and 4(d); spec 0263 row C, sourced-library exception). POSIX only: bash library and
// symbolic links. HOME and USERPROFILE are a scratch directory.
// Retires with scripts/lib/common.sh (row J4).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";

const STORE = path.join(REPO, "artifacts", "core", "system-context");
const COMMON = path.join(REPO, "scripts", "lib", "common.sh");
const roots: string[] = [];
after(() => roots.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function scratch(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sysctx-")));
  roots.push(root);
  return root;
}

/** Source common.sh and run `body`; extra positional arguments are $1.. of the fragment. */
function bash(root: string, body: string, ...args: string[]) {
  const res = spawnSync("bash", ["-c", `set +e\nsource "${COMMON}"\n${body}`, "bash", ...args], {
    encoding: "utf8",
    cwd: root,
    env: { PATH: process.env["PATH"], HOME: root, USERPROFILE: root, LC_ALL: "C" },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

const installDir = (root: string, mode: "copy" | "link", target: string, label: string) =>
  bash(root, 'INSTALL_MODE="$1"; install_dir "$2" "$3" "$4"', mode, STORE, target, label);

function listing(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();
}

/** Same relative file set and byte-identical contents (follows a link target). */
function assertIdentical(source: string, target: string): void {
  assert.deepEqual(listing(target), listing(source));
  for (const rel of listing(source)) {
    const a = path.join(source, rel);
    if (!fs.statSync(a).isFile()) continue;
    assert.ok(fs.readFileSync(a).equals(fs.readFileSync(path.join(target, rel))), rel);
  }
}

describe(
  "install_dir of common.sh (system-context store)",
  { skip: process.platform === "win32" && "POSIX only: bash library and symbolic links" },
  () => {
    it("copy mode: a real directory, byte-identical", () => {
      const root = scratch();
      const target = path.join(root, "copy", "system-context");
      assert.equal(installDir(root, "copy", target, "test-copy").status, 0);
      assert.equal(fs.lstatSync(target).isSymbolicLink(), false);
      assert.ok(fs.lstatSync(target).isDirectory());
      assertIdentical(STORE, target);
    });

    it("copy mode over an existing directory drops stale files (added: not in the Bash suite)", () => {
      const root = scratch();
      const target = path.join(root, "stale", "system-context");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "stale.md"), "old\n");
      assert.equal(installDir(root, "copy", target, "test-stale").status, 0);
      assert.equal(fs.existsSync(path.join(target, "stale.md")), false);
      assertIdentical(STORE, target);
    });

    it("link mode: a symlink, then a switch to copy leaves a real directory", () => {
      const root = scratch();
      const target = path.join(root, "link", "system-context");
      assert.equal(installDir(root, "link", target, "test-link").status, 0);
      assert.ok(fs.lstatSync(target).isSymbolicLink());
      assertIdentical(STORE, target);
      assert.equal(installDir(root, "copy", target, "test-switch").status, 0);
      assert.equal(fs.lstatSync(target).isSymbolicLink(), false);
      assert.ok(fs.lstatSync(target).isDirectory());
      assertIdentical(STORE, target);
    });
  },
);

describe(
  "print_store_access_guidance of common.sh",
  { skip: process.platform === "win32" && "POSIX only: bash library" },
  () => {
    it("names --include-directories for gemini and --add-dir for copilot", () => {
      const root = scratch();
      const gemini = bash(root, 'print_store_access_guidance "$1"', "gemini");
      const copilot = bash(root, 'print_store_access_guidance "$1"', "copilot");
      assert.ok(gemini.stdout.includes("--include-directories"), gemini.stdout);
      assert.ok(copilot.stdout.includes("--add-dir"), copilot.stdout);
    });
  },
);
