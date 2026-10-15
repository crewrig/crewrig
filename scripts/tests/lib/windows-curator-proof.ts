// windows-curator-proof.ts — the fixture and the runner of the Windows proof of the three
// harness-curator entries (spec 0258 requirements 15, 27, 34; PLAN v2 steps 20-21). Importable on
// any host: on Windows an entry runs through PowerShell or `cmd.exe` (resolved from the PARENT
// environment before the child's PATH is narrowed), on POSIX directly with the same assertions.
//
// The child PATH is built from scratch, never from the parent's: a tripwire `bash` first (it stands
// in for `System32\bash.exe`, which cannot be removed, and the proof asserts it was never called), a
// directory holding only the stub `gh` when the case wants one (a `gh.cmd` calling node on Windows:
// the entries launch a `.cmd` shim through cmd.exe, CVE-2024-27980), a directory holding only the
// runner's plain python when the case wants one, node, and the system directory. The real `gh` of a
// runner is therefore never reachable.

import { spawnSync } from "node:child_process";
import type { SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { assertNoBash, baseEnv, lines, writeBins } from "./windows-packaging-driver.ts";
import type { Bins } from "./windows-packaging-driver.ts";
import { SCRIPTS_DIR } from "./harness-curator-observe.ts";
import { setEnv, WIN } from "./windows-proof-support.ts";
import type { Interpreters, Run, Shell } from "./windows-proof-support.ts";

const win = path.win32;
const FIXTURES = path.resolve(import.meta.dirname, "..", "fixtures", "harness-curator");

/** A committed golden file of the differential, CRLF folded (a Windows checkout may rewrite it). */
export const golden = (name: string, file: "stdout" | "stderr"): string =>
  lines(fs.readFileSync(path.join(FIXTURES, name, `${file}.golden`), "utf8"));

/** The sample frictions the Linux differential feeds to `curate.py --from-stdin`, byte for byte. */
export const sampleFrictions = (): Buffer =>
  fs.readFileSync(path.join(SCRIPTS_DIR, "..", "assets", "sample-frictions.json"));

export const entryPath = (name: string): string => path.join(SCRIPTS_DIR, `${name}.ts`);

// A CommonJS stub: logs its argv, `auth status` exits GH_AUTH_EXIT (0), the label named by
// GH_FAIL_LABEL fails.
const GH_STUB = `const fs = require("fs");
const a = process.argv.slice(2);
if (process.env.GH_LOG) fs.appendFileSync(process.env.GH_LOG, JSON.stringify(a) + "\\n");
if (a[0] === "auth") process.exit(Number(process.env.GH_AUTH_EXIT || 0));
if (a[0] === "label" && a[1] === "create" && a[2] === process.env.GH_FAIL_LABEL) process.exit(1);
process.exit(0);
`;

/** The runner's plain python: first `python3`/`python` of the PARENT PATH that answers `--version`. */
export function findPython(): string | undefined {
  const names = WIN ? ["python3.exe", "python.exe"] : ["python3"];
  for (const dir of (process.env["PATH"] ?? "").split(path.delimiter)) {
    if (dir === "" || /WindowsApps/i.test(dir)) continue; // the Store alias is not a python
    for (const name of names) {
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) continue;
      const probe = spawnSync(file, ["--version"], { stdio: "ignore", timeout: 20_000 });
      if (probe.status === 0) return file;
    }
  }
  return undefined;
}

export interface Fixture {
  readonly root: string;
  readonly home: string;
  readonly work: string;
  readonly tmp: string;
  readonly tripwire: Bins;
  readonly ghDir: string;
  /** The directory the child PATH adds for python, or `undefined` when the runner has none. */
  readonly pythonDir: string | undefined;
  readonly interpreters: Interpreters;
  runs: number;
}

/** A sandbox under `root`: home, work, tmp, the tripwire, the stub gh, the python directory. */
export function makeFixture(root: string, interpreters: Interpreters): Fixture {
  const dir = (name: string): string => {
    const full = path.join(root, name);
    fs.mkdirSync(full, { recursive: true });
    return full;
  };
  const [home, work, tmp, ghDir] = ["home", "work", "tmp", "gh"].map(dir) as [
    string,
    string,
    string,
    string,
  ];
  const stub = path.join(ghDir, "gh-stub.cjs");
  fs.writeFileSync(stub, GH_STUB);
  if (WIN)
    fs.writeFileSync(
      path.join(ghDir, "gh.cmd"),
      `@echo off\r\n"${process.execPath}" "${stub}" %*\r\nexit /b %ERRORLEVEL%\r\n`,
    );
  else
    fs.writeFileSync(
      path.join(ghDir, "gh"),
      `#!/bin/sh\nexec '${process.execPath}' '${stub}' "$@"\n`,
      {
        mode: 0o755,
      },
    );
  const python = findPython();
  let pythonDir: string | undefined;
  if (python !== undefined && WIN) pythonDir = path.dirname(python);
  else if (python !== undefined) {
    pythonDir = dir("python");
    fs.symlinkSync(python, path.join(pythonDir, "python3"));
  }
  return {
    root,
    home,
    work,
    tmp,
    tripwire: writeBins(dir("tripwire"), false),
    ghDir,
    pythonDir,
    interpreters,
    runs: 0,
  };
}

