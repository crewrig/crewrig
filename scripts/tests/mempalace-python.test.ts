// mempalace-python.test.ts — hermetic tests of scripts/lib/mempalace-python.ts
// (spec 0252 requirement 4): pipx home resolution order, candidate order,
// resolveSymlink, detection, and the Windows candidate list (the console-script
// shebang forms are in mempalace-python-shebang.test.ts). Every fixture lives in
// a throwaway temp dir.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  detectMempalacePython,
  mempalacePythonCandidates,
  resolveSymlink,
} from "../lib/mempalace-python.ts";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mempalace-python-")));
  temps.push(dir);
  return dir;
}

function writeFile(file: string, text: string, mode = 0o644): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode });
  fs.chmodSync(file, mode);
  return file;
}

/** An env with an empty PATH dir, so no real `mempalace` is ever found. */
function hermeticEnv(extra: Record<string, string> = {}): {
  env: NodeJS.ProcessEnv;
  home: string;
  bin: string;
} {
  const home = tempDir();
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin);
  return { env: { HOME: home, PATH: bin, ...extra }, home, bin };
}

const POSIX = { platform: "linux" } as const;

describe("pipx home resolution order", () => {
  test("a non-empty PIPX_HOME wins over everything", () => {
    const { env, home } = hermeticEnv({ PIPX_HOME: "/custom/pipx" });
    fs.mkdirSync(path.join(home, ".local", "pipx"), { recursive: true });
    assert.equal(
      mempalacePythonCandidates(env, POSIX)[0],
      "/custom/pipx/venvs/mempalace/bin/python",
    );
  });

  test("an empty PIPX_HOME is ignored", () => {
    const { env, home } = hermeticEnv({ PIPX_HOME: "" });
    assert.equal(
      mempalacePythonCandidates(env, POSIX)[0],
      `${home}/.local/share/pipx/venvs/mempalace/bin/python`,
    );
  });

  test("the legacy ~/.local/pipx wins over the platform default when it exists", () => {
    for (const platform of ["linux", "darwin"] as const) {
      const { env, home } = hermeticEnv();
      fs.mkdirSync(path.join(home, ".local", "pipx"), { recursive: true });
      assert.equal(
        mempalacePythonCandidates(env, { platform })[0],
        `${home}/.local/pipx/venvs/mempalace/bin/python`,
      );
    }
  });

  test("macOS default is ~/Library/Application Support/pipx, spaces kept", () => {
    const { env, home } = hermeticEnv();
    assert.equal(
      mempalacePythonCandidates(env, { platform: "darwin" })[0],
      `${home}/Library/Application Support/pipx/venvs/mempalace/bin/python`,
    );
  });

  test("elsewhere the default honours XDG_DATA_HOME, then ~/.local/share", () => {
    const withXdg = hermeticEnv({ XDG_DATA_HOME: "/xdg/data" });
    assert.equal(
      mempalacePythonCandidates(withXdg.env, POSIX)[0],
      "/xdg/data/pipx/venvs/mempalace/bin/python",
    );
    const without = hermeticEnv();
    assert.equal(
      mempalacePythonCandidates(without.env, POSIX)[0],
      `${without.home}/.local/share/pipx/venvs/mempalace/bin/python`,
    );
  });
});

describe("candidate order", () => {
  test("venv, then python3, with no console script on PATH", () => {
    const { env, home } = hermeticEnv();
    assert.deepEqual(mempalacePythonCandidates(env, POSIX), [
      `${home}/.local/share/pipx/venvs/mempalace/bin/python`,
      "python3",
    ]);
  });

  test("the console-script interpreter sits between the venv and python3", () => {
    const { env, home, bin } = hermeticEnv();
    writeFile(path.join(bin, "mempalace"), "#!/opt/venv/bin/python\n", 0o755);
    assert.deepEqual(mempalacePythonCandidates(env, POSIX), [
      `${home}/.local/share/pipx/venvs/mempalace/bin/python`,
      "/opt/venv/bin/python",
      "python3",
    ]);
  });

  test("duplicates are dropped, first occurrence kept", () => {
    const { env, home, bin } = hermeticEnv();
    const venv = `${home}/.local/share/pipx/venvs/mempalace/bin/python`;
    writeFile(path.join(bin, "mempalace"), `#!${venv}\n`, 0o755);
    assert.deepEqual(mempalacePythonCandidates(env, POSIX), [venv, "python3"]);
    writeFile(path.join(bin, "mempalace"), "#!/usr/bin/env python3\n", 0o755);
    assert.deepEqual(mempalacePythonCandidates(env, POSIX), [venv, "python3"]);
  });

  test("a mempalace script that names only a shell contributes nothing", () => {
    const { env, home, bin } = hermeticEnv();
    writeFile(path.join(bin, "mempalace"), "#!/bin/sh\necho hi\n", 0o755);
    assert.deepEqual(mempalacePythonCandidates(env, POSIX), [
      `${home}/.local/share/pipx/venvs/mempalace/bin/python`,
      "python3",
    ]);
  });
});

