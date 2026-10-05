// hook-registry.ts — the hooks hook-wiring.ts can wire, by id (spec 0248 R27).
//
// A hook registers its descriptor and the manifest file that carries its
// commands for a CLI; the wiring tool selects one with `--hook <id>` and
// changes no mechanism. usage-capture owns a manifest of its own; the worktree
// git guard shares `<cli>-transcript-hooks.json` with `mempalace-transcript`
// (row C3), so a guard operation touches only the guard's entries there.
//
// Standard library only (spec 0240 R16).

import { USAGE_CAPTURE, WORKTREE_GIT_GUARD, type HookDescriptor } from "./hook-descriptor.ts";

export interface RegisteredHook {
  readonly descriptor: HookDescriptor;
  /** File name under `hooks/` that carries this hook's commands for `cli`. */
  readonly manifestFile: (cli: string) => string;
  /** How a report names the hook to a person. */
  readonly label: string;
}

export const DEFAULT_HOOK = USAGE_CAPTURE.id;

const REGISTRY: readonly RegisteredHook[] = [
  {
    descriptor: USAGE_CAPTURE,
    manifestFile: (cli) => `${cli}-${USAGE_CAPTURE.id}-hooks.json`,
    label: "Usage capture",
  },
  {
    descriptor: WORKTREE_GIT_GUARD,
    manifestFile: (cli) => `${cli}-transcript-hooks.json`,
    label: "Worktree git guard",
  },
];

/** The registered hook with this id, or `null`. */
export function lookupHook(id: string): RegisteredHook | null {
  return REGISTRY.find((hook) => hook.descriptor.id === id) ?? null;
}

/** Every registered hook id, for usage messages. */
export function hookIds(): string[] {
  return REGISTRY.map((hook) => hook.descriptor.id);
}
