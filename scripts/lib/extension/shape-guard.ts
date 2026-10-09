// shape-guard.ts — the retired-declaration-shape guard (spec 0254 R8).
// Twin of `ext_assert_current_shape`, scripts/lib/extension-manifest.sh:84-117 (spec 0183
// R12/R13). Reads the SAME enumeration the migration tool reads; fail-closed when it cannot.
// The messages are the shell's, byte for byte (the em dash included); `detectShape` is the
// detection half, reused by the migration tool.

import { legacyShapePath, readLegacyShape } from "./descriptors.ts";
import type { LegacyShape } from "./descriptors.ts";
import type { Manifest } from "./manifest.ts";
import type { JsonValue } from "./types.ts";

/** What of the retired shape a manifest still carries, in the enumeration's order. */
export interface ShapeDetection {
  /** `has(componentsKey) and .[componentsKey] != null`. */
  readonly hasComponents: boolean;
  /** The enumerated `componentsSubjects` the `components` object carries. */
  readonly componentsSubjects: string[];
  /** The `perCliKeys` entries (`section.key`) the manifest declares, enumeration order. */
  readonly perCliHits: string[];
}

function hasKey(value: JsonValue | undefined, key: string): boolean {
  return value instanceof Map && value.has(key);
}

/** Which retired forms the manifest carries; pure, no output. */
export function detectShape(manifest: Manifest, shape: LegacyShape): ShapeDetection {
  const components = manifest.get(shape.componentsKey);
  const hasComponents = manifest.has(shape.componentsKey) && components !== null;
  // `has(.)` on a non-object errors in the shell (stderr discarded): no subject is listed.
  const componentsSubjects = hasComponents
    ? shape.componentsSubjects.filter((subject) => hasKey(components, subject))
    : [];
  const perCliHits: string[] = [];
  for (const perCliKey of shape.perCliKeys) {
    if (perCliKey === "") continue;
    // `${k%%.*}` and `${k#*.}`: a key without a dot is its own section and key.
    const dot = perCliKey.indexOf(".");
    const section = dot < 0 ? perCliKey : perCliKey.slice(0, dot);
    const key = dot < 0 ? perCliKey : perCliKey.slice(dot + 1);
    // `.[$s] // {} | has($k)`: only an object section can hold the key.
    if (hasKey(manifest.get(section), key)) perCliHits.push(perCliKey);
  }
  return { hasComponents, componentsSubjects, perCliHits };
}

const TAIL = "run scripts/migrate-extension.sh, see docs/adoption-guide.md";

/**
 * The `VALIDATION-ERROR` lines `ext_assert_current_shape` prints to stderr (none when the
 * manifest is current). A missing or malformed enumeration is itself the one error line.
 */
export function assertCurrentShape(
  manifestPath: string,
  manifest: Manifest,
  libDir: string,
): string[] {
  const result = readLegacyShape(libDir);
  if (result.kind !== "ok") {
    return [
      `VALIDATION-ERROR: ${manifestPath} — legacy-shape enumeration not found at ${legacyShapePath(libDir)} (spec 0183 R12)`,
    ];
  }
  const { shape } = result;
  const found = detectShape(manifest, shape);
  const lines: string[] = [];
  if (found.hasComponents) {
    // The shell's subjects clause never prints: its jq program calls `has` with the whole
    // `components` object as the key, which errors with stderr discarded, so `found_subjects` is
    // always empty and the message keeps the double space before the dash (spec 0254 R8, R14).
    // The enumeration of the subjects stays in `detectShape` for the migration tool.
    lines.push(
      `VALIDATION-ERROR: ${manifestPath} — declares the retired '${shape.componentsKey}' object  — ${TAIL}`,
    );
  }
  for (const hit of found.perCliHits) {
    lines.push(
      `VALIDATION-ERROR: ${manifestPath} — declares the retired per-CLI key '${hit}' — ${TAIL}`,
    );
  }
  return lines;
}
