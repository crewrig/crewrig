// session-recording.ts — the session-recording opt-in of the three hook-file setups (spec 0256
// requirements 30 and 31; plan v2 step B3a.4): `render_session_recording_manifest` and
// `merge_session_recording_hooks` of scripts/lib/usage-capture-optin.sh, with the jq definitions
// (`sr_merge`, `sr_report`, `uc_strip_by`, `uc_add`, `uc_reinject`) as pure functions over JSON.
// The render yields the manifest as a value plus `transcriptWired` (the shell's
// SR_TRANSCRIPT_WIRED); the merge returns `allHooksDisabled` (SR_ALL_HOOKS_DISABLED). A registered
// usage-capture command is carried through the merge unchanged (spec 0211 R8). Layer 2.

import fs from "node:fs";
import path from "node:path";

import { physicalPath } from "../hook-command.ts";
import {
  NotAJsonObjectError,
  readJsonObject,
  writeJsonConfig,
  type JsonObject,
} from "../hook-config.ts";
import { MEMPALACE_TRANSCRIPT, type WiredCli } from "../hook-descriptor.ts";
import { guardRenderFile } from "../hook-guard-manifest.ts";
import { renderTranscriptManifest } from "../hook-transcript-manifest.ts";
import { backupFile } from "./backup.ts";
import type { Spawner } from "./context.ts";
import { requireNodeFloor, type HooksCtx } from "./hooks-rewrite.ts";
import {
  add,
  allHandlers,
  flatOf,
  isCapture,
  isGuard,
  isObj,
  isTranscript,
  isTranscriptAny,
  srMerge,
  srReport,
  stripBy,
  type Json,
} from "./session-recording-merge.ts";
import { createSpawner } from "./spawner.ts";

/** The Claude Code env patch: consent only when the transcript was wired; `text` is what the setup prints. */
export function claudeEnvPatch(wired: boolean, pythonBin: string): { patch: Json; text: string } {
  if (!wired) return { patch: {}, text: "{}" };
  if (pythonBin === "") {
    return {
      patch: { MEMPALACE_TRANSCRIPT_ENABLED: "1" },
      text: '{"MEMPALACE_TRANSCRIPT_ENABLED": "1"}',
    };
  }
  const patch = { MEMPALACE_TRANSCRIPT_ENABLED: "1", MEMPALACE_PYTHON: pythonBin };
  return { patch, text: JSON.stringify(patch) };
}

export interface RenderOptions {
  readonly ctx: HooksCtx;
  readonly cli: WiredCli;
  readonly manifestSrc: string;
  /** The checkout whose hooks the commands name; default `ctx.repoDir`. */
  readonly repoDir?: string;
  readonly spawn?: Spawner;
  readonly floorGuard?: string;
}

export interface RenderedManifest {
  readonly manifest: JsonObject;
  /** The shell's SR_TRANSCRIPT_WIRED: the manifest carries a rendered transcript command. */
  readonly transcriptWired: boolean;
  /** The manifest names the guard (`grep -qF worktree-git-guard`). */
  readonly guardWired: boolean;
}

