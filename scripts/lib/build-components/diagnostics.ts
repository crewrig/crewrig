// diagnostics.ts — drop records and diagnostic notes (spec 0198 R32-R34; spec 0250 R6).
//
// Twins scripts/build-components.sh `emit_diag_line` (:152-159): one line to standard
// error and, when `--diagnostics <path>` names a file, appended to it as well. Nothing
// written here is ever committed. The `--resolve` arm truncates the file first
// (resolve-arm.ts); a build only appends.

import fs from "node:fs";

import type { BaseCtx } from "./types.ts";

// The escaper lives in scripts/lib/escape-control.ts (shared with component-resolve.ts);
// re-exported here so the build modules keep one import site.
export { escapeControl, escapeControlKeepTab, isControlCode } from "../escape-control.ts";
import { escapeControlKeepTab } from "../escape-control.ts";

/**
 * `emit_diag_line <line>`: standard error first, then the `--diagnostics` file.
 *
 * @throws the filesystem error when the named file cannot be appended to (the shell's
 *   `>>` failed the build under `set -e`); the entry turns it into an `Error:` line.
 */
export function emitDiagLine(ctx: Pick<BaseCtx, "io" | "opts">, line: string): void {
  // Printed escaped (a value read from a source can hold a line break); the file is raw.
  ctx.io.err(escapeControlKeepTab(line));
  if (ctx.opts.diagnosticsPath !== "") fs.appendFileSync(ctx.opts.diagnosticsPath, `${line}\n`);
}
