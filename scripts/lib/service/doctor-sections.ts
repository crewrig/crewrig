// doctor-sections.ts — the three labelled sections of `doctor-mempalace` (spec 0252
// requirement 20; spec 0108 R7-R10): what a session launches, what resolves on
// PATH, what a fresh setup would select. Ports sections 1 to 3 of
// scripts/doctor-mempalace.sh with every label and message kept. Read only.

import path from "node:path";
import {
  consoleScriptPython,
  detectMempalacePython,
  findOnPath,
  mempalacePythonCandidates,
  resolveSymlink,
  splitLauncher,
} from "../mempalace-python.ts";
import { configPath, CLIS } from "../mempalace-registration.ts";
import type { Cli } from "../mempalace-registration.ts";
import { evaluate, runProbe } from "./doctor-pin.ts";
import { DoctorState, field, tildify } from "./doctor-report.ts";
import type { Write } from "./doctor-report.ts";
import {
  argvDisplay,
  argvOf,
  checkoutOf,
  daemonRunning,
  findWrapper,
  hasAuthorization,
  isFile,
  registrationEntry,
  remoteUrl,
  resolves,
} from "./doctor-resolve.ts";

export interface SectionContext {
  env: NodeJS.ProcessEnv;
  home: string;
  /** This checkout's scripts directory. */
  scriptDir: string;
  write: Write;
  state: DoctorState;
}

const CLI_LABELS: Readonly<Record<Cli, string>> = {
  claude: "Claude Code",
  gemini: "Gemini CLI",
  copilot: "GitHub Copilot CLI",
  antigravity: "Antigravity CLI",
};

const GAP = "                            ";

function localPin(c: SectionContext): string {
  return path.join(c.scriptDir, "lib", "mempalace_pin.py");
}

function localCommonSh(c: SectionContext): string {
  return path.join(c.scriptDir, "lib", "common.sh");
}

async function inspectRegistration(c: SectionContext, cli: Cli): Promise<void> {
  const { write, state, home } = c;
  const label = CLI_LABELS[cli];
  const config = configPath(cli, home);
  write(`  ${label}`);
  field(write, "config file:", tildify(config, home));

  if (!isFile(config)) {
    field(write, "status:", "NOT PRESENT — this CLI has no MCP configuration on this machine");
    write("");
    return;
  }
  const entry = registrationEntry(config);
  if (entry === undefined) {
    field(write, "status:", "NO MEMPALACE ENTRY — this CLI would start no memory server");
    write("");
    return;
  }

  // An HTTP registration carries a url and headers, no command: report the endpoint.
  const url = remoteUrl(entry);
  if (url !== "") {
    field(write, "transport:", "http (shared daemon, spec 0113)");
    field(write, "endpoint:", url);
    field(
      write,
      "auth:",
      hasAuthorization(entry)
        ? "bearer header present (value not shown)"
        : "*** NO Authorization HEADER — this CLI would reach the daemon unauthenticated ***",
    );
    field(write, "version:", "served by the daemon — run: bash scripts/status-mcp-server.sh");
    write("");
    return;
  }

  const argv = argvOf(entry);
  field(write, "argv:", argvDisplay(argv));

  const daemon = await daemonRunning(c.env);
  if (daemon.up) {
    field(
      write,
      "daemon conflict:",
      `*** LOCKED OUT BY RUNNING DAEMON *** (daemon at http://${daemon.host}:${daemon.port}/mcp holds exclusive write lease)`,
    );
    state.noteFailure(
      `${label}: registered as stdio while shared MCP daemon is running; locked out of writes (run: bash scripts/switch-mempalace-http.sh)`,
    );
  }

  const { wrapper, interp } = findWrapper(argv);
  if (wrapper === "") {
    field(write, "status:", "UNGUARDED — this argv routes through no MemPalace wrapper at all,");
    write(`${GAP}so no launch-time version guard can run for it`);
    write("");
    return;
  }
  if (interp === "") {
    field(write, "status:", "MALFORMED — the wrapper is the first argv element, so no interpreter");
    write(`${GAP}precedes it; this registration cannot start`);
    write("");
    return;
  }
  if (!isFile(wrapper)) {
    field(write, "status:", `WRAPPER MISSING — ${wrapper} does not resolve on this machine`);
    state.noteFailure(`${label}: the registered wrapper ${wrapper} does not exist`);
    write("");
    return;
  }

  const checkout = checkoutOf(wrapper);
  const registeredCommonSh = path.join(checkout, "scripts", "lib", "common.sh");
  const registeredPin = path.join(checkout, "scripts", "lib", "mempalace_pin.py");
  field(write, "launch wrapper:", tildify(wrapper, home));
  field(write, "registered checkout:", tildify(checkout, home));
  field(write, "registered interpreter:", interp);

  if (!resolves(interp, c.env)) {
    field(write, "status:", `INTERPRETER MISSING — ${interp} does not resolve on this machine`);
    state.noteFailure(`${label}: the registered interpreter ${interp} does not resolve`);
    write("");
    return;
  }

  let pinModule: string;
  if (isFile(registeredPin)) {
    pinModule = registeredPin;
    field(write, "guard status:", "PRESENT (evaluated with the registered checkout's own parser)");
  } else {
    pinModule = localPin(c);
    field(
      write,
      "guard status:",
      "GUARD ABSENT (pre-guard checkout) — that checkout carries a wrapper",
    );
    write(`${GAP}but no scripts/lib/mempalace_pin.py, so a session it starts`);
    write(`${GAP}runs NO launch-time version guard. Evaluated below with THIS`);
    write(`${GAP}checkout's parser, under the REGISTERED interpreter and`);
    write(`${GAP}against the REGISTERED pin — only the parser code is local.`);
  }
  evaluate(
    {
      label,
      interp,
      pinModule,
      commonSh: registeredCommonSh,
      probeCapture: runProbe(interp, pinModule, c.env),
      home,
      env: c.env,
    },
    state,
    write,
  );
  write("");
}

