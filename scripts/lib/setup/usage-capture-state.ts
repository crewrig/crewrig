// usage-capture-state.ts — the pure readers of the usage-capture opt-in (spec 0256 requirement 30,
// plan v2 step B3a.2a): the TypeScript twin of `usage_capture_footprint`, `usage_capture_paths` and
// `usage_capture_state` of scripts/lib/usage-capture-optin.sh, and of its `_uc_shape`,
// `_uc_unsafe_path`, `_uc_unresolvable_path` and `_uc_legacy_ok` internals. Recognition is the
// existing hook-recognition.ts (USAGE_CAPTURE descriptor, which carries no guarded prefix, so it
// accepts exactly what `uc_sig_re` and `uc_legacy_re` accept); both twins run over
// scripts/tests/fixtures/usage-capture/recognition-corpus.json.
//
// Everything here takes a parsed configuration object (or a file for the `*OfFile` readers); it
// writes nothing. Layer 2: node built-ins and repository modules only.

import fs from "node:fs";

import { NotAJsonObjectError, readJsonObject, type JsonObject } from "../hook-config.ts";
import { USAGE_CAPTURE } from "../hook-descriptor.ts";
import { parseHandler, parseHookCommand, type HookCommandParse } from "../hook-recognition.ts";
import type { Cli } from "./context.ts";

/** `grouped` for Claude and Gemini (`hooks[Event][] = {selectors, hooks:[handler]}`), `flat` for Copilot. */
export type CaptureShape = "grouped" | "flat";
/** The three CLIs that keep a usage-capture entry in a hooks file. */
export type CaptureCli = "claude" | "gemini" | "copilot";

export interface CaptureEntry {
  readonly event: string;
  /** The group object minus its `hooks` key on a grouped shape, `null` on the flat one. */
  readonly selector: JsonObject | null;
  readonly handler: unknown;
}

/** The shell's return code 2: the file exists but is not a JSON object. */
export class NotAnObjectConfigError extends NotAJsonObjectError {
  readonly rc = 2;
}

const isRecord = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `_uc_shape`: undefined for a CLI that holds no capture entry in a hooks file (the caller prints the shell's ERROR). */
export function captureShape(cli: string): CaptureShape | undefined {
  if (cli === "claude" || cli === "gemini") return "grouped";
  if (cli === "copilot") return "flat";
  return undefined;
}

/** The shell's `unknown CLI` diagnostic, for the caller to print on standard error. */
export const unknownCliMessage = (cli: string): string =>
  `  ERROR: unknown CLI '${cli}' (expected claude, gemini or copilot).`;

/** `_uc_unsafe_path`: the path holds `"`, `$`, a backtick, a backslash or a newline. */
export function isUnsafePath(p: string): boolean {
  return /["$`\\\n]/.test(p);
}

/** `_uc_unresolvable_path`: relative, or holds `$` or a backtick the hook's shell would expand. */
export function isUnresolvablePath(p: string): boolean {
  return !p.startsWith("/") || /[$`]/.test(p);
}

/** `(.hooks // {})`: jq's `//` takes `null` and `false` as absent. */
function hooksOf(config: JsonObject): unknown {
  const hooks = config["hooks"];
  return hooks === null || hooks === false || hooks === undefined ? {} : hooks;
}

/** `uc_all_handlers`: every handler as {event, selector, handler}, in registration order. */
export function allHandlers(shape: CaptureShape, config: JsonObject): CaptureEntry[] {
  const hooks = hooksOf(config);
  if (!isRecord(hooks)) return [];
  const found: CaptureEntry[] = [];
  for (const [event, value] of Object.entries(hooks)) {
    if (!Array.isArray(value)) continue;
    for (const element of value as unknown[]) {
      if (shape === "flat") {
        found.push({ event, selector: null, handler: element });
      } else if (isRecord(element) && Array.isArray(element["hooks"])) {
        const { hooks: handlers, ...selector } = element;
        for (const handler of handlers as unknown[]) found.push({ event, selector, handler });
      }
    }
  }
  return found;
}

/** `uc_legacy_candidates`: the paths of the legacy-shaped commands the signature does not match. */
export function legacyCandidates(shape: CaptureShape, config: JsonObject): string[] {
  const paths: string[] = [];
  for (const { handler } of allHandlers(shape, config)) {
    if (!isRecord(handler)) continue;
    const command = handler["command"];
    const type = handler["type"];
    const isCommand =
      (type === undefined || type === null || type === false || type === "command") &&
      typeof command === "string";
    if (!isCommand || parseHookCommand(command, USAGE_CAPTURE) !== null) continue;
    parseHookCommand(command, USAGE_CAPTURE, {
      pathExists: (p) => {
        if (!paths.includes(p)) paths.push(p);
        return false;
      },
    });
  }
  return paths;
}

/** `_uc_legacy_ok`: the legacy candidates that name an existing file (`[ -f p ]`). */
export function legacyOk(
  shape: CaptureShape,
  config: JsonObject,
  isFile: (p: string) => boolean = defaultIsFile,
): string[] {
  return legacyCandidates(shape, config).filter(isFile);
}

function defaultIsFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** `uc_parse` of one handler under the legacy-ok list of its configuration. */
export function parseCapture(handler: unknown, legacy: readonly string[]): HookCommandParse | null {
  return parseHandler(handler, USAGE_CAPTURE, { pathExists: (p) => legacy.includes(p) });
}

/** `uc_footprint`: every capture handler of the configuration. `null` is an absent file. */
export function captureFootprint(
  cli: CaptureCli,
  config: JsonObject | null,
  isFile?: (p: string) => boolean,
): CaptureEntry[] {
  const shape = captureShape(cli) ?? "grouped";
  const doc = config ?? {};
  const legacy = legacyOk(shape, doc, isFile);
  return allHandlers(shape, doc).filter((x) => parseCapture(x.handler, legacy) !== null);
}

/** `uc_paths`: the distinct registered capture script paths, in registration order. */
export function capturePaths(
  cli: CaptureCli,
  config: JsonObject | null,
  isFile?: (p: string) => boolean,
): string[] {
  const shape = captureShape(cli) ?? "grouped";
  const doc = config ?? {};
  const legacy = legacyOk(shape, doc, isFile);
  const paths: string[] = [];
  for (const x of allHandlers(shape, doc)) {
    const p = parseCapture(x.handler, legacy)?.path;
    if (p !== undefined && !paths.includes(p)) paths.push(p);
  }
  return paths;
}

/** `usage_capture_state`: `installed` when any capture handler is registered. */
export function captureState(
  cli: CaptureCli,
  config: JsonObject | null,
  isFile?: (p: string) => boolean,
): "absent" | "installed" {
  return captureFootprint(cli, config, isFile).length === 0 ? "absent" : "installed";
}

/**
 * `_uc_read`'s file handling: a missing (or non-regular) file is absent (`null`); a file that does
 * not parse as one JSON object throws {@link NotAnObjectConfigError}, whose message is the shell's
 * `  ERROR: <file> is not readable as a JSON object.` and whose `rc` is 2.
 */
export function readCaptureConfig(file: string): JsonObject | null {
  if (!defaultIsFile(file)) return null;
  try {
    return readJsonObject(file);
  } catch (error) {
    if (error instanceof NotAJsonObjectError) throw new NotAnObjectConfigError(file);
    throw error;
  }
}

/** The shell's diagnostic line for a {@link NotAnObjectConfigError} (standard error). */
export const notAnObjectMessage = (file: string): string =>
  `  ERROR: ${file} is not readable as a JSON object.`;
