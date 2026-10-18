// agent-profile-fixtures.ts — agent-source fixtures of the check-agent-profiles suites
// (spec 0265, row J2, P8). Replaces the Bash `render_base` / `render_case_file` generators.
//
// API:
//   baseFrontmatter()                 a fully conformant source frontmatter, as an object
//   writeSource(dir, stem, mutate?)   `<dir>/<stem>.md`: `---` + js-yaml dump + `Body.`; `mutate`
//                                     edits a fresh copy of the baseline in place (one cell each)
//   modelOf(doc)                      the `metadata.model` mapping of a frontmatter object
// The real js-yaml writes the files, so the on-disk quoting differs from `yq` output: the
// checker reads values, never quoting.

import fs from "node:fs";
import path from "node:path";

import { yamlLib } from "./yaml-lib.ts";

export type Doc = Record<string, unknown>;

/** A fully conformant profile: every axis and every tuning knob at a valid value. */
export function baseFrontmatter(): Doc {
  return {
    name: "probe",
    description: "Fixture agent source for the spec 0198 profile validator test suite.",
    metadata: {
      model: {
        intelligence: "medium",
        reasoning: "medium",
        specialization: "general",
        context: 100000,
        speed: "fast",
        modalities: ["text", "vision"],
        locality: "any",
        tuning: {
          temperature: 0.7,
          "top-p": 0.9,
          "top-k": 40,
          "max-output-tokens": 2048,
          "max-turns": 10,
        },
      },
    },
  };
}

/** The `metadata.model` mapping of `doc` (throws when the fixture lost it). */
export function modelOf(doc: Doc): Doc {
  const metadata = doc["metadata"] as Doc | undefined;
  const model = metadata?.["model"];
  if (typeof model !== "object" || model === null) throw new Error("no metadata.model in fixture");
  return model as Doc;
}

/** The source text of a frontmatter object. */
export function sourceText(doc: Doc): string {
  return `---\n${yamlLib.dump(doc)}---\nBody.\n`;
}

/** Write `<dir>/<stem>.md` from the baseline edited by `mutate`; returns the path. */
export function writeSource(dir: string, stem: string, mutate?: (doc: Doc) => void): string {
  const doc = baseFrontmatter();
  mutate?.(doc);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${stem}.md`);
  fs.writeFileSync(file, sourceText(doc));
  return file;
}
