// validate-percli.ts — the per-CLI key validator (spec 0254 R9).
// Twin of the second block of `ext_validate_manifest` (scripts/lib/extension-manifest.sh:141-151).
// Pure: the caller passes the parsed manifest and the allowlist's `key` column.

import type { JsonValue } from "./types.ts";

const CLIS: readonly string[] = ["gemini", "claude", "copilot", "antigravity"];

/** jq orders `keys` by Unicode code point, not by UTF-16 code unit. */
function codePointOrder(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = (x[i] as string).codePointAt(0)! - (y[i] as string).codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/**
 * The names `jq -r '... | keys[]?'` prints: sorted keys of an object, the indices of an
 * array, and nothing for any other value (the `?` swallows the error).
 */
export function jqKeys(value: JsonValue | undefined): string[] {
  if (value instanceof Map) return [...value.keys()].sort(codePointOrder);
  if (Array.isArray(value)) return value.map((_, i) => String(i));
  return [];
}

/** `.[$c] // {}`: null, false and a missing key all read as the empty object. */
function section(manifest: Map<string, JsonValue>, cli: string): JsonValue {
  const value = manifest.get(cli);
  return value === undefined || value === null || value === false ? new Map() : value;
}

export function validatePerCli(
  manifestPath: string,
  manifest: Map<string, JsonValue>,
  allowlistPath: string,
  allowedKeys: readonly string[],
): string[] {
  const lines: string[] = [];
  for (const cli of CLIS) {
    for (const key of jqKeys(section(manifest, cli))) {
      if (key === "") continue;
      if (!allowedKeys.includes(`${cli}.${key}`)) {
        lines.push(
          `VALIDATION-ERROR: ${manifestPath} — inadmissible per-CLI key '${cli}.${key}' (not in ${allowlistPath})`,
        );
      }
    }
  }
  return lines;
}
