// worktree-claim-launch.test.ts — how `run` starts the wrapped command (spec
// 0248 R22, plan decisions D1 and D2, verification duty 1).
//
// The Windows resolution takes `platform`, `env` and `isFile` as parameters, so
// every decision of it is proved here on any host: PATH-only search of a bare
// name (a planted `npm.cmd` or `git.exe` in the worktree is never run), PATHEXT
// order, `.exe` and `.com` started directly, `.cmd` and `.bat` only through
// `%ComSpec% /d /s /c` under an argument allowlist, and a refusal, never a
// shell, otherwise. The real launches (127, 126, 128+signal on POSIX; `npm.cmd`
// on Windows) are in worktree-claim-run.test.ts and worktree-claim-windows.test.ts.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  planWindowsLaunch,
  resolveCommand,
  resolveOnPath,
} from "../lib/worktree-claim/launch-windows.ts";
import { planLaunch } from "../lib/worktree-claim/launch.ts";

const TOP = "C:\\repo\\.worktrees\\736";

/** An `isFile` that knows exactly the paths in `files` (case-insensitively, as Windows does). */
function filesystem(files: readonly string[]): { isFile(p: string): boolean; asked: string[] } {
  const known = new Set(files.map((file) => file.toLowerCase()));
  const asked: string[] = [];
  return {
    asked,
    isFile: (candidate) => {
      asked.push(candidate);
      return known.has(candidate.toLowerCase());
    },
  };
}

const env = (extra: Record<string, string> = {}): Record<string, string> => ({
  PATH: "C:\\bin;C:\\tools",
  PATHEXT: ".com;.exe;.bat;.cmd",
  ComSpec: "C:\\Windows\\System32\\cmd.exe",
  ...extra,
});

function plan(argv: string[], files: string[], extra: Record<string, string> = {}) {
  const fs = filesystem(files);
  const result = planWindowsLaunch(argv, {
    platform: "win32",
    env: env(extra),
    toplevel: TOP,
    isFile: fs.isFile,
  });
  return { result, asked: fs.asked };
}

describe("a bare name is searched through PATH only (D2)", () => {
  test("a .cmd planted in the worktree is not found, a PATH one is", () => {
    const both = plan(["npm", "--version"], [`${TOP}\\npm.cmd`, "C:\\tools\\npm.cmd"]);
    assert.equal(both.result.kind, "spawn");
    assert.match(JSON.stringify(both.result), /C:\\\\tools\\\\npm\.cmd/i);
    assert.doesNotMatch(JSON.stringify(both.result), /\.worktrees/);
    const planted = plan(["npm"], [`${TOP}\\npm.cmd`]);
    assert.deepEqual(planted.result, { kind: "missing" });
  });

  test("a planted git.exe is not found either", () => {
    assert.deepEqual(plan(["git"], [`${TOP}\\git.exe`]).result, { kind: "missing" });
  });

  test("relative and empty PATH entries stand for the current directory and are skipped", () => {
    const run = plan(["tool"], [], { PATH: ";.;bin;C:\\good" });
    assert.deepEqual(run.result, { kind: "missing" });
    for (const asked of run.asked) {
      assert.match(asked, /^C:\\good\\/i, `only the absolute PATH entry is searched: ${asked}`);
    }
  });

  test("PATH and PATHEXT are read case-insensitively, as Windows does", () => {
    const fs = filesystem(["C:\\bin\\tool.exe"]);
    const found = resolveOnPath("tool", {
      platform: "win32",
      env: { Path: "C:\\bin", PathExt: ".EXE" },
      isFile: fs.isFile,
    });
    assert.equal(found?.toLowerCase(), "C:\\bin\\tool.exe".toLowerCase());
  });

  test("PATHEXT order decides between two matches in one directory", () => {
    const files = ["C:\\bin\\x.cmd", "C:\\bin\\x.exe"];
    const exeFirst = plan(["x"], files, { PATHEXT: ".exe;.cmd" });
    const cmdFirst = plan(["x"], files, { PATHEXT: ".cmd;.exe" });
    assert.match(JSON.stringify(exeFirst.result), /x\.exe/i);
    assert.match(JSON.stringify(cmdFirst.result), /x\.cmd/i);
  });

  test("a missing or empty PATHEXT falls back to the default extensions", () => {
    const found = resolveOnPath("tool", {
      platform: "win32",
      env: { PATH: "C:\\bin", PATHEXT: "" },
      isFile: filesystem(["C:\\bin\\tool.cmd"]).isFile,
    });
    assert.equal(found?.toLowerCase(), "c:\\bin\\tool.cmd");
  });

  test("a name that already carries an executable extension is tried as written", () => {
    assert.match(JSON.stringify(plan(["npm.cmd"], ["C:\\tools\\npm.cmd"]).result), /npm\.cmd/);
  });
});

describe("a name with a separator is a path, resolved against the toplevel", () => {
  test("relative to the toplevel, with either separator, extension optional", () => {
    for (const name of ["tools\\run", "tools/run"]) {
      const found = resolveCommand(name, {
        platform: "win32",
        env: env(),
        toplevel: TOP,
        isFile: filesystem([`${TOP}\\tools\\run.cmd`]).isFile,
      });
      assert.equal(found?.toLowerCase(), `${TOP}\\tools\\run.cmd`.toLowerCase(), name);
    }
  });

  test("an absolute path is used as it is", () => {
    const found = resolveCommand("D:\\x\\y.exe", {
      platform: "win32",
      env: env(),
      toplevel: TOP,
      isFile: filesystem(["D:\\x\\y.exe"]).isFile,
    });
    assert.equal(found, "D:\\x\\y.exe");
  });
});

