// render-extension.ts — render one extension for the requested targets (spec 0254 R15, R19).
// Twin of `render_extension` (scripts/build-extension.sh:383-458): validation first, then the
// targets in the order gemini, claude, copilot, antigravity (a failing one never stops the next),
// then the observed-gap file, written only when all four targets were requested.

import path from "node:path";

import { createGapChannel, writeGapFile } from "./gap-record.ts";
import type { GapChannel } from "./gap-record.ts";
import { renderGemini } from "./gemini-render.ts";
import { extGapDir, manifestName, readManifest } from "./manifest.ts";
import { renderPlugin } from "./plugin-delegate.ts";
import { TARGETS } from "./types.ts";
import type { ExtCtx, PluginTarget, Target } from "./types.ts";
import { validateManifest } from "./validate.ts";

const PLUGIN_TARGETS: readonly PluginTarget[] = ["claude", "copilot", "antigravity"];

/**
 * Render `extDir` for `targets`; returns 0, or 1 when validation or any target failed.
 * `gaps` is the channel the renderers append to (a fresh one when omitted).
 */
export async function renderExtension(
  ctx: ExtCtx,
  extDir: string,
  targets: readonly Target[],
  gaps: GapChannel = createGapChannel(),
): Promise<number> {
  const manifestPath = `${extDir}/extension.json`;
  const manifest = readManifest(manifestPath);
  const name = manifestName(manifest) ?? "null";

  const errors = validateManifest(manifestPath, manifest, { libDir: ctx.libDir });
  if (errors.length > 0) {
    for (const line of errors) ctx.io.err(line);
    ctx.io.err(`FAIL: ${extDir} — manifest validation failed (see VALIDATION-ERROR lines above)`);
    return 1;
  }

  ctx.io.out(`Building extension: ${name}`);

  let rc = 0;
  if (targets.includes("gemini") && renderGemini(ctx, extDir, manifest, name, gaps) !== 0) rc = 1;
  for (const target of PLUGIN_TARGETS) {
    if (
      targets.includes(target) &&
      (await renderPlugin(ctx, target, extDir, manifest, name, gaps)) !== 0
    ) {
      rc = 1;
    }
  }

  if (TARGETS.every((target) => targets.includes(target))) {
    writeGapFile(path.join(extGapDir(ctx.repoDir, name), "observed-gaps.json"), gaps.gaps);
  }
  return rc;
}
