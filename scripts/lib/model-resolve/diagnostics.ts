// diagnostics.ts — the two diagnostic record formats (spec 0198 R32-R35).
//
// Twins of model-resolve.sh `_diag_drop` (:974) and `_diag_note` (:980). One record
// per line, fields in a fixed order separated by a single tab, the opening token
// distinguishing a drop record from a note. The shell built each line in a command
// substitution, which removed trailing line feeds; so does this. R2 (spec 0250):
// this slice moved only because the step (b) build depends on it, not as precedent.

import type { ResolveState } from "./types.ts";

function record(fields: readonly string[]): string {
  return fields.join("\t").replace(/\n+$/, "");
}

/** `_diag_drop <agent> <target> <dotted-path> <declared-value> <reason>`. */
export function diagDrop(
  state: ResolveState,
  agent: string,
  target: string,
  path: string,
  declared: string,
  reason: string,
): void {
  state.diag.push(record(["model-drop", agent, target, path, declared, reason]));
}

/** `_diag_note <agent> <target> <category> <detail>`. */
export function diagNote(
  state: ResolveState,
  agent: string,
  target: string,
  category: string,
  detail: string,
): void {
  state.diag.push(record(["model-note", agent, target, category, detail]));
}
