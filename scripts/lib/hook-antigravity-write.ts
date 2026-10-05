// hook-antigravity-write.ts — rewrite the worktree git guard's command in an
// Antigravity CLI `hooks.json` (spec 0248 R27, R29, R30; plan step 11).
//
// The operation hook-antigravity.ts lacks: that module keeps (reports) and
// removes, and never writes a command. This one rewrites, in place, every
// registered guard command — the legacy `bash "<abs>/hooks/worktree-git-guard.sh"`,
// the bare `node` form, a stale guarded form — to the command line
// hook-command.ts builds for the Antigravity CLI hooks surface, and leaves
// every other handler, hook name (the `crewrig-mempalace-transcript` one above
// all), key and key order untouched.
//
//   - A handler is the guard's when it parses as the WORKTREE_GIT_GUARD
//     descriptor, or sits under the named hook `crewrig-worktree-git-guard`
//     (and then is reported when it cannot be rewritten).
//   - C1 target-exists rule (spec 0243 R21): a `.sh` is rewritten only when the
//     `.ts` sits next to it, whichever checkout that is.
//   - A refusal of the module is reported with its own diagnostic and the
//     command is left. Nothing is written when nothing changed (R30).
//   - What stays, and why, is also reported through `keepAntigravityHooks`.
//
// The pure function does no I/O beyond existence tests; the `*File` variant
// backs up first and writes at 0600 through hook-config.ts (R23).
// Standard library only (spec 0240 R16).

import fs from "node:fs";
import path from "node:path";

import { hookCommandLine } from "./hook-command.ts";
import {
  backupFile,
  NotAJsonObjectError,
  readJsonObject,
  writeJsonConfig,
  type JsonObject,
} from "./hook-config.ts";
import { WORKTREE_GIT_GUARD } from "./hook-descriptor.ts";
import { keepAntigravityHooks } from "./hook-antigravity.ts";
import { GUARD_HOOK_NAME } from "./hook-guard-manifest.ts";
import { parseHandler } from "./hook-recognition.ts";
import type { ReportLine } from "./hook-rewrite.ts";
import { resolveReal } from "./paths.ts";

export interface AntigravityGuardResult {
  readonly config: JsonObject;
  readonly lines: readonly ReportLine[];
  readonly rewrote: number;
  readonly left: number;
  readonly changed: boolean;
}

export interface AntigravityGuardOptions {
  readonly platform: NodeJS.Platform;
  /** File existence test; default `fs.statSync(p).isFile()`. */
  readonly pathExists?: (p: string) => boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function defaultExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

interface Located {
  readonly hookName: string;
  readonly event: string;
  readonly handler: Record<string, unknown>;
}

/** Every handler of the named-hook map, grouped or flat, in document order. */
function* located(config: JsonObject): Generator<Located> {
  for (const [hookName, events] of Object.entries(config)) {
    if (!isRecord(events)) continue;
    for (const [event, entries] of Object.entries(events)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (isRecord(entry) && Array.isArray(entry["hooks"])) {
          for (const handler of entry["hooks"]) {
            if (isRecord(handler)) yield { hookName, event, handler };
          }
        } else if (isRecord(entry)) {
          yield { hookName, event, handler: entry };
        }
      }
    }
  }
}

/** A path the module can judge: absolute, with nothing a shell would expand. */
function resolvable(p: string): boolean {
  const absolute = path.posix.isAbsolute(p) || path.win32.isAbsolute(p);
  return absolute && !p.includes("$") && !p.includes("`");
}

