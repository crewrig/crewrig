// antigravity-hooks.ts — the Antigravity hook steps of setup-antigravity-interactive.sh (spec 0256
// requirements 29 and 30, plan v2 step B3a.5): the transcript-hook deployment of
// `deploy_antigravity_transcript_hooks` (scripts/lib/common.sh), the per-run rewrites of an
// installed registration, and the paths and Node.js floor the statusline channel
// (antigravity-statusline.ts) shares. Every step runs the TypeScript modules in-process
// (hook-guard-manifest.ts, hook-transcript-manifest.ts, hook-antigravity-transcript.ts,
// hook-antigravity-write.ts); the only child process is the Node.js floor guard, through the
// injected `Spawner`. Messages are the shell's, byte for byte.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeJsonConfig, readJsonObject, type JsonObject } from "../hook-config.ts";
import { GUARD_HOOK_NAME, guardRenderFile } from "../hook-guard-manifest.ts";
import { rewriteAntigravityGuardFile } from "../hook-antigravity-write.ts";
import {
  mergeAntigravityTranscriptFile,
  rewriteAntigravityTranscriptFile,
} from "../hook-antigravity-transcript.ts";
import { TRANSCRIPT_HOOK_NAME, transcriptRenderFile } from "../hook-transcript-manifest.ts";
import { backupFile } from "./backup.ts";
import { reportIfLossy } from "./lossless.ts";
import type { InstallCtx, Spawner } from "./context.ts";
import { warnIfLinkedWorktree } from "./worktree-warning.ts";

export type AgyCtx = Pick<InstallCtx, "io" | "env" | "platform" | "home" | "repoDir">;

export const TRANSCRIPT_CANCELED = "  Transcript activation canceled.";
export const TRANSCRIPT_DISABLED = "  Session recording disabled (re-run this script to enable).";

export interface AgyPaths {
  readonly agyHome: string;
  readonly settings: string;
  /** `~/.gemini/config/hooks.json`, the global customization root the transcript hooks target. */
  readonly hooksJson: string;
  readonly marker: string;
}

/** `AGY_HOME`, `AGY_SETTINGS`, the hooks file and `STATUSLINE_MARKER`, as the script computes them. */
export function agyPaths(ctx: AgyCtx): AgyPaths {
  const agyHome = path.join(ctx.home, ".gemini", "antigravity-cli");
  const root = ctx.env["CREWRIG_USAGE_ROOT"];
  const usageRoot =
    typeof root === "string" && root !== "" ? root : path.join(ctx.home, ".crewrig", "usage");
  return {
    agyHome,
    settings: path.join(agyHome, "settings.json"),
    hooksJson: path.join(ctx.home, ".gemini", "config", "hooks.json"),
    marker: path.join(usageRoot, "state", "antigravity-statusline.json"),
  };
}

const NOT_FOUND = (what: string): string =>
  `  ERROR: crewrig: Node.js was not found on PATH; ${what} requires Node.js >= 24. Install a supported release from https://nodejs.org/en/download`;

/**
 * The floor guard of spec 0240 R1. `what` is `this step` (common.sh `require_node_floor`, which
 * also checks the guard file) or `usage capture` (the script's `agy_statusline_node_floor`).
 */
export function requireNodeFloor(
  ctx: AgyCtx,
  spawn: Spawner,
  what: "this step" | "usage capture",
): boolean {
  const guard = path.join(ctx.repoDir, "scripts", "lib", "node-floor-guard.js");
  if (what === "this step" && !fs.existsSync(guard)) {
    ctx.io.err(`  ERROR: Node.js floor guard not found at ${guard}.`);
    return false;
  }
  const result = spawn(["node", guard]);
  if (result.status === 127) {
    ctx.io.err(NOT_FOUND(what));
    return false;
  }
  if (result.stderr !== "") ctx.io.errRaw(result.stderr);
  return result.status === 0;
}

