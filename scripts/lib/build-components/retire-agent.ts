// retire-agent.ts — retired Antigravity agent directory reconciliation (spec 0053
// delta-01 R14, R16, R25, R26, R29).
//
// Before delta-01 the compiled Antigravity agent was `.agents/agents/<name>/AGENT.md`.
// For each agent the build emits as `.agents/agents/<name>.md`, the retired directory
// `.agents/agents/<name>/` is
//   - in write mode (including `--check` on a tier that is not drift-compared): removed
//     when, and only when, it holds a single regular file named exactly `AGENT.md` that is
//     provenance-carrying (frontmatter-scoped, scripts/lib/provenance-carrying.ts);
//     anything else is left untouched and warned about;
//   - in compare mode: reported as drift, nothing written.
// A directory that is absent is a silent no-op. Only names being emitted are ever looked
// at (orphans are the layout guard's business, R29). The directory is inspected with
// `lstat` and an exact `readdirSync` listing, never `existsSync` on a case-only twin
// (R25); a symbolic link is warned about and never followed.

import fs from "node:fs";

import { isSoleProvenanceAgentDir } from "../provenance-carrying.ts";
import { joinRoot } from "./args.ts";
import { escapeControl } from "./diagnostics.ts";
import { assertInsideRoot, comparing } from "./write.ts";
import type { Ctx } from "./types.ts";

/** `lstat` of `target`, or null when nothing is there. */
function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

/** Reconcile `<outRoot>/.agents/agents/<name>/` after `<name>.md` has been written or compared. */
export function reconcileRetiredAgentDir(ctx: Ctx, outRoot: string, name: string): void {
  const dir = joinRoot(ctx.platform, outRoot, `.agents/agents/${name}`);
  assertInsideRoot(ctx, outRoot, dir);
  const stat = lstatOrNull(dir);
  if (stat === null) return;
  const shown = escapeControl(dir);

  if (comparing(ctx)) {
    ctx.io.out(`DRIFT: ${shown} is a retired agent layout (expected only ${name}.md)`);
    ctx.state.driftFound = true;
    return;
  }
  if (isSoleProvenanceAgentDir(dir)) {
    fs.rmSync(dir, { recursive: true });
    ctx.io.out(`  Removed retired agent directory: ${shown}`);
    return;
  }
  ctx.io.err(
    `Warning: ${shown} is a retired Antigravity agent layout but not a framework-installed ` +
      `single AGENT.md; left untouched (remove it by hand if it is yours to remove)`,
  );
}
