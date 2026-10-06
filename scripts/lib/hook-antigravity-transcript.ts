// hook-antigravity-transcript.ts — the MemPalace transcript hook in an
// Antigravity CLI `hooks.json` (spec 0247 R23(c), R25, R26, R27; plan step 15;
// seat finding v1-F2).
//
// `hooks.json` is a map of named hooks. The framework owns
// `crewrig-mempalace-transcript` (the transcript) and `crewrig-worktree-git-guard`
// (the guard, written by common.sh's shallow merge, never here). This module
// writes only the transcript named hook, and leaves every other named hook,
// key and key order byte-identical.
//
// Enable path (`mergeAntigravityTranscript`), per event of the named hook:
//   - an event whose array holds a `foreign-prefix` transcript command loses
//     only the own transcript commands (`direct`, `legacy-*`); every other
//     element stays byte-identical and nothing is added — whether or not the
//     manifest still registers the event;
//   - every other event takes the rendered manifest's array, or is removed
//     when the manifest no longer registers it, other elements included, as
//     the wholesale replace did before.
// A rendered manifest without the named hook (a refused render, or Node.js
// below the floor: the caller never gets here then) changes nothing.
//
// Rewrite path (`rewriteAntigravityTranscript`): the in-place class rule of
// transcript-hook-rewrite.ts, inside the named hook only.
//
// The `*File` variants back up first and write at 0600 through hook-config.ts,
// write nothing when nothing changed, and refuse a configuration that is not a
// JSON object, leaving it byte-identical (R26).
// Standard library only (spec 0240 R16).

import path from "node:path";

import {
  backupFile,
  NotAJsonObjectError,
  readJsonObject,
  writeJsonConfig,
  type JsonObject,
} from "./hook-config.ts";
import { MEMPALACE_TRANSCRIPT } from "./hook-descriptor.ts";
import { parseHookCommand } from "./hook-recognition.ts";
import type { ReportLine } from "./hook-rewrite.ts";
import { TRANSCRIPT_HOOK_NAME } from "./hook-transcript-manifest.ts";
import { eventRefs, rewriteTranscriptRefs } from "./transcript-hook-rewrite.ts";
import { assignmentNames, classifyHandler, OWN_CLASSES } from "./transcript-recognition.ts";

