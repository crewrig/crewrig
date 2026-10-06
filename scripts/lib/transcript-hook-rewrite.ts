// transcript-hook-rewrite.ts — the in-place rewrite of the MemPalace transcript
// commands of one event (spec 0247 R23, R25, R26, delta-01), shared by the
// three JSON-settings CLIs (through hook-rewrite.ts's `transcript` option) and
// by Antigravity CLI (hook-antigravity-transcript.ts).
//
// Setup runs it on every run, before the session-recording question, so only
// commands whose consent is already established move to the direct form:
//   - `direct` is re-pointed to the checkout running setup (R25);
//   - `legacy-enabled` is rewritten (its prefix was the consent);
//   - `legacy-unmarked` is rewritten only on Claude Code, and only when the same
//     settings file holds `env.MEMPALACE_TRANSCRIPT_ENABLED` equal to "1";
//     elsewhere it is left and reported "disabled and not upgraded";
//   - `foreign-prefix` is left byte-identical and reported with the names of
//     its assignments, never their values.
// The target is always `<running checkout>/hooks/mempalace-transcript.ts`
// (descriptor `retarget`), whatever path the command names. One event keeps at
// most one command that this rewrite moved: further movable commands on the
// same event are dropped (R26). Nothing else is touched.
//
// Standard library only (spec 0240 R16).

import fs from "node:fs";
import path from "node:path";

import { hookCommandLine, physicalPath, type Cli } from "./hook-command.ts";
import { MEMPALACE_TRANSCRIPT } from "./hook-descriptor.ts";
import { parseHandler } from "./hook-recognition.ts";
import type { ReportLine, RewriteOptions } from "./hook-rewrite.ts";
import { assignmentNames, classOfParse, type TranscriptClass } from "./transcript-recognition.ts";

export interface TranscriptRewrite {
  /** The checkout running setup: its `hooks/mempalace-transcript.ts` is the target. */
  readonly repo: string;
  /** Claude Code only: the same settings file holds `env.MEMPALACE_TRANSCRIPT_ENABLED` equal to "1". */
  readonly claudeEnvEnabled: boolean;
}

export interface TranscriptRef {
  readonly handler: Record<string, unknown>;
  /** The array holding the handler, and (grouped shape) the group holding that array. */
  readonly holder: unknown[];
  readonly group: Record<string, unknown> | null;
}

export interface TranscriptCounts {
  readonly rewrote: number;
  readonly left: number;
  readonly dropped: number;
}

interface Context {
  readonly cli: Cli;
  readonly event: string;
  readonly platform: NodeJS.Platform;
  readonly transcript: TranscriptRewrite;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Every handler of one event's array, grouped or flat, in document order. */
export function eventRefs(entries: unknown[], grouped: boolean | "either"): TranscriptRef[] {
  const refs: TranscriptRef[] = [];
  for (const entry of entries) {
    if (grouped !== false && isRecord(entry) && Array.isArray(entry["hooks"])) {
      const holder = entry["hooks"];
      for (const handler of holder) {
        if (isRecord(handler)) refs.push({ handler, holder, group: entry });
      }
    } else if (grouped !== true && isRecord(entry)) {
      refs.push({ handler: entry, holder: entries, group: null });
    }
  }
  return refs;
}

function consented(cls: TranscriptClass, ctx: Context): boolean {
  if (cls === "direct" || cls === "legacy-enabled") return true;
  return cls === "legacy-unmarked" && ctx.cli === "claude" && ctx.transcript.claudeEnvEnabled;
}

function unconsentedReason(ctx: Context): string {
  return ctx.cli === "claude"
    ? 'disabled and not upgraded: the settings file does not set env.MEMPALACE_TRANSCRIPT_ENABLED to "1"'
    : "disabled and not upgraded: it carries no MEMPALACE_TRANSCRIPT_ENABLED=1 prefix, and a consent kept in the shell environment cannot be established by setup";
}

/** The direct command line for one event, or the refusal. */
function directCommand(
  ctx: Context,
): { ok: true; command: string; target: string } | { ok: false; reason: string } {
  const script = path.join(ctx.transcript.repo, "hooks", `${MEMPALACE_TRANSCRIPT.basename}.ts`);
  if (!fs.existsSync(script)) return { ok: false, reason: `the hook is not found at ${script}` };
  const target = physicalPath(script);
  const args =
    ctx.cli === "antigravity"
      ? ["antigravity-cli", ctx.event]
      : [MEMPALACE_TRANSCRIPT.cliIds[ctx.cli]];
  const built = hookCommandLine({
    cli: ctx.cli,
    surface: "hooks",
    platform: ctx.platform,
    scriptPath: target,
    args,
  });
  return built.ok
    ? { ok: true, command: built.command, target }
    : { ok: false, reason: built.refusal };
}

/** Rewrite the transcript commands among `refs`; report lines are appended to `lines`. */
export function rewriteTranscriptRefs(
  refs: readonly TranscriptRef[],
  entries: unknown[],
  ctx: Context,
  lines: ReportLine[],
): TranscriptCounts {
  let rewrote = 0;
  let left = 0;
  let dropped = 0;
  const label = ctx.event;
  let kept: string | null = null;
  for (const ref of refs) {
    const parse = parseHandler(ref.handler, MEMPALACE_TRANSCRIPT);
    if (parse === null) continue;
    const cls = classOfParse(parse);
    if (cls === "no") continue;
    const registered = parse.path;
    const leave = (detail: string): void => {
      lines.push({ kind: "left", event: label, path: registered, detail });
      left++;
    };
    if (cls === "foreign-prefix") {
      const names = assignmentNames(ref.handler["command"] as string).map((n) => `${n}=...`);
      leave(`keeps an environment prefix the framework does not own (${names.join(", ")})`);
      continue;
    }
    if (!consented(cls, ctx)) {
      leave(unconsentedReason(ctx));
      continue;
    }
    if (kept !== null) {
      // R26: a second movable command on the event would become a twin.
      ref.holder.splice(ref.holder.indexOf(ref.handler), 1);
      if (ref.group !== null && ref.holder.length === 0)
        entries.splice(entries.indexOf(ref.group), 1);
      lines.push({
        kind: "dropped",
        event: label,
        path: registered,
        detail: `duplicate; kept ${kept}`,
      });
      dropped++;
      continue;
    }
    const built = directCommand(ctx);
    if (!built.ok) {
      // A refused command line moves nothing, so nothing on the event is dropped either.
      leave(built.reason);
      continue;
    }
    kept = registered;
    if (ref.handler["command"] === built.command) {
      leave("already the direct form");
      continue;
    }
    ref.handler["command"] = built.command;
    lines.push({ kind: "rewrote", event: label, path: registered, detail: `-> ${built.target}` });
    rewrote++;
  }
  return { rewrote, left, dropped };
}

/** The `transcript` branch of hook-rewrite.ts's `rewriteConfig`, for one event. */
export function rewriteTranscriptEvent(
  event: string,
  entries: unknown[],
  grouped: boolean,
  options: RewriteOptions,
  platform: NodeJS.Platform,
  lines: ReportLine[],
): TranscriptCounts {
  const transcript = options.transcript;
  if (transcript === undefined) return { rewrote: 0, left: 0, dropped: 0 };
  const refs = eventRefs(entries, grouped);
  return rewriteTranscriptRefs(
    refs,
    entries,
    { cli: options.cli, event, platform, transcript },
    lines,
  );
}
