// provenance.ts — provenance block, Gemini comment and splice (spec 0250 R12).
//
// Twins scripts/build-components.sh `provenance_block` (:263-274),
// `gemini_provenance_comment` (:282-295) and `inject_provenance` (:307-339).
//
// A source carries provenance when its `metadata` is a mapping that has the key
// `provenance`. Values are rendered as scalars (a null renders empty; a double
// quote inside a value is not escaped). A provenance entry that is a mapping or a
// sequence is a build error, where the shell emitted an empty block (a listed
// deviation). Nothing returned here carries a trailing line feed.

import { escapeControl } from "./diagnostics.ts";
import { BuildFailure } from "./types.ts";
import type { SourceDoc } from "./types.ts";

const PROVENANCE = ["metadata", "provenance"] as const;

/**
 * `provenance_block`: `metadata:`, `  provenance:`, then `    <key>: "<value>"` per entry
 * in document order; the empty string when the source has no `metadata.provenance`.
 *
 * @throws BuildFailure (status 1) naming the source, on an entry that is not a scalar.
 */
export function provenanceBlock(source: SourceDoc): string {
  if (!source.has(PROVENANCE)) return "";
  const lines = ["metadata:", "  provenance:"];
  for (const entry of source.entries(PROVENANCE)) {
    if (entry.kind !== "scalar") {
      throw new BuildFailure(
        `Error: ${escapeControl(source.file)}: metadata.provenance.${escapeControl(entry.key)} is a mapping or a sequence; a provenance entry must be a scalar`,
      );
    }
    lines.push(`    ${entry.key}: "${entry.text}"`);
  }
  return lines.join("\n");
}

/**
 * `gemini_provenance_comment`: `<!-- crewrig-provenance: version="<v>" canonical="<c>"
 * feedback="<f>" -->`, each field read as `// ""`; the empty string without provenance.
 */
export function geminiProvenanceComment(source: SourceDoc): string {
  if (!source.has(PROVENANCE)) return "";
  const version = source.alt([...PROVENANCE, "version"]);
  const canonical = source.alt([...PROVENANCE, "canonical"]);
  const feedback = source.alt([...PROVENANCE, "feedback"]);
  return `<!-- crewrig-provenance: version="${version}" canonical="${canonical}" feedback="${feedback}" -->`;
}

/**
 * `inject_provenance`: the block inserted before the second line of `content` that is
 * exactly `---`; `content` unchanged when the source has no provenance or the content
 * has fewer than two such lines. Placeholders are resolved after this splice (by the
 * caller), so a `${CANONICAL_REPO}` inside a value is resolved.
 */
export function injectProvenance(content: string, source: SourceDoc): string {
  const block = provenanceBlock(source);
  if (block === "") return content;
  const lines = content.split("\n");
  let fences = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] !== "---") continue;
    fences += 1;
    if (fences === 2) {
      lines.splice(i, 0, block);
      return lines.join("\n");
    }
  }
  return content;
}
