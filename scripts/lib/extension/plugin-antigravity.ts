// plugin-antigravity.ts — the Antigravity CLI plugin renderer (spec 0254 R11, R17, R18).
// Twin of scripts/build-antigravity-extension.ts :92-247 (everything after the shared start,
// which lives in plugin-common.ts): manifest, MCP (the neutral `${extensionRoot}` stays
// unresolved), raw context, skills, commands to skills, flattened agents (`agents/<name>.md`, spec 0254 delta-02 R31), hooks
// directory and the two closing lines.

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
import { stampFile, writeSidecar } from "./provenance-stamp.ts";
import { subjectLocation, subjectPresent } from "./manifest.ts";
import type { ExtCtx } from "./types.ts";

/** `agents/<name>.md` for every agent: nested `AGENT.md` flattened, flat `*.md` copied (as Claude). */
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
      stampFile(`${outDir}/agents/${entry}.md`, plan.fields, "html");
      ctx.io.out(`  Copied agent (flattened): ${entry}`);
    } else if (isFile(from) && entry.endsWith(".md")) {
      fs.copyFileSync(from, `${outDir}/agents/${entry}`);
      stampFile(`${outDir}/agents/${entry}`, plan.fields, "html");
      ctx.io.out(`  Copied agent: ${entry.slice(0, -".md".length)}`);
    }
  }
}

/** Build the whole Antigravity CLI plugin; returns the exit status (0 built, 1 refused or failed). */
export function buildAntigravityPlugin(
  ctx: ExtCtx,
  extArg: string,
  outArg: string | undefined,
): number {
  const plan = startPlugin(ctx, "antigravity", extArg, outArg);
  if (plan === null) return 1;
  const { outDir, name, version, description } = plan;

  const pluginJson = obj([
    ["name", name],
    ["version", version],
    ["description", description],
  ]);
  fs.writeFileSync(`${outDir}/plugin.json`, writeJsonText(pluginJson));
  ctx.io.out(`  Generated: plugin.json (name: ${name})`);

  emitMcp(plan, "mcp_config.json");
  if (!emitContext(plan, "raw")) return 1;
  copySkills(plan);
  convertToSkills(plan, false);
  copyAgents(plan);
  copyHooks(plan);

  writeSidecar(outDir, plan.fields);
  ctx.io.out("");
  ctx.io.out(`Plugin built: ${outDir}`);
  ctx.io.out(`Validate with: agy plugin validate ${outDir}`);
  return 0;
}
