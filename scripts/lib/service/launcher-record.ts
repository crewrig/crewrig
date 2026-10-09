// launcher-record.ts — the endpoint record of the installed MCP launcher
// (spec 0252 requirement 10 with delta-01; plan v2 D9).
//
// The record sits at the legacy launcher path and is not a program: it carries
// the lines `MCP_HOST="…"`, `MCP_PORT="…"`, `LAUNCHER_SOURCE_SHA="…"` and
// `LAUNCHER_PROGRAM="…"`, then a body that names the program on standard error
// and exits 1. `parseLauncher` and `mcp_installed_endpoint` (common.sh) take
// the first `NAME="…"` line of each name, so extra lines and a failing body
// are invisible to them.

import { parseLauncher } from "../mempalace-registration.ts";
import type { Endpoint } from "../mempalace-registration.ts";

export interface RecordFields {
  readonly host: string;
  readonly port: string;
  /** SHA-256 hex digest of the launcher entry, trust wrapper and bundle (delta-01). */
  readonly sourceSha: string;
  /** Absolute path of the installed TypeScript program. */
  readonly program: string;
}

/** The program path of a record path: `.sh` becomes `.ts`, any other extension gets `.ts`. */
export function programPathFor(recordPath: string): string {
  return recordPath.endsWith(".sh") ? `${recordPath.slice(0, -3)}.ts` : `${recordPath}.ts`;
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Render the record. Throws `RangeError` on a field the readers would not take back. */
export function renderRecord(fields: RecordFields): string {
  const { host, port, sourceSha, program } = fields;
  if (parseLauncher(`MCP_HOST="${host}"\nMCP_PORT="${port}"\n`) === null) {
    throw new RangeError(`invalid endpoint record host or port: ${host}:${port}`);
  }
  if (!/^[0-9a-f]{64}$/.test(sourceSha)) throw new RangeError("invalid LAUNCHER_SOURCE_SHA");
  if (program === "" || /["\n\r]/.test(program)) throw new RangeError("invalid LAUNCHER_PROGRAM");
  const message = `This file is an endpoint record, not a program. Run ${program} instead.`;
  return [
    "#!/bin/sh",
    "# CrewRig MCP daemon endpoint record (spec 0252 requirement 10). Not a program.",
    `MCP_HOST="${host}"`,
    `MCP_PORT="${port}"`,
    `LAUNCHER_SOURCE_SHA="${sourceSha}"`,
    `LAUNCHER_PROGRAM="${program}"`,
    `printf '%s\\n' ${shellSingleQuote(message)} >&2`,
    "exit 1",
    "",
  ].join("\n");
}

function firstValue(text: string, name: string): string | null {
  return new RegExp(`(?:^|\\n)${name}="([^"\\n]*)"`).exec(text)?.[1] ?? null;
}

/** Parse a TypeScript-form record; `null` when any of the four lines is missing or malformed. */
export function parseRecord(text: string): RecordFields | null {
  const endpoint = parseLauncher(text);
  const sourceSha = firstValue(text, "LAUNCHER_SOURCE_SHA");
  const program = firstValue(text, "LAUNCHER_PROGRAM");
  if (endpoint === null || sourceSha === null || program === null || program === "") return null;
  return { host: endpoint.host, port: String(endpoint.port), sourceSha, program };
}

export type RecordForm =
  | { readonly form: "typescript"; readonly program: string; readonly endpoint: Endpoint }
  | { readonly form: "shell"; readonly endpoint: Endpoint }
  | { readonly form: "unrecognised" };

/** Tell the two forms apart by the `LAUNCHER_PROGRAM` line (status report). */
export function recordForm(text: string): RecordForm {
  const endpoint = parseLauncher(text);
  if (endpoint === null) return { form: "unrecognised" };
  const program = firstValue(text, "LAUNCHER_PROGRAM");
  if (program === null) return { form: "shell", endpoint };
  return program === "" ? { form: "unrecognised" } : { form: "typescript", program, endpoint };
}
