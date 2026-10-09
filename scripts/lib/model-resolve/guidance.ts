// guidance.ts — step 8: render the guidance template (R27-R31).
//
// Twin of model-resolve.sh `_render_guidance` (:1241). Substitutes, for each
// placeholder of the guidance template, the directed value of the item that
// placeholder names; a line whose placeholder names an undirected (dropped, unmapped
// or profile-absent) or unrecognised item is omitted; survivors join on a single
// space (R28's line-is-the-join-point reading, D9). D7's structural predicate, a
// fragment containing `"`, `\`, a CR or an LF, degrades to an empty prose and one
// `unrenderable-fragment` note: a defensive belt, unreachable on every committed
// source. R2 (spec 0250): this slice moved only because the step (b) build depends
// on it, not as precedent for the other consumers of the library.
//
// The shell's `sed` trim stripped the POSIX `[[:space:]]` class, which is these six
// ASCII characters; `String.prototype.trim` is wider and is not used.

import type { YamlText } from "../yaml-text.ts";
import { diagNote } from "./diagnostics.ts";
import { itemIdx } from "./ladders.ts";
import { guidanceTemplate } from "./mapping-access.ts";
import type { MappingDoc } from "./mapping-access.ts";
import type { ResolveState } from "./types.ts";

const PLACEHOLDER = /\{\{([a-zA-Z0-9_-]+)\}\}/g;
const EDGE_SPACE = /^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g;

/** One template line with every placeholder filled, or `null` when the line is omitted. */
function renderLine(state: ResolveState, line: string): string | null {
  let rendered = line;
  for (const match of line.matchAll(PLACEHOLDER)) {
    const name = match[1] ?? "";
    const idx = itemIdx(name);
    if (idx < 0 || !state.gd[idx] || state.value[idx] === "") return null;
    rendered = rendered.split(`{{${name}}}`).join(state.value[idx]);
  }
  return rendered;
}

/** `_render_guidance`: sets `state.prose`, or records one note when the fragment is unrenderable. */
export function renderGuidance(
  yaml: YamlText,
  state: ResolveState,
  doc: MappingDoc,
  agent: string,
  target: string,
  gdAddr: string,
): void {
  if (gdAddr === "") return;
  const template = guidanceTemplate(yaml, doc, gdAddr);
  if (template === "") return;

  const survivors: string[] = [];
  for (const line of template.split("\n")) {
    if (line === "") continue;
    const rendered = renderLine(state, line);
    if (rendered !== null) survivors.push(rendered);
  }
  const joined = survivors
    .map((survivor) => survivor.replace(EDGE_SPACE, ""))
    .filter((survivor) => survivor !== "")
    .join(" ");
  if (joined === "") return;

  if (joined.includes('"') || joined.includes("\\")) {
    const detail =
      "rendered guidance fragment would alter the compiled description's YAML structure";
    diagNote(state, agent, target, "unrenderable-fragment", detail);
  } else if (joined.includes("\r")) {
    diagNote(
      state,
      agent,
      target,
      "unrenderable-fragment",
      "rendered guidance fragment carries a CR",
    );
  } else {
    state.prose = joined;
  }
}
