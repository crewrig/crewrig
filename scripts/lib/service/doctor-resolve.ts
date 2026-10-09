// doctor-resolve.ts — read one CLI MCP registration the way the shell doctor's
// `jq` filters did, in process (spec 0252 requirement 20: no `jq`).
// The jq semantics kept: `// empty` skips `null` and `false`; `join(" ")` turns
// `null` into the empty string; `-r` prints a string raw and any other value as
// JSON. An unreadable or non-JSON file reads as "no entry", as a failing `jq`
// did. Interpreter and wrapper come from the whole `[command] + args`.

import { accessSync, constants, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { findOnPath } from "../mempalace-python.ts";
import { probe } from "./probe.ts";

export const WRAPPER_BASENAME = "mempalace-http-wrapper.py";

/** The `mempalace` registration object, or `undefined` when there is none. */
export function registrationEntry(config: string): unknown {
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(config, "utf8"));
  } catch {
    return undefined;
  }
  const servers = isRecord(doc) ? doc["mcpServers"] : undefined;
  const entry = isRecord(servers) ? servers["mempalace"] : undefined;
  return entry === null || entry === false ? undefined : entry;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function present(v: unknown): boolean {
  return v !== undefined && v !== null && v !== false;
}

/** `jq -r` of a value: a string raw, anything else as JSON text. */
function raw(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** `.url // .serverUrl // empty` of the entry, or `""`. */
export function remoteUrl(entry: unknown): string {
  if (!isRecord(entry)) return "";
  const v = present(entry["url"]) ? entry["url"] : entry["serverUrl"];
  return present(v) ? raw(v) : "";
}

/** `.headers.Authorization // empty` is present. */
export function hasAuthorization(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  const headers = entry["headers"];
  return isRecord(headers) && present(headers["Authorization"]);
}

/** `[.command] + (.args // [])`; empty when jq would have failed on the shape. */
export function argvOf(entry: unknown): unknown[] {
  if (!isRecord(entry)) return [];
  const args = present(entry["args"]) ? entry["args"] : [];
  return Array.isArray(args) ? [entry["command"] ?? null, ...(args as unknown[])] : [];
}

/** `join(" ")`: each element as text, `null` as the empty string. */
export function argvDisplay(argv: readonly unknown[]): string {
  return argv.map((e) => (e === null || e === undefined ? "" : raw(e))).join(" ");
}

/** The interpreter and wrapper: the element before the first wrapper-named one. */
export function findWrapper(argv: readonly unknown[]): { wrapper: string; interp: string } {
  let prev = "";
  for (const element of argv) {
    const text = element === null || element === undefined ? "null" : raw(element);
    if (
      text === WRAPPER_BASENAME ||
      text.endsWith(`/${WRAPPER_BASENAME}`) ||
      text.endsWith(`\\${WRAPPER_BASENAME}`)
    ) {
      return { wrapper: text, interp: prev };
    }
    prev = text;
  }
  return { wrapper: "", interp: "" };
}

/** `[ -f path ]`. */
export function isFile(target: string): boolean {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

/** The checkout two directories above the wrapper, resolved lexically like `cd .. && pwd`. */
export function checkoutOf(wrapper: string): string {
  return path.resolve(path.dirname(wrapper), "..", "..");
}

/** `[ -x p ]` or `command -v p`. */
export function resolves(name: string, env: NodeJS.ProcessEnv): boolean {
  try {
    accessSync(name, constants.X_OK);
    return true;
  } catch {
    return findOnPath(name, env, undefined) !== undefined;
  }
}

export async function daemonRunning(
  env: NodeJS.ProcessEnv,
): Promise<{ up: boolean; host: string; port: string }> {
  const host = env["MEMPALACE_MCP_HOST"] || "127.0.0.1";
  const port = env["MEMPALACE_MCP_PORT"] || "41893";
  const res = await probe({
    url: `http://${host}:${port}/healthz`,
    timeoutMs: 1000,
    maxBodyBytes: 4096,
  });
  return { up: "status" in res && res.status < 400, host, port };
}
