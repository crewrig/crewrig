// install-sandbox.test.ts — the sandbox helper proves itself before other suites rely on it
// (spec 0255 R26; ticket #1334).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  cliCalls,
  createInstallSandbox,
  IMPL,
  listTree,
  runEntry,
  runLegs,
  stubCli,
} from "./lib/install-sandbox.ts";

const sandbox = createInstallSandbox({ deps: "none" });

describe("install sandbox", () => {
  it("gives the child a throwaway HOME and no jq", () => {
    const h = sandbox.hermetic;
    assert.equal(h.env["HOME"], sandbox.home);
    assert.equal(h.env["USERPROFILE"], sandbox.home);
    assert.notEqual(sandbox.home, process.env["HOME"]);
    assert.ok(sandbox.home.startsWith(fs.realpathSync(h.root)));
    for (const cli of ["claude", "copilot", "agy", "gemini"]) {
      assert.ok(fs.existsSync(path.join(h.bin, cli)), `${cli} stub`);
    }
    assert.equal(fs.existsSync(path.join(h.bin, "jq")), false);
  });

  it("records the argv of a stub and exits with the chosen status", () => {
    stubCli(sandbox, "claude", { status: 7, stdout: "out", stderr: "err" });
    const bin = path.join(sandbox.hermetic.bin, "claude");
    const res = runEntryShell(`${bin} plugin 'two words' ""`);
    assert.equal(res.status, 7);
    assert.equal(res.stdout, "out");
    assert.equal(res.stderr, "err");
    assert.deepEqual(cliCalls(sandbox, "claude"), [["plugin", "two words", ""]]);
    assert.deepEqual(cliCalls(sandbox, "gemini"), []);
  });

  it("runs the shell leg of scripts/unlink-component.sh against the sandbox HOME", () => {
    const target = path.join(sandbox.home, ".gemini", "skills", "demo");
    fs.mkdirSync(target, { recursive: true });
    const removed = runEntry(sandbox, "unlink-component", ["skill", "demo"]);
    assert.equal(removed.status, 0);
    assert.equal(removed.stdout, "Removed: skills/demo\n");
    assert.equal(fs.existsSync(target), false);
    const missing = runEntry(sandbox, "unlink-component", ["skills", "demo"]);
    assert.equal(missing.stdout, "Not found: skills/demo\n");
    const usage = runEntry(sandbox, "unlink-component", []);
    assert.equal(usage.status, 1);
    assert.match(usage.stdout, /^Usage: /);
  });

  it("offers only the legs whose entry exists", () => {
    assert.deepEqual(IMPL, ["shell", "node"]);
    const legs = runLegs(sandbox, "unlink-component", ["skills", "demo"]);
    assert.deepEqual(
      legs.map((l) => l.leg),
      sandbox.tree.exists("scripts/unlink-component.ts") ? ["shell", "node"] : ["shell"],
    );
  });

  it("lists a placed tree with directories and links marked", () => {
    const dir = path.join(sandbox.home, "placed");
    fs.mkdirSync(path.join(dir, "a"), { recursive: true });
    fs.writeFileSync(path.join(dir, "a", "f.txt"), "x");
    fs.symlinkSync("a/f.txt", path.join(dir, "l"));
    assert.deepEqual(listTree(dir), ["a/", "a/f.txt", "l -> a/f.txt"]);
    assert.deepEqual(listTree(path.join(dir, "absent")), []);
  });
});

/** Run a `bash -c` line with the sandbox environment (the stub is reached by absolute path). */
function runEntryShell(line: string): { status: number | null; stdout: string; stderr: string } {
  const bash = path.join(sandbox.hermetic.bin, "bash");
  const res = spawnSync(bash, ["-c", line], { encoding: "utf8", env: sandbox.hermetic.env });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}
