// prune-transcripts-ts.test.ts — unit tests of the TypeScript port of prune-transcripts
// (spec 0253 R16-R18, delta-01 R25 items 5-9). Cross-platform, no shell: the run is driven
// through `runPrune` with injected effects and a throw-away home directory.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parsePruneArgs } from "./../lib/history-import/prune-args.ts";
import { cutoffDate } from "./../lib/history-import/prune-cutoff.ts";
import {
  interpreterExists,
  resolveInterpreter,
} from "./../lib/history-import/prune-interpreter.ts";

const CTX = { script: "scripts/prune-transcripts.ts", installSpec: "mempalace>=3.6.0,<3.7" };
const parse = (...argv: string[]) => parsePruneArgs(argv, CTX);

function errorOf(...argv: string[]): string[] {
  const r = parse(...argv);
  assert.equal(r.kind, "error");
  assert.ok(r.kind === "error");
  assert.equal(r.stream, "stderr");
  return r.lines;
}

describe("parsePruneArgs", () => {
  test("defaults to 30 days, dry run, no project", () => {
    assert.deepEqual(parse(), { kind: "run", days: 30, apply: false, project: "" });
  });
  test("reads --days, --apply and --project, the last value winning", () => {
    assert.deepEqual(parse("--days", "7", "--apply", "--project", "x", "--days", "9"), {
      kind: "run",
      days: 9,
      apply: true,
      project: "x",
    });
  });
  test("an empty --days takes the default, as ${DAYS:-30}", () => {
    assert.deepEqual(parse("--days", ""), { kind: "run", days: 30, apply: false, project: "" });
  });
  test("--help and -h print the usage with the entry name and the pinned install spec", () => {
    for (const flag of ["--help", "-h"]) {
      const r = parse(flag);
      assert.ok(r.kind === "help");
      assert.equal(
        r.lines[0],
        "Usage: scripts/prune-transcripts.ts [--days <days>] [--apply] [--project <name>]",
      );
      assert.ok(r.lines.includes("    pipx install 'mempalace>=3.6.0,<3.7'"));
      assert.ok(r.lines.some((l) => /^ {2}--days {5}/.test(l)));
    }
  });
  test("--help answers before a later error", () => {
    assert.equal(parse("--help", "--bogus").kind, "help");
  });
  test("a non-numeric or negative --days is not a positive integer", () => {
    for (const bad of ["x", "-3", "1.5", "1e3"]) {
      assert.deepEqual(errorOf("--days", bad), ["Error: --days must be a positive integer"]);
    }
  });
  test("--days 0 is below the minimum", () => {
    assert.deepEqual(errorOf("--days", "0"), ["Error: --days must be at least 1"]);
  });
  test("an unknown option is named, with the --help hint", () => {
    assert.deepEqual(errorOf("--bogus"), [
      "Unknown option: --bogus",
      "Run 'scripts/prune-transcripts.ts --help' for usage.",
    ]);
  });
  test("a flag with no value is an error (deviation 5)", () => {
    assert.deepEqual(errorOf("--days"), ["Error: --days requires a value"]);
    assert.deepEqual(errorOf("--project"), ["Error: --project requires a value"]);
    assert.deepEqual(errorOf("--apply", "--project"), ["Error: --project requires a value"]);
  });
});

describe("cutoffDate", () => {
  test("subtracts days within a month", () => {
    assert.equal(cutoffDate(30, new Date(2026, 9, 9, 15)), "2026-09-09");
  });
  test("crosses a month and a year boundary", () => {
    assert.equal(cutoffDate(7, new Date(2026, 2, 3)), "2026-02-24");
    assert.equal(cutoffDate(5, new Date(2026, 0, 2)), "2025-12-28");
  });
  test("honours the leap day", () => {
    assert.equal(cutoffDate(1, new Date(2024, 2, 1)), "2024-02-29");
    assert.equal(cutoffDate(1, new Date(2026, 2, 1)), "2026-02-28");
  });
  test("zero-pads month and day", () => {
    assert.equal(cutoffDate(1, new Date(2026, 0, 10)), "2026-01-09");
  });
});

/** A fake file system: the set of existing paths; every one is an executable file. */
function fakeIo(paths: readonly string[], pipxHome?: string) {
  const set = new Set(paths);
  return {
    exists: (p: string) => set.has(p),
    isExecutableFile: (p: string) => set.has(p),
    pipxHome: () => pipxHome,
  };
}

describe("resolveInterpreter", () => {
  test("MEMPALACE_PYTHON wins over everything", () => {
    const io = fakeIo(["/bin/pipx", "/h/venvs/mempalace"], "/h");
    assert.equal(
      resolveInterpreter({ MEMPALACE_PYTHON: "/x/py", PATH: "/bin" }, "linux", io),
      "/x/py",
    );
  });
  test("an empty MEMPALACE_PYTHON is unset", () => {
    assert.equal(
      resolveInterpreter({ MEMPALACE_PYTHON: "", PATH: "/bin" }, "linux", fakeIo([])),
      "python3",
    );
  });
  test("pipx on PATH and a mempalace venv give the venv python3", () => {
    const io = fakeIo(["/bin/pipx", "/h/venvs/mempalace"], "/h");
    assert.equal(
      resolveInterpreter({ PATH: "/u:/bin" }, "linux", io),
      "/h/venvs/mempalace/bin/python3",
    );
  });
  test("pipx without a mempalace venv, or no pipx, fall back to python3", () => {
    assert.equal(
      resolveInterpreter({ PATH: "/bin" }, "linux", fakeIo(["/bin/pipx"], "/h")),
      "python3",
    );
    assert.equal(
      resolveInterpreter({ PATH: "/bin" }, "linux", fakeIo(["/h/venvs/mempalace"], "/h")),
      "python3",
    );
    assert.equal(resolveInterpreter({ PATH: "/bin" }, "linux", fakeIo(["/bin/pipx"])), "python3");
  });
  test("Windows names: Scripts\\python.exe for the venv, python for the fallback", () => {
    const io = fakeIo(["C:\\bin\\pipx.EXE", "C:\\h\\venvs\\mempalace"], "C:\\h");
    const env = { Path: "C:\\x;C:\\bin", PATHEXT: ".EXE;.CMD" };
    assert.equal(
      resolveInterpreter(env, "win32", io),
      "C:\\h\\venvs\\mempalace\\Scripts\\python.exe",
    );
    assert.equal(resolveInterpreter({ Path: "C:\\bin" }, "win32", fakeIo([])), "python");
  });
});

describe("interpreterExists", () => {
  test("a path with a separator must be an executable file", () => {
    assert.equal(interpreterExists("/a/py", {}, "linux", fakeIo(["/a/py"])), true);
    assert.equal(interpreterExists("/a/py", {}, "linux", fakeIo([])), false);
  });
  test("a bare name is looked up on PATH", () => {
    assert.equal(
      interpreterExists("python3", { PATH: "/x:/bin" }, "linux", fakeIo(["/bin/python3"])),
      true,
    );
    assert.equal(
      interpreterExists("python3", { PATH: "/x" }, "linux", fakeIo(["/bin/python3"])),
      false,
    );
  });
  test("on Windows a bare name tries the PATHEXT extensions", () => {
    const io = fakeIo(["C:\\bin\\python.EXE"]);
    assert.equal(interpreterExists("python", { PATH: "C:\\bin" }, "win32", io), true);
  });
});
