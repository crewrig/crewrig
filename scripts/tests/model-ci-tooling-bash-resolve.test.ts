// model-ci-tooling-bash-resolve.test.ts — the pure Windows bash resolver of the ci-cache-guard and
// ci-changeset-coverage twins (spec 0262 req 4). `System32\bash.exe` is the WSL launcher, never a
// shell. Runs on every OS: the environment and the file system are injected.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { resolveBashWin } from "../lib/ci-cache-guard/shell.ts";

const SYS = "C:\\Windows\\System32\\bash.exe";
const GIT_BIN = "C:\\Program Files\\Git\\bin\\bash.exe";
const GIT_USR = "C:\\Program Files\\Git\\usr\\bin\\bash.exe";

function resolve(path: string[], files: string[], extra: Record<string, string> = {}) {
  const have = new Set(files.map((f) => f.toLowerCase()));
  const env = { Path: path.join(";"), SystemRoot: "C:\\Windows", ...extra };
  return resolveBashWin(env, (f) => have.has(f.toLowerCase()));
}

describe("resolveBashWin", () => {
  test("skips System32 bash.exe when Git Bash exists on PATH", () => {
    const got = resolve(["C:\\Windows\\System32", "C:\\Program Files\\Git\\bin"], [SYS, GIT_BIN]);
    assert.equal(got, GIT_BIN);
  });

  test("skips Sysnative and WindowsApps entries", () => {
    const apps = "C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe";
    const got = resolve(
      ["C:\\Windows\\Sysnative", "C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps"],
      ["C:\\Windows\\Sysnative\\bash.exe", apps],
    );
    assert.equal(got, null);
  });

  test("a System32-only PATH with no Git finds nothing", () => {
    assert.equal(resolve(["C:\\Windows\\System32"], [SYS]), null);
  });

  test("falls back to the Git for Windows locations, bin before usr\\bin", () => {
    const env = { ProgramFiles: "C:\\Program Files" };
    assert.equal(resolve(["C:\\Windows\\System32"], [SYS, GIT_USR, GIT_BIN], env), GIT_BIN);
    assert.equal(resolve(["C:\\Windows\\System32"], [SYS, GIT_USR], env), GIT_USR);
  });

  test("picks bash from the directory of git.exe found on PATH", () => {
    const got = resolve(
      ["D:\\tools\\Git\\cmd"],
      ["D:\\tools\\Git\\cmd\\git.exe", "D:\\tools\\Git\\bin\\bash.exe"],
    );
    assert.equal(got, "D:\\tools\\Git\\bin\\bash.exe");
  });

  test("order of preference: PATH, then well-known, then the git.exe directory", () => {
    const onPath = "E:\\msys\\usr\\bin\\bash.exe";
    const env = { ProgramFiles: "C:\\Program Files" };
    const files = [onPath, GIT_BIN, "D:\\Git\\cmd\\git.exe", "D:\\Git\\bin\\bash.exe"];
    const path = ["D:\\Git\\cmd", "E:\\msys\\usr\\bin"];
    assert.equal(resolve(path, files, env), onPath);
    assert.equal(resolve(["D:\\Git\\cmd"], files, env), GIT_BIN);
    assert.equal(
      resolve(
        ["D:\\Git\\cmd"],
        files.filter((f) => f !== GIT_BIN),
        env,
      ),
      "D:\\Git\\bin\\bash.exe",
    );
  });

  test("reads PATH and SystemRoot case-insensitively and strips quotes", () => {
    const got = resolveBashWin(
      { PATH: '"C:\\Program Files\\Git\\bin"', systemroot: "C:\\Windows" },
      (f) => f === GIT_BIN,
    );
    assert.equal(got, GIT_BIN);
  });
});
