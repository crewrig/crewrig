// hook-guard-manifest.ts — render the worktree git guard's command into a
// transcript manifest (spec 0248 R28, R29, R32; plan step 11).
//
// `hooks/<cli>-transcript-hooks.json` carries the guard beside the
// `mempalace-transcript` entries of row C3. Rendering replaces ONLY the guard's
// command, built by hook-command.ts, and leaves every other byte of the
// manifest as it was.
//
//   - Claude Code, Gemini CLI, Copilot CLI: the guard handlers are the ones
//     recognised by the WORKTREE_GIT_GUARD descriptor, anywhere in the manifest.
//   - Antigravity CLI (v1-F1): the manifest holds the RELATIVE
//     `hooks/worktree-git-guard.<ext>`, which recognition cannot find (it needs
//     a character run and a `/` before `hooks/`), so the handlers are selected
//     by the named-hook key `crewrig-worktree-git-guard`, as setup always did.
//   - A refusal (hook-command.ts, or a guard script that does not exist) drops
//     the guard's handlers, and then every group, event and hook name the drop
//     emptied, from the rendered manifest. The caller prints the diagnostic.
//
// The functions are pure; hook-wiring.ts owns the file and the streams.
// Standard library only (spec 0240 R16).

import fs from "node:fs";
import path from "node:path";

import { hookCommandLine, physicalPath, type Cli } from "./hook-command.ts";
import { readJsonObject, type JsonObject } from "./hook-config.ts";
import { WORKTREE_GIT_GUARD } from "./hook-descriptor.ts";
import { parseHandler } from "./hook-recognition.ts";

/** The Antigravity CLI named hook that carries the guard. */
export const GUARD_HOOK_NAME = "crewrig-worktree-git-guard";

export interface GuardRenderRequest {
  readonly cli: Cli;
  readonly platform: NodeJS.Platform;
  /** Physical absolute path of `hooks/worktree-git-guard.ts`. */
  readonly scriptPath: string;
}

export interface GuardRenderResult {
  readonly manifest: JsonObject;
  /** Guard commands replaced. */
  readonly rendered: number;
  /** The module's refusal; then the guard is absent from `manifest`. */
  readonly refusal: string | null;
}

type Handler = Record<string, unknown>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isHandler = (v: unknown): v is Handler => isRecord(v) && typeof v["command"] === "string";

function collect(node: unknown, found: Handler[] = []): Handler[] {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, found);
  } else if (isHandler(node)) {
    found.push(node);
  } else if (isRecord(node)) {
    for (const value of Object.values(node)) collect(value, found);
  }
  return found;
}

/** The guard's handlers in `manifest` (a live reference into it). */
export function guardHandlers(manifest: JsonObject, cli: Cli): Handler[] {
  if (cli === "antigravity") return collect(manifest[GUARD_HOOK_NAME]);
  return collect(manifest).filter((h) => parseHandler(h, WORKTREE_GIT_GUARD) !== null);
}

const GONE = Symbol("gone");

/**
 * `node` without the handlers in `drop`, and without every group, event and
 * name that the deletion emptied; anything else, including an array that was
 * already empty, stays as it was.
 */
function prune(node: unknown, drop: ReadonlySet<Handler>): unknown {
  if (Array.isArray(node)) {
    const kept = node.map((item) => prune(item, drop)).filter((item) => item !== GONE);
    return kept.length === 0 && node.length > 0 ? GONE : kept;
  }
  if (isHandler(node)) return drop.has(node) ? GONE : node;
  if (!isRecord(node)) return node;
  const out: Record<string, unknown> = {};
  let removed = false;
  let changed = false;
  for (const [key, value] of Object.entries(node)) {
    const kept = prune(value, drop);
    if (kept === GONE) removed = true;
    else out[key] = kept;
    if (kept !== value) changed = true;
  }
  if (!changed) return node;
  // A group (`{ matcher, hooks: [...] }`) is nothing without its handlers.
  if (removed && Array.isArray(node["hooks"]) && !Array.isArray(out["hooks"])) return GONE;
  return removed && Object.keys(out).length === 0 ? GONE : out;
}

/** `manifest` with the guard's command rendered; the input is not mutated. */
export function renderGuardManifest(
  manifest: JsonObject,
  request: GuardRenderRequest,
): GuardRenderResult {
  const copy = structuredClone(manifest);
  const guards = guardHandlers(copy, request.cli);
  if (guards.length === 0) return { manifest: copy, rendered: 0, refusal: null };
  const built = hookCommandLine({
    cli: request.cli,
    surface: "hooks",
    platform: request.platform,
    scriptPath: request.scriptPath,
    args: [],
  });
  if (!built.ok) {
    const pruned = prune(copy, new Set(guards));
    return {
      manifest: pruned === GONE ? {} : (pruned as JsonObject),
      rendered: 0,
      refusal: built.refusal,
    };
  }
  for (const guard of guards) guard["command"] = built.command;
  return { manifest: copy, rendered: guards.length, refusal: null };
}

/** The same drop, for a script that does not exist (never a command line). */
export function dropGuard(manifest: JsonObject, cli: Cli): JsonObject {
  const copy = structuredClone(manifest);
  const pruned = prune(copy, new Set(guardHandlers(copy, cli)));
  return pruned === GONE ? {} : (pruned as JsonObject);
}

export interface GuardRenderFile {
  /** Checkout whose `hooks/worktree-git-guard.ts` the command points at. */
  readonly repo: string;
  readonly cli: Cli;
  readonly manifest: string;
  readonly platform: NodeJS.Platform;
}

/**
 * `guard render` over a file: print the manifest, guard rendered, as one line
 * of compact JSON. A refusal prints its diagnostic on `warn`, drops the guard
 * and still exits 0, so an already-registered guard is never touched by it; a
 * missing or non-object manifest exits 1 with nothing printed.
 */
export function guardRenderFile(
  request: GuardRenderFile,
  out: (line: string) => void,
  warn: (line: string) => void,
): number {
  const manifest = readJsonObject(request.manifest);
  if (manifest === null) {
    warn(`  ERROR: manifest not found at ${request.manifest}.`);
    return 1;
  }
  const script = path.join(request.repo, "hooks", `${WORKTREE_GIT_GUARD.basename}.ts`);
  if (!fs.existsSync(script)) {
    warn(`  ERROR: guard script not found at ${script}; no guard command is written.`);
    out(JSON.stringify(dropGuard(manifest, request.cli)));
    return 0;
  }
  const result = renderGuardManifest(manifest, {
    cli: request.cli,
    platform: request.platform,
    scriptPath: physicalPath(script),
  });
  if (result.refusal !== null) warn(`  ERROR: ${result.refusal}`);
  out(JSON.stringify(result.manifest));
  return 0;
}
