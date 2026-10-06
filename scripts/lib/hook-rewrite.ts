// hook-rewrite.ts — rewrite the registered commands of one hook to the direct
// `node` form, in a parsed CLI configuration (spec 0243 R19, R21, R22, R25).
//
// The mechanism is parameterised by a `HookDescriptor`, so the later hook rows
// register a descriptor and change nothing here. It works on an in-memory
// object and does no I/O beyond existence tests: hook-config.ts owns the
// backup and the write, hook-wiring.ts owns the file names.
//
//   - Shape: claude/gemini are GROUPED (`.hooks[E][] = {selector…, hooks:[h…]}`),
//     copilot is FLAT (`.hooks[E][] = h`).
//   - Only the `command` of a recognised handler changes; event, selector, key
//     order and every other entry are kept exactly as they were.
//   - One command per event (R22, v1-F3): when an event holds several
//     recognised commands — a legacy and a direct twin above all — exactly one
//     survives, chosen by the live-path rule of spec 0211 R11: the first whose
//     path exists, else the first whose path cannot be judged, else the first.
//   - Only where the target exists (R21): a legacy `.sh` is rewritten only
//     when the `.ts` sits next to the registered `.sh`, whichever checkout that
//     is; otherwise the command is left, and the report says why.
//
// Standard library only (spec 0240 R16).

import fs from "node:fs";
import path from "node:path";

import type { HookDescriptor, WiredCli } from "./hook-descriptor.ts";
import { hookCommandLine } from "./hook-command.ts";
import type { JsonObject } from "./hook-config.ts";
import { parseHandler, type HookCommandParse } from "./hook-recognition.ts";
import { resolveReal } from "./paths.ts";
import { rewriteTranscriptEvent, type TranscriptRewrite } from "./transcript-hook-rewrite.ts";

export interface ReportLine {
  readonly kind: "rewrote" | "left" | "dropped";
  readonly event: string;
  /** The registered script path; never the whole command. */
  readonly path: string;
  readonly detail: string;
}

export interface RewriteOptions {
  readonly descriptor: HookDescriptor;
  readonly cli: WiredCli;
  readonly platform?: NodeJS.Platform;
  /** Events on which duplicates collapse to one command. Default: every event. */
  readonly dedupEvents?: readonly string[];
  /** File existence test; default `fs.statSync(p).isFile()`. */
  readonly pathExists?: (p: string) => boolean;
  /**
   * Spec 0247 R23, R25 (delta-01): the in-place rewrite of the MemPalace
   * transcript commands, run before the session-recording question. When
   * present the class rule of transcript-hook-rewrite.ts replaces C1's rules;
   * when absent, every step below runs exactly as before.
   */
  readonly transcript?: TranscriptRewrite;
}

export interface RewriteResult {
  readonly config: JsonObject;
  readonly lines: readonly ReportLine[];
  readonly rewrote: number;
  readonly left: number;
  readonly dropped: number;
  readonly changed: boolean;
}

