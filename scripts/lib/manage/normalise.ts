// normalise.ts — the singular-to-plural type normalisation of the manage-* scripts (spec 0255 R6).
//
// Twins the `case "$TYPE" in claude-skill) TYPE=claude-skills ;; ...` block each script runs
// before its dispatch: an exact match on a declared singular maps to its plural, anything
// else (a plural, an unknown word, an empty string) passes through unchanged.

import type { CliDescriptor } from "./types.ts";

/** The plural a singular alias stands for, or `type` itself when it is not a declared alias. */
export function normaliseType(descriptor: CliDescriptor, type: string): string {
  return Object.hasOwn(descriptor.aliases, type) ? (descriptor.aliases[type] ?? type) : type;
}
