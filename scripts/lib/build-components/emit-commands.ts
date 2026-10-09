// emit-commands.ts — compile the commands of one tier for the four CLIs (spec 0250 R13).
//
// Twins scripts/build-components.sh `build_commands` (:729-821): Gemini `.toml` (:756-760)
// and Claude Code `SKILL.md` (:766-770) from the shared renderer (spec 0042, twinned by
// scripts/lib/render-command.ts); Copilot (:775-800) and Antigravity (:805-819) compile a
// command as a skill, because neither CLI has a slash-command file. The body is never
// link-rewritten and no resource is propagated. Provenance is spliced into every file by
// `checkOrWrite` (it reads the source's own `metadata.provenance`).

import { joinRoot } from "./args.ts";
import {
  allowedToolsLines,
  componentName,
  globMarkdown,
  isDirectory,
  markdownFile,
  selects,
} from "./tiers.ts";
import { checkOrWrite } from "./write.ts";
import type { Ctx } from "./types.ts";

/** `build_commands <tier> <tier_dir>`, writing under `outRoot`. */
export function buildCommands(ctx: Ctx, tierDir: string, outRoot: string): void {
  const commandsDir = joinRoot(ctx.platform, tierDir, "commands");
  if (!isDirectory(commandsDir)) return;
  const out = (rel: string): string => joinRoot(ctx.platform, outRoot, rel);
  for (const file of globMarkdown(ctx, commandsDir)) {
    const source = ctx.fm.open(file);
    const name = componentName(ctx, source);
    if (name === null) continue;
    ctx.io.out(`Building command: ${name}`);
    const description = source.field("description");

    if (selects(ctx, "gemini")) {
      const toml = ctx.fm.render.renderCommandGemini(file);
      checkOrWrite(ctx, out(`.gemini/commands/${name}.toml`), toml, source, outRoot);
    }
    if (selects(ctx, "claude")) {
      const skill = ctx.fm.render.renderCommandClaude(file);
      checkOrWrite(ctx, out(`.claude/skills/${name}/SKILL.md`), skill, source, outRoot);
    }
    if (selects(ctx, "copilot")) {
      const frontmatter = [
        `name: ${name}`,
        `description: "${description}"`,
        ...allowedToolsLines(source),
      ];
      const content = markdownFile(frontmatter, source.body);
      checkOrWrite(ctx, out(`.github/skills/${name}/SKILL.md`), content, source, outRoot);
    }
    if (selects(ctx, "antigravity")) {
      const frontmatter = [`name: ${name}`, `description: "${description}"`];
      const content = markdownFile(frontmatter, source.body);
      checkOrWrite(ctx, out(`.agents/skills/${name}/SKILL.md`), content, source, outRoot);
    }
  }
}
