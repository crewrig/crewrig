// agent-profiles-yq.ts — shared pieces of the agent-profile checker: the failure
// callback type, the runtime-failure error, and the `yq -r` value read.

import { render, YqMap, YqSeq, type YqNode } from "../yq-accessors/index.ts";

/** Records one rejection `<file>: <id> <message>`. */
export type Fail = (id: string, message: string) => void;

/** A failure of the shell's own runtime (spec 0262 requirement 24 (c)): one `Error:` line, exit 1. */
export class AgentProfilesError extends Error {}

/**
 * `v=$(yq -r <path>)`: the printed text with trailing line feeds removed. A non-empty
 * collection prints as block YAML, which this reader does not render: that is a gap,
 * reported through the (c) line rather than guessed.
 */
export function valueOf(node: YqNode): string {
  if (node instanceof YqMap && node.entries.length === 0) return "{}";
  if (node instanceof YqSeq && node.items.length === 0) return "[]";
  if (node instanceof YqMap || node instanceof YqSeq) {
    throw new AgentProfilesError(
      "a non-empty collection where a scalar is expected is not rendered",
    );
  }
  return render(node).replace(/\n+$/, "");
}
