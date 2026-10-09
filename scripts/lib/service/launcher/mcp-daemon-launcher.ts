// mcp-daemon-launcher.ts — the installed entry of the shared MemPalace MCP
// HTTP daemon (spec 0252 requirement 11; spec 0113, ADR 0016). The TypeScript
// twin of scripts/lib/mcp-daemon-launcher.sh, which stays beside it.
//
// THIS FILE IS A TEMPLATE. The supervisor never runs this copy: the installer
// writes it to ~/.crewrig/mcp-daemon-launcher.ts with the constants below
// substituted, and the supervisor definition names THAT path (a `git revert`
// must not delete the program a unit names).
//
// BUNDLE: the flat directory ~/.crewrig/service-lib/ holds exactly (see
// bundle.ts, which lists it and rewrites the entry's imports):
//   launcher-child.ts, launcher-token.ts, launcher-wait.ts       (scripts/lib/service/launcher/)
//   mempalace-registration.ts, session-check-throttle.ts          (scripts/lib/)
// This repository copy imports by repository-relative path so it typechecks in
// place; the installer rewrites each import specifier of THIS file to
// `./service-lib/<basename>`, so the installed copy has no import reaching
// into the repository. Bundled files import each other only as `./name.ts`.
//
// Properties kept from the shell launcher: (a) foreground — the supervisor
// owns this process and it never detaches; (b) the token reaches the daemon
// through the child's environment only; (c) fail closed on a missing, empty,
// ill-shaped or short token, before anything else is done; (d) the idle
// watchdog defaults to off; (e) refuse fast on a taken port; (f) wait for
// ChromaDB on a deadline, then export its endpoint; (g) a missing wrapper is a
// diagnosed failure; (h) the spec 0172 stdio warning; (i) hand off to the
// wrapper as a child with inherited streams. Every log and die line keeps its
// shell format.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dieLine, logLine, superviseChild } from "./launcher-child.ts";
import { readToken } from "./launcher-token.ts";
import { canBind, exportChromaEnv, portTakenMessage, waitForChroma } from "./launcher-wait.ts";
import { CLIS, classifyFile, configPath, type Cli } from "../../mempalace-registration.ts";

const CREWRIG_REPO_DIR: string = "__CREWRIG_REPO_DIR__";
const MCP_HOST: string = "__MCP_HOST__";
const MCP_PORT: string = "__MCP_PORT__";
const CHROMA_HOST: string = "__CHROMA_HOST__";
const CHROMA_PORT: string = "__CHROMA_PORT__";
const MEMPALACE_PYTHON: string = "__MEMPALACE_PYTHON__";
const CONFIGURED_PALACE_PATH: string = "__MEMPALACE_PALACE_PATH__";
// The sha256 of the program's REPOSITORY source, recorded at install time.
const LAUNCHER_SOURCE_SHA: string = "__LAUNCHER_SOURCE_SHA__";

function log(message: string): void {
  process.stdout.write(`${logLine(message)}\n`);
}

function die(message: string): never {
  process.stderr.write(`${dieLine(message)}\n`);
  process.exit(1);
}

/** `command -v claude`: the one assistant whose presence is its binary. */
function onPath(name: string): boolean {
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd"] : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const ext of exts) {
      if (dir !== "" && fs.existsSync(path.join(dir, name + ext))) return true;
    }
  }
  return false;
}

function arrangementIsStdio(cli: Cli, home: string): boolean {
  if (cli === "claude" && !onPath("claude")) return false;
  const file = configPath(cli, home);
  let read: Parameters<typeof classifyFile>[0];
  try {
    read = fs.statSync(file).isFile()
      ? { kind: "ok", bytes: fs.readFileSync(file) }
      : { kind: "unreadable" };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    read = code === "ENOENT" || code === "ENOTDIR" ? { kind: "missing" } : { kind: "unreadable" };
  }
  const expected = `http://${MCP_HOST}:${MCP_PORT}/mcp`;
  return classifyFile(read, expected, cli).class === "stdio";
}

/** Spec 0172 R4: warn when an installed assistant is still in stdio mode. */
function warnStdio(home: string): void {
  const stdio = CLIS.filter((cli) => arrangementIsStdio(cli, home));
  if (stdio.length === 0) return;
  const err = (line: string): boolean => process.stderr.write(`${logLine(line)}\n`);
  err(
    `WARNING: MemPalace MCP HTTP daemon is starting, but assistant(s) [${stdio.join(", ")}] are still configured in stdio mode.`,
  );
  err(
    `WARNING: stdio sessions will be locked out of writing by this daemon. Run: bash ${CREWRIG_REPO_DIR}/scripts/switch-mempalace-http.sh`,
  );
}

async function main(): Promise<void> {
  const home = os.homedir();
  const env: Record<string, string | undefined> = { ...process.env };
  if (CONFIGURED_PALACE_PATH !== "") env.MEMPALACE_PALACE_PATH = CONFIGURED_PALACE_PATH;
  env.LAUNCHER_SOURCE_SHA = LAUNCHER_SOURCE_SHA;

  // 1. Token: read, or refuse to serve. Held in the child's environment only.
  const token = readToken(env, home);
  if (!token.ok) die(token.message);
  else env.MEMPALACE_MCP_HTTP_TOKEN = token.token;
  env.MEMPALACE_MCP_IDLE_HOURS = env.MEMPALACE_MCP_IDLE_HOURS ?? "0";

  // 1b. Refuse fast when the port is already taken.
  if (!(await canBind(MCP_HOST, Number(MCP_PORT)))) die(portTakenMessage(MCP_HOST, MCP_PORT));

  // 2. Wait for the ChromaDB daemon, on a deadline.
  const chroma = await waitForChroma({
    host: CHROMA_HOST,
    port: CHROMA_PORT,
    repoDir: CREWRIG_REPO_DIR,
    waitSetting: process.env.MEMPALACE_MCP_CHROMA_WAIT,
  });
  if (!chroma.ok) die(chroma.message);
  log(`ChromaDB daemon reachable at ${CHROMA_HOST}:${CHROMA_PORT}`);
  exportChromaEnv(env, CHROMA_HOST, CHROMA_PORT);

  // 3. Hand off, as a child: a Node.js process cannot replace itself.
  const wrapper = path.join(CREWRIG_REPO_DIR, "scripts", "lib", "mempalace-http-wrapper.py");
  if (!fs.existsSync(wrapper) || !fs.statSync(wrapper).isFile()) {
    die(`wrapper not found: ${wrapper}
       The launcher lives outside the repository but the wrapper does not; a
       moved or removed checkout breaks this path. Re-run the setup script.`);
  }
  warnStdio(home);
  log(`starting MemPalace MCP HTTP daemon on ${MCP_HOST}:${MCP_PORT}/mcp`);
  superviseChild({
    spawn: () =>
      spawn(
        MEMPALACE_PYTHON,
        [wrapper, "--transport", "http", "--host", MCP_HOST, "--port", MCP_PORT],
        { stdio: "inherit", env: env as NodeJS.ProcessEnv, windowsHide: true },
      ),
    onSignal: (signal, handler) => process.on(signal, handler),
    exit: (code) => process.exit(code),
    log,
    // A test seam only: the wait before SIGKILL on a requested stop.
    ...(Number(process.env.MEMPALACE_LAUNCHER_KILL_AFTER_MS) > 0
      ? { killAfterMs: Number(process.env.MEMPALACE_LAUNCHER_KILL_AFTER_MS) }
      : {}),
  });
}

main().catch((error: unknown) => die(error instanceof Error ? error.message : String(error)));
