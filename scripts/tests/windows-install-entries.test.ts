// windows-install-entries.test.ts — runs the cross-system proof of the install, manage and link entries
// (spec 0255 R28) on Windows only; elsewhere it is skipped, as the proof's POSIX leg is the Linux
// black-box suites' job. The `windows-install-entries` job runs the proof as its own step too.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

import { resolveInterpreters } from "./lib/windows-proof-support.ts";

const PROOF = path.resolve(import.meta.dirname, "lib", "windows-install-proof.ts");

describe("windows install entries proof", { skip: process.platform !== "win32" }, () => {
  it("passes under PowerShell and cmd.exe", () => {
    const res = spawnSync(
      process.execPath,
      ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", PROOF],
      { encoding: "utf8" },
    );
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /windows-install-proof: OK/);
  });
});

describe("windows interpreter resolution (simulated win32 data)", () => {
  const PWSH7 = "C:\\Program Files\\PowerShell\\7\\pwsh.EXE";
  const LEGACY = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  const COMSPEC = "D:\\Win\\System32\\cmd.exe";
  const resolve = (env: NodeJS.ProcessEnv, files: string[], platform: NodeJS.Platform = "win32") =>
    resolveInterpreters({ platform, env, isFile: (f) => files.includes(f) });
  const base = {
    Path: "C:\\Windows\\System32;C:\\Program Files\\PowerShell\\7",
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    SystemRoot: "C:\\Windows",
  };

  it("finds pwsh through the parent PATH and PATHEXT, whatever the case of the key", () => {
    const res = resolve(base, [PWSH7]);
    assert.equal(res.pwsh, PWSH7);
    assert.match(res.notes.join("\n"), /parent PATH/);
  });

  it("falls back to Windows PowerShell under System32 when pwsh is absent", () => {
    const res = resolve(base, [LEGACY]);
    assert.equal(res.pwsh, LEGACY);
    assert.match(res.notes.join("\n"), /System32 fallback/);
  });

  it("fails loudly when no PowerShell exists", () => {
    assert.throws(() => resolve(base, []), /no PowerShell/);
  });

  it("ignores relative PATH entries, which stand for the current directory", () => {
    const env = { ...base, Path: ".;bin;C:\\Windows\\System32" };
    assert.equal(resolve(env, ["bin\\pwsh.EXE", LEGACY]).pwsh, LEGACY);
  });

  it("takes cmd.exe from ComSpec when it is an existing absolute file", () => {
    assert.equal(resolve({ ...base, ComSpec: COMSPEC }, [PWSH7, COMSPEC]).cmd, COMSPEC);
  });

  it("falls back to System32 cmd.exe for a missing, relative or absent ComSpec", () => {
    const system = "C:\\Windows\\System32\\cmd.exe";
    assert.equal(resolve({ ...base, ComSpec: COMSPEC }, [PWSH7]).cmd, system);
    assert.equal(resolve({ ...base, ComSpec: "cmd.exe" }, [PWSH7, "cmd.exe"]).cmd, system);
    assert.equal(resolve(base, [PWSH7]).cmd, system);
    const moved = { ...base, SystemRoot: undefined, windir: "E:\\W" };
    assert.equal(resolve(moved, [PWSH7]).cmd, "E:\\W\\System32\\cmd.exe");
  });

  it("returns bare names off Windows", () => {
    assert.equal(resolve({}, [], "linux").pwsh, "pwsh");
  });
});
