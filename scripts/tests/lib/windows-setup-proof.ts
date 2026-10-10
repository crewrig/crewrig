// windows-setup-proof.ts — the cross-system proof of the four interactive setup entries (spec 0256 R34,
// R35, R37; parent R17). Not a test suite: a script the `windows-setup-entries` job runs under pwsh.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/tests/lib/windows-setup-proof.ts
// Off Windows it prints one line and exits 0. On Windows every run uses a sandbox HOME/USERPROFILE and a
// hermetic PATH (the `.cmd` stubs, node, System32: no bash). The interpreters are resolved from the
// PARENT environment before PATH is narrowed. Timings are printed, never asserted. The cases live in
// windows-setup-cases.ts (R34), windows-setup-delta01.ts and windows-setup-e2e.ts; they receive a
// `Harness` and share nothing else. Exit 0, or an aggregated report (command, stdout, stderr) and exit 1.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { createFixtureTree } from "./build-fixture-tree.ts";
import type { FixtureTree } from "./build-fixture-tree.ts";
import { defaultIsFile } from "../../lib/worktree-claim/launch-windows.ts";
import {
  buildRepo,
  disposeFixture,
  formatReport,
  landed,
  npmFixture,
  runCases,
} from "./windows-setup-cases.ts";
import { resolveInterpreters, sandboxPath, setEnv, WIN } from "./windows-proof-support.ts";
import type { Interpreters, Run, Shell } from "./windows-proof-support.ts";

export type { Run, Shell };

export interface Sandbox {
  readonly root: string;
  readonly home: string;
  readonly repo: string;
  readonly bin: string;
  readonly calls: string;
  dispose(): void;
}

export interface RunOptions {
  readonly shell?: Shell;
  /** Bytes piped to standard input; absent = closed standard input. */
  readonly input?: Buffer | string;
  readonly env?: Readonly<Record<string, string>>;
}

/** What a case file receives: everything it needs, nothing it must import. */
export interface Harness {
  readonly interpreters: Interpreters;
  /** A fresh sandbox; `npm: "real"` leaves npm to node's directory (default: the `npm ci` stub). */
  sandbox(options?: { npm?: "stub" | "real" }): Sandbox;
  /** A recording `.cmd` stub; `body` (batch lines) runs after the recording. */
  stub(sb: Sandbox, name: string, body?: string): void;
  /** The argv lines the stub `name` recorded, oldest first. */
  calls(sb: Sandbox, name: string): string[];
  /** Run `scripts/setup-<cli>-interactive.ts` of the sandbox repository. */
  run(sb: Sandbox, cli: string, args: readonly string[], options?: RunOptions): Run;
  exec(sb: Sandbox, argv: readonly string[], options?: RunOptions): Run;
  landed(sb: Sandbox): Map<string, Buffer>;
  check(name: string, fn: () => void): void;
  /** A case that could not be exercised: reported, never a failure. */
  notExercised(name: string, reason: string): void;
}

const failures: string[] = [];
const notes: string[] = [];
const disposers: Array<() => void> = [];
let interpreters: Interpreters = { pwsh: "pwsh", cmd: "cmd.exe", notes: [] };
let current = "";

function stub(sb: Sandbox, name: string, body = ""): void {
  const lines = [
    "@echo off",
    `>>"${path.join(sb.calls, name)}" echo %*`,
    ...body.split("\n").filter((l) => l !== ""),
    "exit /b 0",
  ];
  fs.writeFileSync(path.join(sb.bin, `${name}.cmd`), lines.join("\r\n") + "\r\n");
}

function sandbox(options: { npm?: "stub" | "real" } = {}): Sandbox {
  const tree: FixtureTree = createFixtureTree({ deps: "no-packages" });
  const root = tree.root;
  const sb: Sandbox = {
    root,
    repo: root,
    home: path.join(root, "home"),
    bin: path.join(root, "bin"),
    calls: path.join(root, "calls"),
    dispose: () => tree.dispose(),
  };
  for (const dir of [sb.home, sb.bin, sb.calls]) fs.mkdirSync(dir, { recursive: true });
  buildRepo(sb.repo);
  for (const name of ["claude", "agy", "gh"]) stub(sb, name);
  // A stand-in `npm ci`: the production packages are copied into ./node_modules, as the oracle's stub does.
  const copy = `if "%1"=="ci" xcopy "${npmFixture()}" "%CD%\\node_modules\\" /E /I /Y /Q >nul`;
  if (options.npm !== "real") stub(sb, "npm", copy);
  disposers.push(() => sb.dispose());
  return sb;
}

