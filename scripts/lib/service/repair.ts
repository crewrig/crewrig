// repair.ts — repair the residue left by an interrupted MemPalace switch (spec
// 0165; spec 0252 requirement 18; plan v3 PR E). The TypeScript counterpart of
// scripts/repair-mempalace-http.sh, whose verbs, messages and exit statuses it
// keeps: report (exit 1 on residue), --restore-backup, --reset-none, the
// post-repair verification, and 2 for a usage error. The command restores
// recognisability only: it never registers anyone for http and the bearer token
// is never on an argument list (no process is spawned here).
//
// The assistant arrangement, the configuration path and the registration removal
// are those of assistant-arrangement.ts and assistant-config.ts; the backup
// rules are in repair-backup.ts. No `jq` (DEVIATION 31(b), see those files).

import { readFileSync } from "node:fs";
import {
  assistantArrangement,
  assistantConfigPath,
  assistantPresent,
} from "./assistant-arrangement.ts";
import type { Cli } from "./assistant-arrangement.ts";
import { ASSISTANTS, restoreRegistration } from "./assistant-config.ts";
import {
  hasAnyBackup,
  mostRecentUsableBackup,
  parsesAsJson,
  restoreBackup,
} from "./repair-backup.ts";
import type { RepairIo } from "./repair-backup.ts";

export const USAGE: readonly string[] = [
  "Usage: bash scripts/repair-mempalace-http.sh [--restore-backup | --reset-none]",
  "",
  "Repair the residue left by an interrupted MemPalace switch (spec 0165): an",
  "assistant whose configuration does not parse as JSON, or whose mempalace",
  "registration matches neither the http nor the stdio shape.",
  "",
  "With no flag, reports each affected assistant, its configuration path, whether",
  "a timestamped backup exists, and the repair actions available; exits non-zero",
  "when any residue exists.",
  "",
  "  --restore-backup  Restore each affected assistant's most recent backup whose",
  "                    content parses as JSON (mode preserved; 0600 when the",
  "                    restored content carries a bearer token, or when the",
  "                    backup's mode would deny its owner read).",
  "  --reset-none      Remove the mempalace registration from each affected",
  "                    assistant whose configuration parses, producing the",
  "                    recognisable none arrangement.",
  "",
  "The command restores recognisability only — it never registers anyone for http",
  "(that is setup's job) and never places the bearer token in argv.",
];

export interface RepairOptions {
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
  readonly io: RepairIo;
}

/** present assistants map absent→none: a missing config is no registration, not residue (R2). */
function classify(cli: Cli, env: NodeJS.ProcessEnv, home: string): string {
  const state = assistantArrangement(cli, env, home);
  return state === "absent" ? "none" : state;
}

function reportResidue(cli: Cli, home: string, io: RepairIo): void {
  const cfg = assistantConfigPath(cli, home);
  let actions = "";
  io.out(`  ${cli}`);
  io.out(`    config:  ${cfg}`);
  if (hasAnyBackup(cfg)) {
    if (mostRecentUsableBackup(cfg) !== null) {
      io.out("    backup:  yes (most recent parses as JSON)");
      actions = "--restore-backup";
    } else {
      io.out("    backup:  yes, but none parses as JSON");
    }
  } else {
    io.out("    backup:  no");
  }
  if (parsesAsJson(cfg)) {
    actions = actions === "" ? "--reset-none" : `${actions} | --reset-none`;
  } else {
    io.out("    note:    config does not parse — --reset-none unavailable");
  }
  io.out(
    `    actions: ${actions === "" ? "restore the .bak file by hand, then re-run setup" : actions}`,
  );
  io.out("");
}

/** `del(.mcpServers.mempalace)` errors on a document that is not an object or whose mcpServers is neither object nor null. */
function removable(cfg: string): boolean {
  try {
    const doc: unknown = JSON.parse(readFileSync(cfg, "utf8"));
    if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return false;
    const servers = (doc as Record<string, unknown>)["mcpServers"];
    return (
      servers === undefined ||
      servers === null ||
      (typeof servers === "object" && !Array.isArray(servers))
    );
  } catch {
    return false;
  }
}

