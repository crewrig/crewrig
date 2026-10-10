// antigravity-plugin.ts — twin of scripts/install-antigravity-extension.sh (spec 0255 R10): build
// into dist-antigravity-plugin/<name>, `agy plugin install <dir>`, then resolve `${extensionRoot}`.

import type { EntryInput } from "../extension/entry-ctx.ts";
import { resolveTokens } from "./antigravity-tokens.ts";
import { buildPlugin, distDir, prepare } from "./plugin-common.ts";
import { createPluginCtx } from "./plugin-ctx.ts";
import { runTool } from "./spawn.ts";

/** Run the installer and return its exit status; never exits the process. */
export async function installAntigravityExtension(input: EntryInput): Promise<number> {
  const ctx = createPluginCtx(input);
  const prepared = prepare(ctx, {
    script: "install-antigravity-extension.sh",
    binary: "agy",
    missing: "Error: 'agy' CLI is required. Install Antigravity CLI first.",
  });
  if (prepared === null) return 1;
  const out = distDir(ctx, "dist-antigravity-plugin", prepared.name);
  const built = await buildPlugin(ctx, "antigravity", prepared.extDir, out);
  if (built !== 0) return built;
  const status = runTool(ctx, ["agy", "plugin", "install", out]);
  if (status !== 0) return status;
  if (!resolveTokens(out, ctx.home, ctx.io)) return 1;
  ctx.io.out("");
  ctx.io.out(`Plugin '${prepared.name}' installed. Restart Antigravity CLI to pick up the plugin.`);
  return 0;
}
