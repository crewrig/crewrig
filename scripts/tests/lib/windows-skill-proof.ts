// windows-skill-proof.ts — how the cross-system proof of the eleven skill entries runs an entry and
// keeps its books (spec 0258 R27, parent R17; conventions of spec 0257 R27). Importable on any host.
//
// Three legs run the same assertions: `direct` (node itself, on any host), `pwsh` and `cmd` (Windows
// only: the entry goes through PowerShell or `cmd.exe`, interpreters resolved from the PARENT PATH
// before the child's PATH is narrowed). The child PATH holds a tripwire `bash` first (the WSL
// `System32\bash.exe` cannot be removed from a runner PATH, so the proof asserts the tripwire was
// never called), the stub wrapped tools of the case, git where a case needs it, and the system
// directory: never the parent PATH, so no real `ruff`, `markdownlint` or `act` can answer.

import { spawnSync } from "node:child_process";
import type { SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { defaultIsFile, resolveOnPath } from "../../lib/worktree-claim/launch-windows.ts";
import { baseEnv, childPath, lines, writeBins } from "./windows-packaging-driver.ts";
import type { Bins, Proof } from "./windows-packaging-driver.ts";
import { WIN } from "./windows-proof-support.ts";
import type { Run, Shell } from "./windows-proof-support.ts";

export type Leg = "direct" | Shell;

/** A tool call a stub recorded. */
export interface Call {
  readonly tool: string;
  readonly args: readonly string[];
}

export interface Box {
  readonly root: string;
  /** Stub wrapped tools of every case. */
  readonly bin: string;
  /** Only `ruff`, so the `flake8` fallback case can leave it out. */
  readonly binRuff: string;
  /** Only `act`, so a case can leave `docker` out. */
  readonly binAct: string;
  /** A copy of the node binary named `docker`, to resolve an `.exe` through `PATHEXT`. */
  readonly binNode: string;
  readonly trip: Bins;
  readonly stubs: string;
  readonly tmp: string;
  readonly home: string;
  readonly work: string;
  readonly git: string | undefined;
}

export interface Ctx {
  readonly proof: Proof;
  readonly leg: Leg;
  readonly box: Box;
}

const STUB = `const fs = require("fs");
const path = require("path");
const [tool, ...args] = process.argv.slice(2);
const rec = { tool, args };
const at = args.indexOf("--eventpath");
if (at >= 0 && args[at + 1] !== undefined) {
  fs.copyFileSync(args[at + 1], path.join(__dirname, "payload-copy.json"));
  rec.payloadPath = args[at + 1];
}
fs.appendFileSync(path.join(__dirname, "calls.log"), JSON.stringify(rec) + "\\n");
const bad = args.find((a) => a.includes("FAILME"));
if (tool === "docker") process.exit(process.env.STUB_DOCKER === "down" ? 1 : 0);
if (tool === "act") {
  console.log("act-stub " + args.join(" "));
  process.exit(Number(process.env.STUB_ACT_EXIT || 0));
}
if (tool === "actionlint") console.log("actionlint-stub " + args.join(" "));
if (bad !== undefined && tool !== "actionlint") console.log(bad + ":1: " + tool + " stub finding");
process.exit(bad === undefined ? 0 : 1);
`;

/** A stub wrapped tool: a POSIX script, or a Windows \`.cmd\` that calls node (so the launch rule applies). */
function writeStub(dir: string, stubs: string, tool: string): void {
  const js = path.join(stubs, "stub-tool.cjs");
  if (WIN) {
    const body = `@echo off\r\n"${process.execPath}" "${js}" ${tool} %*\r\nexit /b %ERRORLEVEL%\r\n`;
    fs.writeFileSync(path.join(dir, `${tool}.cmd`), body);
  } else {
    const body = `#!/bin/sh\nexec '${process.execPath}' '${js}' ${tool} "$@"\n`;
    fs.writeFileSync(path.join(dir, tool), body, { mode: 0o755 });
  }
}

/** The directory holding the first `git` of the parent PATH, bash-bearing directories excluded. */
function gitDirectory(): string | undefined {
  const parent = process.env["PATH"] ?? "";
  const systemRoot = process.env["SystemRoot"] ?? "C:\\Windows";
  const filtered = childPath([], parent, {
    platform: process.platform,
    systemRoot,
    isFile: defaultIsFile,
  });
  const env = { ...process.env, PATH: filtered };
  const found = resolveOnPath("git", { platform: process.platform, env, isFile: defaultIsFile });
  if (found === undefined) return undefined;
  if (!WIN) {
    for (const dir of filtered.split(path.delimiter))
      if (dir !== "" && defaultIsFile(path.join(dir, "git"))) return dir;
    return undefined;
  }
  return path.win32.dirname(found);
}

export function makeBox(root: string): Box {
  const dir = (name: string): string => {
    const full = path.join(root, name);
    fs.mkdirSync(full, { recursive: true });
    return full;
  };
  const [bin, binRuff, binAct, binNode, stubs, tmp, home, work] = [
    "bin",
    "bin-ruff",
    "bin-act",
    "bin-node",
    "stubs",
    "tmp",
    "home",
    "work",
  ].map(dir) as [string, string, string, string, string, string, string, string];
  fs.writeFileSync(path.join(stubs, "stub-tool.cjs"), STUB);
  for (const tool of ["markdownlint", "actionlint", "flake8", "act", "docker"])
    writeStub(bin, stubs, tool);
  writeStub(binRuff, stubs, "ruff");
  writeStub(binAct, stubs, "act");
  fs.copyFileSync(process.execPath, path.join(binNode, WIN ? "docker.exe" : "docker"));
  return {
    root,
    bin,
    binRuff,
    binAct,
    binNode,
    trip: writeBins(dir("trip"), false),
    stubs,
    tmp,
    home,
    work,
    git: gitDirectory(),
  };
}

export const calls = (box: Box): Call[] => {
  const file = path.join(box.stubs, "calls.log");
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  return text
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as Call);
};

