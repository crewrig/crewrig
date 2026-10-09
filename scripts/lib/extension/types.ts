// types.ts — shared contracts of the extension and plugin builder modules (spec 0254 R1).
// Types and the one failure class only: no behaviour lives here.
//
// Module map (one concern per file, each under 300 lines; the plan of #1333 names them):
//   json-ordered.ts   `parseJson`: an order-preserving JSON reader (R12)
//   json-write.ts     `writeJsonText`, `jqText`, `obj`: the `jq` pretty writer (R12)
//   descriptors.ts    typed readers of the four `extension-*.json` descriptors
//   manifest.ts       manifest accessors, the twins of `extension-manifest.sh` :39-72, :187-202
//   shape-guard.ts    `assertCurrentShape` (R8)
//   validate-*.ts     the per-CLI key, hook and MCP validators (R9)
//   hooks-*.ts        the hook translator (R10)
//   mcp-delivery.ts   the MCP delivery gate and root-token rewrite (R11)
//   context-*.ts      the context renderer (R16)
//   tree-copy.ts resolve.ts gap-record.ts   shared plumbing (R6, R13, R14)

/** Environment as read from `process.env`: every value is `string | undefined`. */
export type Env = Readonly<Record<string, string | undefined>>;

/** The four CLIs an extension is rendered for. */
export type Target = "gemini" | "claude" | "copilot" | "antigravity";

export const TARGETS: readonly Target[] = ["gemini", "claude", "copilot", "antigravity"];

/**
 * A parsed JSON value. Objects are `Map`s so that every key, integer-like ones
 * included, keeps the position it was written at (a plain object would list
 * `"2"` before `"b"`); arrays and scalars are the plain JavaScript values.
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | Map<string, JsonValue>;

/**
 * One row of `scripts/lib/extension-targets.json`, every column rendered as the
 * shell's `jq -r '.[$t][$c] // empty'` rendered it: the text, or "" when the column is
 * absent, null or false. `mcpDelivery` is the one boolean (`// false | tostring`).
 */
export interface TargetRow {
  readonly shellTool: string;
  readonly rootToken: string;
  readonly hookFile: string;
  readonly matchAll: string;
  readonly mcpDelivery: boolean;
  readonly displayName: string;
  readonly commandRef: string;
  readonly skillRef: string;
  readonly contextOutput: string;
}

/** The descriptor's four target rows (the `_readme` row is never a target). */
export type TargetTable = Readonly<Record<Target, TargetRow>>;

/**
 * Where the scripts write. `out` and `err` append the line feed themselves (the
 * shell's `echo`); `errRaw` writes text as it is. Nothing here exits the process:
 * `main` returns the exit code and the entry sets `process.exitCode`.
 */
export interface Io {
  out(line: string): void;
  err(line: string): void;
  errRaw(text: string): void;
}

/** One observed gap, in the key order of the shell's `jq -c -n` records (R13). */
export interface Gap {
  readonly subject: string;
  readonly target: Target;
  readonly hook?: string;
  readonly event?: string;
  readonly part?: "event" | "matcher";
  readonly reason: string;
}

/**
 * A failure the entry reports as a single `Error: <message>` line and an exit
 * status (default 1). Anything else that escapes a module is a defect.
 */
export class ExtError extends Error {
  readonly status: number;

  constructor(message: string, status = 1) {
    super(message);
    this.name = "ExtError";
    this.status = status;
  }
}