export const noBashCalled = (fx: Fixture): void => assertNoBash(fx.tripwire);

export interface Invocation {
  readonly fx: Fixture;
  /** `curate`, `setup-labels` or `schedule-curator`. */
  readonly entry: string;
  readonly args: readonly string[];
  readonly shell: Shell;
  readonly gh?: boolean;
  readonly python?: boolean;
  readonly input?: Buffer;
  readonly env?: Readonly<Record<string, string>>;
}

export interface CuratorRun extends Run {
  /** The argv of every call the stub gh received during this run. */
  readonly ghCalls: string[][];
}

const head = (text: string): string => (text.length > 2000 ? `${text.slice(0, 2000)}...` : text);

/** The hermetic PATH of a child; see the header. */
function childPath(o: Invocation): string {
  const { fx } = o;
  const dirs = [fx.tripwire.dir];
  if (o.gh === true) dirs.push(fx.ghDir);
  if (o.python === true && fx.pythonDir !== undefined) dirs.push(fx.pythonDir);
  if (WIN) {
    const root = process.env["SystemRoot"] ?? process.env["windir"] ?? "C:\\Windows";
    dirs.push(path.dirname(process.execPath), win.join(root, "System32"));
  }
  return dirs.join(path.delimiter);
}

/** Run an entry (POSIX: node directly; Windows: through the absolute interpreter) and record it. */
export function runCurator(o: Invocation): CuratorRun {
  const { fx } = o;
  const ghLog = path.join(fx.root, `gh-${fx.runs++}.log`);
  const extra = { GH_LOG: ghLog, ...o.env };
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv(childPath(o), fx.home, fx.tmp, extra)))
    setEnv(env, key, value);
  const script = entryPath(o.entry);
  const argv = [process.execPath, script, ...o.args];
  const quoted = argv.map((a) => `'${a.replaceAll("'", "''")}'`).join(" ");
  // The console encoding is set to UTF-8 without a BOM: the output of a native command is decoded
  // and re-encoded by PowerShell, which would turn the emoji of a title into mojibake.
  const ps = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & ${quoted}; exit $LASTEXITCODE`;
  const cmd = `"${argv.map((a) => `"${a}"`).join(" ")}"`;
  const base = {
    encoding: "utf8",
    env,
    cwd: fx.work,
    windowsHide: true,
    timeout: 120_000,
    ...(o.input === undefined ? {} : { input: o.input }),
  } as const;
  const spawned: [string, string[], SpawnSyncOptionsWithStringEncoding] = !WIN
    ? [process.execPath, argv.slice(1), base]
    : o.shell === "cmd"
      ? [fx.interpreters.cmd, ["/d", "/s", "/c", cmd], { ...base, windowsVerbatimArguments: true }]
      : [fx.interpreters.pwsh, ["-NoProfile", "-NonInteractive", "-Command", ps], base];
  const started = process.hrtime.bigint();
  const res = spawnSync(spawned[0], spawned[1], spawned[2]);
  const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
  const out = lines(res.stdout ?? "");
  const err = lines(res.stderr ?? "");
  const label = `${o.entry}.ts ${o.args.join(" ")}`.trim();
  const detail = [
    `  command: ${JSON.stringify([spawned[0], ...spawned[1]])}`,
    `  spawn error: ${res.error?.message ?? "none"}`,
    `  status: ${res.status}, signal: ${res.signal}`,
    `  stdout: ${JSON.stringify(head(out))}`,
    `  stderr: ${JSON.stringify(head(err))}`,
  ].join("\n");
  const ghCalls = fs.existsSync(ghLog)
    ? fs
        .readFileSync(ghLog, "utf8")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l) as string[])
    : [];
  return { entry: label, status: res.status, out, err, ms, detail, ghCalls };
}

/**
 * No file the entries could have written under the sandbox holds a carriage return. `AppData` is
 * skipped: PowerShell itself writes there (`StartupProfileData-NonInteractive`, with CRLF) whatever
 * the entries do, so it is not a landing zone of an entry.
 */
export function assertNoCarriageReturn(fx: Fixture): void {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      if (name.toLowerCase() === "appdata") continue;
      const file = path.join(dir, name);
      if (fs.statSync(file).isDirectory()) walk(file);
      else if (fs.readFileSync(file).includes(13)) found.push(file);
    }
  };
  for (const zone of [fx.home, fx.work, fx.tmp]) walk(zone);
  if (found.length > 0) throw new Error(`carriage return in: ${found.join(", ")}`);
}
