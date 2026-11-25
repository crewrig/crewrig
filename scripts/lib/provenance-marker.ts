// provenance-marker.ts — the one writer of provenance-marker bytes (spec 0316 R1, R3, R6).
//
// Every generated surface (the component build, the extension renderer, setup) writes its
// marker through this module, so the field order, the omission rule and the two encodings
// exist once. Two encodings carry the same fields:
//   - a one-line comment (`markerLine`, in three syntaxes) for formats with no metadata block;
//   - a YAML block (`markerYaml`, `spliceMarkerYaml`) for formats with a frontmatter.
// The fixed field order is: package, extension, version, canonical, feedback. An undefined or
// empty member is omitted. Values are emitted verbatim: a placeholder passes through for the
// caller to resolve, so resolve placeholders BEFORE calling the writer, which then validates
// the final value. Nothing returned carries a trailing line feed.

import fs from "node:fs";

export type ProvenanceFields = {
  readonly package: string;
  readonly extension?: string;
  readonly version?: string;
  readonly canonical?: string;
  readonly feedback?: string;
};

export type MarkerSyntax = "html" | "hash" | "block-js";

/** A refusal of the writer; `field` names the offending field, or the file it was read from. */
export class ProvenanceMarkerError extends Error {
  readonly field: string;

  constructor(message: string, field: string) {
    super(message);
    this.name = "ProvenanceMarkerError";
    this.field = field;
  }
}

const ORDER = ["package", "extension", "version", "canonical", "feedback"] as const;

/** The members to emit, in order. @throws ProvenanceMarkerError on an empty `package` or a `"`, CR or LF. */
function members(fields: ProvenanceFields): Array<readonly [string, string]> {
  if (typeof fields.package !== "string" || fields.package === "") {
    throw new ProvenanceMarkerError(
      "provenance marker: `package` is required and not empty",
      "package",
    );
  }
  const out: Array<readonly [string, string]> = [];
  for (const key of ORDER) {
    const value = fields[key];
    if (value === undefined || value === "") continue;
    if (/["\r\n]/.test(value)) {
      throw new ProvenanceMarkerError(
        `provenance marker: \`${key}\` holds a double quote or a line break`,
        key,
      );
    }
    out.push([key, value]);
  }
  return out;
}

function payload(fields: ProvenanceFields): string {
  const body = members(fields)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");
  return `crewrig-provenance: ${body}`;
}

/** The one-line marker: an HTML comment (html), a `#` line (hash) or a block comment (block-js). */
export function markerLine(fields: ProvenanceFields, syntax: MarkerSyntax): string {
  const text = payload(fields);
  if (syntax === "html") return `<!-- ${text} -->`;
  if (syntax === "hash") return `# ${text}`;
  return `/* ${text} */`;
}

/** The YAML carrier: `metadata:`, `  provenance:`, then `    <key>: "<value>"` per member. */
export function markerYaml(fields: ProvenanceFields): string {
  const lines = ["metadata:", "  provenance:"];
  for (const [key, value] of members(fields)) lines.push(`    ${key}: "${value}"`);
  return lines.join("\n");
}

const MARKER_LINE: Record<MarkerSyntax, RegExp> = {
  html: /^<!--\s*crewrig-provenance:.*-->\s*$/,
  hash: /^#\s*crewrig-provenance:/,
  "block-js": /^\/\*\s*crewrig-provenance:.*\*\/\s*$/,
};

/** Where a marker of `syntax` goes in `lines`: after the frontmatter (html), line 1, or line 1 after `#!`. */
function insertionIndex(lines: string[], syntax: MarkerSyntax): number {
  if (syntax === "html") {
    if (lines[0] !== "---") return 0;
    const close = lines.indexOf("---", 1);
    return close < 0 ? 0 : close + 1;
  }
  if (syntax === "block-js" && lines[0]?.startsWith("#!")) return 1;
  return 0;
}

/**
 * Put exactly one marker in `text`. The run of consecutive marker lines of `syntax` that starts
 * at the first non-blank line at or after the insertion point is replaced in place, never
 * merged; with no such run the marker is inserted at the insertion point. Marker lines
 * elsewhere are content and stay. Blank lines and LF endings are kept; idempotent.
 */
export function replaceMarker(
  text: string,
  fields: ProvenanceFields,
  syntax: MarkerSyntax,
): string {
  const line = markerLine(fields, syntax);
  const lines = text.split("\n");
  const at = insertionIndex(lines, syntax);
  let first = at;
  while (first < lines.length && lines[first]?.trim() === "") first += 1;
  let end = first;
  while (end < lines.length && MARKER_LINE[syntax].test(lines[end] ?? "")) end += 1;
  if (end === first) {
    lines.splice(at, 0, line);
  } else {
    lines.splice(first, end - first, line);
  }
  return lines.join("\n");
}

/**
 * Place the YAML carrier in a frontmatter: before the second line of `text` that is exactly
 * `---`, `text` unchanged when there is none. An existing `metadata:` block that holds only a
 * `provenance` child is replaced, never merged.
 *
 * @throws ProvenanceMarkerError when `metadata:` already has another child (a second `metadata`
 *   key would be a duplicate YAML key).
 */
export function spliceMarkerYaml(text: string, fields: ProvenanceFields): string {
  const block = markerYaml(fields);
  const lines = text.split("\n");
  let open = -1;
  let close = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] !== "---") continue;
    if (open < 0) open = i;
    else {
      close = i;
      break;
    }
  }
  if (close < 0) return text;

  const start = lines.findIndex((l, i) => i > open && i < close && /^metadata:\s*$/.test(l));
  if (start < 0) {
    lines.splice(close, 0, block);
    return lines.join("\n");
  }
  let stop = start + 1;
  while (stop < close && (lines[stop] === "" || /^\s/.test(lines[stop] ?? ""))) stop += 1;
  const children = lines.slice(start + 1, stop).filter((l) => l.trim() !== "");
  const own = children.length > 0 && /^ {2}provenance:\s*$/.test(children[0] ?? "");
  const foreign = children.some((l) => /^ {2}\S/.test(l) && !/^ {2}provenance:\s*$/.test(l));
  if (!own || foreign) {
    throw new ProvenanceMarkerError(
      "provenance marker: the frontmatter already has a `metadata:` block with another child",
      "metadata",
    );
  }
  lines.splice(start, stop - start, block);
  return lines.join("\n");
}

/** The `name` of a `package.json`, a non-empty string. @throws ProvenanceMarkerError naming the file and `name`. */
export function packageNameOf(packageJsonPath: string): string {
  let name: unknown;
  try {
    name = (JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { name?: unknown }).name;
  } catch {
    throw new ProvenanceMarkerError(
      `${packageJsonPath}: cannot be read as JSON; \`name\` is required`,
      packageJsonPath,
    );
  }
  if (typeof name !== "string" || name.trim() === "") {
    throw new ProvenanceMarkerError(
      `${packageJsonPath}: \`name\` must be a non-empty string`,
      packageJsonPath,
    );
  }
  return name;
}
