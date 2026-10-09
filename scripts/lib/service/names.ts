// names.ts — the service names of the two MemPalace daemons (spec 0252
// requirement 5; plan v2 D1): the launchd label, the systemd unit and the
// Windows task leaf, plus the daemon's host and port.
//
// The defaults repeat the constants of scripts/lib/common.sh
// (MCP_DAEMON_LABEL_DEFAULT, MCP_DAEMON_UNIT_DEFAULT); the conformance test of
// plan step 14 asserts they stay equal. The overrides MEMPALACE_MCP_LABEL and
// MEMPALACE_MCP_UNIT keep applying to the MCP daemon only, as in the shell
// (`${VAR:-default}`: an empty value means the default). The unit value names
// the Windows task leaf. Host and port are NOT redeclared here: they come from
// the one definition in scripts/lib/usage-store/mcp.js.

import { endpoint } from "../usage-store/mcp.js";

export type DaemonKind = "mcp" | "chroma";

export const MCP_LABEL_DEFAULT = "com.mempalace.mcp-server";
export const MCP_UNIT_DEFAULT = "mempalace-mcp-server";
export const CHROMA_LABEL_DEFAULT = "com.mempalace.chroma-server";
export const CHROMA_UNIT_DEFAULT = "mempalace-chroma-server";

/** The Task Scheduler folder that holds every CrewRig task. */
export const WINDOWS_TASK_FOLDER = "\\CrewRig";

export interface ServiceNames {
  readonly kind: DaemonKind;
  /** launchd label. */
  readonly label: string;
  /** systemd unit name, also the Windows task leaf. */
  readonly unit: string;
}

/** The environment the overrides are read from; `process.env` by default. */
export type EnvLike = Readonly<Record<string, string | undefined>>;

function nonEmpty(value: string | undefined, fallback: string): string {
  return value !== undefined && value !== "" ? value : fallback;
}

/** The names of one daemon. Only the MCP daemon honours the overrides. */
export function serviceNames(kind: DaemonKind, env: EnvLike = process.env): ServiceNames {
  if (kind === "chroma") {
    return { kind, label: CHROMA_LABEL_DEFAULT, unit: CHROMA_UNIT_DEFAULT };
  }
  return {
    kind,
    label: nonEmpty(env["MEMPALACE_MCP_LABEL"], MCP_LABEL_DEFAULT),
    unit: nonEmpty(env["MEMPALACE_MCP_UNIT"], MCP_UNIT_DEFAULT),
  };
}

const LEAF_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * `\CrewRig\<leaf>`. A leaf with a path separator, a space or any other
 * character outside `[A-Za-z0-9._-]` would name another task or escape the
 * folder, so it is refused rather than passed to the Task Scheduler.
 */
export function windowsTaskPath(leaf: string): string {
  if (!LEAF_RE.test(leaf)) {
    throw new RangeError(`invalid Windows task leaf: ${JSON.stringify(leaf)}`);
  }
  return `${WINDOWS_TASK_FOLDER}\\${leaf}`;
}

/** The Windows task path of a daemon. */
export function taskPathOf(names: ServiceNames): string {
  return windowsTaskPath(names.unit);
}

/**
 * The daemon's host and port: `MEMPALACE_MCP_HOST` / `MEMPALACE_MCP_PORT`,
 * defaulting to `127.0.0.1` / `41893`. The one definition, re-used from
 * scripts/lib/usage-store/mcp.js (the port is a string there).
 */
export function daemonEndpoint(): { readonly host: string; readonly port: string } {
  const { host, port } = endpoint();
  return { host, port };
}
