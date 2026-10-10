// windows-install-proof.ts — the cross-system proof of the install, manage and link entries (spec 0255
// R28, parent R17). Not a test suite: a script the `windows-install-entries` job runs under pwsh, and
// that also passes on POSIX (the entry then runs directly), so its assertions are the same on both.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/tests/lib/windows-install-proof.ts
// Every one of the thirteen entries runs against a sandbox HOME/USERPROFILE from a NON-POSIX
// interpreter (PowerShell; `cmd.exe` for the unlink and link entries). Stub CLIs are `.cmd` files on
// Windows. The elapsed time of each step is printed, never asserted. Exit 0, or a message and exit 1.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { createFixtureTree, REPO } from "./build-fixture-tree.ts";
import type { FixtureTree } from "./build-fixture-tree.ts";
import { collectFiles } from "./extension-run.ts";
import { renameRetry } from "../../lib/link-or-copy-swap.ts";
import type { SwapFs } from "../../lib/link-or-copy-swap.ts";
import { defaultIsFile } from "../../lib/worktree-claim/launch-windows.ts";
import {
  resolveInterpreters,
  sandboxPath,
  spawnEntry,
  expectStatus,
  why,
  WIN,
} from "./windows-proof-support.ts";
import type { Interpreters, Run, Shell } from "./windows-proof-support.ts";

let tree: FixtureTree | undefined;
let home = "";
let bin = "";
let calls = "";
let interpreters: Interpreters = { pwsh: "pwsh", cmd: "cmd.exe", notes: [] };
let current = "";
const failures: string[] = [];
const covered = new Set<string>();
const gemini = (...parts: string[]): string => path.join(home, ".gemini", ...parts);

function setup(): void {
  tree = createFixtureTree();
  home = path.join(tree.root, "home");
  bin = path.join(tree.root, "bin");
  calls = path.join(tree.root, "calls");
  for (const dir of [home, bin, calls]) fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(
    path.join(REPO, "extensions", "core", "hello-world"),
    path.join(tree.root, "extensions", "core", "hello-world"),
    { recursive: true, filter: (e) => path.basename(e) !== "node_modules" },
  );
}

function stub(name: string, body: string): void {
  const log = path.join(calls, name);
  if (WIN) {
    const lines = ["@echo off", `>>"${log}" echo %*`, ...body.split("\n"), "exit /b 0"];
    fs.writeFileSync(path.join(bin, `${name}.cmd`), lines.join("\r\n") + "\r\n");
  } else {
    const text = `#!/bin/sh\necho "$@" >> '${log}'\n${body}\nexit 0\n`;
    fs.writeFileSync(path.join(bin, name), text, { mode: 0o755 });
  }
}
const calledWith = (name: string): string => fs.readFileSync(path.join(calls, name), "utf8");