const isRecord = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Run a `*RenderFile` tool in-process and return the one line of compact JSON it prints. */
function render(
  run: (out: (line: string) => void, warn: (line: string) => void) => number,
  ctx: AgyCtx,
): JsonObject | null {
  let printed = "";
  const status = run((line) => void (printed = line), ctx.io.err);
  if (status !== 0) return null;
  try {
    const value: unknown = JSON.parse(printed);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** `.[0] + .[1]` of `jq -s`: an empty file or a JSON `null` adds nothing; any non-object is refused. */
function readTargetForMerge(file: string): JsonObject | null {
  const text = fs.readFileSync(file, "utf8");
  if (/^[ \t\n\r]*$/.test(text)) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (value === null) return {};
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export interface DeployRequest {
  /** `hooks/antigravity-transcript-hooks.json` of the checkout. */
  readonly manifestSrc: string;
  readonly hooksDir: string;
  readonly manifestTarget: string;
  /** `<repo>/hooks/worktree-git-guard.ts`: the checkout both hooks are wired from sits above it. */
  readonly guardSrc: string;
}

/**
 * `deploy_antigravity_transcript_hooks`: render the guard and shallow-merge it (`+`) into the hooks
 * file, then, only above the floor, render the transcript and merge its named hook per event.
 * `ok` is the shell's return code 0; `wired` is `SR_TRANSCRIPT_WIRED=1`.
 */
export function deployAntigravityTranscriptHooks(
  ctx: AgyCtx,
  spawn: Spawner,
  request: DeployRequest,
): { readonly ok: boolean; readonly wired: boolean } {
  const { manifestSrc, hooksDir, manifestTarget } = request;
  const guardRepo = fs.realpathSync(path.join(path.dirname(request.guardSrc), ".."));
  const refused = { ok: false, wired: false };
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.mkdirSync(path.dirname(manifestTarget), { recursive: true });

  const guardRendered = requireNodeFloor(ctx, spawn, "this step")
    ? render(
        (out, warn) =>
          guardRenderFile(
            { repo: guardRepo, cli: "antigravity", manifest: manifestSrc, platform: ctx.platform },
            out,
            warn,
          ),
        ctx,
      )
    : null;
  let rendered = guardRendered;
  if (rendered === null) {
    ctx.io.err(
      "  Worktree git guard not wired this run; an installed guard command is left as it is.",
    );
    const source = readJsonObject(manifestSrc);
    if (source === null) return refused;
    rendered = Object.fromEntries(
      Object.entries(source).filter(([key]) => key !== GUARD_HOOK_NAME),
    );
  }
  const patched = Object.fromEntries(
    Object.entries(rendered).filter(([key]) => key !== TRANSCRIPT_HOOK_NAME),
  );
  if (fs.existsSync(manifestTarget)) {
    // `if ! deploy_antigravity_transcript_hooks`: the refusal reports and the run goes on, the file untouched.
    if (!reportIfLossy(ctx, manifestTarget)) return refused;
    backupFile(ctx, manifestTarget);
    const current = readTargetForMerge(manifestTarget);
    if (current === null) {
      ctx.io.err(`  ERROR: ${manifestTarget} is not a JSON object; refusing to merge.`);
      ctx.io.err("         Your original file is untouched, and a backup sits beside it.");
      return refused;
    }
    writeJsonConfig(manifestTarget, { ...current, ...patched });
  } else {
    writeJsonConfig(manifestTarget, patched);
  }
  try {
    fs.chmodSync(manifestTarget, 0o600);
  } catch {
    // `chmod 600 ... 2>/dev/null || true`
  }

  const transcript = requireNodeFloor(ctx, spawn, "this step")
    ? render(
        (out, warn) =>
          transcriptRenderFile(
            { repo: guardRepo, cli: "antigravity", manifest: manifestSrc, platform: ctx.platform },
            out,
            warn,
          ),
        ctx,
      )
    : null;
  let wired = false;
  if (transcript !== null && TRANSCRIPT_HOOK_NAME in transcript) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-agy-"));
    try {
      const file = path.join(dir, "transcript.json");
      fs.writeFileSync(file, JSON.stringify(transcript), { mode: 0o600 });
      wired =
        mergeAntigravityTranscriptFile(manifestTarget, file, {
          log: ctx.io.out,
          warn: ctx.io.err,
        }) === 0;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } else {
    ctx.io.err(
      "  Session recording not wired this run; an installed transcript hook is left as it is.",
    );
  }
  ctx.io.out(`  Transcript hooks deployed to ${manifestTarget}`);
  return { ok: true, wired };
}

/** The consent text printed before the `Apply?` question (the script's `echo` block). */
export function transcriptDisclosure(ctx: AgyCtx, hooksJson: string): void {
  const say = ctx.io.out;
  say("");
  say("Activating transcript hooks will:");
  say(`  1. Wire node "${ctx.repoDir}/hooks/mempalace-transcript.ts" antigravity-cli Stop`);
  say("     (in-repo absolute path; Node.js >= 24 is needed when the hook fires)");
  say(`  2. Deploy hooks to ${hooksJson} (fires for ALL projects)`);
  if (fs.existsSync(hooksJson) && fs.statSync(hooksJson).isFile()) {
    say(`  3. Backup ${hooksJson} to ${hooksJson}.bak.<timestamp>, then merge`);
    say("     the crewrig hook in — any hook you already declare is preserved");
  } else {
    say(`  3. Create ${hooksJson} (none exists today)`);
  }
  say("  4. Record ONE entry each time the agent's execution loop ends — in");
  say("     normal use, once per turn. No other event is");
  say("     registered: the CLI's other four all fire once per model call or");
  say("     once per tool step, many times in a single turn, and each hook run");
  say("     blocks the agent loop");
  say(`  Recording depends on this checkout staying at ${ctx.repoDir};`);
  say("  re-running this setup from a checkout repairs it.");
  say("");
}

/** The confirmed branch: deploy, then the outcome line and the linked-worktree warning. */
export function applyTranscriptHooks(ctx: AgyCtx, spawn: Spawner, paths: AgyPaths): boolean {
  const hooks = path.join(ctx.repoDir, "hooks");
  const result = deployAntigravityTranscriptHooks(ctx, spawn, {
    manifestSrc: path.join(hooks, "antigravity-transcript-hooks.json"),
    hooksDir: path.join(paths.agyHome, "hooks"),
    manifestTarget: paths.hooksJson,
    guardSrc: path.join(hooks, "worktree-git-guard.ts"),
  });
  if (!result.ok) {
    ctx.io.err("  Transcript activation FAILED — setup continues without it.");
  } else if (result.wired) {
    ctx.io.out(
      `  Session recording wired to ${ctx.repoDir}/hooks/mempalace-transcript.ts (in-repo absolute path)`,
    );
    warnIfLinkedWorktree(ctx, spawn, "session recording");
  } else {
    ctx.io.out(
      "  Session recording NOT activated this run; an installed transcript hook is left as it is.",
    );
  }
  return result.ok;
}

/**
 * The two per-run rewrites of an installed registration (guard, then transcript) and the notice
 * about the unused shell copy: `guard_rewrite_installed`, `transcript_rewrite_installed`,
 * `report_unused_transcript_copy` for `antigravity`. Neither fails the run.
 */
export function rewriteInstalledAntigravityHooks(
  ctx: AgyCtx,
  spawn: Spawner,
  paths: AgyPaths,
): void {
  const { hooksJson } = paths;
  const text = fs.existsSync(hooksJson) ? fs.readFileSync(hooksJson, "utf8") : "";
  const mentions = (needle: string): boolean => text.includes(needle);
  if (mentions("worktree-git-guard")) {
    if (requireNodeFloor(ctx, spawn, "this step")) {
      rewriteAntigravityGuardFile(hooksJson, { platform: ctx.platform }, ctx.io.out, ctx.io.err);
    } else {
      ctx.io.err("  Installed worktree git guard command left as it is.");
    }
  }
  if (mentions("mempalace-transcript")) {
    if (requireNodeFloor(ctx, spawn, "this step")) {
      const io = { log: ctx.io.out, warn: ctx.io.err };
      rewriteAntigravityTranscriptFile(
        hooksJson,
        { repo: ctx.repoDir, platform: ctx.platform },
        io,
      );
    } else {
      ctx.io.err("  Installed session-recording commands left as they are.");
    }
  }
  const copy = path.join(paths.agyHome, "hooks", "mempalace-transcript.sh");
  if (fs.existsSync(copy) && fs.statSync(copy).isFile()) {
    ctx.io.out(`  No longer used (left on disk): ${copy} — session recording now runs the`);
    ctx.io.out("  hook from this checkout.");
  }
}
