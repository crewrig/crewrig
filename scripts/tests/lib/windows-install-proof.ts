// windows-install-proof.ts — the cross-system proof of the install, manage and link entries (spec 0255
// R28, parent R17). Not a test suite: a script the `windows-install-entries` job runs under pwsh, and
// that also passes on POSIX (the entry then runs directly), so its assertions are the same on both.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/tests/lib/windows-install-proof.ts
// Every one of the thirteen entries runs against a sandbox HOME/USERPROFILE from a NON-POSIX
// interpreter (PowerShell; `cmd.exe` for the unlink and link entries). Stub CLIs are `.cmd` files on
// Windows. The elapsed time of each step is printed, never asserted. Exit 0, or a message and exit 1.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { createFixtureTree, REPO } from "./build-fixture-tree.ts";
import { collectFiles } from "./extension-run.ts";
import { renameRetry } from "../../lib/link-or-copy-swap.ts";
import type { SwapFs } from "../../lib/link-or-copy-swap.ts";

type Shell = "pwsh" | "cmd";
const WIN = process.platform === "win32";
const tree = createFixtureTree();
const home = path.join(tree.root, "home");
const bin = path.join(tree.root, "bin");
const calls = path.join(tree.root, "calls");
for (const dir of [home, bin, calls]) fs.mkdirSync(dir, { recursive: true });
fs.cpSync(
  path.join(REPO, "extensions", "core", "hello-world"),
  path.join(tree.root, "extensions", "core", "hello-world"),
  { recursive: true, filter: (e) => path.basename(e) !== "node_modules" },
);
const covered = new Set<string>();
const gemini = (...parts: string[]): string => path.join(home, ".gemini", ...parts);

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

/** Run `scripts/<entry>.ts` through `shell` (POSIX: directly), timing the step. */
function run(entry: string, args: string[], shell: Shell, env: Record<string, string> = {}) {
  covered.add(entry);
  const script = path.join(tree.root, "scripts", `${entry}.ts`);
  const full: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, ...env };
  // Hermetic PATH (no real claude, copilot or agy): the stubs, the system directory, node on Windows.
  const sys = WIN
    ? [path.dirname(process.execPath), path.join(process.env["SystemRoot"] ?? "", "System32")]
    : ["/usr/bin", "/bin"];
  full["PATH"] = [bin, ...sys].join(path.delimiter);
  for (const key of ["REPO_DIR", "CLAUDE_CONFIG_DIR"]) delete full[key];
  const started = process.hrtime.bigint();
  const argv = [process.execPath, script, ...args];
  const o = { encoding: "utf8", env: full } as const;
  const ps = `& ${argv.map((a) => `'${a.replaceAll("'", "''")}'`).join(" ")}; exit $LASTEXITCODE`;
  const cmd = `"${argv.map((a) => `"${a}"`).join(" ")}"`;
  const res = !WIN
    ? spawnSync(process.execPath, argv.slice(1), o)
    : shell === "cmd"
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", cmd], { ...o, windowsVerbatimArguments: true })
      : spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", ps], o);
  const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
  console.log(`windows-install-proof: ${entry} ${args.join(" ")} [${shell}]: ${ms} ms`);
  return { status: res.status, out: res.stdout ?? "", err: res.stderr ?? "" };
}

function noCarriageReturn(dir: string): void {
  for (const [rel, bytes] of collectFiles(dir))
    assert.ok(!bytes.includes(13), `${path.join(dir, rel)} holds a carriage return`);
}

function installStep(): void {
  const res = run("install-extension", ["install", "hello-world"], "pwsh");
  assert.equal(res.status, 0, `${res.out}\n${res.err}`);
  assert.match(res.out, /Copied: hello-world/);
  assert.ok(collectFiles(gemini("extensions", "hello-world")).size > 0, "files were placed");
  noCarriageReturn(gemini("extensions", "hello-world"));
}

function unlinkStep(): void {
  const removed = run("unlink-extensions", [], "cmd");
  assert.equal(removed.status, 0, removed.err);
  assert.match(removed.out, /^ {2}Removed: hello-world$/m);
  assert.ok(!fs.existsSync(gemini("extensions", "hello-world")), "the copy is gone");
  fs.mkdirSync(gemini("commands", "x"), { recursive: true });
  fs.writeFileSync(gemini("commands", "x", "f.txt"), "keep\n");
  const copy = run("unlink-component", ["command", "x"], "cmd");
  assert.equal(copy.out, "Removed: commands/x\n");
  assert.equal(run("unlink-component", ["commands", "x"], "cmd").out, "Not found: commands/x\n");
  let linked = false;
  try {
    fs.mkdirSync(gemini("commands", "target"), { recursive: true });
    fs.symlinkSync(gemini("commands", "target"), gemini("commands", "lnk"), "junction");
    linked = true;
  } catch (error) {
    console.log(`windows-install-proof: runner cannot link: ${(error as { code?: unknown }).code}`);
  }
  if (!linked) return;
  assert.equal(run("unlink-component", ["commands", "lnk"], "cmd").out, "Removed: commands/lnk\n");
  assert.ok(fs.existsSync(gemini("commands", "target")), "the link target is left alone");
}

