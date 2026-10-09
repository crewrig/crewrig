// config.ts — the repository directory, the command line and the canonical upstream URL
// of the sync (spec 0253 R19). Each function reproduces one line of the shell script it
// replaces, including the quirks of the `grep | sed` pipeline.

import { readFileSync, realpathSync } from "node:fs";
import { dirname } from "node:path";

/**
 * `${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/.." && pwd)"}`: the override when set and
 * non-empty, else the parent of the directory holding the entry, as a physical path.
 */
export function repoDirFrom(env: NodeJS.ProcessEnv, entryFile: string): string {
  const override = env["CREWRIG_REPO_DIR"];
  if (override !== undefined && override !== "") return override;
  return dirname(realpathSync(dirname(entryFile)));
}

export interface ParsedArgs {
  readonly preserveHistory: boolean;
  /** The first argument that is not `--preserve-history`; the caller reports it and exits 1. */
  readonly unknown?: string;
}

/** `--preserve-history` is the sole recognised flag; the first other argument stops the parse. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let preserveHistory = false;
  for (const arg of argv) {
    if (arg === "--preserve-history") {
      preserveHistory = true;
    } else {
      return { preserveHistory, unknown: arg };
    }
  }
  return { preserveHistory };
}

// `sed 's/.*= *"\(.*\)".*/\1/'`: greedy, whole-line; `s` so that a trailing CR is matched by `.`.
const QUOTED_VALUE = /^.*= *"(.*)".*$/s;

/**
 * The shell's `grep '^canonical_repo' | sed` capture of the quoted value: every
 * line starting with `canonical_repo` is rewritten to its quoted value (kept unchanged when
 * it has none), the lines are joined by newlines and trailing newlines are dropped. A
 * missing or unreadable file yields the empty string.
 */
export function readCanonicalRepo(configPath: string): string {
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch {
    return "";
  }
  const values: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("canonical_repo")) continue;
    const match = QUOTED_VALUE.exec(line);
    values.push(match?.[1] ?? line);
  }
  return values.join("\n").replace(/\n+$/, "");
}
