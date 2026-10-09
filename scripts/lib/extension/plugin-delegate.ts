// plugin-delegate.ts — the plugin delegation of `build-extension` (spec 0254 R15).
// Twin of `_plugin_default_out_dir` and `render_plugin` (scripts/build-extension.sh:339-381):
// the target's builder runs in-process with its standard output sent to standard error, then
// the hook file lands in the builder's default output root, then the MCP gap decision.

import { emitHooks } from "./gemini-render.ts";
import type { GapChannel } from "./gap-record.ts";
import { mcpDelivery } from "./mcp-delivery.ts";
import type { ExtCtx, JsonValue, PluginTarget } from "./types.ts";

type Builder = (
  ctx: ExtCtx,
  extArg: string,
  outArg: string | undefined,
) => number | Promise<number>;

/** The same default output root each builder resolves for a bare invocation. */
export function pluginDefaultOutDir(
  ctx: ExtCtx,
  target: PluginTarget,
  extDir: string,
  name: string,
): string {
  switch (target) {
    case "claude":
      return `${extDir}/dist-claude-plugin/${name}`;
    case "copilot":
      return `${ctx.repoDir}/dist-copilot-plugin/${name}`;
    case "antigravity":
      return `${ctx.repoDir}/dist-antigravity-plugin/${name}`;
  }
}

async function loadBuilder(target: PluginTarget): Promise<Builder> {
  switch (target) {
    case "claude":
      return (await import("./plugin-claude.ts")).buildClaudePlugin;
    case "copilot":
      return (await import("./plugin-copilot.ts")).buildCopilotPlugin;
    case "antigravity":
      return (await import("./plugin-antigravity.ts")).buildAntigravityPlugin;
  }
}

/** `jq -e '(.mcpServers // {}) | length > 0'`. */
function declaresMcp(manifest: Map<string, JsonValue>): boolean {
  const servers = manifest.get("mcpServers");
  if (Array.isArray(servers) || typeof servers === "string") return servers.length > 0;
  return servers instanceof Map && servers.size > 0;
}

/** Run one target's builder, then its hooks and MCP gap; 1 when the builder failed. */
export async function renderPlugin(
  ctx: ExtCtx,
  target: PluginTarget,
  extDir: string,
  manifest: Map<string, JsonValue>,
  name: string,
  gaps: GapChannel,
): Promise<number> {
  let rc = 0;
  // `bash "$builder" "$ext_dir" >&2`: the builder's stdout lines go to stderr.
  const derived: ExtCtx = { ...ctx, io: { ...ctx.io, out: (line) => ctx.io.err(line) } };
  try {
    const builder = await loadBuilder(target);
    if ((await builder(derived, extDir, undefined)) !== 0) rc = 1;
  } catch (error) {
    ctx.io.err(`Error: ${error instanceof Error ? error.message : String(error)}`);
    rc = 1;
  }

  emitHooks(ctx, target, manifest, pluginDefaultOutDir(ctx, target, extDir, name), gaps);

  if (declaresMcp(manifest) && !mcpDelivery(target, ctx.table)) {
    ctx.io.err(
      `Warning: extension '${name}' declares mcpServers, which has no expressible delivery on target '${target}'`,
    );
    gaps.record({
      subject: "mcpServers",
      target,
      reason: "no resolvable path form for this target's MCP delivery (see docs/cli-matrix.md)",
    });
  }
  return rc;
}
