// chroma-launch.ts — start the shared ChromaDB HTTP daemon (spec 0252
// requirement 13; plan v3 D7). It ports scripts/start-chroma-server.sh with every
// message and exit status kept; no shell is spawned and `curl` is not used.
//
// Order, as in the shell: the interpreter text, the directories, idempotency (a
// live PID file ends the run with status 0, a stale one is removed), the sanity
// checks, the daemon, the PID file, the 15-second heartbeat poll.
//
// POSIX: the open-file soft limit is raised by running the daemon through the
// Python interpreter. The prelude reads RLIMIT_NOFILE, tries
// setrlimit(NOFILE, (floor, hard)), writes the shell's warning on failure and
// continues, then os.execv replaces the interpreter by the daemon, so the PID
// recorded is the daemon's. Windows: no prelude, `chroma.exe` beside the
// interpreter started detached with its window hidden (the `Scripts\chroma.exe`
// launcher is an executable, not a script for the interpreter).

import { accessSync, constants, mkdirSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, isAbsolute, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { launchDaemon } from "./exec.ts";
import {
  chromaEndpoint,
  chromaPaths,
  heartbeatOk,
  pidState,
  processAlive,
  removeFile,
  sleep,
  type EnvLike,
  type Io,
} from "./chroma-state.ts";
import { detectMempalacePython, splitLauncher } from "../mempalace-python.ts";
import { readMempalacePin } from "../mempalace-pin.ts";
import { readTlsEnv } from "../tls-env.ts";

/** The whole startup poll, in milliseconds. */
export const STARTUP_DEADLINE_MS = 15_000;
/** The bound of one heartbeat inside the poll. */
const POLL_HEARTBEAT_MS = 2000;

export const DEFAULT_ULIMIT_FLOOR = "10240";

/** Run as `python -c PRELUDE <floor> <python> <chroma> run ...`; see the header. */
export const PRELUDE = [
  "import os, resource, sys",
  "floor, py, rest = sys.argv[1], sys.argv[2], sys.argv[3:]",
  "soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)",
  "try:",
  "    resource.setrlimit(resource.RLIMIT_NOFILE, (int(floor), hard))",
  "except (ValueError, OSError):",
  "    ceiling = 'unlimited' if hard == resource.RLIM_INFINITY else hard",
  "    sys.stderr.write('WARNING: could not raise open-file limit to %s; current hard ceiling is %s.\\n' % (floor, ceiling))",
  "    sys.stderr.flush()",
  "os.execv(py, [py] + rest)",
].join("\n");

function isExecutable(file: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function onPath(name: string, env: EnvLike, platform: NodeJS.Platform): string | undefined {
  const exts =
    platform === "win32" ? ["", ...(env["PATHEXT"] ?? ".EXE").split(";").filter(Boolean)] : [""];
  for (const dir of (env["PATH"] ?? env["Path"] ?? "").split(delimiter)) {
    if (dir === "") continue;
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (isExecutable(candidate, platform)) return candidate;
    }
  }
  return undefined;
}

/** The interpreter file behind `text` (a path, a bare name, or a `py -3` launcher), if it runs. */
export function resolveInterpreter(
  text: string,
  env: EnvLike,
  platform: NodeJS.Platform,
): string | undefined {
  const [command, ...lead] = splitLauncher(text);
  if (command === undefined) return undefined;
  if (lead.length > 0) {
    const run = spawnSync(command, [...lead, "-c", "import sys; print(sys.executable)"], {
      encoding: "utf8",
      windowsHide: true,
      env: { ...env },
    });
    const printed = typeof run.stdout === "string" ? run.stdout.trim() : "";
    return run.status === 0 && printed !== "" && isExecutable(printed, platform)
      ? printed
      : undefined;
  }
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    return isExecutable(command, platform) ? command : undefined;
  }
  return onPath(command, env, platform);
}

/** The `chroma` binary beside the interpreter (`chroma.exe`, here or in `Scripts`, on Windows). */
export function chromaBinaryFor(
  python: string,
  platform: NodeJS.Platform,
  exists: (file: string) => boolean = (f) => isExecutable(f, platform),
): string {
  const dir = dirname(python);
  if (platform !== "win32") return join(dir, "chroma");
  const beside = join(dir, "chroma.exe");
  const inScripts = join(dir, "Scripts", "chroma.exe");
  return basename(dir).toLowerCase() === "scripts" || exists(beside) || !exists(inScripts)
    ? beside
    : inScripts;
}