export interface AntigravityTranscriptResult {
  readonly config: JsonObject;
  readonly lines: readonly ReportLine[];
  readonly changed: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** An event array without its own transcript commands, groups emptied by that removal dropped. */
function withoutOwn(entries: unknown[]): unknown[] {
  const isOwn = (h: unknown): boolean => OWN_CLASSES.includes(classifyHandler(h));
  const kept: unknown[] = [];
  for (const entry of entries) {
    if (isRecord(entry) && Array.isArray(entry["hooks"])) {
      const hooks = entry["hooks"].filter((h) => !isOwn(h));
      if (hooks.length === entry["hooks"].length) kept.push(entry);
      else if (hooks.length > 0) kept.push({ ...entry, hooks });
    } else if (!isOwn(entry)) {
      kept.push(entry);
    }
  }
  return kept;
}

/** The `foreign-prefix` transcript commands of one event array. */
function foreignCommands(entries: unknown[]): string[] {
  return eventRefs(entries, "either")
    .filter((ref) => classifyHandler(ref.handler) === "foreign-prefix")
    .map((ref) => ref.handler["command"] as string);
}

/** Enable path: the named hook merged per event; the input is not mutated. */
export function mergeAntigravityTranscript(
  input: JsonObject,
  rendered: JsonObject,
): AntigravityTranscriptResult {
  const config = structuredClone(input);
  const lines: ReportLine[] = [];
  const target = rendered[TRANSCRIPT_HOOK_NAME];
  if (!isRecord(target)) return { config, lines, changed: false };
  const current = config[TRANSCRIPT_HOOK_NAME];
  const merged: Record<string, unknown> = structuredClone(target);

  if (isRecord(current)) {
    for (const [event, entries] of Object.entries(current)) {
      if (!Array.isArray(entries)) continue;
      const foreign = foreignCommands(entries);
      if (foreign.length === 0) continue;
      merged[event] = withoutOwn(entries);
      for (const command of foreign) {
        const names = assignmentNames(command)
          .map((n) => `${n}=...`)
          .join(", ");
        lines.push({
          kind: "left",
          event: `${TRANSCRIPT_HOOK_NAME}/${event}`,
          path: parseHookCommand(command, MEMPALACE_TRANSCRIPT)?.path ?? "",
          detail: `keeps an environment prefix the framework does not own (${names}); nothing added on this event`,
        });
      }
    }
  }
  const before = JSON.stringify(current);
  config[TRANSCRIPT_HOOK_NAME] = merged;
  return { config, lines, changed: before !== JSON.stringify(merged) };
}

/** Rewrite path: the in-place class rule inside the named hook; the input is not mutated. */
export function rewriteAntigravityTranscript(
  input: JsonObject,
  options: { readonly repo: string; readonly platform: NodeJS.Platform },
): AntigravityTranscriptResult & {
  readonly rewrote: number;
  readonly left: number;
  readonly dropped: number;
} {
  const config = structuredClone(input);
  const lines: ReportLine[] = [];
  let rewrote = 0;
  let left = 0;
  let dropped = 0;
  const named = config[TRANSCRIPT_HOOK_NAME];
  if (isRecord(named)) {
    for (const [event, entries] of Object.entries(named)) {
      if (!Array.isArray(entries)) continue;
      const counts = rewriteTranscriptRefs(
        eventRefs(entries, "either"),
        entries,
        {
          cli: "antigravity",
          event,
          platform: options.platform,
          transcript: { repo: options.repo, claudeEnvEnabled: false },
        },
        lines,
      );
      rewrote += counts.rewrote;
      left += counts.left;
      dropped += counts.dropped;
    }
  }
  const labelled = lines.map((line) => ({
    ...line,
    event: `${TRANSCRIPT_HOOK_NAME}/${line.event}`,
  }));
  return { config, lines: labelled, rewrote, left, dropped, changed: rewrote > 0 || dropped > 0 };
}

type Io = { readonly log: (line: string) => void; readonly warn: (line: string) => void };

function readHooks(file: string, io: Io): JsonObject | null | "refused" {
  try {
    return readJsonObject(file);
  } catch (error) {
    if (error instanceof NotAJsonObjectError) {
      io.warn(`  ERROR: ${file} is not a JSON object; session recording is left as it is.`);
      return "refused";
    }
    throw error;
  }
}

function writeChanged(file: string, result: AntigravityTranscriptResult, io: Io): number {
  for (const line of result.lines) {
    io.log(`  Session recording: ${line.kind} ${line.path} on ${line.event} (${line.detail})`);
  }
  if (!result.changed) {
    io.log(`  Session recording: nothing to change in ${file}; nothing written.`);
    return 0;
  }
  const backup = backupFile(file);
  if (backup.status === "failed") {
    io.warn(`  ERROR: could not back up ${file}; leaving it untouched (backup-first).`);
    return 1;
  }
  if (backup.status === "made")
    io.log(`  Backed up: ${path.basename(file)} -> ${path.basename(backup.path)}`);
  writeJsonConfig(file, result.config);
  io.log(`  Session recording: ${TRANSCRIPT_HOOK_NAME} written to ${file}`);
  return 0;
}

/** `transcript antigravity-merge`: exit 0 done (also nothing to do), 1 refused or failed. */
export function mergeAntigravityTranscriptFile(file: string, manifest: string, io: Io): number {
  const rendered = readJsonObject(manifest);
  if (rendered === null) {
    io.warn(`  ERROR: rendered manifest not found at ${manifest}.`);
    return 1;
  }
  const current = readHooks(file, io);
  if (current === "refused") return 1;
  return writeChanged(file, mergeAntigravityTranscript(current ?? {}, rendered), io);
}

/** `transcript antigravity-rewrite`: exit 0 done (also nothing to do), 1 refused or failed. */
export function rewriteAntigravityTranscriptFile(
  file: string,
  options: { readonly repo: string; readonly platform: NodeJS.Platform },
  io: Io,
): number {
  const current = readHooks(file, io);
  if (current === "refused") return 1;
  if (current === null) {
    io.log(`  Session recording: no ${file}; nothing to rewrite.`);
    return 0;
  }
  return writeChanged(file, rewriteAntigravityTranscript(current, options), io);
}
