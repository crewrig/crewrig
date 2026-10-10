// copilot-plugin.ts — twin of scripts/install-copilot-plugin.sh (spec 0255 R10): build the plugin
// into dist-copilot-plugin/<name>, then `copilot plugin install <dir>`.

import type { EntryInput } from "../extension/entry-ctx.ts";
import { buildPlugin, distDir, prepare } from "./plugin-common.ts";
import { createPluginCtx } from "./plugin-ctx.ts";
import { runTool } from "./spawn.ts";

/** Run the installer and return its exit status; never exits the process. */
export async function installCopilotPlugin(input: EntryInput): Promise<number> {
  const ctx = createPluginCtx(input);
  const prepared = prepare(ctx, {
    script: "install-copilot-plugin.sh",
    binary: "copilot",
    missing: "Error: 'copilot' CLI is required. Install GitHub Copilot CLI first.",
  });
  if (prepared === null) return 1;
  const out = distDir(ctx, "dist-copilot-plugin", prepared.name);
  const built = await buildPlugin(ctx, "copilot", prepared.extDir, out);
  if (built !== 0) return built;
  const status = runTool(ctx, ["copilot", "plugin", "install", out]);
  if (status !== 0) return status;
  ctx.io.out("");
  ctx.io.out(`Plugin '${prepared.name}' installed. Run: copilot plugin list`);
  return 0;
}
