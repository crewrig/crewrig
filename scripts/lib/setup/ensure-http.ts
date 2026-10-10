// ensure-http.ts — `ensure_mempalace_http` of scripts/lib/common.sh (spec 0256 requirement 26 and
// deviation (o) of delta-01): make the shared MemPalace MCP HTTP daemon the outcome of a setup run
// and return the status the four setups route on.
//
//   0  the probe accepted a real bearer and the HTTP registration was written;
//   1  no usable serving daemon: the probe never accepted, the install or the token step failed, or
//      a non-loopback `MEMPALACE_MCP_HOST` made the probe refuse to send the bearer (deviation (o));
//   2  the daemon is verified serving but the registration could not be completed: the write failed
//      (`claude` absent included), or the probe accepted only the placeholder bearer.
//
// The serving gate is the authenticated `tools/list` probe, never a `/healthz` poll. No exception
// leaves this function on status 1 or 2: each seam of `EnsureHttpDeps` is guarded. The lines are the
// shell's, byte for byte, printed through `ctx.io.out` (the shell's `echo`).

import { TokenError } from "../service/token.ts";
import { defaultEnsureHttpDeps } from "./ensure-http-probe.ts";
import type { EnsureHttpCtx, EnsureHttpDeps, EnsureRc } from "./ensure-http-probe.ts";
import type { Cli, Spawner } from "./context.ts";

export type { EnsureHttpCtx, EnsureHttpDeps, EnsureRc };

const HOST_DEFAULT = "127.0.0.1";
const PORT_DEFAULT = "41893";
const PLACEHOLDER = "crewrig-setup-placeholder-not-a-credential";
const OTHERS: readonly Cli[] = ["claude", "gemini", "copilot", "antigravity"];

/** `${VAR:-default}`: unset and empty both fall to the default. */
const orDefault = (value: string | undefined, fallback: string): string =>
  value === undefined || value === "" ? fallback : value;

/**
 * The bearer token, or "" when it cannot be read or created (`mcp_token_read_or_create || true`).
 * A refusal of the token step (`TokenError`) is reported on standard error as the shell does
 * (`  ERROR: <reason>`, the reason's own continuation lines verbatim), unless the call is quiet
 * (the shell's `>/dev/null 2>&1` probe of the install-failure arm).
 */
function tryToken(deps: EnsureHttpDeps, io?: EnsureHttpCtx["io"]): string {
  try {
    return deps.readToken();
  } catch (error) {
    if (io !== undefined && error instanceof TokenError) io.err(`  ERROR: ${error.message}`);
    return "";
  }
}

async function accepts(deps: EnsureHttpDeps, host: string, port: string, token: string) {
  try {
    return await deps.probeAccepts(host, port, token);
  } catch {
    return false;
  }
}

/** The arrangement NOTE of the shell: the other present assistants not yet on HTTP, in order. */
function stillLeft(deps: EnsureHttpDeps, cli: Cli): Cli[] {
  const left: Cli[] = [];
  for (const other of OTHERS) {
    if (other === cli) continue;
    try {
      if (!deps.present(other)) continue;
      if (deps.arrangement(other) === "http") continue;
    } catch {
      continue;
    }
    left.push(other);
  }
  return left;
}

/** Write the registration; false on any failure (`claude` absent from PATH included). */
function tryRegister(deps: EnsureHttpDeps, cli: Cli, token: string): boolean {
  try {
    if (cli === "claude" && !deps.present("claude")) return false;
    deps.backup(cli);
    deps.register(cli, token);
    return true;
  } catch {
    return false;
  }
}

/** Run the daemon contract for `cli`; `deps` default to the production seams. */
export async function ensureMempalaceHttp(args: {
  ctx: EnsureHttpCtx;
  cli: Cli;
  spawn: Spawner;
  deps?: EnsureHttpDeps;
}): Promise<EnsureRc> {
  const { ctx, cli } = args;
  const say = (line: string): void => ctx.io.out(line);
  const host = orDefault(ctx.env["MEMPALACE_MCP_HOST"], HOST_DEFAULT);
  const port = orDefault(ctx.env["MEMPALACE_MCP_PORT"], PORT_DEFAULT);
  const deps = args.deps ?? defaultEnsureHttpDeps(ctx, args.spawn, { host, port });
  const repair = (): void => {
    say("  Repair: run 'task mempalace:status' to inspect the daemon, then");
    say("          'task mempalace:switch-http' for the machine-wide conversion,");
    say("          and re-run setup afterwards.");
  };

  say("");
  say(`Shared memory daemon (spec 0113 delta-02): defaulting ${cli} to HTTP.`);
  say("  Without it, every session spawns its own memory server and only the");
  say("  first one to write can write — the rest are refused for their whole life.");

  // Tolerant read: a token failure never aborts before the probe, so a serving daemon is still
  // registered against rather than bypassed for stdio.
  let token = tryToken(deps, ctx.io);
  let placeholder = false;
  if (token === "") {
    token = PLACEHOLDER;
    placeholder = true;
    say("  NOTE: no readable bearer token — probing with a placeholder bearer.");
  }

  if (!(await accepts(deps, host, port, token))) {
    say(`  Daemon not accepting on ${host}:${port} — installing and starting it (R18)...`);
    let installed = false;
    try {
      const result = await deps.installDaemon();
      for (const line of result.lines) say(line);
      installed = result.ok;
    } catch {
      installed = false;
    }
    if (!installed) {
      if (tryToken(deps) === "")
        say("  ERROR: the MCP bearer token could not be provisioned (R19).");
      else say("  ERROR: the daemon supervisor refused to install or start (R19).");
      repair();
      return 1;
    }
    token = tryToken(deps, ctx.io);
    if (token === "") {
      say("  ERROR: the installer succeeded but no usable bearer token exists (R19).");
      repair();
      return 1;
    }
    placeholder = false;
    if (!(await accepts(deps, host, port, token))) {
      say("  ERROR: the daemon was installed but still refuses authenticated requests (R19).");
      repair();
      return 1;
    }
  } else if (placeholder) {
    // The probe accepted the placeholder: serving is proven but no credential exists to register.
    say(`  WARNING: the daemon on ${host}:${port} is verified serving but no`);
    say("           readable bearer token exists for this palace, so registration");
    say(`           would point ${cli} at a credential that does not authenticate.`);
    say("           Keeping the existing registration untouched (exit 2).");
    repair();
    return 2;
  }

  if (!tryRegister(deps, cli, token)) {
    say(`  ERROR: registering ${cli} against the verified-serving daemon failed (exit 2).`);
    repair();
    return 2;
  }

  say(`  ${cli} now reaches shared memory through the daemon.`);
  const left = stillLeft(deps, cli);
  if (left.length > 0) {
    say("");
    say(`  NOTE: this run switched ${cli} only. Still on the previous arrangement:`);
    for (const other of left) say(`    - ${other}`);
    say(`  They will contend for the memory lock with ${cli} until they switch too.`);
    say("  Switch the whole machine at once with: task mempalace:switch-http");
  }
  say("");
  say(`  Restart any running ${cli} session to pick this up.`);
  return 0;
}