describe("what is started (R22)", () => {
  test(".exe and .com are started directly with the arguments untouched, no shell", () => {
    const run = plan(["git", "log", "--format=%H & x"], ["C:\\bin\\git.exe"]);
    assert.deepEqual(run.result, {
      kind: "spawn",
      file: "C:\\bin\\git.exe",
      args: ["log", "--format=%H & x"],
      verbatim: false,
    });
    assert.equal(plan(["old"], ["C:\\bin\\old.com"]).result.kind, "spawn");
  });

  test(".cmd and .bat go through %ComSpec% /d /s /c with the quoted path, verbatim", () => {
    const cmd = plan(["npm", "--version", "run", "a.b-c"], ["C:\\tools\\npm.cmd"]);
    assert.deepEqual(cmd.result, {
      kind: "spawn",
      file: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", '""C:\\tools\\npm.cmd" --version run a.b-c"'],
      verbatim: true,
    });
    const bat = plan(["build"], ["C:\\tools\\build.bat"]);
    assert.equal(bat.result.kind, "spawn");
  });

  test("a path with a space or parentheses is quoted and accepted", () => {
    const run = plan(["x"], ["C:\\Program Files (x86)\\t\\x.cmd"], {
      PATH: "C:\\Program Files (x86)\\t",
    });
    assert.equal(run.result.kind, "spawn");
  });

  test("%ComSpec% unset or relative: System32\\cmd.exe under SystemRoot, never a bare name", () => {
    for (const extra of [{ ComSpec: "" }, { ComSpec: "cmd.exe" }, { ComSpec: ".\\cmd.exe" }]) {
      const run = plan(["npm"], ["C:\\tools\\npm.cmd"], { ...extra, SystemRoot: "D:\\Win" });
      assert.equal(
        run.result.kind === "spawn" ? run.result.file : "",
        "D:\\Win\\System32\\cmd.exe",
      );
    }
  });

  test("an argument cmd.exe would read as syntax refuses the command before anything runs", () => {
    for (const argument of [
      "a&b",
      "a|b",
      "a>b",
      "a<b",
      "a^b",
      "%PATH%",
      "!x!",
      'a"b',
      "a b",
      "(x)",
      "",
    ]) {
      const run = plan(["npm", argument], ["C:\\tools\\npm.cmd"]);
      assert.equal(run.result.kind, "refused", JSON.stringify(argument));
      if (run.result.kind === "refused") {
        assert.match(run.result.message, /npm/);
        assert.match(run.result.message, /no claim was taken/);
      }
    }
  });

  test("allowSpaces quotes a path argument holding spaces; absent, the argument is refused", () => {
    const argv = [
      "claude",
      "marketplace",
      "add",
      "C:\\Users\\John Doe\\.claude\\local-marketplace",
    ];
    const files = ["C:\\tools\\claude.cmd"];
    assert.equal(plan(argv, files).result.kind, "refused");
    const fs = filesystem(files);
    const run = planWindowsLaunch(argv, {
      platform: "win32",
      env: env(),
      toplevel: TOP,
      isFile: fs.isFile,
      allowSpaces: true,
    });
    assert.deepEqual(run, {
      kind: "spawn",
      file: "C:\\Windows\\System32\\cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        '""C:\\tools\\claude.cmd" marketplace add "C:\\Users\\John Doe\\.claude\\local-marketplace""',
      ],
      verbatim: true,
    });
  });

  test("allowSpaces still refuses cmd.exe syntax, quotes, newlines, empty and a trailing backslash", () => {
    for (const argument of [
      "C:\\a b&c",
      "C:\\a b|c",
      "C:\\a b<c",
      "C:\\a b>c",
      "C:\\a b^c",
      "C:\\a b%PATH%",
      "C:\\a b!x!",
      'C:\\a "b"',
      "C:\\a b\nc",
      "C:\\a b\\",
      "",
    ]) {
      const result = planWindowsLaunch(["npm", argument], {
        platform: "win32",
        env: env(),
        toplevel: TOP,
        isFile: filesystem(["C:\\tools\\npm.cmd"]).isFile,
        allowSpaces: true,
      });
      assert.equal(result.kind, "refused", JSON.stringify(argument));
    }
  });

  test("a .cmd whose own path holds a cmd.exe metacharacter is refused", () => {
    const run = plan(["x"], ["C:\\a&b\\x.cmd"], { PATH: "C:\\a&b" });
    assert.equal(run.result.kind, "refused");
  });

  test("a resolved file that is neither an executable nor a script is refused, never started", () => {
    const found = planWindowsLaunch(["tools\\x.vbs"], {
      platform: "win32",
      env: env(),
      toplevel: TOP,
      isFile: filesystem([`${TOP}\\tools\\x.vbs`]).isFile,
    });
    assert.equal(found.kind, "refused");
  });

  test("nothing matches: missing (exit 127 upstream)", () => {
    assert.deepEqual(plan(["nope"], []).result, { kind: "missing" });
  });
});

describe("off Windows the vector goes through unchanged (R22: execvp semantics)", () => {
  test("planLaunch hands the name and every argument to spawn, whatever the characters", () => {
    for (const platform of ["linux", "darwin"] as const) {
      const planned = planLaunch(["tool", "a&b", "$HOME", "x y", ""], {
        platform,
        env: {},
        toplevel: "/repo/.worktrees/736",
      });
      assert.deepEqual(planned, {
        kind: "spawn",
        file: "tool",
        args: ["a&b", "$HOME", "x y", ""],
        verbatim: false,
      });
    }
  });

  test("resolveOnPath returns the name unchanged: execvp searches PATH alone", () => {
    assert.equal(resolveOnPath("git", { platform: "linux", env: {}, isFile: () => false }), "git");
  });
});
