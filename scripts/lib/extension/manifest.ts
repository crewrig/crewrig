// manifest.ts — manifest accessors over a parsed `extension.json` (spec 0254 R8).
// Twins of scripts/lib/extension-manifest.sh: `ext_subject_present` :39, `ext_subject_location`
// :52, `ext_subject_option` :61, `ext_version` :69, `ext_build_dir` :187, `ext_gap_dir` :197,
// plus the `jq -r` field reads the plugin builders perform on the manifest.
//
// Every read renders its value as `jq -r` does inside `$(...)`: a string verbatim (trailing line
// feeds stripped), a number or boolean as JSON text; absent and null have no text (`null` here) unless the jq filter carried `// <default>`,
// in which case null, false and absent all fall to the default.

import { ExtError } from "./types.ts";
import type { JsonValue } from "./types.ts";
import { readJsonFile } from "./descriptors.ts";
import { jqText } from "./json-write.ts";

/** A manifest is a JSON object whose keys keep their file order. */
export type Manifest = Map<string, JsonValue>;

/** Read `extension.json` (BOM stripped, CRLF read as LF); a non-object manifest is refused. */
export function readManifest(file: string): Manifest {
  const doc = readJsonFile(file);
  if (!(doc instanceof Map)) throw new ExtError(`${file}: manifest is not a JSON object`);
  return doc;
}

/** The value at a key path; a non-object on the way reads as absent (`undefined`). */
export function valueAt(manifest: Manifest, ...path: string[]): JsonValue | undefined {
  let current: JsonValue | undefined = manifest;
  for (const key of path) {
    if (!(current instanceof Map)) return undefined;
    current = current.get(key);
  }
  return current;
}

/** `jq -r '<path> // <dflt>'`: null, false and absent fall to the default. */
export function textOr(value: JsonValue | undefined, dflt: string): string {
  if (value === undefined || value === null || value === false) return dflt;
  return jqText(value);
}

/** `jq -r '<path>'` with no default: absent and null have no text, false reads "false". */
export function textOrNull(value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) return null;
  return jqText(value);
}

/** `ext_subject_present`: the key exists and its value is not null. */
export function subjectPresent(manifest: Manifest, subject: string): boolean {
  const value = manifest.get(subject);
  return manifest.has(subject) && value !== null && value !== undefined;
}

/** `ext_subject_option`: `(.[$s][$o] // $d)` when the subject is present, else `$d`. */
export function subjectOption(
  manifest: Manifest,
  subject: string,
  option: string,
  dflt = "",
): string {
  return subjectPresent(manifest, subject)
    ? textOr(valueAt(manifest, subject, option), dflt)
    : dflt;
}

/** `ext_subject_location`: `(.[$s].location // $d)` when the subject is present, else `$d`. */
export function subjectLocation(manifest: Manifest, subject: string, dflt: string): string {
  return subjectOption(manifest, subject, "location", dflt);
}

/** `ext_version`: `.version // ""`. */
export function extVersion(manifest: Manifest): string {
  return textOr(manifest.get("version"), "");
}

/** `.name` read with `jq -r` (no default): `null` when absent or null. */
export function manifestName(manifest: Manifest): string | null {
  return textOrNull(manifest.get("name"));
}

/** `.version` read with `jq -r` (no default): `null` when absent or null. */
export function manifestVersion(manifest: Manifest): string | null {
  return textOrNull(manifest.get("version"));
}

/** `.description` read with `jq -r` (no default): `null` when absent or null. */
export function manifestDescription(manifest: Manifest): string | null {
  return textOrNull(manifest.get("description"));
}

/** `.claude.author.name // "Unknown"`. */
export function claudeAuthorName(manifest: Manifest): string {
  return textOr(valueAt(manifest, "claude", "author", "name"), "Unknown");
}

/** `.context.source // ""`. */
export function contextSource(manifest: Manifest): string {
  return textOr(valueAt(manifest, "context", "source"), "");
}

/** `ext_build_dir`: `<repo>/build/extensions/<name>`, the one place the layout is decided. */
export function extBuildDir(repoDir: string, name: string): string {
  return `${repoDir}/build/extensions/${name}`;
}

/** `ext_gap_dir`: `<repo>/build/gaps/<name>`, beside the build directory, outside it. */
export function extGapDir(repoDir: string, name: string): string {
  return `${repoDir}/build/gaps/${name}`;
}
