// reference.ts — the `changeset-gated: true` capabilities of ci/ci-capabilities.yml in reference
// order, read with the shared yq reader instead of spawning `yq` (spec 0262 req 4, 5, 11).
//
// Usage: gatedPlan(text). Exit codes: not applicable. Finding-line format: not applicable.

import { get, loadYq, render, YqAlias, YqMap, YqSeq, type YqNode } from "../yq-accessors/index.ts";

export interface Gated {
  /** The `yq -r .id` text of the capability, or null for a null id. */
  id: string | null;
  commands: string[];
}

function deref(n: YqNode): YqNode {
  let cur = n;
  while (cur instanceof YqAlias) cur = cur.target;
  return cur;
}

/** `select(.changeset-gated == true)`: yq compares the scalar text, quoted or not. */
function isGated(item: YqNode): boolean {
  const v = deref(get(item, ["changeset-gated"]));
  if (v === null || v instanceof YqMap || v instanceof YqSeq) return false;
  return v.toString() === "true";
}

function commandsOf(item: YqNode): string[] {
  const seq = deref(get(item, ["command"]));
  if (!(seq instanceof YqSeq)) return [];
  return seq.items.flatMap((c) => render(deref(c)).split("\n")).filter((l) => l !== "");
}

/** The gated capabilities in reference order (`.capabilities[] | select(...)`). */
export function gatedPlan(text: string): Gated[] {
  const caps = deref(get(loadYq(text), ["capabilities"]));
  if (!(caps instanceof YqSeq)) return [];
  const gated = caps.items.map(deref).filter(isGated);
  return gated.map((item) => {
    const id = deref(get(item, ["id"]));
    return { id: id === null ? null : render(id), commands: commandsOf(item) };
  });
}

/**
 * The commands to run, as the shell's two queries produce them: for each id printed by the
 * outer query (one per line), every command of every gated capability whose id equals it.
 */
export function runList(plan: readonly Gated[]): { id: string; command: string }[] {
  const out: { id: string; command: string }[] = [];
  for (const cap of plan) {
    for (const line of (cap.id ?? "null").split("\n")) {
      if (line === "") continue;
      for (const match of plan) {
        if (match.id !== line) continue;
        for (const command of match.commands) out.push({ id: line, command });
      }
    }
  }
  return out;
}
