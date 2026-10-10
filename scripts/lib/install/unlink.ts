// unlink.ts — remove what the install scripts placed under the Gemini home (spec 0255 R13).
// Twins of scripts/unlink-component.sh and scripts/unlink-extensions.sh. Removal is by name and
// never follows a link: a symbolic link (a dangling one included) is unlinked and its target is
// left alone, a directory is removed with its content.

import { removePlaced } from "../link-or-copy.ts";
import { geminiHome, tierNames, walkedTiers, wantsOrg } from "./ctx.ts";
import type { InstallCtx } from "./ctx.ts";

/** Singular type names mapped to the plural directory name; any other type is kept verbatim. */
const PLURALS: ReadonlyMap<string, string> = new Map([
  ["command", "commands"],
  ["skill", "skills"],
  ["hook", "hooks"],
  ["agent", "agents"],
  ["policy", "policies"],
  ["mcp-server", "mcp-servers"],
  ["theme", "themes"],
]);

/** `unlink-component.ts <type> <name>`: the usage goes to standard output, as the shell's does. */
export function unlinkComponentMain(ctx: InstallCtx, argv: readonly string[]): number {
  const type = argv[0] ?? "";
  const name = argv[1] ?? "";
  if (type === "" || name === "") {
    ctx.io.out("Usage: unlink-component.sh <type> <name>");
    ctx.io.out("Types: commands, skills, hooks, agents, policies, mcp-servers, themes");
    return 1;
  }
  const plural = PLURALS.get(type) ?? type;
  const removed = removePlaced(`${geminiHome(ctx)}/${plural}/${name}`) !== "absent";
  ctx.io.out(`${removed ? "Removed" : "Not found"}: ${plural}/${name}`);
  return 0;
}

/** `unlink-extensions.ts [--include-org]`: the target is keyed on the bare installed name. */
export function unlinkExtensionsMain(ctx: InstallCtx, argv: readonly string[]): number {
  for (const tier of walkedTiers(wantsOrg(ctx, argv[0] === "--include-org"))) {
    for (const name of tierNames(ctx.repoDir, tier)) {
      if (removePlaced(`${geminiHome(ctx)}/extensions/${name}`) !== "absent") {
        ctx.io.out(`  Removed: ${name}`);
      }
    }
  }
  return 0;
}
