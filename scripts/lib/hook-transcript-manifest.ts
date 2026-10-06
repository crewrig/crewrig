// hook-transcript-manifest.ts — render the MemPalace transcript hook's commands
// into a transcript manifest (spec 0247 R20-R22, R27; plan step 14).
//
// The sibling of hook-guard-manifest.ts, whose signatures C2's tests pin. The
// manifest `hooks/<cli>-transcript-hooks.json` carries the transcript commands
// beside the worktree git guard; rendering replaces ONLY the transcript
// commands, built by hook-command.ts, and leaves every other byte as it was:
//   - Claude Code, Gemini CLI, Copilot CLI: the handlers recognised by the
//     MEMPALACE_TRANSCRIPT descriptor, anywhere in the manifest, rendered with
//     their own arguments (the CLI identifier);
//   - Antigravity CLI: the handlers under the named hook
//     `crewrig-mempalace-transcript`, flat or grouped, rendered with
//     `antigravity-cli <event key>` (seat finding v1-F5(a)).
// A refusal (hook-command.ts, or a hook script that does not exist) drops the
// transcript handlers and every group, event and hook name the drop emptied;
// the caller prints the diagnostic, and the merge then leaves installed
// transcript commands as they are.
//
// Standard library only (spec 0240 R16).

import fs from "node:fs";
import path from "node:path";

import { hookCommandLine, physicalPath, type Cli } from "./hook-command.ts";
import { readJsonObject, type JsonObject } from "./hook-config.ts";
import { MEMPALACE_TRANSCRIPT } from "./hook-descriptor.ts";
import { dropHandlers } from "./hook-guard-manifest.ts";
import { parseHandler } from "./hook-recognition.ts";

/** The Antigravity CLI named hook that carries the transcript commands. */
export const TRANSCRIPT_HOOK_NAME = "crewrig-mempalace-transcript";

type Handler = Record<string, unknown>;

interface Located {
  readonly handler: Handler;
  readonly args: readonly string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function collect(node: unknown, found: Handler[] = []): Handler[] {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, found);
  } else if (isRecord(node)) {
    if (typeof node["command"] === "string") found.push(node);
    else for (const value of Object.values(node)) collect(value, found);
  }
  return found;
}

/** The transcript handlers of a manifest (live references) with the arguments each one is rendered with. */
export function transcriptHandlers(manifest: JsonObject, cli: Cli): Located[] {
  if (cli === "antigravity") {
    const named = manifest[TRANSCRIPT_HOOK_NAME];
    if (!isRecord(named)) return [];
    return Object.entries(named).flatMap(([event, entries]) =>
      Array.isArray(entries)
        ? collect(entries).map((handler) => ({ handler, args: ["antigravity-cli", event] }))
        : [],
    );
  }
  return collect(manifest).flatMap((handler) => {
    const parse = parseHandler(handler, MEMPALACE_TRANSCRIPT);
    if (parse === null) return [];
    return [{ handler, args: parse.post.split(/\s+/).filter((word) => word !== "") }];
  });
}

export interface TranscriptRenderResult {
  readonly manifest: JsonObject;
  readonly rendered: number;
  /** The refusal; then no transcript handler is left in `manifest`. */
  readonly refusal: string | null;
}

/** `manifest` with the transcript commands rendered for `scriptPath`; the input is not mutated. */
export function renderTranscriptManifest(
  manifest: JsonObject,
  request: {
    readonly cli: Cli;
    readonly platform: NodeJS.Platform;
    readonly scriptPath: string | null;
  },
): TranscriptRenderResult {
  const copy = structuredClone(manifest);
  const located = transcriptHandlers(copy, request.cli);
  if (located.length === 0) return { manifest: copy, rendered: 0, refusal: null };
  const drop = (refusal: string): TranscriptRenderResult => ({
    manifest: dropHandlers(copy, new Set(located.map((l) => l.handler))),
    rendered: 0,
    refusal,
  });
  if (request.scriptPath === null) return drop("the transcript hook script is missing");
  const commands: string[] = [];
  for (const { args } of located) {
    const built = hookCommandLine({
      cli: request.cli,
      surface: "hooks",
      platform: request.platform,
      scriptPath: request.scriptPath,
      args,
    });
    if (!built.ok) return drop(built.refusal);
    commands.push(built.command);
  }
  located.forEach(({ handler }, i) => {
    handler["command"] = commands[i];
  });
  return { manifest: copy, rendered: located.length, refusal: null };
}

/**
 * `transcript render` over a file: print the manifest, transcript commands
 * rendered, as one line of compact JSON. A refusal prints `  ERROR: <diagnostic>`
 * on `warn`, drops the transcript handlers and still exits 0; a missing or
 * non-object manifest exits 1 with nothing printed.
 */
export function transcriptRenderFile(
  request: {
    readonly repo: string;
    readonly cli: Cli;
    readonly manifest: string;
    readonly platform: NodeJS.Platform;
  },
  out: (line: string) => void,
  warn: (line: string) => void,
): number {
  const manifest = readJsonObject(request.manifest);
  if (manifest === null) {
    warn(`  ERROR: manifest not found at ${request.manifest}.`);
    return 1;
  }
  const script = path.join(request.repo, "hooks", `${MEMPALACE_TRANSCRIPT.basename}.ts`);
  const exists = fs.existsSync(script);
  const result = renderTranscriptManifest(manifest, {
    cli: request.cli,
    platform: request.platform,
    scriptPath: exists ? physicalPath(script) : null,
  });
  if (result.refusal !== null) {
    warn(
      exists
        ? `  ERROR: ${result.refusal}`
        : `  ERROR: transcript hook not found at ${script}; no session-recording command is written.`,
    );
  }
  out(JSON.stringify(result.manifest));
  return 0;
}