/** Section 1: what a session actually launches. */
export async function sectionLaunches(c: SectionContext): Promise<void> {
  const { write } = c;
  write("1. What a session actually launches");
  write("   (the MCP registration each CLI would start a memory server from)");
  write("");
  for (const cli of CLIS) await inspectRegistration(c, cli);
  write("  Files consulted for this section: ~/.claude.json, ~/.gemini/settings.json,");
  write("  ~/.copilot/mcp-config.json, ~/.gemini/config/mcp_config.json. A memory server");
  write("  registered by hand anywhere else is invisible here.");
  write("");
}

function inspectConsoleScript(c: SectionContext, name: string): void {
  const { write, state, home } = c;
  write(`  ${name}`);
  const resolved = findOnPath(name, c.env, undefined);
  if (resolved === undefined) {
    field(write, "status:", "ABSENT — not on PATH (reported as absent, not as an error)");
    write("");
    return;
  }
  field(write, "resolves to:", tildify(resolved, home));
  const real = resolveSymlink(resolved);
  field(write, "realpath:", tildify(real, home));

  const interp = consoleScriptPython(real);
  if (interp === undefined) {
    field(write, "status:", "NO SHEBANG INTERPRETER — cannot tell which interpreter would run it");
    state.noteFailure(`PATH:${name}: no interpreter could be read from its shebang`);
    write("");
    return;
  }
  field(write, "shebang interpreter:", interp);
  evaluate(
    {
      label: `PATH:${name}`,
      interp,
      pinModule: localPin(c),
      commonSh: localCommonSh(c),
      probeCapture: runProbe(interp, localPin(c), c.env),
      home,
      env: c.env,
    },
    state,
    write,
  );
  write("");
}

/** Section 2: what resolves on PATH. */
export function sectionPath(c: SectionContext): void {
  c.write("2. What resolves on your PATH");
  c.write("   (the MemPalace commands an operator would reach from a shell)");
  c.write("");
  inspectConsoleScript(c, "mempalace");
  inspectConsoleScript(c, "mempalace-mcp");
}

/** Section 3: what a fresh setup would select (the next setup run, not any running session). */
export function sectionFresh(c: SectionContext): void {
  const { write, state, env, home } = c;
  write("3. What a fresh setup would select");
  write("   (what the NEXT setup run would pick — NOT what any running session uses)");
  write("");

  const winner = detectMempalacePython(env);
  const candidates = mempalacePythonCandidates(env);
  let winnerIndex = 0;
  candidates.forEach((candidate, i) => {
    if (winner !== undefined && candidate === winner && winnerIndex === 0) winnerIndex = i + 1;
    const [command] = splitLauncher(candidate);
    const found = command !== undefined && findOnPath(command, env, undefined) !== undefined;
    write(`    ${i + 1}. ${candidate}  (${found ? "resolves" : "does not resolve"})`);
  });
  write("");

  const first = candidates[0] ?? "";
  if (winner === undefined) {
    field(write, "selection:", "NONE — no candidate could import mempalace.mcp_server");
    state.noteFailure(
      "fresh setup: detect_mempalace_python selects no interpreter on this machine",
    );
  } else {
    field(write, "selection:", `candidate ${winnerIndex}: ${winner}`);
    if (winner !== first) {
      // R10 — a fallback to a lower-priority candidate is never silent.
      field(write, "fallback selected:", "YES");
      write(`${GAP}highest-priority candidate 1 (${first}) was NOT`);
      write(`${GAP}selected; candidate ${winnerIndex} (${winner}) was, and the`);
      write(`${GAP}version it serves is reported immediately below.`);
    }
    evaluate(
      {
        label: "fresh-setup-selection",
        interp: winner,
        pinModule: localPin(c),
        commonSh: localCommonSh(c),
        probeCapture: runProbe(winner, localPin(c), env),
        home,
        env,
      },
      state,
      write,
    );
  }
  write("");
}