interface Ref {
  readonly handler: Record<string, unknown>;
  readonly parse: HookCommandParse;
  /** The array holding the handler, and (grouped shape) the group holding that array. */
  readonly holder: unknown[];
  readonly group: Record<string, unknown> | null;
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

/** 0 live, 1 cannot be judged (relative or expandable), 2 vanished. */
function rank(p: string, exists: (p: string) => boolean): 0 | 1 | 2 {
  const absolute = path.posix.isAbsolute(p) || path.win32.isAbsolute(p);
  if (!absolute || p.includes("$") || p.includes("`")) return 1;
  return exists(p) ? 0 : 2;
}

function collect(
  eventEntries: unknown[],
  grouped: boolean,
  options: RewriteOptions,
  exists: (p: string) => boolean,
): Ref[] {
  const refs: Ref[] = [];
  const add = (holder: unknown[], group: Record<string, unknown> | null): void => {
    for (const handler of holder) {
      if (!isRecord(handler)) continue;
      const parse = parseHandler(handler, options.descriptor, { pathExists: exists });
      if (parse !== null) refs.push({ handler, parse, holder, group });
    }
  };
  if (!grouped) {
    add(eventEntries, null);
  } else {
    for (const group of eventEntries) {
      if (isRecord(group) && Array.isArray(group["hooks"])) add(group["hooks"], group);
    }
  }
  return refs;
}

/** Rewrite `input` (left untouched: the result carries a modified deep copy). */
export function rewriteConfig(input: JsonObject, options: RewriteOptions): RewriteResult {
  const config = structuredClone(input);
  const exists = options.pathExists ?? defaultExists;
  const platform = options.platform ?? process.platform;
  const grouped = options.cli !== "copilot";
  const lines: ReportLine[] = [];
  let rewrote = 0;
  let left = 0;
  let dropped = 0;

  const hooks = config["hooks"];
  if (isRecord(hooks)) {
    for (const [event, entries] of Object.entries(hooks)) {
      if (!Array.isArray(entries)) continue;
      if (options.transcript !== undefined) {
        const counts = rewriteTranscriptEvent(event, entries, grouped, options, platform, lines);
        rewrote += counts.rewrote;
        left += counts.left;
        dropped += counts.dropped;
        continue;
      }
      let refs = collect(entries, grouped, options, exists);
      if (
        refs.length > 1 &&
        (options.dedupEvents === undefined || options.dedupEvents.includes(event))
      ) {
        const best = Math.min(...refs.map((r) => rank(r.parse.path, exists)));
        const survivor = refs.find((r) => rank(r.parse.path, exists) === best);
        for (const ref of refs) {
          if (ref === survivor) continue;
          const at = ref.holder.indexOf(ref.handler);
          ref.holder.splice(at, 1);
          if (ref.group !== null && ref.holder.length === 0) {
            entries.splice(entries.indexOf(ref.group), 1);
          }
          dropped++;
          lines.push({
            kind: "dropped",
            event,
            path: ref.parse.path,
            detail: `duplicate; kept ${survivor?.parse.path ?? ""}`,
          });
        }
        refs = survivor === undefined ? [] : [survivor];
      }
      for (const ref of refs) {
        const outcome = rewriteOne(ref, event, options, platform, exists);
        lines.push(outcome.line);
        if (outcome.line.kind === "rewrote") rewrote++;
        else left++;
      }
    }
  }
  return { config, lines, rewrote, left, dropped, changed: rewrote > 0 || dropped > 0 };
}

const LEADING_ASSIGNMENT = /\s*([A-Za-z_][A-Za-z0-9_]*)=\S*\s+/y;

/**
 * Names (never values: they may be credentials) of the `NAME=value` words that
 * precede any `env` or interpreter in a command prefix, and only those: the
 * `env NAME=value …` form is outside the R20 signature and never recognised.
 */
function envPrefixNames(pre: string): string[] {
  const names: string[] = [];
  LEADING_ASSIGNMENT.lastIndex = 0;
  for (let m = LEADING_ASSIGNMENT.exec(pre); m !== null; m = LEADING_ASSIGNMENT.exec(pre)) {
    names.push(m[1] ?? "");
  }
  return names;
}

function rewriteOne(
  ref: Ref,
  event: string,
  options: RewriteOptions,
  platform: NodeJS.Platform,
  exists: (p: string) => boolean,
): { line: ReportLine } {
  const registered = ref.parse.path;
  const left = (detail: string): { line: ReportLine } => ({
    line: { kind: "left", event, path: registered, detail },
  });
  if (ref.parse.ext === "ts") return left("already the direct form");
  // The direct form is `node "<abs>" <args>` and carries no environment: dropping
  // the prefix would silently redirect the records (security review finding 3,
  // spec 0243 delta-01). The command stays recognised for keep/dedup/re-point/remove.
  const envNames = envPrefixNames(ref.parse.pre);
  if (envNames.length > 0) {
    const shown = envNames.map((name) => `${name}=...`).join(", ");
    return left(`keeps an environment prefix (${shown}) the direct form cannot carry`);
  }
  if (rank(registered, exists) === 1)
    return left("its path cannot be resolved (variable or relative)");
  const target = `${registered.slice(0, -".sh".length)}.ts`;
  if (!exists(target)) {
    return left(
      "no .ts next to the registered .sh (an older checkout; it still works through its own shell script)",
    );
  }
  let physical: string;
  try {
    physical = resolveReal(target);
  } catch {
    return left("the .ts path could not be resolved");
  }
  const args = ref.parse.post.split(/\s+/).filter((word) => word !== "");
  const built = hookCommandLine({
    cli: options.cli,
    surface: "hooks",
    platform,
    scriptPath: physical,
    args,
  });
  if (!built.ok) return left(built.refusal);
  ref.handler["command"] = built.command;
  return { line: { kind: "rewrote", event, path: registered, detail: `-> ${physical}` } };
}
