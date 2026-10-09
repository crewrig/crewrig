// prune-run.ts — the run of scripts/prune-transcripts.ts (spec 0253 R16-R18), in the order of
// the shell predecessor: trust file, arguments, interpreter, banner, then prune_drawers.py as a
// child sharing the parent's standard streams. Every effect is injected through `PruneDeps`.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { cutoffDate } from "./prune-cutoff.ts";
import { parsePruneArgs } from "./prune-args.ts";
import { buildChildEnv, loadTls } from "./prune-env.ts";
import { interpreterExists, resolveInterpreter } from "./prune-interpreter.ts";
import type { PathIo } from "./prune-interpreter.ts";
import type { Io } from "./types.ts";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

export interface PruneDeps extends PathIo {
  readonly installSpec: string;
  /** The entry as the user types it. */
  readonly script: string;
  readonly platform: NodeJS.Platform;
  /** Absolute path of prune_drawers.py. */
  readonly pythonFile: string;
  readonly now: () => Date;
  /** `pipx environment --value PIPX_HOME` run under `env`; its trimmed standard output or undefined. */
  readonly pipxHome: (env: NodeJS.ProcessEnv) => string | undefined;
  /** Run `command args` with inherited streams under `env`; its exit status. */
  readonly spawn: (command: string, args: readonly string[], env: NodeJS.ProcessEnv) => number;
}

function isExecutableFile(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false;
    if (process.platform !== "win32") fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The real effects of a run. */
export function realDeps(installSpec: string): PruneDeps {
  return {
    installSpec,
    script: "scripts/prune-transcripts.ts",
    platform: process.platform,
    pythonFile: path.join(import.meta.dirname, "prune_drawers.py"),
    now: () => new Date(),
    exists: (p) => fs.existsSync(p),
    isExecutableFile,
    pipxHome: (env) => {
      const r = spawnSync("pipx", ["environment", "--value", "PIPX_HOME"], {
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return r.status === 0 && typeof r.stdout === "string" ? r.stdout.trim() : undefined;
    },
    spawn: (command, args, env) => {
      const r = spawnSync(command, [...args], { env, stdio: "inherit" });
      if (r.status !== null) return r.status;
      process.stderr.write(
        `Error: ${command} did not run to completion (${r.error?.message ?? r.signal})\n`,
      );
      return (r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT" ? 127 : 1;
    },
  };
}

function writeFd(fd: 1 | 2, text: string): void {
  try {
    fs.writeSync(fd, text);
  } catch {
    (fd === 1 ? process.stdout : process.stderr).write(text);
  }
}

/** Streams written synchronously, so the banner precedes the child's output. */
export const realIo: Io = {
  out: (line) => writeFd(1, `${line}\n`),
  err: (line) => writeFd(2, `${line}\n`),
};

/** Run the prune; returns the exit status. */
export function runPrune(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  home: string,
  io: Io,
  deps: PruneDeps,
): number {
  const tls = loadTls(home);
  if (tls.warning !== undefined) io.err(tls.warning);
  const runEnv: NodeJS.ProcessEnv = { ...env, ...tls.vars };

  const args = parsePruneArgs(argv, { script: deps.script, installSpec: deps.installSpec });
  if (args.kind === "help") {
    for (const line of args.lines) io.out(line);
    return 0;
  }
  if (args.kind === "error") {
    for (const line of args.lines) (args.stream === "stdout" ? io.out : io.err)(line);
    return 1;
  }

  const interpreter = resolveInterpreter(runEnv, deps.platform, {
    exists: deps.exists,
    isExecutableFile: deps.isExecutableFile,
    pipxHome: () => deps.pipxHome(runEnv),
  });
  if (!interpreterExists(interpreter, runEnv, deps.platform, deps)) {
    io.err(`Error: ${interpreter} not found`);
    io.err(`Install MemPalace via pipx: pipx install '${deps.installSpec}'`);
    return 1;
  }

  const cutoff = cutoffDate(args.days, deps.now());
  io.out("=========================================");
  io.out("  Transcript Prune");
  io.out("=========================================");
  io.out("Wing:        transcripts");
  io.out(`Cutoff date: ${cutoff} (older than ${args.days} days)`);
  io.out(`Dry run:     ${args.apply ? "false" : "true"}`);
  if (args.project !== "") io.out(`Project:      ${args.project} (filter only)`);
  io.out("");

  const childEnv = buildChildEnv(env, tls.vars, {
    cutoff,
    dryRun: !args.apply,
    project: args.project,
    installSpec: deps.installSpec,
  });
  return deps.spawn(interpreter, [deps.pythonFile], childEnv);
}
