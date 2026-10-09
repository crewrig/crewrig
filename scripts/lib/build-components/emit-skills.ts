// emit-skills.ts — compile the skills of one tier for the four CLIs (spec 0250 R13, R15).
//
// Twins scripts/build-components.sh `build_skills` (:531-725): Gemini :560-588, Claude
// :590-658, Copilot :660-690, Antigravity :692-723. The four files share one shape
// (`name`, `description`, `license`, `compatibility`); Claude Code adds its own fields
// after those. In tier `core` the body's relative links lose one `../` (:557). Each
// built skill then receives the skill's `scripts/`, `references/` and `assets/`.
//
// A source with no name is skipped with the shell's warning (tiers.ts `componentName`).
// `description` is written between double quotes and never escaped, as the shell wrote it.

import { joinRoot } from "./args.ts";
import { rewriteSkillBodyLinks } from "./links.ts";
import { propagateSkillResources } from "./resources.ts";
import {
  allowedToolsLines,
  componentName,
  globDirs,
  isDirectory,
  licenseLines,
  markdownFile,
  present,
  selects,
} from "./tiers.ts";
import { checkOrWrite, isRegularFile } from "./write.ts";
import type { CliId, Ctx, SourceDoc } from "./types.ts";

interface SkillTarget {
  readonly cli: CliId;
  /** Output directory of the CLI's skills, relative to the output root. */
  readonly dir: string;
}

/** Shell order: Gemini, Claude Code, Copilot, Antigravity. */
const TARGETS: readonly SkillTarget[] = [
  { cli: "gemini", dir: ".gemini/skills" },
  { cli: "claude", dir: ".claude/skills" },
  { cli: "copilot", dir: ".github/skills" },
  { cli: "antigravity", dir: ".agents/skills" },
];

/** The `claude.*` keys written after the shared lines, each when neither empty nor `null`. */
const CLAUDE_KEYS: readonly (readonly [string, string])[] = [
  ["user-invocable", "user-invocable"],
  ["disable-model-invocation", "disable-model-invocation"],
  ["context", "context"],
  ["agent", "agent"],
];

function claudeLines(source: SourceDoc): string[] {
  const lines = allowedToolsLines(source);
  for (const [key, label] of CLAUDE_KEYS) {
    const value = source.nested(["claude", key]);
    if (present(value)) lines.push(`${label}: ${value}`);
  }
  return lines;
}

/** `build_skills <tier> <tier_dir>`, writing under `outRoot`. */
export function buildSkills(ctx: Ctx, tier: string, tierDir: string, outRoot: string): void {
  const skillsDir = joinRoot(ctx.platform, tierDir, "skills");
  if (!isDirectory(skillsDir)) return;
  for (const skillDir of globDirs(ctx, skillsDir)) {
    const sourceFile = joinRoot(ctx.platform, skillDir, "SKILL.md");
    if (!isRegularFile(sourceFile)) continue;
    const source = ctx.fm.open(sourceFile);
    const name = componentName(ctx, source);
    if (name === null) continue;
    ctx.io.out(`Building skill: ${name}`);

    const body = tier === "core" ? rewriteSkillBodyLinks(source.body) : source.body;
    const description = source.field("description");
    for (const target of TARGETS) {
      if (!selects(ctx, target.cli)) continue;
      const frontmatter = [
        `name: ${name}`,
        `description: "${description}"`,
        ...licenseLines(source),
        ...(target.cli === "claude" ? claudeLines(source) : []),
      ];
      const outDir = joinRoot(ctx.platform, outRoot, `${target.dir}/${name}`);
      checkOrWrite(
        ctx,
        joinRoot(ctx.platform, outDir, "SKILL.md"),
        markdownFile(frontmatter, body),
        source,
        outRoot,
      );
      propagateSkillResources(ctx, skillDir, outDir, outRoot);
    }
  }
}
