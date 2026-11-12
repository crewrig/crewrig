// frontmatter.ts — read a SKILL.md into its frontmatter object, its body and its line count
// (spec 0293 R3, R9). `js-yaml` is loaded by the caller and handed in, never imported here.
//
// Usage: const doc = parseSkill(text, yaml).
// Exit codes: not applicable (library). Finding-line format: not applicable.

import type { YamlNamespace } from "./types.ts";

export interface SkillDoc {
  /** The parsed frontmatter, or null when absent or unreadable. */
  readonly front: Record<string, unknown> | null;
  /** Lines of the whole file, the frontmatter included (the R9 size is measured on it). */
  readonly lineCount: number;
  /** The file text after the closing frontmatter delimiter. */
  readonly body: string;
}

export function parseSkill(text: string, yaml: YamlNamespace): SkillDoc {
  const lf = text.replace(/\r\n/g, "\n");
  const lines = lf.split("\n");
  const lineCount = lf.endsWith("\n") ? lines.length - 1 : lines.length;
  if (lines[0] !== "---") return { front: null, lineCount, body: lf };
  const close = lines.indexOf("---", 1);
  if (close < 0) return { front: null, lineCount, body: lf };
  let front: Record<string, unknown> | null = null;
  try {
    const doc = yaml.load(lines.slice(1, close).join("\n"));
    if (typeof doc === "object" && doc !== null && !Array.isArray(doc))
      front = doc as Record<string, unknown>;
  } catch {
    front = null;
  }
  return { front, lineCount, body: lines.slice(close + 1).join("\n") };
}
