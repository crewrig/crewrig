// plugin-copilot.ts — the Copilot CLI plugin renderer (spec 0254 R11, R17, R18).
// Twin of scripts/build-copilot-plugin.sh :91-253 (everything after the shared start, which
// lives in plugin-common.ts): manifest, MCP, context skill, skills, commands to skills,
// flattened `<name>.agent.md` agents, hooks directory and the two closing lines.

import fs from "node:fs";
import path from "node:path";

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
import { subjectLocation, subjectPresent } from "./manifest.ts";
import type { ExtCtx } from "./types.ts";

/**
 * Each agent directory flattened to `agents/<name>.agent.md` (`cp <dir>/AGENT.md`). The shell's `cp`
 * is unconditional: a directory without a readable `AGENT.md` fails it and `set -e` ends the script
 * with status 1 after the preceding output. Returns false in that case (nothing is printed for it).
 */
function copyAgents(plan: PluginPlan): boolean {
  const { manifest, extDir, outDir, ctx } = plan;
  const dir = `${extDir}/${subjectLocation(manifest, "agents", "agents/").replace(/\/+$/, "")}`;
  if (!subjectPresent(manifest, "agents") || !isDirectory(dir)) return true;
  fs.mkdirSync(`${outDir}/agents`, { recursive: true });
  for (const entry of listEntries(dir)) {
    if (!isDirectory(`${dir}/${entry}`)) continue;
    if (!isFile(`${dir}/${entry}/AGENT.md`)) return false;
    fs.copyFileSync(`${dir}/${entry}/AGENT.md`, `${outDir}/agents/${entry}.agent.md`);
    ctx.io.out(`  Copied agent (flattened): ${entry}`);
  }
  return true;
}

/** Build the whole Copilot CLI plugin; returns the exit status (0 built, 1 refused or failed). */
export function buildCopilotPlugin(
  ctx: ExtCtx,
  extArg: string,
  outArg: string | undefined,
): number {
  const plan = startPlugin(ctx, "copilot", extArg, outArg);
  if (plan === null) return 1;
  const { outDir, name, version, description } = plan;

  const pluginJson = obj([
    ["name", name],
    ["version", version],
    ["description", description],
  ]);
  fs.writeFileSync(`${outDir}/plugin.json`, writeJsonText(pluginJson));
  ctx.io.out(`  Generated: plugin.json (name: ${name})`);

  emitMcp(plan, ".mcp.json");
  if (!emitContext(plan, "copilot")) {
    // The shell creates the context directory before it renders: a failed render leaves it empty.
    const output = ctx.table.copilot.contextOutput
      .split("{ext}")
      .join(name)
      .split("{name}")
      .join("");
    fs.mkdirSync(path.dirname(`${outDir}/${output}`), { recursive: true });
    return 1;
  }
  copySkills(plan);
  convertToSkills(plan, false);
  if (!copyAgents(plan)) return 1;
  copyHooks(plan);

  ctx.io.out("");
  ctx.io.out(`Plugin built: ${outDir}`);
  ctx.io.out(`Install with: copilot plugin install ${outDir}`);
  return 0;
}
