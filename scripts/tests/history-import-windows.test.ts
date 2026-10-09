// history-import-windows.test.ts — the cross-platform offline test of the history importers and
// of scripts/prune-transcripts.ts (spec 0253 R27, delta-01 R27; ticket #1331). It is the test
// run by the `windows-history-import` CI job under PowerShell on `windows-latest`, and it also
// passes on Linux and macOS.
//
// LIMIT: no bash, sh or POSIX tool is used, and only the paths that need neither a successful
// interpreter probe nor a real Python are covered. Node (>= 20.12) refuses to spawn a `.cmd` or
// `.bat` file without a shell, so a stub interpreter cannot work on Windows. The end-to-end
// `mempalace` path and the confirmed/declined prompt flows are covered on Linux and macOS only,
// by the PR A oracle.
//
// Every command is spawned as `process.execPath <entry>.ts` under an explicit, isolated
// environment. Timings are printed, never asserted (R24).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

const SCRIPTS = path.resolve(import.meta.dirname, "..");
const QUIET = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
const NOT_IMPORTABLE = "Error: 'mempalace' is not importable from any candidate Python.";
const INSTALL_FIRST = "Install MemPalace first: pipx install mempalace";

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly out: string[];
  readonly err: string[];
}

let work: string;
let home: string;
let emptyPath: string;

const lines = (text: string): string[] => text.split(/\r?\n/).filter((l) => l !== "");

/** The explicit child environment: temporary home, empty PATH directory, nothing inherited. */
function isolatedEnv(extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    APPDATA: path.join(home, "AppData", "Roaming"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    PATH: emptyPath,
    ...extra,
  };
  // Windows processes need these to start; they do not put an interpreter on the PATH.
  for (const name of ["SystemRoot", "windir", "TEMP", "TMP"]) {
    const value = process.env[name];
    if (value !== undefined && process.platform === "win32") env[name] = value;
  }
  return env;
}

function run(
  name: string,
  entry: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  quiet = true,
): Run {
  const argv = [...(quiet ? [QUIET] : []), path.join(SCRIPTS, entry), ...args];
  const start = performance.now();
  const r = spawnSync(process.execPath, argv, {
    env,
    encoding: "utf8",
    input: "",
    timeout: 60_000,
  });
  console.log(`timing: ${name} ${Math.round(performance.now() - start)} ms`);
  assert.equal(r.error, undefined, `${name}: spawn failed: ${String(r.error)}`);
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    out: lines(r.stdout),
    err: lines(r.stderr),
  };
}

before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "history-import-win-"));
  home = path.join(work, "home");
  emptyPath = path.join(work, "empty-path");
  fs.mkdirSync(home);
  fs.mkdirSync(emptyPath);
});

after(() => fs.rmSync(work, { recursive: true, force: true }));

describe("history importers with no interpreter on the PATH", () => {
  const importers: readonly (readonly [string, "out" | "err"])[] = [
    ["claude", "out"],
    ["gemini", "out"],
    ["copilot", "out"],
    ["antigravity", "err"],
  ];
  for (const [cli, stream] of importers) {
    test(`${cli} reports MemPalace missing on ${stream === "out" ? "stdout" : "stderr"}, exit 1, no prompt`, () => {
      const r = run(`import-${cli}`, `import-${cli}-history.ts`, [], isolatedEnv());
      assert.equal(r.status, 1);
      const errors = stream === "out" ? r.out : r.err;
      assert.deepEqual(errors.slice(-2), [NOT_IMPORTABLE, INSTALL_FIRST]);
      // the other stream carries no Error line, and no question was asked
      const other = stream === "out" ? r.err : r.out;
      assert.equal(
        other.some((l) => l.startsWith("Error:")),
        false,
      );
      assert.doesNotMatch(r.stdout + r.stderr, /\(yes\/no\)/);
    });
  }

  test("the importer prints no Node warning when run without the warning flag", () => {
    const r = run("import-claude-noflag", "import-claude-history.ts", [], isolatedEnv(), false);
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stderr, /Warning|MODULE_TYPELESS|ExperimentalWarning/);
  });
});