function linkStep(): void {
  for (let pass = 1; pass <= 2; pass++) {
    const res = run("link-extensions", [], "pwsh");
    assert.equal(res.status, 0, `pass ${pass}: ${res.out}\n${res.err}`);
    const dest = gemini("extensions", "hello-world");
    const isLink = fs.lstatSync(dest).isSymbolicLink();
    console.log(
      `windows-install-proof: link pass ${pass}: link = ${isLink} ${isLink ? "" : res.err.split("\n")[0]}`,
    );
    if (isLink) assert.match(res.out, /Linked: hello-world/);
    else assert.match(res.err, /Symbolic links were refused \((\w+)/); // the observed code is printed
  }
  run("unlink-extensions", [], "cmd");
  const forced = run("link-extensions", [], "cmd", { CREWRIG_TEST_LINK_REFUSAL: "EPERM" });
  assert.equal(forced.status, 0, forced.err);
  assert.match(forced.out, /Copied: hello-world/);
  for (const name of fs.readdirSync(path.join(tree.root, "extensions", "core")))
    assert.ok(forced.err.includes(gemini("extensions", name)), `the notice names ${name}`);
  assert.ok(!fs.lstatSync(gemini("extensions", "hello-world")).isSymbolicLink());
  run("unlink-extensions", [], "cmd");
}

function pluginsStep(): void {
  stub("claude", "");
  const claude = run("install-claude-plugin", ["hello-world"], "pwsh");
  assert.equal(claude.status, 0, `${claude.out}\n${claude.err}`);
  assert.match(calledWith("claude"), /plugin marketplace add/);
  assert.match(calledWith("claude"), /plugin install hello-world@/);
  const market = path.join(home, ".claude", "local-marketplace");
  const manifests = [...collectFiles(market).keys()].filter((k) => k.endsWith("marketplace.json"));
  assert.equal(manifests.length, 1, `one marketplace manifest: ${manifests.join(", ")}`);
  assert.match(fs.readFileSync(path.join(market, manifests[0] ?? ""), "utf8"), /hello-world/);
  const copyPlugin = WIN
    ? `xcopy "%~3" "${gemini("config", "plugins", "hello-world")}\\" /E /I /Y /Q >nul`
    : `mkdir -p '${gemini("config", "plugins")}'; cp -R "$3" '${gemini("config", "plugins", "hello-world")}'`;
  stub("agy", copyPlugin);
  const agy = run("install-antigravity-extension", ["hello-world"], "pwsh");
  assert.equal(agy.status, 0, `${agy.out}\n${agy.err}`);
  const mcp = path.join(gemini("config", "plugins", "hello-world"), "mcp_config.json");
  assert.ok(!fs.readFileSync(mcp, "utf8").includes("${extensionRoot}"), "the token is rewritten");
  stub("copilot", "");
  const copilot = run("install-copilot-plugin", ["hello-world"], "pwsh");
  assert.equal(copilot.status, 0, copilot.err);
  fs.rmSync(path.join(bin, WIN ? "copilot.cmd" : "copilot")); // the umbrella skips an absent CLI
  const all = run("install-extension-all", ["hello-world"], "pwsh");
  assert.match(all.out, /\[INSTALLED\]/);
  assert.match(all.out, /\[SKIPPED\]/);
  assert.match(run("install-extension-all", [], "pwsh").out, /^Usage: install-extension-all\.sh/m);
}

function manageStep(): void {
  for (const entry of ["claude", "copilot", "antigravity", "workspace"]) {
    const res = run(`manage-${entry}-component`, [], "pwsh");
    assert.equal(res.status, 1, `manage-${entry}-component: ${res.err}`);
    assert.match(res.out + res.err, new RegExp(`Usage: manage-${entry}-component\\.sh`));
  }
  const res = run("install-workspace", [], "pwsh");
  assert.equal(res.status, 0, `${res.out}\n${res.err}`);
  noCarriageReturn(home);
}

/** Plan step 20: how many of the 5 attempts at 50 ms win against a held handle (recorded). */
function renameStep(): void {
  const dest = path.join(tree.root, "held");
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

try {
  for (const [label, step] of Object.entries({
    install: installStep,
    unlink: unlinkStep,
    link: linkStep,
    plugins: pluginsStep,
    manage: manageStep,
    "rename retry": renameStep,
  })) {
    const started = Date.now();
    step();
    console.log(`windows-install-proof: ${label}: ${Date.now() - started} ms`);
  }
  assert.equal(covered.size, 13, `entries exercised: ${[...covered].sort().join(", ")}`);
  console.log("windows-install-proof: OK");
} catch (error) {
  console.error(
    `windows-install-proof: FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  tree.dispose();
}
