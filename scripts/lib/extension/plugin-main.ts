// plugin-main.ts — the shared `main` of the three plugin builder entries (spec 0254 R5).
// Parses `<extension> [output-dir]`, builds the context and dispatches to the renderer of the
// target. The renderers load lazily so an entry pays only for the one it runs.

import { parsePluginArgs } from "./args.ts";
import { createCtx } from "./entry-ctx.ts";
import type { EntryInput } from "./entry-ctx.ts";
import type { ExtCtx, PluginTarget } from "./types.ts";

type Builder = (ctx: ExtCtx, extArg: string, outArg: string | undefined) => number;

const SCRIPTS: Readonly<Record<PluginTarget, string>> = {
  claude: "build-claude-plugin.sh",
  copilot: "build-copilot-plugin.sh",
  antigravity: "build-antigravity-extension.sh",
};

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

/** Run one plugin builder and return its exit status; never exits the process. */
export async function pluginMain(target: PluginTarget, input: EntryInput): Promise<number> {
  const parsed = parsePluginArgs(input.argv, SCRIPTS[target]);
  if (!parsed.ok) {
    input.io.err(parsed.message);
    return parsed.status;
  }
  const ctx = await createCtx(input);
  if (ctx === null) return 1;
  const build = await loadBuilder(target);
  return build(ctx, parsed.extArg, parsed.outArg);
}