/** R6: remove the registration of an assistant whose configuration parses. */
function resetNone(cli: Cli, home: string, io: RepairIo): boolean {
  const cfg = assistantConfigPath(cli, home);
  if (!parsesAsJson(cfg)) {
    io.out(`  ${cli}: CONFIG DOES NOT PARSE — run --restore-backup first, or restore`);
    io.out(`        the timestamped .bak file beside ${cfg} by hand.`);
    return false;
  }
  try {
    if (!removable(cfg)) throw new Error("not a configuration object");
    restoreRegistration(cli, home, null);
  } catch {
    io.err(`  ERROR: could not remove the mempalace registration from ${cfg}`);
    return false;
  }
  io.out(`  ${cli}: mempalace registration removed (arrangement: none)`);
  return true;
}

/** R7: re-detect and report every present assistant. Returns 1 when residue remains. */
function verify(present: readonly Cli[], o: RepairOptions): number {
  const residue: Cli[] = [];
  o.io.out("");
  o.io.out("Post-repair verification:");
  for (const cli of present) {
    switch (classify(cli, o.env, o.home)) {
      case "http":
        o.io.out(`  ${cli}: http (shared daemon)`);
        break;
      case "stdio":
        o.io.out(`  ${cli}: stdio (previous arrangement)`);
        break;
      case "none":
        o.io.out(`  ${cli}: none (no mempalace registration)`);
        break;
      case "unknown":
        o.io.out(`  ${cli}: *** UNRECOGNISED — residue remains ***`);
        residue.push(cli);
        break;
    }
  }
  o.io.out("");
  if (residue.length > 0) {
    o.io.out(`Residue remains for: ${residue.join(" ")}`);
    return 1;
  }
  o.io.out("No residue remains — every present assistant is in a recognisable");
  o.io.out("arrangement (http, stdio, or none).");
  return 0;
}

/** Run the repair; returns the exit status (0 clean, 1 residue, 2 usage). */
export function runRepair(o: RepairOptions): number {
  let restore = false;
  let reset = false;
  for (const arg of o.argv) {
    if (arg === "--restore-backup") restore = true;
    else if (arg === "--reset-none") reset = true;
    else if (arg === "-h" || arg === "--help") {
      for (const line of USAGE) o.io.out(line);
      return 0;
    } else {
      o.io.err(`ERROR: unknown option: ${arg}`);
      for (const line of USAGE) o.io.err(line);
      return 2;
    }
  }
  if (restore && reset) {
    o.io.err("ERROR: --restore-backup and --reset-none are mutually exclusive.");
    for (const line of USAGE) o.io.err(line);
    return 2;
  }

  o.io.out("MemPalace switch residue repair (spec 0165)");
  o.io.out("===========================================");
  o.io.out("");
  const present = ASSISTANTS.filter((cli) => assistantPresent(cli, o.env, o.home));
  const residue = present.filter((cli) => classify(cli, o.env, o.home) === "unknown");
  if (present.length === 0) {
    o.io.out("  No supported assistant found on this machine — nothing to repair.");
    return 0;
  }
  if (residue.length === 0) {
    o.io.out("  No residue found — every present assistant is in a recognisable");
    o.io.out("  arrangement (http, stdio, or none). Nothing to repair.");
    return 0;
  }
  o.io.out("Residue found — assistants in neither a recognisable arrangement nor");
  o.io.out("parseable as JSON:");
  o.io.out("");
  for (const cli of residue) reportResidue(cli, o.home, o.io);
  if (!restore && !reset) {
    o.io.out("Run with --restore-backup or --reset-none to repair.");
    return 1;
  }
  if (restore) {
    o.io.out("Restoring the most recent usable backup for each affected assistant:");
    o.io.out("");
    for (const cli of residue) restoreBackup(cli, assistantConfigPath(cli, o.home), o.io);
  } else {
    o.io.out("Removing the mempalace registration from each affected assistant:");
    o.io.out("");
    for (const cli of residue) resetNone(cli, o.home, o.io);
  }
  return verify(present, o);
}