describe("prune-transcripts.ts arguments", () => {
  const prune = (name: string, args: string[], extra: Record<string, string> = {}): Run =>
    run(name, "prune-transcripts.ts", args, isolatedEnv(extra));

  for (const flag of ["--help", "-h"]) {
    test(`${flag} prints the usage and the pipx prerequisite, exit 0`, () => {
      const r = prune(`prune ${flag}`, [flag]);
      assert.equal(r.status, 0);
      assert.match(r.out[0] ?? "", /^Usage: .*scripts[\\/]prune-transcripts\.ts /);
      for (const option of ["--days", "--apply", "--project"]) {
        assert.ok(
          r.out.some((l) => l.trimStart().startsWith(option)),
          `${option} listed`,
        );
      }
      assert.ok(r.out.includes("Prerequisites:"));
      assert.ok(r.out.some((l) => /^\s+pipx install 'mempalace.*'$/.test(l)));
    });
  }

  test("--days 0 is refused", () => {
    const r = prune("prune days-0", ["--days", "0"]);
    assert.equal(r.status, 1);
    assert.deepEqual(r.err, ["Error: --days must be at least 1"]);
  });

  test("--days x is refused", () => {
    const r = prune("prune days-x", ["--days", "x"]);
    assert.equal(r.status, 1);
    assert.deepEqual(r.err, ["Error: --days must be a positive integer"]);
  });

  test("--days without a value is refused", () => {
    const r = prune("prune days-missing", ["--days"]);
    assert.equal(r.status, 1);
    assert.deepEqual(r.err, ["Error: --days requires a value"]);
  });

  test("an unknown option names the entry in the hint", () => {
    const r = prune("prune bogus", ["--bogus"]);
    assert.equal(r.status, 1);
    assert.equal(r.err[0], "Unknown option: --bogus");
    assert.match(r.err[1] ?? "", /^Run '.*prune-transcripts\.ts --help' for usage\.$/);
    assert.equal(r.err.length, 2);
  });

  test("a missing MEMPALACE_PYTHON is reported with the pipx install line", () => {
    const missing = path.join(
      work,
      "no-such-dir",
      process.platform === "win32" ? "python.exe" : "python3",
    );
    const r = prune("prune missing-interpreter", [], { MEMPALACE_PYTHON: missing });
    assert.equal(r.status, 1);
    assert.equal(r.err[0], `Error: ${missing} not found`);
    assert.match(r.err[1] ?? "", /^Install MemPalace via pipx: pipx install 'mempalace.*'$/);
    assert.equal(r.out.length, 0);
  });
});

describe("prune-transcripts.ts dry run", () => {
  test("prints the banner, then exits with the failing child's status", () => {
    // node itself plays the interpreter: it cannot run prune_drawers.py as JavaScript, so the
    // child exits non-zero after the banner was written
    const t0 = new Date();
    const r = run(
      "prune dry-run",
      "prune-transcripts.ts",
      [],
      isolatedEnv({ MEMPALACE_PYTHON: process.execPath }),
    );
    const t1 = new Date();
    assert.notEqual(r.status, 0);
    assert.notEqual(r.status, null);
    assert.ok(r.out.includes("  Transcript Prune"));
    assert.ok(r.out.includes("Wing:        transcripts"));
    assert.ok(r.out.includes("Dry run:     true"));
    const cutoff = r.out.find((l) => l.startsWith("Cutoff date: "));
    const date = /^Cutoff date: (\d{4}-\d{2}-\d{2}) \(older than 30 days\)$/.exec(cutoff ?? "");
    assert.ok(date, `Cutoff date line: ${String(cutoff)}`);
    const local = (d: Date): string => {
      const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 30);
      const p = (n: number): string => String(n).padStart(2, "0");
      return `${c.getFullYear()}-${p(c.getMonth() + 1)}-${p(c.getDate())}`;
    };
    assert.ok([local(t0), local(t1)].includes(date[1] as string), "cutoff is 30 days ago");
  });
});
