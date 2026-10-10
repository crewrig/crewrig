// switch-transaction.ts — switch every present assistant to the shared MemPalace
// MCP HTTP daemon, all-or-nothing (spec 0252 requirement 18; spec 0113 R3, R4,
// R11-R15; spec 0176). Ports scripts/switch-mempalace-http.sh and
// `switch_assistants_to_http` / `_switch_rollback` of scripts/lib/common.sh with
// their wording and exit statuses kept.
//
// Order: [rotate: remove the token file, purge `.bak.*`] -> install the daemon and
// its launcher (daemon-install.ts) -> provision the token -> replace the daemon
// process so it honours the current token (daemon-replace.ts) -> floor checks,
// capture and backup of every present assistant -> register each, restoring every
// touched assistant on the first failure -> [rotate: purge the transition
// backups] -> the final status run, whose exit status decides the run. With
// CREWRIG_TEST_MOCK_DAEMON=true the daemon steps and the status run are skipped.

import { existsSync, accessSync, constants, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  assistantArrangement,
  assistantConfigPath,
  assistantPresent,
} from "./assistant-arrangement.ts";
import type { Cli } from "./assistant-arrangement.ts";
import {
  ASSISTANTS,
  backupConfig,
  captureRegistration,
  purgeBackups,
  registerAssistant,
  restoreRegistration,
} from "./assistant-config.ts";
import type { ClaudeRemover, Registration } from "./assistant-config.ts";
import { rollbackSwitch } from "./switch-rollback.ts";
import { selectBackend } from "./backend.ts";
import type { ServiceBackend } from "./backend.ts";
import { installMcpDaemon } from "./daemon-install.ts";
import { replaceDaemonProcess } from "./daemon-replace.ts";
import type { ReplaceOptions } from "./daemon-replace.ts";
import { daemonEndpoint, serviceNames } from "./names.ts";
import { readOrCreateToken, removeTokenFile, tokenFilePath } from "./token.ts";

export interface SwitchIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface SwitchOptions {
  readonly rotate: boolean;
  readonly repoDir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
  readonly platform: string;
  readonly io: SwitchIo;
  /** Test seams; the defaults are the real operations. */
  readonly backend?: ServiceBackend;
  readonly installDaemon?: () => Promise<{ ok: boolean; lines: readonly string[] }>;
  readonly replaceProcess?: (token: string) => Promise<boolean>;
  readonly register?: (cli: Cli, token: string) => void;
  readonly runStatus?: () => number;
  readonly backup?: (file: string) => string | null;
  readonly removeClaude?: ClaudeRemover;
}

export const USAGE = [
  "Usage: switch-mempalace-http.sh [--rotate|-r]",
  "",
  "Switch assistants to the shared MemPalace MCP HTTP daemon.",
  "  --rotate, -r  Rotate the bearer token, replace the daemon process,",
  "                purge stale backup files holding the old token, and",
  "                re-register every assistant with the new token (spec 0176).",
];

export function daemonUrl(env: NodeJS.ProcessEnv): string {
  void env;
  const { host, port } = daemonEndpoint();
  return `http://${host}:${port}/mcp`;
}

/** The transaction of `switch_assistants_to_http`. Returns the exit status. */
export function switchAssistants(token: string, o: SwitchOptions): number {
  const say = o.io.out;
  const present: Cli[] = [];
  let hadHttp = false;
  let hadStdio = false;
  for (const cli of ASSISTANTS) {
    if (!assistantPresent(cli, o.env, o.home)) continue;
    present.push(cli);
    const arrangement = assistantArrangement(cli, o.env, o.home);
    if (arrangement === "http") hadHttp = true;
    if (arrangement === "stdio") hadStdio = true;
    if (arrangement === "unknown") {
      say(`  ERROR: ${cli} is in an unrecognised arrangement.`);
      say("         A repeated run cannot resolve a configuration it cannot");
      say("         recognise. Run 'task mempalace:repair', then re-run. (R14)");
      return 1;
    }
  }
  if (present.length === 0) {
    say("  No supported assistant found on this machine — nothing to switch.");
    return 0;
  }
  if (hadHttp && hadStdio) {
    say("  NOTE: found a partial state — some assistants were already switched");
    say("        and others were not. Converging them now. (R15)");
  }

  // R12 floor: every present assistant's configuration exists, is readable,
  // writable and parses before anything is applied.
  for (const cli of present) {
    const cfg = assistantConfigPath(cli, o.home);
    if (!existsSync(cfg)) {
      say(`  ERROR: ${cli} is installed but has no configuration file yet:`);
      say(`         ${cfg}`);
      say("         Run its own setup script once first. No assistant has been");
      say("         changed. (R12)");
      return 1;
    }
    try {
      accessSync(cfg, constants.R_OK | constants.W_OK);
    } catch {
      say(`  ERROR: ${cli}'s configuration is not both readable and writable:`);
      say(`         ${cfg}`);
      say("         No assistant has been changed. (R12)");
      return 1;
    }
    try {
      JSON.parse(readFileSync(cfg, "utf8"));
    } catch {
      say(`  ERROR: ${cli}'s configuration does not parse: ${cfg}`);
      say("         No assistant has been changed. (R12)");
      return 1;
    }
  }

  const captured = new Map<Cli, Registration>();
  for (const cli of present) {
    captured.set(cli, captureRegistration(cli, o.home));
    const cfg = assistantConfigPath(cli, o.home);
    const bak = (o.backup ?? backupConfig)(cfg);
    if (bak === null) {
      // As the shell's `backup_file`: warn and go on. The rollback restores from the
      // registration captured in memory above, not from this file; only
      // `repair-mempalace-http --restore-backup` would find no backup to use.
      o.io.err(`  WARNING: Failed to back up ${path.basename(cfg)} (could not create a backup)`);
      continue;
    }
    say(`  Backed up: ${path.basename(cfg)} -> ${path.basename(bak)}`);
  }

  const url = daemonUrl(o.env);
  const register =
    o.register ?? ((cli: Cli, t: string) => registerAssistant(cli, o.home, url, t, o.removeClaude));
  const applied: Cli[] = [];
  for (const cli of present) {
    // Recorded BEFORE the attempt: a failed Claude write has already dropped
    // its old entry, so the rollback must cover it too.
    applied.push(cli);
    try {
      register(cli, token);
      say(`  ${cli}: switched to the shared daemon`);
    } catch {
      say(`  ERROR: ${cli} could not be switched.`);
      rollbackSwitch(applied, captured, o.home, o.env, o.io);
      return 1;
    }
  }
  return 0;
}

