// usage-capture-fragment.ts — the floor guard, the capture script path and the rendered fragment of
// the usage-capture opt-in (spec 0256 requirement 30, plan v2 step B3a.2b): `usage_capture_require_node_floor`,
// `usage_capture_abs` and `usage_capture_fragment` of scripts/lib/usage-capture-optin.sh, with the
// render of `hook-wiring.ts render`. Messages are the shell's, byte for byte. Layer 2.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hookCommandLine, physicalPath } from "../hook-command.ts";
import { readJsonObject, type JsonObject } from "../hook-config.ts";
import { USAGE_CAPTURE, type WiredCli } from "../hook-descriptor.ts";
import { parseHandler } from "../hook-recognition.ts";
import type { Spawner } from "./context.ts";
import type { HooksCtx } from "./hooks-rewrite.ts";
import { isCapture, isObj, type Json } from "./session-recording-merge.ts";
import { createSpawner } from "./spawner.ts";
import { captureShape, isUnsafePath, unknownCliMessage } from "./usage-capture-state.ts";

/** What the usage-capture steps read from the setup context (a `SetupCtx` satisfies it). */
export type UcCtx = HooksCtx;

/** Machine seams, for tests: the process starter and the floor guard script. */
export interface UcDeps {
  readonly spawn?: Spawner;
  readonly floorGuard?: string;
}

/** The floor guard of the checkout this module sits in (the shell's `_UC_LIB_ROOT`). */
const FLOOR_GUARD = fileURLToPath(new URL("../node-floor-guard.js", import.meta.url));
const DOWNLOAD = "Install a supported release from https://nodejs.org/en/download";

export const isRegularFile = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** `usage_capture_require_node_floor`: the guard's diagnostic (or the shell's own line) and `false` below the floor. */
export function usageCaptureRequireNodeFloor(ctx: UcCtx, deps: UcDeps = {}): boolean {
  const guard = deps.floorGuard ?? FLOOR_GUARD;
  const spawn = deps.spawn ?? createSpawner(ctx);
  const noNode = `  ERROR: crewrig: Node.js was not found on PATH; usage capture requires Node.js >= 24. ${DOWNLOAD}`;
  if (!fs.existsSync(guard)) {
    const probe = spawn(["node", "--version"]);
    ctx.io.err(
      probe.status === 127 ? noNode : `  ERROR: Node.js floor guard not found at ${guard}.`,
    );
    return false;
  }
  const res = spawn(["node", guard]);
  if (res.status === 127) {
    ctx.io.err(noNode);
    return false;
  }
  if (res.status !== 0) {
    ctx.io.errRaw(res.stderr);
    return false;
  }
  return true;
}

const unsafeMessage = (dir: string): string =>
  `  ERROR: the checkout path ${dir} contains a character (" $ \` \\ or a newline) that cannot be wired safely into a hook command; move the checkout to a path without it.`;

/**
 * The path as a hook command line carries it: on win32 the physical path is written with forward slashes,
 * as `hookCommandLine` does (scripts/lib/hook-command.ts), so the backslashes of a Windows path are not
 * the unsafe character the shell rejected (deviation (t) of spec 0256 delta-03).
 */
export const wirePath = (platform: NodeJS.Platform, p: string): string =>
  platform === "win32" ? p.replaceAll("\\", "/") : p;

/** `usage_capture_abs`: the physical absolute path of the capture script, or `null` after the shell's diagnostic. */
export function usageCaptureAbs(
  ctx: UcCtx,
  repoDir: string,
  ext: "sh" | "ts" = "ts",
): string | null {
  const src = `${repoDir}/hooks/usage-capture.${ext}`;
  if (isUnsafePath(wirePath(ctx.platform, repoDir))) {
    ctx.io.err(unsafeMessage(repoDir));
    return null;
  }
  if (!isRegularFile(src)) {
    ctx.io.err(`  ERROR: capture script not found at ${src}.`);
    return null;
  }
  const dir = fs.realpathSync.native(path.dirname(src));
  const abs = wirePath(ctx.platform, path.join(dir, path.basename(src)));
  if (isUnsafePath(abs)) {
    ctx.io.err(unsafeMessage(dir));
    return null;
  }
  return abs;
}