/** Guard render then transcript render (`guard_render_manifest`, `transcript_render_manifest`); `null` when the manifest is no JSON object. */
export function renderSessionRecordingManifest(o: RenderOptions): RenderedManifest | null {
  const { ctx, cli } = o;
  const flat = flatOf(cli);
  const repo = o.repoDir ?? ctx.repoDir;
  let rendered: JsonObject | null = null;
  try {
    if (requireNodeFloor(ctx, o.spawn ?? createSpawner(ctx), o.floorGuard)) {
      let line = "";
      const request = { repo, cli, manifest: o.manifestSrc, platform: ctx.platform };
      const status = guardRenderFile(request, (l) => void (line = l), ctx.io.err);
      const guarded = status === 0 ? (JSON.parse(line) as JsonObject) : null;
      rendered = guarded === null ? null : renderTranscript(ctx, repo, cli, guarded);
    }
  } catch (error) {
    ctx.io.err(`  ERROR: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (rendered !== null) {
    const wired = allHandlers(rendered, flat).some((x) => isTranscript(x.handler));
    return {
      manifest: rendered,
      transcriptWired: wired,
      guardWired: JSON.stringify(rendered).includes("worktree-git-guard"),
    };
  }
  ctx.io.err(
    "  Worktree git guard and session recording not wired this run; installed commands are left as they are.",
  );
  let source: JsonObject | null;
  try {
    source = readJsonObject(o.manifestSrc);
  } catch (error) {
    if (!(error instanceof NotAJsonObjectError)) throw error;
    source = null;
  }
  if (source === null) return null;
  const manifest = stripBy(source, flat, (h) => isGuard(h) || isTranscriptAny(h));
  return { manifest, transcriptWired: false, guardWired: false };
}

/** The transcript half of the render (`transcriptRenderFile` over an in-memory manifest). */
function renderTranscript(
  ctx: HooksCtx,
  repo: string,
  cli: WiredCli,
  manifest: JsonObject,
): JsonObject {
  const script = path.join(repo, "hooks", `${MEMPALACE_TRANSCRIPT.basename}.ts`);
  const exists = fs.existsSync(script);
  const result = renderTranscriptManifest(manifest, {
    cli,
    platform: ctx.platform,
    scriptPath: exists ? physicalPath(script) : null,
  });
  if (result.refusal !== null) {
    ctx.io.err(
      exists
        ? `  ERROR: ${result.refusal}`
        : `  ERROR: transcript hook not found at ${script}; no session-recording command is written.`,
    );
  }
  return result.manifest;
}

export interface MergeOptions {
  readonly ctx: Pick<HooksCtx, "io">;
  readonly cli: WiredCli;
  readonly config: string;
  /** The rendered manifest of {@link renderSessionRecordingManifest}. */
  readonly patched: unknown;
  /** Claude Code only: keys merged into `env` (see {@link claudeEnvPatch}). */
  readonly envPatch?: Json;
  /** Names the manifest in the shell's diagnostic (its temporary file there). */
  readonly patchedLabel?: string;
}

export interface MergeResult {
  readonly ok: boolean;
  /** The shell's SR_ALL_HOOKS_DISABLED: a kept `"disableAllHooks": true` (Copilot CLI only). */
  readonly allHooksDisabled: boolean;
}

/** `merge_session_recording_hooks`: report, back up (when the file exists), merge, write at 0600. */
export function mergeSessionRecordingHooks(o: MergeOptions): MergeResult {
  const { cli, config, patched } = o;
  const { out, err } = o.ctx.io;
  const flat = flatOf(cli);
  const fail = (message: string): MergeResult => {
    err(message);
    return { ok: false, allHooksDisabled: false };
  };
  let current: JsonObject | null;
  try {
    current = readJsonObject(config);
  } catch (error) {
    if (!(error instanceof NotAJsonObjectError)) throw error;
    err(`  ERROR: ${config} is not readable as a JSON object.`);
    return fail(`  ERROR: ${config} is not readable as JSON; session-recording hooks not merged.`);
  }
  if (!isObj(patched)) {
    return fail(
      `  ERROR: patched hook manifest ${o.patchedLabel ?? "(rendered)"} is not a JSON object.`,
    );
  }
  const patch = o.envPatch ?? {};
  if (!isObj(patch)) return fail(`  ERROR: invalid environment patch for ${config}.`);
  const footprint = allHandlers(current ?? {}, flat).filter((x) => isCapture(x.handler));
  const created = current === null;
  if (current !== null) {
    for (const line of srReport(current, patched, flat)) out(line);
    backupFile(o.ctx, config);
  } else {
    try {
      fs.mkdirSync(path.dirname(config), { recursive: true });
      fs.writeFileSync(config, "{}\n", { mode: 0o600 });
      fs.chmodSync(config, 0o600);
    } catch {
      return fail(`  ERROR: could not create ${config}.`);
    }
  }
  let merged: Json;
  try {
    const base = current ?? {};
    let doc = srMerge(base, patched, flat);
    if (flat) {
      const rest = Object.entries(patched).filter(([key]) => key !== "hooks");
      if (Object.keys(base).length === 0) doc = { ...Object.fromEntries(rest), ...doc };
      else for (const [key, value] of rest) if (!Object.hasOwn(doc, key)) doc[key] = value;
    }
    if (cli === "claude" && Object.keys(patch).length > 0) {
      const env = doc["env"] ?? {};
      if (!isObj(env)) throw new Error("env is not an object");
      doc["env"] = { ...env, ...patch };
    }
    merged = stripBy(doc, flat, isCapture);
    for (const x of footprint) add(merged, x, flat);
    writeJsonConfig(config, merged);
  } catch {
    if (created) fs.rmSync(config, { force: true });
    return fail(`  ERROR: could not write ${config}.`);
  }
  const disabled = cli === "copilot" && merged["disableAllHooks"] === true;
  if (disabled) {
    err(`  WARNING: ${config} keeps "disableAllHooks": true — no hook in that file fires,`);
    err("           session recording included, until you set it to false.");
  }
  return { ok: true, allHooksDisabled: disabled };
}