export const resetCalls = (box: Box): void => {
  fs.rmSync(path.join(box.stubs, "calls.log"), { force: true });
  fs.rmSync(path.join(box.stubs, "payload-copy.json"), { force: true });
};

export interface Exec {
  readonly cwd?: string;
  /** Tool directories on the child PATH, after the tripwire. Default: the stub `bin`. */
  readonly dirs?: readonly string[];
  readonly git?: boolean;
  /** Keep the Windows `System32` directory on the child PATH (default). A runner may ship real tools there. */
  readonly system?: boolean;
  readonly env?: Record<string, string>;
  /** Text piped to the entry through the shell (a file, `type` or `Get-Content`). */
  readonly stdin?: string;
}

const head = (text: string): string => (text.length > 2000 ? `${text.slice(0, 2000)}...` : text);

/** Run an entry through the leg's interpreter and record it; CRLF folded only on the shell legs. */
export function childDirs(box: Box, o: Exec = {}): string[] {
  const system =
    WIN && o.system !== false
      ? [path.win32.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32")]
      : [];
  const git = o.git === true && box.git !== undefined ? [box.git] : [];
  return [box.trip.dir, ...(o.dirs ?? [box.bin]), ...git, ...system];
}

/** Every file a `docker` lookup could resolve on the directories the child PATH would hold. */
export function findable(tool: string, dirs: readonly string[]): string[] {
  const names = [tool, ...[".com", ".exe", ".bat", ".cmd"].map((e) => tool + e)];
  return dirs.flatMap((d) => names.map((n) => path.join(d, n))).filter((f) => fs.existsSync(f));
}

export function exec(c: Ctx, script: string, args: readonly string[], o: Exec = {}): Run {
  const { box, leg } = c;
  const pathValue = childDirs(box, o).join(path.delimiter);
  const env = baseEnv(pathValue, box.home, box.tmp, o.env ?? {});
  const cwd = o.cwd ?? box.work;
  const started = process.hrtime.bigint();
  const argv = [process.execPath, script, ...args];
  const piped = o.stdin === undefined ? undefined : path.join(box.tmp, "stdin.txt");
  if (piped !== undefined) fs.writeFileSync(piped, o.stdin as string);
  const ps = `${piped === undefined ? "" : `Get-Content -Raw -LiteralPath '${piped}' | `}& ${argv.map((a) => `'${a.replaceAll("'", "''")}'`).join(" ")}; exit $LASTEXITCODE`;
  const cmd = `"${piped === undefined ? "" : `type "${piped}" | `}${argv.map((a) => `"${a}"`).join(" ")}"`;
  const base = { encoding: "utf8", env, cwd, windowsHide: true } as const;
  const spawned: [string, string[], SpawnSyncOptionsWithStringEncoding] =
    leg === "direct"
      ? [
          process.execPath,
          argv.slice(1),
          { ...base, ...(o.stdin === undefined ? {} : { input: o.stdin }) },
        ]
      : leg === "cmd"
        ? [
            c.proof.interpreters.cmd,
            ["/d", "/s", "/c", cmd],
            { ...base, windowsVerbatimArguments: true },
          ]
        : [c.proof.interpreters.pwsh, ["-NoProfile", "-NonInteractive", "-Command", ps], base];
  const res = spawnSync(spawned[0], spawned[1], spawned[2]);
  const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
  const fold = leg === "direct" ? (t: string): string => t : lines;
  const out = fold(res.stdout ?? "");
  const err = fold(res.stderr ?? "");
  const detail = [
    `  leg: ${leg}, command: ${JSON.stringify([spawned[0], ...spawned[1]])}`,
    `  cwd: ${cwd}`,
    `  spawn error: ${res.error?.message ?? "none"}`,
    `  status: ${res.status}, signal: ${res.signal}`,
    `  stdout: ${JSON.stringify(head(out))}`,
    `  stderr: ${JSON.stringify(head(err))}`,
  ].join("\n");
  return { entry: path.basename(script), status: res.status, out, err, ms, detail };
}

/** Run one case; a failure is recorded with its name and the proof carries on with the next. */
export function attempt(c: Ctx, name: string, fn: () => void): void {
  const started = Date.now();
  c.proof.current = name;
  resetCalls(c.box);
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    c.proof.failures.push(`[${c.leg}] ${name}: ${message}`);
  }
  console.log(`windows-skill-proof: [${c.leg}] ${name}: ${Date.now() - started} ms`);
}