export interface StartOptions {
  readonly env: EnvLike;
  readonly platform: NodeJS.Platform;
  /** The repository root, whose `scripts/lib/common.sh` carries the MemPalace pin. */
  readonly repoRoot: string;
  readonly io: Io;
  readonly home?: string;
  /** Seam for tests: the poll deadline in milliseconds. */
  readonly deadlineMs?: number;
}

function pinRange(repoRoot: string): string {
  try {
    const pin = readMempalacePin(repoRoot);
    return `>=${pin.min},<${pin.maxExclusive}`;
  } catch {
    return "";
  }
}

/** Start the daemon; resolves to the exit status of the shell script. */
export async function startChroma(o: StartOptions): Promise<number> {
  const { env, io } = o;
  const paths = chromaPaths(env, o.home);
  const { host, port } = chromaEndpoint(env);

  const configured = env["MEMPALACE_PYTHON"];
  const pythonText =
    configured !== undefined && configured !== "" ? configured : detectMempalacePython({ ...env });
  if (pythonText === undefined || pythonText === "") {
    io.err("ERROR: cannot locate the mempalace Python interpreter.");
    io.err(`  Install via: pipx install 'mempalace${pinRange(o.repoRoot)}'`);
    return 1;
  }

  mkdirSync(paths.dir, { recursive: true });
  mkdirSync(paths.palaceDir, { recursive: true });

  const existing = pidState(paths.pidFile);
  if (existing.kind === "alive") {
    io.out(`chroma server already running (PID ${existing.pid})`);
    return 0;
  }
  if (existing.kind === "stale") {
    io.out("  Stale PID file detected — cleaning up.");
    removeFile(paths.pidFile);
  }

  const python = resolveInterpreter(pythonText, env, o.platform);
  if (python === undefined) {
    io.err(`ERROR: Python interpreter not found at ${pythonText}`);
    io.err("  Install MemPalace via pipx first.");
    return 1;
  }
  const chroma = chromaBinaryFor(python, o.platform);
  if (!isExecutable(chroma, o.platform)) {
    io.err(`ERROR: chroma binary not found at ${chroma}`);
    io.err("  Install via: pipx inject mempalace 'chromadb>=1.5.9'");
    return 1;
  }

  // Custom root-CA / native-TLS delegation (spec 0084), applied to the daemon only.
  const tls = readTlsEnv(o.home ?? env["HOME"] ?? env["USERPROFILE"] ?? "");
  if (tls.kind === "malformed") {
    io.err(`WARNING: ignoring ${tls.file}: line ${tls.line} is outside the trust-file format.`);
  } else if (tls.kind === "unreadable") {
    io.err(`WARNING: ignoring ${tls.file}: the file could not be read.`);
  }
  const daemonEnv = { ...env, ...(tls.kind === "ok" ? tls.vars : {}) };

  const runArgs = ["run", "--path", paths.palaceDir, "--host", host, "--port", port];
  const launch =
    o.platform === "win32"
      ? launchDaemon(chroma, runArgs, { env: daemonEnv, logFile: paths.logFile })
      : launchDaemon(
          python,
          [
            "-c",
            PRELUDE,
            env["MEMPALACE_CHROMA_ULIMIT_FLOOR"] || DEFAULT_ULIMIT_FLOOR,
            python,
            chroma,
            ...runArgs,
          ],
          { env: daemonEnv, logFile: paths.logFile },
        );
  const pid = launch.pid;
  if (pid === undefined) {
    io.err("ERROR: chroma server process died during startup.");
    io.err(`  Check the log: ${paths.logFile}`);
    return 1;
  }
  writeFileSync(paths.pidFile, `${pid}\n`);

  const deadline = Date.now() + (o.deadlineMs ?? STARTUP_DEADLINE_MS);
  while (Date.now() < deadline) {
    const bound = Math.max(1, Math.min(POLL_HEARTBEAT_MS, deadline - Date.now()));
    if (await heartbeatOk({ host, port }, bound)) {
      io.out(`chroma server started (PID ${pid}, ${host}:${port})`);
      return 0;
    }
    if (!processAlive(pid)) {
      io.err("ERROR: chroma server process died during startup.");
      io.err(`  Check the log: ${paths.logFile}`);
      removeFile(paths.pidFile);
      return 1;
    }
    await sleep(500);
  }
  io.err(`ERROR: chroma server heartbeat timed out after 15s at ${host}:${port}`);
  io.err(`  Check the log: ${paths.logFile}`);
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
  removeFile(paths.pidFile);
  return 1;
}