/** Run one check; a failure is recorded with its step and name, and the proof carries on. */
function attempt(name: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${current} / ${name}: ${message}`);
    console.error(`windows-install-proof: FAIL ${current} / ${name}: ${message}`);
  }
}

/** Run `scripts/<entry>.ts` through `shell` (POSIX: directly), timing the step. */
function run(entry: string, args: string[], shell: Shell, env: Record<string, string> = {}): Run {
  covered.add(entry);
  const script = path.join(tree?.root ?? "", "scripts", `${entry}.ts`);
  const res = spawnEntry({ entry, script, args, shell, env, home, bin, interpreters });
  console.log(`windows-install-proof: ${entry} ${args.join(" ")} [${shell}]: ${res.ms} ms`);
  return res;
}

function noCarriageReturn(dir: string): void {
  for (const [rel, bytes] of collectFiles(dir))
    assert.ok(!bytes.includes(13), `${path.join(dir, rel)} holds a carriage return`);
}

function installStep(): void {
  attempt("install-extension install hello-world", () => {
    const res = run("install-extension", ["install", "hello-world"], "pwsh");
    expectStatus(res, 0);
    assert.match(res.out, /Copied: hello-world/, why(res, "expected a Copied line"));
    assert.ok(collectFiles(gemini("extensions", "hello-world")).size > 0, "files were placed");
    noCarriageReturn(gemini("extensions", "hello-world"));
  });
}

function unlinkStep(): void {
  attempt("unlink-extensions", () => {
    const removed = run("unlink-extensions", [], "cmd");
    expectStatus(removed, 0);
    assert.match(removed.out, /^ {2}Removed: hello-world$/m, why(removed, "expected Removed"));
    assert.ok(!fs.existsSync(gemini("extensions", "hello-world")), "the copy is gone");
  });
  attempt("unlink-component command x", () => {
    fs.mkdirSync(gemini("commands", "x"), { recursive: true });
    fs.writeFileSync(gemini("commands", "x", "f.txt"), "keep\n");
    const copy = run("unlink-component", ["command", "x"], "cmd");
    assert.equal(copy.out, "Removed: commands/x\n", why(copy, "unexpected stdout"));
    const again = run("unlink-component", ["commands", "x"], "cmd");
    assert.equal(again.out, "Not found: commands/x\n", why(again, "unexpected stdout"));
  });
  attempt("unlink-component of a link", () => {
    try {
      fs.mkdirSync(gemini("commands", "target"), { recursive: true });
      fs.symlinkSync(gemini("commands", "target"), gemini("commands", "lnk"), "junction");
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      console.log(`windows-install-proof: runner cannot link: ${code}`);
      return;
    }
    const res = run("unlink-component", ["commands", "lnk"], "cmd");
    assert.equal(res.out, "Removed: commands/lnk\n", why(res, "unexpected stdout"));
    assert.ok(fs.existsSync(gemini("commands", "target")), "the link target is left alone");
  });
}

function linkStep(): void {
  for (let pass = 1; pass <= 2; pass++)
    attempt(`link-extensions pass ${pass}`, () => {
      const res = run("link-extensions", [], "pwsh");
      expectStatus(res, 0);
      const isLink = fs.lstatSync(gemini("extensions", "hello-world")).isSymbolicLink();
      console.log(
        `windows-install-proof: link pass ${pass}: link = ${isLink} ${isLink ? "" : res.err.split("\n")[0]}`,
      );
      if (isLink) assert.match(res.out, /Linked: hello-world/, why(res, "expected Linked"));
      else
        assert.match(res.err, /Symbolic links were refused \((\w+)/, why(res, "expected notice"));
    });
  attempt("link-extensions with a forced refusal", () => {
    run("unlink-extensions", [], "cmd");
    const forced = run("link-extensions", [], "cmd", { CREWRIG_TEST_LINK_REFUSAL: "EPERM" });
    expectStatus(forced, 0);
    assert.match(forced.out, /Copied: hello-world/, why(forced, "expected Copied"));
    for (const name of fs.readdirSync(path.join(tree?.root ?? "", "extensions", "core")))
      assert.ok(
        forced.err.includes(gemini("extensions", name)),
        why(forced, `notice names ${name}`),
      );
    assert.ok(!fs.lstatSync(gemini("extensions", "hello-world")).isSymbolicLink());
    run("unlink-extensions", [], "cmd");
  });
}

function pluginsStep(): void {
  attempt("install-claude-plugin", () => {
    stub("claude", "");
    const claude = run("install-claude-plugin", ["hello-world"], "pwsh");
    expectStatus(claude, 0);
    assert.match(calledWith("claude"), /plugin marketplace add/);
    assert.match(calledWith("claude"), /plugin install hello-world@/);
    const market = path.join(home, ".claude", "local-marketplace");
    const manifests = [...collectFiles(market).keys()].filter((k) =>
      k.endsWith("marketplace.json"),
    );
    assert.equal(manifests.length, 1, `one marketplace manifest: ${manifests.join(", ")}`);
    assert.match(fs.readFileSync(path.join(market, manifests[0] ?? ""), "utf8"), /hello-world/);
  });
  attempt("install-antigravity-extension", () => {
    const dest = gemini("config", "plugins", "hello-world");
    const copyPlugin = WIN
      ? `xcopy "%~3" "${dest}\\" /E /I /Y /Q >nul`
      : `mkdir -p '${gemini("config", "plugins")}'; cp -R "$3" '${dest}'`;
    stub("agy", copyPlugin);
    const agy = run("install-antigravity-extension", ["hello-world"], "pwsh");
    expectStatus(agy, 0);
    const mcp = fs.readFileSync(path.join(dest, "mcp_config.json"), "utf8");
    assert.ok(!mcp.includes("${extensionRoot}"), "the token is rewritten");
  });
  attempt("install-copilot-plugin", () => {
    stub("copilot", "");
    expectStatus(run("install-copilot-plugin", ["hello-world"], "pwsh"), 0);
  });
  attempt("install-extension-all", () => {
    fs.rmSync(path.join(bin, WIN ? "copilot.cmd" : "copilot"), { force: true }); // absent CLI: skipped
    const all = run("install-extension-all", ["hello-world"], "pwsh");
    assert.match(all.out, /\[INSTALLED\]/, why(all, "expected INSTALLED"));
    assert.match(all.out, /\[SKIPPED\]/, why(all, "expected SKIPPED"));
    const usage = run("install-extension-all", [], "pwsh");
    assert.match(usage.out, /^Usage: install-extension-all\.sh/m, why(usage, "expected usage"));
  });
}

function manageStep(): void {
  for (const entry of ["claude", "copilot", "antigravity", "workspace"])
    attempt(`manage-${entry}-component without arguments`, () => {
      const res = run(`manage-${entry}-component`, [], "pwsh");
      expectStatus(res, 1);
      const usage = new RegExp(`Usage: manage-${entry}-component\\.sh`);
      assert.match(res.out + res.err, usage, why(res, "expected usage"));
    });
  attempt("install-workspace", () => {
    const res = run("install-workspace", [], "pwsh");
    expectStatus(res, 0);
    noCarriageReturn(home);
  });
}

/** Plan step 20: how many of the 5 attempts at 50 ms win against a held handle (recorded). */
function renameStep(): void {
  const dest = path.join(tree?.root ?? "", "held");
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(dest, "f.txt"), "old\n");
  const holder = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    cwd: dest,
    stdio: "ignore",
  });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  let attempts = 0;
  const fsImpl: SwapFs = {
    lstatSync: fs.lstatSync,
    mkdirSync: (p, o) => fs.mkdirSync(p, o),
    renameSync: (from, to) => (attempts++, fs.renameSync(from, to)),
    rmSync: (p, o) => fs.rmSync(p, o),
  };
  let outcome = "succeeded";
  try {
    renameRetry(dest, `${dest}.moved`, { fsImpl, platform: "win32" });
  } catch (error) {
    outcome = `failed (${(error as { code?: unknown }).code}) with the old entry intact`;
    assert.equal(fs.readFileSync(path.join(dest, "f.txt"), "utf8"), "old\n");
  }
  holder.kill();
  console.log(`windows-install-proof: rename with a held handle ${outcome} after ${attempts} of 5`);
}

function main(): void {
  console.log(`windows-install-proof: platform ${process.platform}, node ${process.version}`);
  try {
    interpreters = resolveInterpreters({
      platform: process.platform,
      env: process.env,
      isFile: defaultIsFile,
    });
    setup();
    console.log(`windows-install-proof: ${interpreters.notes.join("; ")}`);
    console.log(`windows-install-proof: sandbox PATH = ${sandboxPath(bin)}`);
    console.log(`windows-install-proof: sandbox root = ${tree?.root}`);
    const steps: Record<string, () => void> = {
      install: installStep,
      unlink: unlinkStep,
      link: linkStep,
      plugins: pluginsStep,
      manage: manageStep,
      "rename retry": renameStep,
    };
    for (const [label, step] of Object.entries(steps)) {
      current = label;
      const started = Date.now();
      attempt("(whole step)", step);
      console.log(`windows-install-proof: ${label}: ${Date.now() - started} ms`);
    }
    current = "coverage";
    attempt("entries exercised", () =>
      assert.equal(covered.size, 13, `entries exercised: ${[...covered].sort().join(", ")}`),
    );
  } catch (error) {
    failures.push(`setup: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    tree?.dispose();
  }
  if (failures.length === 0) return void console.log("windows-install-proof: OK");
  const list = failures.map((f, i) => `${i + 1}. ${f}`).join("\n");
  console.error(`windows-install-proof: FAILED: ${failures.length} failure(s)\n${list}`);
  process.exitCode = 1;
}

if (import.meta.main) main();