function run(sb: Sandbox, cli: string, args: readonly string[], options: RunOptions = {}): Run {
  const script = path.join(sb.repo, "scripts", `setup-${cli}-interactive.ts`);
  const argv = [
    process.execPath,
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    script,
    ...args,
  ];
  return exec(sb, argv, options);
}

function exec(sb: Sandbox, argv: readonly string[], options: RunOptions = {}): Run {
  const entry = path.basename(argv[2] ?? argv[0] ?? "");
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["REPO_DIR", "CLAUDE_CONFIG_DIR", "TLS_DELEGATION"]) delete env[key];
  for (const [k, v] of Object.entries({ HOME: sb.home, USERPROFILE: sb.home, ...options.env }))
    setEnv(env, k, v);
  setEnv(env, "PATH", sandboxPath(sb.bin)); // hermetic: no bash, no real claude, agy or gh
  const ps = `& ${argv.map((a) => `'${a.replaceAll("'", "''")}'`).join(" ")}; exit $LASTEXITCODE`;
  const cmd = `"${argv.map((a) => `"${a}"`).join(" ")}"`;
  const shell = options.shell ?? "pwsh";
  const [file, fileArgs, verbatim] = !WIN
    ? [process.execPath, argv.slice(1), false]
    : shell === "cmd"
      ? [interpreters.cmd, ["/d", "/s", "/c", cmd], true]
      : [interpreters.pwsh, ["-NoProfile", "-NonInteractive", "-Command", ps], false];
  const started = Date.now();
  const res = spawnSync(file, fileArgs, {
    encoding: "utf8",
    env,
    windowsHide: true,
    windowsVerbatimArguments: verbatim,
    input: options.input ?? "",
    cwd: sb.repo,
  });
  const ms = Date.now() - started;
  const out = res.stdout ?? "";
  const err = res.stderr ?? "";
  const clip = (t: string): string => (t.length > 3000 ? `${t.slice(0, 3000)}...` : t);
  const detail = [
    `  command: ${JSON.stringify([file, ...fileArgs])}`,
    `  spawn error: ${res.error?.message ?? "none"}`,
    `  status: ${res.status}, signal: ${res.signal}`,
    `  stdout: ${JSON.stringify(clip(out))}`,
    `  stderr: ${JSON.stringify(clip(err))}`,
  ].join("\n");
  console.log(`windows-setup-proof: ${entry} ${argv.length - 3} arg(s) [${shell}]: ${ms} ms`);
  return { entry, status: res.status, out, err, ms, detail };
}

export const harness: Harness = {
  get interpreters() {
    return interpreters;
  },
  sandbox,
  stub,
  calls: (sb, name) => {
    const file = path.join(sb.calls, name);
    return fs.existsSync(file)
      ? fs
          .readFileSync(file, "utf8")
          .split(/\r?\n/)
          .filter((l) => l !== "")
      : [];
  },
  run,
  exec,
  landed,
  check(name, fn) {
    try {
      fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${current} / ${name}: ${message}`);
      console.error(`windows-setup-proof: FAIL ${current} / ${name}: ${message}`);
    }
  },
  notExercised: (name, reason) => void notes.push(`${current} / ${name}: ${reason}`),
};

async function main(): Promise<void> {
  if (!WIN) return void console.log("windows-setup-proof: Windows-only proof, skipped (exit 0)");
  console.log(`windows-setup-proof: platform ${process.platform}, node ${process.version}`);
  try {
    interpreters = resolveInterpreters({
      platform: process.platform,
      env: process.env,
      isFile: defaultIsFile,
    });
    console.log(`windows-setup-proof: ${interpreters.notes.join("; ")}`);
    const { runDelta01 } = await import("./windows-setup-delta01.ts");
    const { runE2e } = await import("./windows-setup-e2e.ts");
    const steps: Record<string, (h: Harness) => void> = {
      "R34 cases": runCases,
      "delta-01 cases": runDelta01,
      "end to end": runE2e,
    };
    for (const [label, step] of Object.entries(steps)) {
      current = label;
      const started = Date.now();
      harness.check("(whole step)", () => step(harness));
      console.log(`windows-setup-proof: ${label}: ${Date.now() - started} ms`);
    }
  } catch (error) {
    failures.push(`setup: ${error instanceof Error ? error.stack : String(error)}`);
  } finally {
    for (const dispose of disposers.splice(0)) dispose();
    disposeFixture();
  }
  if (failures.length === 0)
    return void console.log(
      `windows-setup-proof: OK${notes.length ? ` (${notes.length} not exercised)` : ""}`,
    );
  console.error(formatReport(failures, notes));
  process.exitCode = 1;
}

if (import.meta.main) await main();
