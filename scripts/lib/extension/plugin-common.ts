// plugin-common.ts — the part shared by the three plugin renderers (spec 0254 R11, R17, R18).
// Twins the identical sections of scripts/build-claude-plugin.sh :32-160, :162-217, :259-262,
// scripts/build-copilot-plugin.sh and scripts/build-antigravity-extension.sh.
//
// API (kept small and stable; every printed line goes to `plan.ctx.io`):
//   startPlugin(ctx, target, extArg, outArg) -> PluginPlan | null
//       resolution, manifest presence, shape guard, metadata, output directory reset, banner.
//       null means the failure line is already printed: the caller returns 1. Anything that
//       throws (ExtError from a bad manifest or a refused output root) is the entry's to print.
//   emitMcp(plan, fileName)            the MCP file plus `dist/` and `package.json`.
//   emitContext(plan, shape)           the rendered context; shape "raw" or "copilot"; false = failed.
//   copySkills(plan)                   `skills/<name>` directories, `Copied skill:` lines.
//   convertToSkills(plan, withTools)   pivot commands to `skills/<cmd>/SKILL.md`; `withTools` adds
//                                      the manifest's `claude.defaultAllowedTools` (claude only).
//   copyHooks(plan)                    the `hooks/` handler directory.
//   isDirectory, isFile, listEntries   follow-link filesystem tests and the sorted `*` glob.
// The agents copy is per target and lives in each renderer. Link-copy notices from `copyTree`
// are printed on stderr as they come. The `yq` presence check of the shell has no twin: YAML is
// read in-process.

import fs from "node:fs";
import path from "node:path";

import { readTextLf } from "../line-endings.ts";
import { declaredCommands, declaredSkills } from "./context-declared.ts";
import { renderContext } from "./context-render.ts";
import { assertSafeToRemove, copyTree, emptyDir } from "./tree-copy.ts";
import { jqText, obj, writeJsonText } from "./json-write.ts";
import { mcpDelivery, mcpNative } from "./mcp-delivery.ts";
import { readManifest, subjectLocation, subjectOption, subjectPresent } from "./manifest.ts";
import { contextSource, valueAt } from "./manifest.ts";
import type { Manifest } from "./manifest.ts";
import { resolveExtensionDir } from "./resolve.ts";
import { assertCurrentShape } from "./shape-guard.ts";
import { TARGETS } from "./types.ts";
import type { ExtCtx, JsonValue, PluginTarget } from "./types.ts";

export interface PluginPlan {
  readonly ctx: ExtCtx;
  readonly target: PluginTarget;
  readonly extDir: string;
  readonly manifest: Manifest;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly outDir: string;
}

const BANNER: Readonly<Record<PluginTarget, string>> = {
  claude: "Claude Code",
  copilot: "Copilot CLI",
  antigravity: "Antigravity CLI",
};
const DEFAULT_OUT: Readonly<Record<PluginTarget, string>> = {
  claude: "dist-claude-plugin",
  copilot: "dist-copilot-plugin",
  antigravity: "dist-antigravity-plugin",
};

