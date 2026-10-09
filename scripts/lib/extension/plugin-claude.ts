// plugin-claude.ts — the Claude Code plugin renderer (spec 0254 R11, R17, R18).
// Twin of scripts/build-claude-plugin.sh :84-287 (everything after the shared start, which
// lives in plugin-common.ts): manifest, MCP, context, skills, commands, flattened agents,
// hooks directory, settings, LSP, `bin/` and the two closing lines.

import fs from "node:fs";

import {
  convertToSkills,
  copyHooks,
  copySkills,
  emitContext,
  emitMcp,
  isDirectory,
  isFile,
  listEntries,
  startPlugin,
} from "./plugin-common.ts";
import type { PluginPlan } from "./plugin-common.ts";
import { obj, writeJsonText } from "./json-write.ts";
import { claudeAuthorName, subjectLocation, subjectPresent, textOr, valueAt } from "./manifest.ts";
import { copyTree } from "./tree-copy.ts";
import type { ExtCtx } from "./types.ts";

/** Agents flattened to `agents/<name>.md`: a nested `AGENT.md` or a flat `*.md`; siblings never travel. */
function copyAgents(plan: PluginPlan): void {
  const { manifest, extDir, outDir, ctx } = plan;
  const dir = `${extDir}/${subjectLocation(manifest, "agents", "agents/").replace(/\/+$/, "")}`;
  if (!subjectPresent(manifest, "agents") || !isDirectory(dir)) return;
  fs.mkdirSync(`${outDir}/agents`, { recursive: true });
  for (const entry of listEntries(dir)) {
    const from = `${dir}/${entry}`;
    if (isDirectory(from)) {
      if (!isFile(`${from}/AGENT.md`)) continue;
      fs.copyFileSync(`${from}/AGENT.md`, `${outDir}/agents/${entry}.md`);
      ctx.io.out(`  Copied agent (flattened): ${entry}`);
    } else if (isFile(from) && entry.endsWith(".md")) {
      fs.copyFileSync(from, `${outDir}/agents/${entry}`);
      ctx.io.out(`  Copied agent: ${entry.slice(0, -".md".length)}`);
    }
  }
}

/** `jq '.claude.<key> // {}'` written as `jq .`; an empty object, null and false write nothing. */
function writeClaudeJson(plan: PluginPlan, key: string, file: string): void {
  const value = valueAt(plan.manifest, "claude", key);
  if (value === undefined || value === null || value === false) return;
  if (value instanceof Map && value.size === 0) return;
  fs.writeFileSync(`${plan.outDir}/${file}`, writeJsonText(value));
  plan.ctx.io.out(`  Generated: ${file}`);
}

/** Build the whole Claude Code plugin; returns the exit status (0 built, 1 refused or failed). */
export function buildClaudePlugin(ctx: ExtCtx, extArg: string, outArg: string | undefined): number {
  const plan = startPlugin(ctx, "claude", extArg, outArg);
  if (plan === null) return 1;
  const { outDir, extDir, manifest, name, version, description } = plan;

  fs.mkdirSync(`${outDir}/.claude-plugin`, { recursive: true });
  const pluginJson = obj([
    ["name", name],
    ["description", description],
    ["version", version],
    ["author", obj([["name", claudeAuthorName(manifest)]])],
  ]);
  fs.writeFileSync(`${outDir}/.claude-plugin/plugin.json`, writeJsonText(pluginJson));
  ctx.io.out("  Generated: .claude-plugin/plugin.json");

  emitMcp(plan, ".mcp.json");
  if (!emitContext(plan, "raw")) return 1;
  copySkills(plan);
  convertToSkills(plan, true);
  copyAgents(plan);
  copyHooks(plan);
  writeClaudeJson(plan, "settings", "settings.json");
  writeClaudeJson(plan, "lsp", ".lsp.json");

  const bin = textOr(valueAt(manifest, "claude", "bin"), "");
  if (bin !== "" && isDirectory(`${extDir}/${bin}`)) {
    for (const notice of copyTree(`${extDir}/${bin}`, `${outDir}/bin`)) ctx.io.err(notice);
    ctx.io.out("  Copied: bin/");
  }

  ctx.io.out("");
  ctx.io.out(`Plugin built: ${outDir}`);
  ctx.io.out(`Test with: claude --plugin-dir ${outDir}`);
  return 0;
}