/** Every object of `node` whose `type` is `command` (jq's `.. | objects | select(.type? == "command")`). */
function commandObjects(node: unknown, found: Json[] = []): Json[] {
  if (Array.isArray(node)) for (const item of node) commandObjects(item, found);
  else if (isObj(node)) {
    if (node["type"] === "command") found.push(node);
    for (const value of Object.values(node)) commandObjects(value, found);
  }
  return found;
}

/** `hook-wiring.ts render`: each command of the fragment replaced by the module-built direct command line. */
function renderFragment(ctx: UcCtx, cli: WiredCli, repoDir: string): JsonObject | null {
  const fragment = readJsonObject(`${repoDir}/hooks/${cli}-usage-capture-hooks.json`);
  if (fragment === null) throw new Error(`capture fragment not found at ${repoDir}.`);
  const script = path.join(repoDir, "hooks", "usage-capture.ts");
  if (!fs.existsSync(script)) {
    ctx.io.err(`  ERROR: capture script not found at ${script}.`);
    return null;
  }
  const physical = physicalPath(script);
  for (const handler of commandObjects(fragment)) {
    if (typeof handler["command"] !== "string") continue;
    const parse = parseHandler(handler, USAGE_CAPTURE);
    if (parse === null) {
      ctx.io.err(
        `  ERROR: the ${cli} capture fragment holds a command that does not match the capture signature.`,
      );
      return null;
    }
    const args = parse.post.split(/\s+/).filter((word) => word !== "");
    const built = hookCommandLine({
      cli,
      surface: "hooks",
      platform: ctx.platform,
      scriptPath: physical,
      args,
    });
    if (!built.ok) {
      ctx.io.err(`  ERROR: ${built.refusal}`);
      return null;
    }
    handler["command"] = built.command;
  }
  return fragment;
}

/**
 * `usage_capture_fragment`: the CLI's capture fragment with every command built for the checkout
 * `repoDir`, round-trip checked against the recognizer; `null` after the shell's diagnostic when the
 * floor is not met, the fragment is missing or unparsable, or a command is refused.
 */
export function usageCaptureFragment(
  ctx: UcCtx,
  cli: string,
  repoDir: string,
  deps: UcDeps = {},
): JsonObject | null {
  const { err } = ctx.io;
  if (captureShape(cli) === undefined) {
    err(unknownCliMessage(cli));
    return null;
  }
  const fragSrc = `${repoDir}/hooks/${cli}-usage-capture-hooks.json`;
  if (!isRegularFile(fragSrc)) {
    err(`  ERROR: capture fragment not found at ${fragSrc}.`);
    return null;
  }
  if (!usageCaptureRequireNodeFloor(ctx, deps)) return null;
  if (usageCaptureAbs(ctx, repoDir, "ts") === null) return null;
  let rendered: JsonObject | null = null;
  try {
    rendered = renderFragment(ctx, cli as WiredCli, repoDir);
  } catch (error) {
    err(`  ERROR: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (rendered === null) {
    err(`  ERROR: could not render the ${cli} capture fragment ${fragSrc}.`);
    return null;
  }
  if (JSON.stringify(rendered).includes("_PROJECT_DIR")) {
    err(`  ERROR: unresolved project-dir token in the ${cli} capture fragment.`);
    return null;
  }
  const commands = commandObjects(rendered);
  if (commands.length === 0 || !commands.every((h) => isCapture(h))) {
    err(`  ERROR: the ${cli} capture fragment ${fragSrc} does not match the capture signature.`);
    return null;
  }
  return rendered;
}

/** `.hooks | keys_unsorted | join(", ")` of a rendered fragment. */
export function fragmentEvents(fragment: JsonObject): string {
  const hooks = fragment["hooks"];
  return isObj(hooks) ? Object.keys(hooks).join(", ") : "";
}