describe("resolveSymlink", () => {
  test("a regular path is returned with its directory normalised", () => {
    const dir = tempDir();
    writeFile(path.join(dir, "f"), "x");
    assert.equal(resolveSymlink(`${dir}/./f`), path.join(dir, "f"));
  });

  test("relative and absolute hops are followed", () => {
    const dir = tempDir();
    writeFile(path.join(dir, "real", "f"), "x");
    fs.symlinkSync("real/f", path.join(dir, "rel"));
    fs.symlinkSync(path.join(dir, "real", "f"), path.join(dir, "abs"));
    fs.symlinkSync("rel", path.join(dir, "chain"));
    assert.equal(resolveSymlink(path.join(dir, "rel")), path.join(dir, "real", "f"));
    assert.equal(resolveSymlink(path.join(dir, "abs")), path.join(dir, "real", "f"));
    assert.equal(resolveSymlink(path.join(dir, "chain")), path.join(dir, "real", "f"));
  });

  test("a symlinked directory component is normalised", () => {
    const dir = tempDir();
    writeFile(path.join(dir, "real", "f"), "x");
    fs.symlinkSync("real", path.join(dir, "dirlink"));
    assert.equal(resolveSymlink(path.join(dir, "dirlink", "f")), path.join(dir, "real", "f"));
  });

  test("the hop cap is 32: a longer chain stops at the 33rd link", () => {
    const dir = tempDir();
    writeFile(path.join(dir, "end"), "x");
    for (let i = 0; i < 40; i++) {
      fs.symlinkSync(i === 39 ? "end" : `l${i + 1}`, path.join(dir, `l${i}`));
    }
    assert.equal(resolveSymlink(path.join(dir, "l0")), path.join(dir, "l32"));
    // a 32-hop chain resolves fully
    assert.equal(resolveSymlink(path.join(dir, "l8")), path.join(dir, "end"));
  });

  test("a loop terminates", () => {
    const dir = tempDir();
    fs.symlinkSync("b", path.join(dir, "a"));
    fs.symlinkSync("a", path.join(dir, "b"));
    assert.match(resolveSymlink(path.join(dir, "a")), /[/\\][ab]$/);
  });

  test("an unresolvable directory leaves the path as given", () => {
    assert.equal(resolveSymlink("/no/such/dir/file"), "/no/such/dir/file");
  });
});

describe("detectMempalacePython", () => {
  const posixOnly = { skip: process.platform === "win32" };

  /** The venv candidate on the running platform (its pipx default differs). */
  const venv = (env: NodeJS.ProcessEnv): string => mempalacePythonCandidates(env)[0] ?? "";

  /** A fake interpreter: a shell script exiting `code` for any arguments. */
  function fake(file: string, code: number): void {
    writeFile(file, `#!/bin/sh\nexit ${code}\n`, 0o755);
  }

  test("returns the first candidate whose import succeeds", posixOnly, () => {
    const { env, bin } = hermeticEnv();
    fake(venv(env), 0);
    fake(path.join(bin, "python3"), 0);
    assert.equal(detectMempalacePython(env), venv(env));
  });

  test("skips a candidate whose import fails, then a missing one", posixOnly, () => {
    const { env, bin } = hermeticEnv();
    fake(venv(env), 1);
    fake(path.join(bin, "python3"), 0);
    assert.equal(detectMempalacePython(env), "python3");
  });

  test("returns undefined when nothing imports", posixOnly, () => {
    const { env, bin } = hermeticEnv();
    fake(path.join(bin, "python3"), 1);
    assert.equal(detectMempalacePython(env), undefined);
  });

  test("returns undefined when no candidate exists at all", posixOnly, () => {
    const { env } = hermeticEnv();
    assert.equal(detectMempalacePython(env), undefined);
  });
});

describe("Windows candidate list", () => {
  const win = { platform: "win32" } as const;

  test("venv Scripts python, then python and py -3, never python3", () => {
    const { env } = hermeticEnv({
      PIPX_HOME: "C:\\Users\\me\\pipx",
    });
    assert.deepEqual(mempalacePythonCandidates(env, win), [
      "C:\\Users\\me\\pipx\\venvs\\mempalace\\Scripts\\python.exe",
      "python",
      "py -3",
    ]);
  });

  test("pipx home follows pipx's Windows resolution: PIPX_HOME, legacy, LOCALAPPDATA", () => {
    const local = hermeticEnv({ LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" });
    assert.equal(
      mempalacePythonCandidates(local.env, win)[0],
      "C:\\Users\\me\\AppData\\Local\\pipx\\pipx\\venvs\\mempalace\\Scripts\\python.exe",
    );
    const legacy = hermeticEnv({ LOCALAPPDATA: "C:\\L" });
    fs.mkdirSync(path.join(legacy.home, ".local", "pipx"), { recursive: true });
    assert.match(
      mempalacePythonCandidates(legacy.env, win)[0] ?? "",
      /\.local\\pipx\\venvs\\mempalace\\Scripts\\python\.exe$/,
    );
    const noLocal = hermeticEnv();
    assert.match(
      mempalacePythonCandidates(noLocal.env, win)[0] ?? "",
      /AppData\\Local\\pipx\\pipx\\venvs\\mempalace\\Scripts\\python\.exe$/,
    );
  });

  test("a console script's interpreter is listed between the venv and the launchers", () => {
    const { env, bin } = hermeticEnv({ PIPX_HOME: "C:\\p", PATH: "" });
    writeFile(path.join(bin, "mempalace"), "#!/opt/venv/bin/python\n", 0o755);
    env.PATH = bin;
    assert.deepEqual(mempalacePythonCandidates(env, win), [
      "C:\\p\\venvs\\mempalace\\Scripts\\python.exe",
      "/opt/venv/bin/python",
      "python",
      "py -3",
    ]);
  });
});