/** `config` with every registered guard command rewritten; the input is not mutated. */
export function rewriteAntigravityGuard(
  input: JsonObject,
  options: AntigravityGuardOptions,
): AntigravityGuardResult {
  const config = structuredClone(input);
  const exists = options.pathExists ?? defaultExists;
  const lines: ReportLine[] = [];
  let rewrote = 0;
  let left = 0;
  const leave = (at: Located, registered: string, detail: string): void => {
    lines.push({ kind: "left", event: `${at.hookName}/${at.event}`, path: registered, detail });
    left++;
  };

  for (const at of located(config)) {
    const command = at.handler["command"];
    if (typeof command !== "string") continue;
    const parse = parseHandler(at.handler, WORKTREE_GIT_GUARD);
    const label = `${at.hookName}/${at.event}`;
    if (parse === null) {
      // Ours by name, but not a shape this tool can resolve: say so, touch nothing.
      if (at.hookName === GUARD_HOOK_NAME) {
        leave(at, command, "its path cannot be resolved (variable or relative)");
      }
      continue;
    }
    const registered = parse.path;
    if (parse.guarded && options.platform !== "win32") {
      leave(at, registered, "unrecognised shape");
      continue;
    }
    if (!parse.guarded && /^\s*[A-Za-z_][A-Za-z0-9_]*=/.test(parse.pre)) {
      leave(at, registered, "keeps an environment prefix the direct form cannot carry");
      continue;
    }
    if (!resolvable(registered)) {
      leave(at, registered, "its path cannot be resolved (variable or relative)");
      continue;
    }
    const target = parse.ext === "ts" ? registered : `${registered.slice(0, -".sh".length)}.ts`;
    if (!exists(target)) {
      leave(at, registered, "no .ts next to the registered .sh (an older checkout)");
      continue;
    }
    let physical: string;
    try {
      physical = resolveReal(target);
    } catch {
      leave(at, registered, "the .ts path could not be resolved");
      continue;
    }
    const built = hookCommandLine({
      cli: "antigravity",
      surface: "hooks",
      platform: options.platform,
      scriptPath: physical,
      args: [],
    });
    if (!built.ok) {
      leave(at, registered, built.refusal);
      continue;
    }
    if (built.command === command) {
      leave(at, registered, "already the direct form");
      continue;
    }
    at.handler["command"] = built.command;
    lines.push({ kind: "rewrote", event: label, path: registered, detail: `-> ${physical}` });
    rewrote++;
  }

  // Whatever the module still reports as a guard command it did not make current
  // (an unmeasured Windows surface, a stale guarded form) joins the report once.
  const seen = new Set(lines.map((line) => `${line.event}\u0000${line.path}`));
  for (const kept of keepAntigravityHooks(config, {
    descriptor: WORKTREE_GIT_GUARD,
    platform: options.platform,
  })) {
    if (kept.detail === "already the direct form" || seen.has(`${kept.event}\u0000${kept.path}`)) {
      continue;
    }
    lines.push(kept);
    left++;
  }
  return { config, lines, rewrote, left, changed: rewrote > 0 };
}

/**
 * Rewrite over a file: back up first (0600), then write at 0600 (R23). Nothing
 * is written, and no backup made, when nothing changed. Exit status: 0 done
 * (also "nothing to do"), 1 refused or failed.
 */
export function rewriteAntigravityGuardFile(
  file: string,
  options: AntigravityGuardOptions,
  log: (line: string) => void,
  warn: (line: string) => void,
): number {
  let current: JsonObject | null;
  try {
    current = readJsonObject(file);
  } catch (error) {
    if (error instanceof NotAJsonObjectError) {
      warn(`  ERROR: ${file} is not a JSON object; the worktree git guard is left as it is.`);
      return 1;
    }
    throw error;
  }
  if (current === null) {
    log(`  Worktree git guard: no ${file}; nothing to rewrite.`);
    return 0;
  }
  const result = rewriteAntigravityGuard(current, options);
  for (const line of result.lines) {
    log(`  Worktree git guard: ${line.kind} ${line.path} on ${line.event} (${line.detail})`);
  }
  if (!result.changed) {
    log(
      `  Worktree git guard: ${result.left} command(s) left as they are in ${file}; nothing written.`,
    );
    return 0;
  }
  const backup = backupFile(file);
  if (backup.status === "failed") {
    warn(`  ERROR: could not back up ${file}; leaving it untouched (backup-first, R23).`);
    return 1;
  }
  if (backup.status === "made") {
    log(`  Backed up: ${path.basename(file)} -> ${path.basename(backup.path)}`);
  }
  writeJsonConfig(file, result.config);
  log(`  Worktree git guard: rewrote ${result.rewrote}, left ${result.left} in ${file}`);
  return 0;
}
