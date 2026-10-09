// emit-agents.ts — compile the agents of one tier for the four CLIs (spec 0250 R13, R19).
//
// Twins scripts/build-components.sh `build_agents` (:825-1076): Gemini :855-897, Claude
// :900-949, Copilot :955-985; the Antigravity branch is emit-agent-antigravity.ts.
// For each CLI the agent's capability profile is resolved against that CLI's mapping
// first (`resolveAgent`, spec 0198), every diagnostic line goes to standard error and to
// `--diagnostics`, and the CLI's own `description` is the source description followed by
// one space and the resolved prose when there is prose. `description` itself is never
// reassigned, so each CLI composes its own (spec 0198 R5).
//
// Files. Claude Code, Copilot and Antigravity: `---`, frontmatter, `---`, an empty line,
// the body, with the provenance block spliced in. Gemini CLI: the frontmatter carries no
// `metadata:` (Gemini rejects it, issue #54), so the provenance travels as an HTML comment
// on the line after the closing `---`, an empty line when there is none, and no splice
// (the source argument of the write is `null`).

import { resolveAgent } from "../model-resolve.ts";
import type { ResolveContext, ResolveResult } from "../model-resolve.ts";
import { joinRoot } from "./args.ts";
import { emitDiagLine } from "./diagnostics.ts";
import { emitAntigravityAgent } from "./emit-agent-antigravity.ts";
import type { AgentJob } from "./emit-agent-antigravity.ts";
import { geminiProvenanceComment } from "./provenance.ts";
import {
  componentName,
  globDirs,
  isDirectory,
  licenseLines,
  markdownFile,
  selects,
} from "./tiers.ts";
import { checkOrWrite, isRegularFile } from "./write.ts";
import type { CliId, Ctx } from "./types.ts";

/** Resolve the profile of `job` for `cli` and write its diagnostics. */
function resolveFor(ctx: Ctx, model: ResolveContext, job: AgentJob, cli: CliId): ResolveResult {
  const resolved = resolveAgent(model, job.name, job.source.file, cli);
  for (const line of resolved.diagLines) emitDiagLine(ctx, line);
  return resolved;
}

/** The `name`, `description` and directed lines every CLI's agent file starts from. */
function head(job: AgentJob, resolved: ResolveResult): string[] {
  const description =
    resolved.prose === "" ? job.description : `${job.description} ${resolved.prose}`;
  return [`name: ${job.name}`, `description: "${description}"`];
}

function emitGemini(ctx: Ctx, model: ResolveContext, job: AgentJob): void {
  const resolved = resolveFor(ctx, model, job, "gemini");
  const frontmatter = [...head(job, resolved), ...resolved.fmLines];
  const comment = geminiProvenanceComment(job.source);
  const content = `---\n${frontmatter.join("\n")}\n---\n${comment}\n${job.source.body}`;
  const target = joinRoot(ctx.platform, job.outRoot, `.gemini/agents/${job.name}.md`);
  checkOrWrite(ctx, target, content, null, job.outRoot);
}

function emitClaude(ctx: Ctx, model: ResolveContext, job: AgentJob): void {
  const resolved = resolveFor(ctx, model, job, "claude");
  const frontmatter = [...head(job, resolved), ...licenseLines(job.source), ...resolved.fmLines];
  const target = joinRoot(ctx.platform, job.outRoot, `.claude/agents/${job.name}.md`);
  checkOrWrite(ctx, target, markdownFile(frontmatter, job.source.body), job.source, job.outRoot);
}

function emitCopilot(ctx: Ctx, model: ResolveContext, job: AgentJob): void {
  const resolved = resolveFor(ctx, model, job, "copilot");
  const frontmatter = [...head(job, resolved), ...resolved.fmLines];
  const target = joinRoot(ctx.platform, job.outRoot, `.github/agents/${job.name}.md`);
  checkOrWrite(ctx, target, markdownFile(frontmatter, job.source.body), job.source, job.outRoot);
}

/** `build_agents <tier> <tier_dir>`, writing under `outRoot`. */
export function buildAgents(
  ctx: Ctx,
  model: ResolveContext,
  tierDir: string,
  outRoot: string,
): void {
  const agentsDir = joinRoot(ctx.platform, tierDir, "agents");
  if (!isDirectory(agentsDir)) return;
  for (const agentDir of globDirs(ctx, agentsDir)) {
    const sourceFile = joinRoot(ctx.platform, agentDir, "AGENT.md");
    if (!isRegularFile(sourceFile)) continue;
    const source = ctx.fm.open(sourceFile);
    const name = componentName(ctx, source);
    if (name === null) continue;
    ctx.io.out(`Building agent: ${name}`);

    const job: AgentJob = { name, description: source.field("description"), source, outRoot };
    if (selects(ctx, "gemini")) emitGemini(ctx, model, job);
    if (selects(ctx, "claude")) emitClaude(ctx, model, job);
    if (selects(ctx, "copilot")) emitCopilot(ctx, model, job);
    if (selects(ctx, "antigravity")) emitAntigravityAgent(ctx, model, job);
  }
}
