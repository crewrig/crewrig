// gemini-render.ts — the Gemini CLI render of `build-extension` (spec 0254 R14, R17).
// Twin of `render_gemini` (scripts/build-extension.sh:214-337): the verbatim copy with the
// generated-class and release debris removed, `gemini-extension.json`, the context, the
// `.toml` commands and the hook file. Returns 0, or 1 when any file failed.

import fs from "node:fs";
import path from "node:path";

import { readTextLf } from "../line-endings.ts";
import { declaredCommands, declaredSkills } from "./context-declared.ts";
import { renderContext } from "./context-render.ts";
import { readGeneratedClass } from "./descriptors.ts";
import type { GapChannel } from "./gap-record.ts";
import { renderHookFile } from "./hooks-emit.ts";
import { hookGaps } from "./hooks-resolve.ts";
import { jqText, obj, writeJsonText } from "./json-write.ts";
import { mcpNative } from "./mcp-delivery.ts";
import { extBuildDir, extVersion, subjectLocation, subjectPresent, textOr } from "./manifest.ts";
import { contextSource, valueAt } from "./manifest.ts";
import { copyTree, emptyDir, removeGenerated } from "./tree-copy.ts";
import { TARGETS } from "./types.ts";
import type { ExtCtx, JsonValue, Target } from "./types.ts";

/** `jq length > 0` on a value: a non-empty array, object or string. */
function nonEmpty(value: JsonValue | undefined): boolean {
  if (Array.isArray(value) || typeof value === "string") return value.length > 0;
  return value instanceof Map && value.size > 0;
}

/**
 * `ext_hooks_render` then `ext_hooks_gaps`: the target's hook file under `outDir` (nothing when
 * no hook maps), the warnings on stderr and the records on the gap channel.
 */
export function emitHooks(
  ctx: ExtCtx,
  target: Target,
  manifest: Map<string, JsonValue>,
  outDir: string,
  gaps: GapChannel,
): void {
  const hookFile = renderHookFile(target, manifest, ctx.table);
  if (hookFile !== null) {
    const file = path.join(outDir, hookFile.file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, writeJsonText(hookFile.value));
  }
  const found = hookGaps(target, manifest, ctx.table);
  for (const line of found.warnings) ctx.io.err(line);
  for (const gap of found.gaps) gaps.record(gap);
}

/** The context file, rendered in memory and written only on success; false when it failed. */
function renderGeminiContext(
  ctx: ExtCtx,
  extDir: string,
  manifest: Map<string, JsonValue>,
  name: string,
  buildDir: string,
  contextFileName: string,
): boolean {
  const source = contextSource(manifest);
  const row = ctx.table.gemini;
  const result = renderContext({
    source: readTextLf(`${extDir}/${source}`),
    sourceName: `${extDir}/${source}`,
    target: "gemini",
    knownTargets: TARGETS,
    displayName: row.displayName,
    commandRef: row.commandRef,
    skillRef: row.skillRef,
    extName: jqText(manifest.get("name")),
    declaredCommands: declaredCommands(manifest, extDir, ctx.renderCommand),
    declaredSkills: declaredSkills(manifest, extDir),
  });
  if (!result.ok) {
    for (const line of result.diagnostics) ctx.io.err(line);
    return false;
  }
  for (const line of result.warnings) ctx.io.err(line);
  fs.mkdirSync(path.dirname(`${buildDir}/${contextFileName}`), { recursive: true });
  fs.writeFileSync(`${buildDir}/${contextFileName}`, result.text);
  ctx.io.out(`  Rendered: build/extensions/${name}/${contextFileName}`);
  return true;
}

/** `<location>/*.md` to `<location>/<name>.toml`; a source without a name is skipped with a warning. */
function renderCommands(
  ctx: ExtCtx,
  extDir: string,
  manifest: Map<string, JsonValue>,
  name: string,
  buildDir: string,
): number {
  if (!subjectPresent(manifest, "commands")) return 0;
  const loc = subjectLocation(manifest, "commands", "commands/").replace(/\/$/, "");
  const dir = `${extDir}/${loc}`;
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return 0;
  let rc = 0;
  const sources = fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith(".") && f.endsWith(".md"))
    .sort();
  for (const file of sources) {
    const source = `${dir}/${file}`;
    if (!fs.statSync(source).isFile()) continue;
    const cmdName = ctx.renderCommand.yamlField(source, "name");
    if (cmdName === "" || cmdName === "null") {
      ctx.io.err(`Warning: ${source} missing 'name' field, skipping`);
      continue;
    }
    let rendered: string;
    try {
      rendered = ctx.renderCommand.renderCommandGemini(source);
    } catch (error) {
      ctx.io.err(error instanceof Error ? error.message : String(error));
      rc = 1;
      continue;
    }
    fs.mkdirSync(`${buildDir}/${loc}`, { recursive: true });
    fs.writeFileSync(`${buildDir}/${loc}/${cmdName}.toml`, `${rendered.replace(/\n+$/, "")}\n`);
    ctx.io.out(`  Rendered: build/extensions/${name}/${loc}/${cmdName}.toml`);
  }
  return rc;
}

/** Render the complete installable Gemini tree into `build/extensions/<name>/`. */
export function renderGemini(
  ctx: ExtCtx,
  extDir: string,
  manifest: Map<string, JsonValue>,
  name: string,
  gaps: GapChannel,
): number {
  const buildDir = extBuildDir(ctx.repoDir, name);
  emptyDir(buildDir, ctx.repoDir);
  copyTree(extDir, buildDir);
  removeGenerated(buildDir, readGeneratedClass(ctx.libDir));
  fs.rmSync(`${buildDir}/.releaserc.json`, { force: true });

  let rc = 0;
  const hasContext = contextSource(manifest) !== "";
  const contextFileName = hasContext
    ? ctx.table.gemini.contextOutput.split("{ext}").join(name).split("{name}").join("")
    : "";
  const mcpServers = mcpNative("gemini", manifest, ctx.table);
  const themes = valueAt(manifest, "gemini", "themes");

  const pairs: Array<readonly [string, JsonValue]> = [
    ["name", name],
    ["version", extVersion(manifest)],
    ["description", textOr(manifest.get("description"), "")],
  ];
  if (contextFileName !== "") pairs.push(["contextFileName", contextFileName]);
  if (mcpServers.size > 0) pairs.push(["mcpServers", mcpServers]);
  if (themes !== undefined && nonEmpty(themes)) pairs.push(["themes", themes]);
  fs.writeFileSync(`${buildDir}/gemini-extension.json`, writeJsonText(obj(pairs)));
  ctx.io.out(`  Rendered: build/extensions/${name}/gemini-extension.json`);

  if (hasContext && fs.existsSync(`${extDir}/${contextSource(manifest)}`)) {
    if (!renderGeminiContext(ctx, extDir, manifest, name, buildDir, contextFileName)) rc = 1;
  }
  if (renderCommands(ctx, extDir, manifest, name, buildDir) !== 0) rc = 1;
  emitHooks(ctx, "gemini", manifest, buildDir, gaps);
  return rc;
}
