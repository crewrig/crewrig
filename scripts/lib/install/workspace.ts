// workspace.ts — install (or link) every Gemini CLI workspace component type in one run (spec 0255
// R13, ported from scripts/install-workspace.sh, spec 0119 R15).
//
// Every type runs, whatever any other type does: a failing status is collected, never fatal. Each
// type is `node scripts/manage-workspace-component.ts <mode> <type>`, run with the umbrella's
// standard streams so the type's own reports appear in place.

import path from "node:path";

import type { Env, Io } from "../extension/types.ts";
import { runNodeScript } from "./all.ts";

/** The component types, in the order the shell ran them. */
export const WORKSPACE_TYPES: readonly string[] = [
  "commands",
  "skills",
  "hooks",
  "agents",
  "policies",
  "mcp-servers",
  "themes",
];

export interface WorkspaceCtx {
  readonly io: Io;
  readonly repoDir: string;
  readonly env: Env;
}

/** Run one `<mode> <type>` pair; the exit status. */
export type RunType = (mode: string, type: string) => Promise<number>;

/** The default `RunType`: a `manage-workspace-component.ts` child inheriting the standard streams. */
export function childRunType(ctx: WorkspaceCtx): RunType {
  const script = path.join(ctx.repoDir, "scripts", "manage-workspace-component.ts");
  return (mode, type) => runNodeScript(script, [mode, type], ctx.env, "inherit");
}

/** Run the seven types; returns the exit status (1 when any type failed). */
export async function installWorkspace(
  argv: readonly string[],
  ctx: WorkspaceCtx,
  run: RunType = childRunType(ctx),
): Promise<number> {
  const first = argv[0];
  const mode = first === undefined || first === "" ? "install" : first;
  ctx.io.out(`Installing artifacts components (mode: ${mode})...`);
  let failed = "";
  for (const type of WORKSPACE_TYPES) {
    if ((await run(mode, type)) !== 0) failed += ` ${type}`;
  }
  if (failed !== "") {
    ctx.io.err("");
    ctx.io.err(`Artifacts installation finished with failures in:${failed}`);
    ctx.io.err("Every other type was processed; only the types named above did not");
    ctx.io.err("complete. Their own reports appear above.");
    return 1;
  }
  ctx.io.out("Artifacts installation complete.");
  return 0;
}
