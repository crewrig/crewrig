// frontmatter.ts — build field access over the render-command twin (spec 0250 R10, R11).
//
// Twins scripts/build-components.sh `yaml_field` (:355) and `yaml_nested` (:361),
// plus the `yq -r` reads the emitters make inline (`.claude.allowed-tools // [] | .[]`,
// :609, :780). The file's extraction (`extract_frontmatter`, `extract_body`) and the
// text-level readers live in scripts/lib/render-command.ts and scripts/lib/yaml-text.ts;
// this module only binds them.
//
// One `YamlText` per process (built from the `js-yaml` namespace the entry loaded
// through `loadDependency`) is shared by the build and the render twin
// (`Frontmatter.render`), so a source is parsed the same way wherever it is read.
// A source is read and parsed once (`open`), not once per field as the shell did.

import { readTextLf } from "../line-endings.ts";
import { bodyOfText, createRenderCommand, frontmatterOfText } from "../render-command.ts";
import { createYamlText, toYamlLib } from "../yaml-text.ts";
import type { YamlText } from "../yaml-text.ts";
import type { Frontmatter, SourceDoc } from "./types.ts";

/** Remove every trailing line feed (the shell's `$(...)`). */
function withoutTrailingLf(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 10) end -= 1;
  return text.slice(0, end);
}

function sourceDoc(yaml: YamlText, file: string): SourceDoc {
  const text = readTextLf(file);
  const doc = yaml.parse(frontmatterOfText(text));
  return {
    file,
    body: bodyOfText(text),
    field: (name) => yaml.plain(doc, name),
    nested(path) {
      const rendered = yaml.plain(doc, path);
      return rendered === "null" ? "" : rendered;
    },
    alt: (path) => yaml.alt(doc, path),
    lines(path) {
      const joined = withoutTrailingLf(yaml.seq(doc, path).join("\n"));
      return joined === "" ? [] : joined.split("\n");
    },
    has: (path) => yaml.has(doc, path),
    entries: (path) => yaml.entries(doc, path),
  };
}

/**
 * Bind the readers to the `js-yaml` namespace `loadDependency("js-yaml")` returned.
 *
 * @throws TypeError when the namespace lacks what `toYamlLib` needs (a programming error).
 */
export function createFrontmatter(yamlNamespace: unknown): Frontmatter {
  const yaml = createYamlText(toYamlLib(yamlNamespace));
  return { yaml, render: createRenderCommand(yaml), open: (file) => sourceDoc(yaml, file) };
}
