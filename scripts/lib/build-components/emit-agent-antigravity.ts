// emit-agent-antigravity.ts — the Antigravity CLI agent file (spec 0053 delta-01 R11-R13,
// superseded for `tools` by spec 0291 delta-03 R37-R41).
//
// Supersedes the directory layout of spec 0250 R13 and R15 (`.agents/agents/<name>/AGENT.md`
// with `license`, `compatibility` and the `enable_*` keys): the compiled agent is the flat
// regular file `.agents/agents/<name>.md`, whose frontmatter is `name`, `description`, `tools`
// and the `metadata` provenance block, in that order, and nothing else. The capability profile
// is still resolved for `antigravity` first (the mapping declares no frontmatter surface, so the
// directed lines are always empty and the model item reaches the description alone).
//
// The build never reads `antigravity.enable_*` (a source that still declares one builds
// silently) and derives nothing from `claude.allowed-tools`, `Bash` included (R13). The `tools`
// line comes from `metadata.tools` (R37-R39) or, when absent, is the vendor's all-tools line
// (R40): an omitted key gives a read-only default on `agy`. A declared class with no Antigravity
// name (`skill`) is dropped with a `tools-drop` record. After the write, the retired
// `.agents/agents/<name>/` directory is reconciled (retire-agent.ts).

import { resolveAgent } from "../model-resolve.ts";
import type { ResolveContext } from "../model-resolve.ts";
import { joinRoot } from "./args.ts";
import { ANTIGRAVITY_DEFAULT_TOOLS, noToolName, toolsDrop, toolsLine } from "./agent-tools.ts";
import type { ToolClass } from "./agent-tools.ts";
import { emitDiagLine } from "./diagnostics.ts";
import { reconcileRetiredAgentDir } from "./retire-agent.ts";
import { markdownFile } from "./tiers.ts";
import { provenanceFields } from "./provenance.ts";
import { checkOrWrite } from "./write.ts";
import { BuildFailure } from "./types.ts";
import type { Ctx, SourceDoc } from "./types.ts";

/** One agent source, read once, with the fields every CLI's file starts from. */
export interface AgentJob {
  readonly name: string;
  readonly description: string;
  readonly source: SourceDoc;
  readonly outRoot: string;
  /** The compiled body every CLI writes: source body, a blank line, the conventions block (R6). */
  readonly body: string;
  /** The validated `metadata.tools` classes in vocabulary order; `null` when not declared. */
  readonly tools: readonly ToolClass[] | null;
}

/** Resolve the profile for `antigravity` and write `.agents/agents/<name>.md`. */
export function emitAntigravityAgent(ctx: Ctx, model: ResolveContext, job: AgentJob): void {
  const { name, description, source } = job;
  const resolved = resolveAgent(model, name, source.file, "antigravity");
  for (const line of resolved.diagLines) emitDiagLine(ctx, line);

  const withProse = resolved.prose === "" ? description : `${description} ${resolved.prose}`;
  // Spec 0053 delta-01 R12: no directed lines exist for antigravity; fail loudly if that changes.
  if (resolved.fmLines.length > 0) {
    throw new BuildFailure(
      `Error: ${source.file}: the antigravity profile produced frontmatter lines; the flat agent carries none`,
    );
  }
  const frontmatter = [`name: ${name}`, `description: "${withProse}"`];
  if (job.tools === null) {
    frontmatter.push(ANTIGRAVITY_DEFAULT_TOOLS);
  } else {
    const { line, omitted } = toolsLine("antigravity", job.tools);
    if (omitted.length === job.tools.length) throw noToolName(source, "antigravity", job.tools);
    if (omitted.length > 0)
      emitDiagLine(ctx, toolsDrop(name, "antigravity", omitted, "no-equivalent-on-cli"));
    frontmatter.push(line);
  }

  const target = joinRoot(ctx.platform, job.outRoot, `.agents/agents/${name}.md`);
  checkOrWrite(
    ctx,
    target,
    markdownFile(frontmatter, job.body),
    provenanceFields(source, ctx.config, ctx.packageName),
    job.outRoot,
  );
  reconcileRetiredAgentDir(ctx, job.outRoot, name);
}