/** `[ -d p ]`: follows links. */
export function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** `[ -f p ]`: follows links. */
export function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** The shell's `<dir>/*` glob: visible names, code-unit order (empty when `dir` is no directory). */
export function listEntries(dir: string): string[] {
  if (!isDirectory(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => !n.startsWith("."))
    .sort();
}

/** `jq -e '(<v> // <empty>) | length > 0'`: a jq error (a boolean true has no length) reads false. */
function lengthPositive(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (value === true) return false;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  return Array.isArray(value) ? value.length > 0 : value.size > 0;
}

/** A location always read as a directory: `commands` and `commands/` are the same directory. */
function dirOf(plan: PluginPlan, subject: string, dflt: string): string {
  return `${plan.extDir}/${subjectLocation(plan.manifest, subject, dflt).replace(/\/+$/, "")}`;
}

/** Everything the renderers do before their first emitter; null when a failure line was printed. */
export function startPlugin(
  ctx: ExtCtx,
  target: PluginTarget,
  extArg: string,
  outArg: string | undefined,
): PluginPlan | null {
  const resolved = resolveExtensionDir(extArg, ctx.repoDir);
  if (!resolved.ok) {
    ctx.io.out(resolved.message);
    return null;
  }
  const extDir = resolved.dir;
  const manifestPath = path.join(extDir, "extension.json");
  if (!isFile(manifestPath)) {
    ctx.io.out(
      `Error: No extension.json found in ${extDir} — run scripts/migrate-extension.sh if this is an old-shape extension (see docs/adoption-guide.md).`,
    );
    return null;
  }
  const manifest = readManifest(manifestPath);
  const shape = assertCurrentShape(manifestPath, manifest, ctx.libDir);
  if (shape.length > 0) {
    for (const line of shape) ctx.io.err(line);
    return null;
  }
  const name = jqText(manifest.get("name"));
  const version = jqText(manifest.get("version"));
  const description = jqText(manifest.get("description"));
  const base = target === "claude" ? extDir : ctx.repoDir;
  const outDir =
    outArg !== undefined && outArg !== "" ? outArg : path.join(base, DEFAULT_OUT[target], name);
  assertSafeToRemove(outDir, ctx.repoDir);
  if (!isDirectory(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  emptyDir(outDir, ctx.repoDir);
  ctx.io.out(`Building ${BANNER[target]} plugin: ${name} v${version}`);
  ctx.io.out(`  Source: ${extDir}`);
  ctx.io.out(`  Output: ${outDir}`);
  return { ctx, target, extDir, manifest, name, version, description, outDir };
}

function copyDir(plan: PluginPlan, from: string, to: string): void {
  for (const notice of copyTree(from, to)) plan.ctx.io.err(notice);
}

/** R11: the MCP file at `<outDir>/<fileName>`, its `dist/` and `package.json`, or the gap warning. */
export function emitMcp(plan: PluginPlan, fileName: string): void {
  const { ctx, target, manifest, extDir, outDir } = plan;
  if (mcpDelivery(target, ctx.table)) {
    const native = mcpNative(target, manifest, ctx.table);
    if (native.size === 0) return;
    fs.writeFileSync(`${outDir}/${fileName}`, writeJsonText(obj([["mcpServers", native]])));
    ctx.io.out(`  Generated: ${fileName}`);
    if (isDirectory(`${extDir}/dist`)) {
      copyDir(plan, `${extDir}/dist`, `${outDir}/dist`);
      ctx.io.out("  Copied: dist/");
    }
    if (isFile(`${extDir}/package.json`)) {
      fs.copyFileSync(`${extDir}/package.json`, `${outDir}/package.json`);
      ctx.io.out("  Copied: package.json");
    }
  } else if (lengthPositive(manifest.get("mcpServers"))) {
    ctx.io.err(
      `Warning: extension declares mcpServers, which has no expressible delivery on target '${target}' — recorded as an observed gap by the parent render`,
    );
  }
}

/** The body as `printf '%s\n' "$(...)"` left it: trailing line feeds replaced by one. */
function withOneLf(text: string): string {
  return `${text.replace(/\n+$/, "")}\n`;
}

/**
 * R17: render `context.source` into the target's `contextOutput`. "raw" writes the rendered text
 * and prints `Rendered:`; "copilot" wraps it as a user-invocable skill. Diagnostics and warnings
 * go to stderr; on failure nothing is written, `Error: rendering context ...` is printed (raw shape only,
 * see below) and the result is false.
 */
export function emitContext(plan: PluginPlan, shape: "raw" | "copilot"): boolean {
  const { ctx, target, manifest, extDir, name, outDir } = plan;
  const source = contextSource(manifest);
  if (source === "" || !isFile(`${extDir}/${source}`)) return true;
  const row = ctx.table[target];
  const output = row.contextOutput.split("{ext}").join(name).split("{name}").join("");
  if (output === "") return true;
  const result = renderContext({
    source: readTextLf(`${extDir}/${source}`),
    sourceName: `${extDir}/${source}`,
    target,
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
    // The Copilot shell assigns the render through a command substitution under `set -e`, so it
    // exits silently after the diagnostics; claude and antigravity name the failure.
    if (shape === "raw") ctx.io.err(`Error: rendering context for target '${target}' failed`);
    return false;
  }
  for (const line of result.warnings) ctx.io.err(line);
  const text =
    shape === "raw"
      ? result.text
      : [
          "---",
          `name: ${name}-context`,
          `description: "Agent-facing context for the ${name} extension."`,
          "user-invocable: true",
          "---",
          "",
          withOneLf(result.text),
        ].join("\n");
  fs.mkdirSync(path.dirname(`${outDir}/${output}`), { recursive: true });
  fs.writeFileSync(`${outDir}/${output}`, text);
  ctx.io.out(`  Rendered: ${output}`);
  return true;
}

/** `skills/<name>` for every directory under the skills location (`cp -r`), when `skills` is declared. */
export function copySkills(plan: PluginPlan): void {
  const dir = dirOf(plan, "skills", "skills/");
  if (!subjectPresent(plan.manifest, "skills") || !isDirectory(dir)) return;
  fs.mkdirSync(`${plan.outDir}/skills`, { recursive: true });
  for (const skill of listEntries(dir)) {
    if (!isDirectory(`${dir}/${skill}`)) continue;
    copyDir(plan, `${dir}/${skill}`, `${plan.outDir}/skills/${skill}`);
    plan.ctx.io.out(`  Copied skill: ${skill}`);
  }
}

/**
 * `claude.defaultAllowedTools` as the shell saw it: null when the joined text is empty (no
 * `allowed-tools:` header), else the lines its `read` loop kept (trimmed, non-empty).
 */
function allowedTools(manifest: Manifest): string[] | null {
  const list = valueAt(manifest, "claude", "defaultAllowedTools");
  if (!Array.isArray(list)) return null;
  const joined = list.map((t) => (t === null ? "" : jqText(t))).join("\n");
  if (joined.replace(/\n+$/, "") === "") return null;
  return joined
    .split("\n")
    .map((t) => t.replace(/^[ \t]+|[ \t]+$/g, ""))
    .filter((t) => t !== "");
}

/** R18: each pivot `commands/*.md` becomes `skills/<name>/SKILL.md` when `convertToSkills` is true. */
export function convertToSkills(plan: PluginPlan, withTools: boolean): void {
  const { manifest, ctx, outDir } = plan;
  const dir = dirOf(plan, "commands", "commands/");
  if (!subjectPresent(manifest, "commands")) return;
  if (subjectOption(manifest, "commands", "convertToSkills", "false") !== "true") return;
  if (!isDirectory(dir)) return;
  const tools = withTools ? allowedTools(manifest) : null;
  for (const file of listEntries(dir)) {
    const md = `${dir}/${file}`;
    if (!file.endsWith(".md") || !isFile(md)) continue;
    let cmdName = ctx.renderCommand.yamlField(md, "name");
    if (cmdName === "" || cmdName === "null") cmdName = file.slice(0, -".md".length);
    const prompt = ctx.renderCommand.extractBody(md);
    const lines = [
      "---",
      `name: ${cmdName}`,
      `description: "${ctx.renderCommand.yamlField(md, "description")}"`,
      "user-invocable: true",
    ];
    if (tools !== null) lines.push("allowed-tools:", ...tools.map((t) => `  - ${t}`));
    lines.push("---", "", `${prompt.replace(/\n+$/, "")}\n`);
    fs.mkdirSync(`${outDir}/skills/${cmdName}`, { recursive: true });
    fs.writeFileSync(`${outDir}/skills/${cmdName}/SKILL.md`, lines.join("\n"));
    ctx.io.out(`  Rendered command to skill: ${cmdName}`);
  }
}

/** The hook handler directory, delivered whenever any generic hook is declared. */
export function copyHooks(plan: PluginPlan): void {
  if (!lengthPositive(plan.manifest.get("hooks")) || !isDirectory(`${plan.extDir}/hooks`)) return;
  copyDir(plan, `${plan.extDir}/hooks`, `${plan.outDir}/hooks`);
  plan.ctx.io.out("  Copied: hooks/");
}
