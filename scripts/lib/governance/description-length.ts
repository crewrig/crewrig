// description-length.ts — cap on a skill or agent `description` (spec 0269 R11).
//
// A description is loaded into every session for routing, so it is held to
// MAX_DESCRIPTION_CHARS. Checked on the sources under artifacts/ and on every compiled
// skill/agent output. `js-yaml` is loaded by the caller and handed in (never imported here).

import fs from "node:fs";
import path from "node:path";

export const MAX_DESCRIPTION_CHARS = 300;

/** Globs, relative to the repository root, of every file whose description is capped. */
export const DESCRIPTION_GLOBS: readonly string[] = [
  "artifacts/*/skills/*/SKILL.md",
  "artifacts/*/agents/*/AGENT.md",
  ".claude/skills/*/SKILL.md",
  ".claude/agents/*.md",
  ".gemini/skills/*/SKILL.md",
  ".gemini/agents/*.md",
  ".github/skills/*/SKILL.md",
  ".github/agents/*.md",
  ".agents/skills/*/SKILL.md",
  ".agents/agents/*/AGENT.md",
];

interface YamlNamespace {
  load(input: string): unknown;
}

/** The `description` of a fenced front matter, or null when absent or unreadable. */
export function readDescription(text: string, yaml: YamlNamespace): string | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") return null;
  const close = lines.indexOf("---", 1);
  if (close < 0) return null;
  let doc: unknown;
  try {
    doc = yaml.load(lines.slice(1, close).join("\n"));
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null) return null;
  const value = (doc as Record<string, unknown>)["description"];
  return typeof value === "string" ? value : null;
}

export interface DescriptionFinding {
  readonly file: string;
  readonly length: number;
}

/** Every capped file under `repoDir` whose description is longer than the cap. */
export function findOverlong(repoDir: string, yaml: YamlNamespace): DescriptionFinding[] {
  const found: DescriptionFinding[] = [];
  const files = DESCRIPTION_GLOBS.flatMap((glob) => fs.globSync(glob, { cwd: repoDir })).sort();
  for (const rel of files) {
    const description = readDescription(fs.readFileSync(path.join(repoDir, rel), "utf8"), yaml);
    if (description === null) continue;
    const length = [...description.trim()].length;
    if (length > MAX_DESCRIPTION_CHARS) found.push({ file: rel, length });
  }
  return found;
}
