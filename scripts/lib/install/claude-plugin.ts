// claude-plugin.ts — twin of scripts/install-claude-plugin.sh (spec 0255 R10): build the plugin
// into the shared local marketplace home `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/local-marketplace`,
// upsert the marketplace manifest, then register it and install through the `claude` CLI.

import path from "node:path";

import type { EntryInput } from "../extension/entry-ctx.ts";
import { loadManifest, marketplaceName, upsertMarketplace } from "./marketplace.ts";
import { buildPlugin, prepare } from "./plugin-common.ts";
import { createPluginCtx } from "./plugin-ctx.ts";
import { runTool } from "./spawn.ts";

/** Run the installer and return its exit status; never exits the process. */
export async function installClaudePlugin(input: EntryInput): Promise<number> {
  const ctx = createPluginCtx(input);
  const prepared = prepare(ctx, {
    script: "install-claude-plugin.sh",
    binary: "claude",
    missing: "Error: 'claude' CLI is required. Install Claude Code first.",
  });
  if (prepared === null) return 1;
  const { name, extDir } = prepared;
  const libDir = path.join(ctx.repoDir, "scripts", "lib");
  const manifest = loadManifest(extDir, libDir, ctx.io);
  if (manifest === null) return 1;

  const configured = ctx.env["CLAUDE_CONFIG_DIR"];
  const config =
    configured === undefined || configured === "" ? path.join(ctx.home, ".claude") : configured;
  const marketHome = path.join(config, "local-marketplace");
  const built = await buildPlugin(ctx, "claude", extDir, path.join(marketHome, name));
  if (built !== 0) return built;

  const market = marketplaceName(ctx.repoDir);
  upsertMarketplace(marketHome, market, name, manifest, ctx.io);
  const added = runTool(
    ctx,
    ["claude", "plugin", "marketplace", "add", marketHome, "--scope", "user"],
    { allowSpaces: true },
  );
  if (added !== 0) return added;
  const installed = runTool(ctx, [
    "claude",
    "plugin",
    "install",
    `${name}@${market}`,
    "--scope",
    "user",
  ]);
  if (installed !== 0) return installed;
  ctx.io.out("");
  ctx.io.out(`Plugin installed via marketplace '${market}'.`);
  ctx.io.out("Verify with: claude plugin list");
  ctx.io.out("Restart Claude Code to pick up the plugin.");
  return 0;
}
