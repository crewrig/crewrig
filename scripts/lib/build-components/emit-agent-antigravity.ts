// emit-agent-antigravity.ts — the Antigravity CLI agent file (spec 0250 R13).
//
// Twins scripts/build-components.sh `build_agents`, Antigravity branch (:987-1076): the
// directory layout `.agents/agents/<name>/AGENT.md`, modelled on the Claude Code agent.
// The capability profile is resolved for `antigravity` first (the mapping declares no
// frontmatter surface, so the directed lines are always empty and the model item reaches
// the description alone), then the frontmatter is `name`, `description`, `license`,
// `compatibility`, the three `enable_*` lines, the directed lines.
//
// The `enable_*` rule (:1017-1058). Each key is read only when `antigravity` has it
// (`has`), so an explicit `false` is kept; the text then counts when it is neither empty
// nor `null`. `enable_write_tools` alone falls back to `true` when it does not count and
// `claude.allowed-tools` has an element equal to `Bash`.

import { resolveAgent } from "../model-resolve.ts";
import type { ResolveContext } from "../model-resolve.ts";
import { joinRoot } from "./args.ts";
import { emitDiagLine } from "./diagnostics.ts";
import { licenseLines, markdownFile, present } from "./tiers.ts";
import { checkOrWrite } from "./write.ts";
import type { Ctx, SourceDoc } from "./types.ts";

/** One agent source, read once, with the fields every CLI's file starts from. */
export interface AgentJob {
  readonly name: string;
  readonly description: string;
  readonly source: SourceDoc;
  readonly outRoot: string;
}

/** `has("<key>")` then `yq -r`: the written text of `antigravity.<key>`, empty when absent. */
function enableValue(source: SourceDoc, key: string): string {
  const keys = ["antigravity", key];
  return source.has(keys) ? source.nested(keys) : "";
}

/** `enable_write_tools`, with the `Bash` fallback; empty when it is not written. */
function writeTools(source: SourceDoc): string {
  const declared = enableValue(source, "enable_write_tools");
  if (present(declared)) return declared;
  return source.lines(["claude", "allowed-tools"]).includes("Bash") ? "true" : "";
}

/** Resolve the profile for `antigravity` and write `.agents/agents/<name>/AGENT.md`. */
export function emitAntigravityAgent(ctx: Ctx, model: ResolveContext, job: AgentJob): void {
  const { name, description, source } = job;
  const resolved = resolveAgent(model, name, source.file, "antigravity");
  for (const line of resolved.diagLines) emitDiagLine(ctx, line);

  const withProse = resolved.prose === "" ? description : `${description} ${resolved.prose}`;
  const frontmatter = [`name: ${name}`, `description: "${withProse}"`, ...licenseLines(source)];
  const enables: readonly (readonly [string, string])[] = [
    ["enable_write_tools", writeTools(source)],
    ["enable_mcp_tools", enableValue(source, "enable_mcp_tools")],
    ["enable_subagent_tools", enableValue(source, "enable_subagent_tools")],
  ];
  for (const [key, value] of enables) {
    if (present(value)) frontmatter.push(`${key}: ${value}`);
  }
  frontmatter.push(...resolved.fmLines);

  const target = joinRoot(ctx.platform, job.outRoot, `.agents/agents/${name}/AGENT.md`);
  checkOrWrite(ctx, target, markdownFile(frontmatter, source.body), source, job.outRoot);
}
