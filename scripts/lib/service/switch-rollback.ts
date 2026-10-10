// switch-rollback.ts — the rollback of the switch transaction (spec 0252
// requirement 18; spec 0113 R13, R14). Ports `_switch_rollback` of
// scripts/lib/common.sh: restore every touched assistant's captured
// registration and, when a restore itself fails, print the manual-repair report
// with the current arrangement of every assistant.

import { assistantArrangement, assistantConfigPath } from "./assistant-arrangement.ts";
import type { Cli } from "./assistant-arrangement.ts";
import { ASSISTANTS, restoreRegistration } from "./assistant-config.ts";
import type { Registration } from "./assistant-config.ts";

interface Io {
  readonly out: (line: string) => void;
}

function reportArrangements(env: NodeJS.ProcessEnv, home: string, io: Io): void {
  for (const cli of ASSISTANTS) {
    const state = assistantArrangement(cli, env, home);
    const label: Record<string, string> = {
      http: "http (shared daemon)",
      stdio: "stdio (previous arrangement)",
      none: "no mempalace registration",
      unknown: "unrecognised arrangement",
      absent: "absent (CLI not installed)",
    };
    io.out(`  ${cli.padEnd(12)} ${label[state] ?? state}`);
  }
}

/** R13, and R14 when a restore itself fails. */
export function rollbackSwitch(
  applied: readonly Cli[],
  captured: Map<Cli, Registration>,
  home: string,
  env: NodeJS.ProcessEnv,
  io: Io,
): void {
  const say = io.out;
  const failed: Cli[] = [];
  say("  Restoring the assistants already changed in this run... (R13)");
  for (const cli of applied) {
    try {
      restoreRegistration(cli, home, captured.get(cli) ?? null);
      say(`    ${cli}: restored`);
    } catch {
      say(`    ${cli}: RESTORE FAILED`);
      failed.push(cli);
    }
  }
  if (failed.length === 0) return;
  say("");
  say("  *** MANUAL REPAIR REQUIRED (R14) ***");
  say("  These assistants could not be returned to their previous arrangement:");
  for (const cli of failed) say(`    - ${cli}  (${assistantConfigPath(cli, home)})`);
  say("  Each config was backed up before the change; run");
  say("  'task mempalace:repair -- --restore-backup' to restore the timestamped");
  say("  .bak file, or re-run setup once the cause is fixed.");
  say("");
  say("  Current state of every assistant:");
  reportArrangements(env, home, io);
}
