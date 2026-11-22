// provenance.ts — the build's adapter over the shared marker writer (spec 0250 R12, spec 0316 R8).
//
// `scripts/lib/provenance-marker.ts` writes every marker byte. This module maps a source's
// authored `metadata.provenance` plus the root package name to `ProvenanceFields`, and
// turns the writer's refusals into build failures. A source with no `metadata.provenance`
// gets no marker. Nothing returned here carries a trailing line feed.

import { ProvenanceMarkerError, replaceMarker, spliceMarkerYaml } from "../provenance-marker.ts";
import type { MarkerSyntax, ProvenanceFields } from "../provenance-marker.ts";
import { resolvePlaceholders } from "./config.ts";
import { escapeControl } from "./diagnostics.ts";
import { BuildFailure } from "./types.ts";
import type { Config, SourceDoc } from "./types.ts";

const PROVENANCE = ["metadata", "provenance"] as const;
const AUTHORED = ["version", "canonical", "feedback"] as const;

/**
 * The marker fields of a source: its authored `version`, `canonical` and `feedback` plus the
 * root package name; `null` without `metadata.provenance` (spec 0316 R8). An authored
 * `package` or `extension` is dropped (R2: the build is the only writer of `package`). Values
 * are placeholder-resolved here so the writer validates the final text.
 *
 * @throws BuildFailure (status 1) naming the source, on a non-scalar or unknown entry.
 */
export function provenanceFields(
  source: SourceDoc,
  config: Config,
  packageName: string,
): ProvenanceFields | null {
  if (!source.has(PROVENANCE)) return null;
  for (const entry of source.entries(PROVENANCE)) {
    if (entry.kind !== "scalar") {
      throw new BuildFailure(
        `Error: ${escapeControl(source.file)}: metadata.provenance.${escapeControl(entry.key)} is a mapping or a sequence; a provenance entry must be a scalar`,
      );
    }
    if (entry.key === "package" || entry.key === "extension") continue;
    if (!(AUTHORED as readonly string[]).includes(entry.key)) {
      throw new BuildFailure(
        `Error: ${escapeControl(source.file)}: metadata.provenance.${escapeControl(entry.key)} is not a provenance field (expected ${AUTHORED.join(", ")})`,
      );
    }
  }
  const read = (key: (typeof AUTHORED)[number]): string =>
    resolvePlaceholders(config, source.alt([...PROVENANCE, key]));
  return {
    package: packageName,
    version: read("version"),
    canonical: read("canonical"),
    feedback: read("feedback"),
  };
}

/** Run a writer call, turning its refusal into a build failure that names `file`. */
export function guardMarker<T>(file: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (!(error instanceof ProvenanceMarkerError)) throw error;
    throw new BuildFailure(`Error: ${escapeControl(file)}: ${escapeControl(error.message)}`);
  }
}

/** The one-line marker of `fields` placed in `content` (replaced, never merged). */
export function withMarkerLine(
  file: string,
  content: string,
  fields: ProvenanceFields,
  syntax: MarkerSyntax,
): string {
  return guardMarker(file, () => replaceMarker(content, fields, syntax));
}

/**
 * The YAML carrier spliced into a frontmatter (see `spliceMarkerYaml`); `content` unchanged
 * without fields. Placeholders are already resolved in the fields.
 */
export function injectProvenance(content: string, fields: ProvenanceFields | null): string {
  return fields === null ? content : spliceMarkerYaml(content, fields);
}

const PROVENANCE_COMMENT = /<!--\s*provenance:[\s\S]*?-->/g;

/**
 * Strip `<!-- provenance: ... -->` citation comments (spec 0269 R7). A comment alone on
 * its line is removed with the line; an inline one is removed alone. Only the `provenance:`
 * form matches: the Gemini carrier `<!-- crewrig-provenance: ... -->` and every other
 * comment are kept.
 */
export function stripProvenanceComments(text: string): string {
  if (!text.includes("<!--")) return text;
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (!PROVENANCE_COMMENT.test(line)) {
      out.push(line);
      PROVENANCE_COMMENT.lastIndex = 0;
      continue;
    }
    PROVENANCE_COMMENT.lastIndex = 0;
    const rest = line.replace(PROVENANCE_COMMENT, "");
    if (rest.trim() !== "") out.push(rest);
  }
  return out.join("\n");
}
