// pin.ts — the one place `prune-transcripts` meets ticket #1330's MemPalace version pin
// (`scripts/lib/mempalace-pin.ts`, spec 0252): the two declaration lines of
// `scripts/lib/common.sh` stay the single source until row J4.

import { installSpec, readMempalacePin } from "../mempalace-pin.ts";

/** The pip requirement string, e.g. `mempalace>=3.6.0,<3.7`. */
export function installSpecFor(repoRoot: string): string {
  return installSpec(readMempalacePin(repoRoot));
}
