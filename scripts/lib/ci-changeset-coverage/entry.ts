// entry.ts — ci-changeset-coverage: exhaustive run of every changeset-gated command (spec 0147
// delta-01 R21; spec 0262 req 11). Twin of scripts/ci-changeset-coverage.sh.
//
// Usage: runCoverage(entry, env). Exit codes: 0 every command passed, 1 a command failed (the
// rest still run), 2 yq or the reference is missing.
// Finding-line format: `ci-changeset-coverage: running [<id>] <cmd>` (stdout),
// `ci-changeset-coverage: FAILED [<id>] <cmd>` (stderr).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { atLine, bashPath, NO_BASH, shellName } from "../ci-cache-guard/shell.ts";
import { fatal, ok } from "../governance/report.ts";
import { gatedPlan, runList } from "./reference.ts";

/** Line of ci-changeset-coverage.sh where the shell evaluates each command. */
const EVAL_LINE = 62;

/** `command -v yq`: kept so a missing yq exits 2 as the shell does; yq itself is never spawned. */
function yqOnPath(env: NodeJS.ProcessEnv): boolean {
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of (env["PATH"] ?? "").split(path.delimiter)) {
    for (const ext of exts) {
      try {
        const p = path.join(dir === "" ? "." : dir, `yq${ext}`);
        if (fs.statSync(p).isFile()) {
          fs.accessSync(p, fs.constants.X_OK);
          return true;
        }
      } catch {
        // not here
      }
    }
  }
  return false;
}

export function runCoverage(entry: string, env: NodeJS.ProcessEnv): number {
  if (!yqOnPath(env)) {
    fatal("Error: yq is required. Install with: brew install yq");
    return 2;
  }
  const self = shellName(entry);
  const repoDir = env["REPO_DIR"] || path.resolve(path.dirname(entry), "..");
  const reference = path.join(repoDir, "ci", "ci-capabilities.yml");
  if (fs.statSync(reference, { throwIfNoEntry: false })?.isFile() !== true) {
    fatal(`Error: CI reference not found: ${reference}`);
    return 2;
  }
  let list: { id: string; command: string }[];
  try {
    list = runList(gatedPlan(fs.readFileSync(reference, "utf8")));
  } catch (e) {
    // Spec 0262 delta-02 (g): the shell exits 0 with accidental output on an unreadable reference.
    const msg = e instanceof Error ? e.message : String(e);
    fatal(`Error: ${reference}: ${msg.split("\n")[0]}`);
    return 1;
  }
  const bash = list.length > 0 ? bashPath(env) : "bash";
  if (bash === null) {
    fatal(NO_BASH);
    return 1;
  }
  let failures = 0;
  for (const { id, command } of list) {
    ok(`ci-changeset-coverage: running [${id}] ${command}`);
    let failed: boolean;
    if (fs.statSync(repoDir, { throwIfNoEntry: false })?.isDirectory() !== true) {
      fatal(`${self}: line ${EVAL_LINE}: cd: ${repoDir}: No such file or directory`);
      failed = true;
    } else {
      // `set -uo pipefail` only: the shell runs the eval inside `if !`, where errexit is off.
      const body = atLine(EVAL_LINE - 1, 'set -uo pipefail\neval "$1"');
      const r = spawnSync(bash, ["-c", body, self, command], {
        cwd: repoDir,
        stdio: ["ignore", "inherit", "inherit"],
      });
      failed = r.error !== undefined || r.status !== 0;
    }
    if (failed) {
      fatal(`ci-changeset-coverage: FAILED [${id}] ${command}`);
      failures++;
    }
  }
  if (failures > 0) {
    fatal(`ci-changeset-coverage: ${failures} command(s) failed in the exhaustive run.`);
    return 1;
  }
  ok("ci-changeset-coverage: exhaustive run passed.");
  return 0;
}
