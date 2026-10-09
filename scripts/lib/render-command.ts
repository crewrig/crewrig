// render-command.ts — TypeScript twin of scripts/lib/render-command.sh, the shared
// command renderer (spec 0042; spec 0250 R18).
//
// Twin of the shell library: change both, and keep them equal. The conformance
// test `scripts/tests/build-components-conformance.test.ts` compares the two.
// The library is complete, all six of its functions, because row G1b (the
// extension and plugin builders) reuses it unchanged.
//
// No precedent (spec 0250 R2): the sibling libraries `component-resolve` and
// `model-resolve` moved only a slice, because the step (b) build depends on that
// slice. That is not a precedent for the other consumers of those shell libraries.
//
// ── Injection of the YAML reader ─────────────────────────────────────────────
// `js-yaml` is a devDependency until the dependency move of spec 0250 R24, and it
// is loaded only through `loadDependency`, so nothing here imports it. The caller
// builds a `YamlText` (scripts/lib/yaml-text.ts: `createYamlText(toYamlLib(ns))`)
// and passes it to `createRenderCommand`, once per process:
//
//   const render = createRenderCommand(createYamlText(toYamlLib(loadYamlNamespace())));
//   render.renderCommandGemini(source);
//
// The build entry (`scripts/lib/build-components/frontmatter.ts`) and the
// extension builders share one instance. The two functions that read no YAML are
// also exported on their own (`extractFrontmatter`, `extractBody`) together with
// their text-level forms, for a caller that already holds the file's text.
//
// ── Contract ─────────────────────────────────────────────────────────────────
// Files are read through `readTextLf`: LF, CRLF and a leading byte-order mark are
// accepted (spec 0250 R10, deviation R33(e): the shell found no frontmatter in a
// CRLF or BOM source). Every returned string carries no trailing line feed, as the
// shell's command substitution removed it; callers add one. The unreadable-source
// case is not softened: `readTextLf` throws, where the shell printed awk's own
// diagnostic and carried on, so a caller that must refuse a source (`--resolve`,
// R6) catches it. A frontmatter that does not parse reads as having no field.

import { readTextLf } from "./line-endings.ts";
import type { YamlDoc, YamlText } from "./yaml-text.ts";

/** The renderer bound to one YAML reader. Each member twins one shell function. */
export interface RenderCommand {
  /** `extract_frontmatter`: the lines between line 1 `---` and the next `---`. */
  extractFrontmatter(file: string): string;
  /** `extract_body`: every line after the second line that is exactly `---`. */
  extractBody(file: string): string;
  /** `yaml_field`: a frontmatter field as `yq -r ".<field>"` printed it. */
  yamlField(file: string, field: string): string;
  /** `render_command_toml_provenance_comment`: the `# crewrig-provenance:` line, or empty. */
  renderCommandTomlProvenanceComment(frontmatter: string): string;
  /** `render_command_gemini`: the Gemini CLI `.toml` form of a command source. */
  renderCommandGemini(source: string): string;
  /** `render_command_claude`: the Claude Code `SKILL.md` form of a command source. */
  renderCommandClaude(source: string): string;
}

/** The text of a file as awk's records: split at LF, the final terminator ends no record. */
function linesOf(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Remove every trailing line feed (the shell's `$(...)`). */
function withoutTrailingLf(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 10) end -= 1;
  return text.slice(0, end);
}

/** `awk 'NR==1 && /^---$/{inblk=1; next} inblk && /^---$/{exit} inblk{print}'`, on text. */
export function frontmatterOfText(text: string): string {
  const lines = linesOf(text);
  if (lines[0] !== "---") return "";
  const kept: string[] = [];
  for (const line of lines.slice(1)) {
    if (line === "---") break;
    kept.push(line);
  }
  return withoutTrailingLf(kept.join("\n"));
}

/** `awk 'BEGIN{c=0} /^---$/{c++; if(c==2){found=1; next}} found{print}'`, on text. */
export function bodyOfText(text: string): string {
  const kept: string[] = [];
  let dashes = 0;
  let found = false;
  for (const line of linesOf(text)) {
    if (line === "---") {
      dashes += 1;
      if (dashes === 2) {
        found = true;
        continue;
      }
    }
    if (found) kept.push(line);
  }
  return withoutTrailingLf(kept.join("\n"));
}

/** `extract_frontmatter <file>`, reading through `readTextLf`. */
export function extractFrontmatter(file: string): string {
  return frontmatterOfText(readTextLf(file));
}

/** `extract_body <file>`, reading through `readTextLf`. */
export function extractBody(file: string): string {
  return bodyOfText(readTextLf(file));
}

/** The provenance comment of a parsed frontmatter; `` when `metadata` has no `provenance`. */
function provenanceComment(yaml: YamlText, doc: YamlDoc | null): string {
  if (!yaml.has(doc, ["metadata", "provenance"])) return "";
  const version = yaml.alt(doc, ["metadata", "provenance", "version"]);
  const canonical = yaml.alt(doc, ["metadata", "provenance", "canonical"]);
  const feedback = yaml.alt(doc, ["metadata", "provenance", "feedback"]);
  return `# crewrig-provenance: version="${version}" canonical="${canonical}" feedback="${feedback}"`;
}

/** One source read once: its parsed frontmatter and its body. */
interface Source {
  readonly doc: YamlDoc | null;
  readonly body: string;
}

function readSource(yaml: YamlText, file: string): Source {
  const text = readTextLf(file);
  return { doc: yaml.parse(frontmatterOfText(text)), body: bodyOfText(text) };
}

/** Bind the renderer to a YAML reader (see the header for the injection). */
export function createRenderCommand(yaml: YamlText): RenderCommand {
  return {
    extractFrontmatter,
    extractBody,

    yamlField(file, field) {
      return yaml.plain(yaml.parse(extractFrontmatter(file)), field);
    },

    renderCommandTomlProvenanceComment(frontmatter) {
      return provenanceComment(yaml, yaml.parse(frontmatter));
    },

    renderCommandGemini(source) {
      const { doc, body } = readSource(yaml, source);
      const description = yaml.plain(doc, "description");
      const base = `description = "${description}"\n\nprompt = """\n${body}\n"""`;
      const comment = provenanceComment(yaml, doc);
      // The `#` line sits at top level above `description`, never in the prompt.
      return comment === "" ? base : `${comment}\n${base}`;
    },

    renderCommandClaude(source) {
      const { doc, body } = readSource(yaml, source);
      const name = yaml.plain(doc, "name");
      const description = yaml.plain(doc, "description");
      let frontmatter = `name: ${name}\ndescription: "${description}"\nuser-invocable: true`;
      // `yq` printed one element per line and the substitution dropped the tail.
      const tools = withoutTrailingLf(yaml.seq(doc, ["claude", "allowed-tools"]).join("\n"));
      if (tools !== "") {
        frontmatter += "\nallowed-tools:";
        for (const tool of tools.split("\n")) frontmatter += `\n  - ${tool}`;
      }
      return `---\n${frontmatter}\n---\n\n${body}`;
    },
  };
}
