// text-rules.ts — the rules that read only a skill's frontmatter, body and reference text
// (spec 0293 R3, R8, R9). Each function returns raw findings; run.ts attaches severity.
//
// Usage: import { frontRules, promptRules, referenceShape } from "./text-rules.ts".
// Exit codes: not applicable (library). Finding-line format: not applicable.

import { MAX_DESCRIPTION_CHARS } from "../governance/description-length.ts";
import { proseLines } from "../skill-citations/grammar.ts";
import type { SkillDoc } from "./frontmatter.ts";
import type { Raw } from "./types.ts";

export const MAX_BODY_LINES = 500;
export const MAX_EMPHASIS = 5;
export const TOC_THRESHOLD = 100;
export const TOC_WINDOW = 20;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PERSON = /\b(?:I|(?:i'm|i'll|me|my|we|our|you|your|you'll))\b/gi;
const EMPHASIS = /\b(?:MUST|NEVER|CRITICAL|ALWAYS|IMPORTANT)\b/g;
const CITATION = /\bspec \d{4}\b|\bR\d+\b|#\d{3,}/g;

/** Name, description, compatibility and size (R3, R9). */
export function frontRules(doc: SkillDoc, dirName: string, file: string): Raw[] {
  const out: Raw[] = [];
  const add = (rule: string, message: string): number => out.push({ rule, message, file });
  if (doc.front === null) {
    add(
      "frontmatter",
      "SKILL.md has no readable YAML frontmatter; add a `---` block with `name`, `description` and `compatibility`",
    );
    return out;
  }
  const name = doc.front["name"];
  if (typeof name !== "string" || name.length === 0 || name.length > 64 || !NAME.test(name))
    add(
      "name",
      "`name` must be 1 to 64 characters of lowercase letters, digits and single hyphens, with no hyphen at either end",
    );
  else if (name !== dirName)
    add("name", `\`name\` is "${name}" but the directory is "${dirName}"; make them equal`);
  const description = doc.front["description"];
  if (typeof description !== "string" || description.trim() === "") {
    add(
      "description-missing",
      "`description` is missing or empty; state what the skill does, `Use when` and its trigger terms",
    );
  } else {
    const text = description.trim();
    const length = [...text].length;
    if (length > MAX_DESCRIPTION_CHARS)
      add(
        "description-length",
        `description is ${length} characters; the cap is ${MAX_DESCRIPTION_CHARS}`,
      );
    if (!/\bUse when\b/i.test(text))
      add(
        "description-use-when",
        "description has no `Use when` clause; add one naming the situations that call for the skill",
      );
    const pronoun = text.match(PERSON);
    if (pronoun !== null)
      add(
        "description-person",
        `description is not in the third person (found "${pronoun[0]}"); state what the skill does, not what "you" or "I" do`,
      );
  }
  const compat = doc.front["compatibility"];
  if (typeof compat !== "string" || compat.trim() === "" || compat.length > 500)
    add(
      "compatibility",
      "`compatibility` must be present, non-empty and at most 500 characters; name the runtime and tools the skill needs",
    );
  if (doc.lineCount > MAX_BODY_LINES)
    add(
      "body-length",
      `SKILL.md has ${doc.lineCount} lines; the limit is ${MAX_BODY_LINES}; move detail into references/`,
    );
  return out;
}

/** Capitalised emphasis and spec or issue citations in the prose of a file (R8). */
export function promptRules(text: string, file: string, skipFrontmatter: boolean): Raw[] {
  const out: Raw[] = [];
  const prose = proseLines(text, skipFrontmatter);
  let emphasis = 0;
  for (const l of prose) {
    emphasis += l.text.match(EMPHASIS)?.length ?? 0;
    for (const m of l.text.matchAll(CITATION))
      out.push({
        rule: "prompt-citation",
        message: `"${m[0]}" cites a specification or an issue in a runtime prompt; state the reason of the rule instead, traceability belongs in specs and commit history`,
        file,
        line: l.line,
      });
  }
  if (emphasis > MAX_EMPHASIS)
    out.push({
      rule: "prompt-emphasis",
      message: `${emphasis} capitalised emphasis words (limit ${MAX_EMPHASIS}); explain the reason of each rule instead of stacking MUST, NEVER or CRITICAL`,
      file,
    });
  return out;
}

/** A reference longer than the threshold opens with a table of contents (R9). */
export function referenceShape(text: string, file: string): Raw[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const count = text.endsWith("\n") ? lines.length - 1 : lines.length;
  if (count <= TOC_THRESHOLD) return [];
  const head = lines.slice(0, TOC_WINDOW);
  if (head.some((l) => /^#{1,6}\s*(?:Contents|Table of contents)\s*$/i.test(l.trim()))) return [];
  return [
    {
      rule: "reference-toc",
      message: `reference has ${count} lines and no \`Contents\` heading in its first ${TOC_WINDOW}; add a table of contents`,
      file,
    },
  ];
}