function purgeAll(o: SwitchOptions, announce: boolean): void {
  for (const cli of ASSISTANTS) {
    for (const bak of purgeBackups(cli, o.home)) {
      if (announce) o.io.out(`  Purged stale backup file: ${bak}`);
    }
  }
}

function defaultStatus(o: SwitchOptions): number {
  const r = spawnSync(process.execPath, [path.join(o.repoDir, "scripts", "status-mcp-server.ts")], {
    stdio: "inherit",
    env: o.env,
  });
  return r.status ?? 1;
}

/** The whole run of `switch-mempalace-http`. Returns the exit status. */
export async function runSwitch(o: SwitchOptions): Promise<number> {
  const say = o.io.out;
  const mock = o.env["CREWRIG_TEST_MOCK_DAEMON"] === "true";
  if (o.rotate) {
    say("Rotating the shared MemPalace daemon bearer token (spec 0176)");
    say("");
    const file = tokenFilePath();
    if (removeTokenFile(file)) say(`  Removed superseded token file: ${file}`);
    purgeAll(o, true);
  } else {
    say("Switching assistants to the shared MemPalace MCP HTTP daemon");
  }
  say("");

  const backend = mock ? undefined : (o.backend ?? (await selectBackend(o.platform)));
  if (!mock && backend !== undefined) {
    const installed = await (
      o.installDaemon ??
      (() =>
        installMcpDaemon({
          repoDir: o.repoDir,
          home: o.home,
          env: o.env,
          platform: o.platform,
          backend,
        }))
    )();
    for (const line of installed.lines) say(line);
    if (!installed.ok) {
      say("");
      say("ERROR: the daemon is not serving — no assistant has been switched.");
      say("       Switching them to a daemon that is not there would break every");
      say("       session (R5: fail visibly, never fall back silently).");
      return 1;
    }
  }

  let token: string;
  try {
    token = readOrCreateToken();
  } catch {
    o.io.err("ERROR: could not read the bearer token.");
    return 1;
  }

  if (!mock && backend !== undefined) {
    say("");
    say("Ensuring the daemon process honours the current token (spec 0139 R2)...");
    const { host, port } = daemonEndpoint();
    const replace =
      o.replaceProcess ??
      ((t: string) => {
        const opts: ReplaceOptions = {
          backend,
          names: serviceNames("mcp", o.env),
          host,
          port,
          token: t,
          env: o.env,
          home: o.home,
          io: o.io,
        };
        return replaceDaemonProcess(opts);
      });
    if (!(await replace(token))) {
      say("");
      say("ERROR: the daemon process could not be replaced — it may still be");
      say("       honouring a superseded token. No assistant has been switched over");
      say("       a stale credential.");
      return 1;
    }
  }

  say("");
  say("Registering assistants...");
  if (switchAssistants(token, o) !== 0) return 1;

  if (o.rotate) {
    purgeAll(o, false);
    say("  Purged transition backup files holding the superseded token.");
  }

  say("");
  say("Done. Every supported assistant on this machine now reaches shared memory");
  say("through the daemon.");
  say("");
  say("IMPORTANT: already-running sessions keep their previous memory server");
  say("           until they restart. Restart them to pick up the change —");
  say("           without that, you will see no difference.");
  say("");
  // The status probe's exit code decides the run: it is the one check able to
  // detect an unauthenticated daemon, so it must be able to fail the transaction.
  if (!mock && (o.runStatus ?? (() => defaultStatus(o)))() !== 0) {
    say("");
    say("ERROR: the daemon is serving, the assistants are registered, but the");
    say("       checks above did not all pass. Read them before using this.");
    say("       If authentication is NOT ENFORCED, treat the token as burned:");
    say("       remove it, run 'task mempalace:uninstall-daemon', and re-run.");
    return 1;
  }
  return 0;
}
