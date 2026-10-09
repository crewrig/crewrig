// resolve-arm.ts — the `--resolve <source> <target>` fast-exit arm (spec 0198 R6, R34;
// spec 0250 R6).
//
// Twins scripts/build-components.sh :161-185. It exercises `resolveAgent` for one agent
// source and one target, writes no compiled output, and runs before the configuration is
// read, so it needs no `crewrig.config.toml` and no `canonical_repo`. It prints, each only
// when non-empty and in this order, `offering: <id>`, `native: <value>`, one `fm: <line>`
// per directed frontmatter line and `prose: <text>`, then sends every diagnostic line to
// standard error (and `--diagnostics`), and returns 0. The derived merge root is removed
// by the caller's cleanup (`main.ts`), on this arm as on every other path (the shell did it
// by hand at :183 because its trap was not yet installed).
//
// An unreadable source returns 2, the status awk's failure gave the shell (R6, accepted
// by the owner); the wording of the diagnostic differs (R33(i)). A source that reads but
// holds no frontmatter, or one that does not parse, has no name: the agent is resolved
// under the name `null` or the empty text, as the shell did.

import fs from "node:fs";

import { resolveAgent } from "../model-resolve.ts";
import type { ResolveContext } from "../model-resolve.ts";
import { emitDiagLine, escapeControl, escapeControlKeepTab } from "./diagnostics.ts";
import type { BaseCtx, SourceDoc } from "./types.ts";

/** Run the arm and return the exit status (0, or 2 on an unreadable source). */
export function runResolveArm(ctx: BaseCtx, model: ResolveContext): number {
  const { io, opts } = ctx;
  const resolve = opts.resolve;
  if (resolve === null) return 0;
  if (opts.diagnosticsPath !== "") fs.writeFileSync(opts.diagnosticsPath, "");

  let doc: SourceDoc;
  try {
    doc = ctx.fm.open(resolve.source);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    io.err(`Error: cannot read --resolve source: ${escapeControl(reason)}`);
    return 2;
  }
  const result = resolveAgent(model, doc.field("name"), resolve.source, resolve.target);
  if (result.offeringId !== "") io.out(`offering: ${escapeControlKeepTab(result.offeringId)}`);
  if (result.nativeValue !== "") io.out(`native: ${escapeControlKeepTab(result.nativeValue)}`);
  for (const line of result.fmLines) io.out(`fm: ${escapeControlKeepTab(line)}`);
  if (result.prose !== "") io.out(`prose: ${escapeControlKeepTab(result.prose)}`);
  for (const line of result.diagLines) emitDiagLine(ctx, line);
  return 0;
}
