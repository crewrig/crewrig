// provenance-stamp.ts — render-time provenance stamping of the extension renderers (spec 0316
// R2, R5, R7, R9). The bytes come from the shared writer (`../provenance-marker.ts`); this file
// only resolves the fields from `extension.json` and `package.json`, and applies the writer to
// the copies the renderers produce. No source file is ever written.

import fs from "node:fs";
import path from "node:path";

import { markerYaml, replaceMarker } from "../provenance-marker.ts";
import type { MarkerSyntax, ProvenanceFields } from "../provenance-marker.ts";
import { obj, writeJsonText } from "./json-write.ts";
import { extVersion, manifestName } from "./manifest.ts";
import type { Manifest } from "./manifest.ts";
import type { ExtCtx, JsonValue, PluginTarget, Target } from "./types.ts";
import { isUpstreamTier, readPackageJson, validateProvenance } from "./validate-provenance.ts";

export const SIDECAR = "crewrig-provenance.json";

/**
 * The one predicate that decides whether an output carries markers and a sidecar: the extension
 * has a `package.json` with a non-empty `name` (R1 requires `package`). Upstream tiers are
 * guaranteed to satisfy it by `validateProvenance`.
 */
export function sidecarExpected(extDir: string): boolean {
  const name = readPackageJson(extDir)?.name;
  return typeof name === "string" && name !== "";
}

/** The R1 fields of an extension (R2 sources), or null when `sidecarExpected` is false. */
export function extensionFields(extDir: string, manifest: Manifest): ProvenanceFields | null {
  const pkg = readPackageJson(extDir);
  if (pkg === null || !sidecarExpected(extDir)) return null;
  const declared = manifest.get("provenance");
  const member = (key: string): string | undefined => {
    const v = declared instanceof Map ? declared.get(key) : undefined;
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const canonical = member("canonical");
  const version = typeof pkg.version === "string" && pkg.version !== "" ? pkg.version : undefined;
  return {
    package: String(pkg.name),
    extension: manifestName(manifest) ?? undefined,
    version,
    canonical,
    feedback: canonical === undefined ? undefined : (member("feedback") ?? canonical),
  };
}

/** The render-side warnings, printed per target so each CLI names itself. */
export function provenanceWarnings(
  ctx: ExtCtx,
  extDir: string,
  manifest: Manifest,
  target: Target,
): void {
  const name = manifestName(manifest) ?? "null";
  const declared = manifest.get("provenance");
  const canonical = declared instanceof Map ? declared.get("canonical") : undefined;
  if (canonical === undefined && !isUpstreamTier(extDir)) {
    ctx.io.err(
      `Warning: extension '${name}' declares no provenance.canonical — the ${target} markers carry no canonical or feedback`,
    );
  }
  const pkg = readPackageJson(extDir);
  const pkgVersion = typeof pkg?.version === "string" ? pkg.version : undefined;
  if (pkgVersion !== undefined && pkgVersion !== extVersion(manifest)) {
    ctx.io.err(
      `Warning: extension '${name}' package.json version '${pkgVersion}' differs from extension.json version '${extVersion(manifest)}' — the ${target} provenance carries the package.json version`,
    );
  }
}

/** Validate and resolve the fields for a standalone plugin build; `errors` stops the build. */
export function preparePlanProvenance(
  ctx: ExtCtx,
  extDir: string,
  manifestPath: string,
  manifest: Manifest,
  target: PluginTarget,
): { fields: ProvenanceFields | null } | { errors: string[] } {
  const errors = validateProvenance(manifestPath, manifest);
  if (errors.length > 0) return { errors };
  provenanceWarnings(ctx, extDir, manifest, target);
  return { fields: extensionFields(extDir, manifest) };
}

/** `text` carrying the marker of `syntax`; unchanged when there are no fields. */
export function stampText(
  text: string,
  fields: ProvenanceFields | null,
  syntax: MarkerSyntax,
): string {
  return fields === null ? text : replaceMarker(text, fields, syntax);
}

/** Stamp the file at `file` in place (a copy in an output tree, never a source). */
export function stampFile(
  file: string,
  fields: ProvenanceFields | null,
  syntax: MarkerSyntax,
): void {
  if (fields === null || !fs.existsSync(file)) return;
  fs.writeFileSync(file, replaceMarker(fs.readFileSync(file, "utf8"), fields, syntax));
}

/** Stamp each `SKILL.md` below `<root>/<skill>/` and each agent under `<agentsRoot>`. */
export function stampTree(
  fields: ProvenanceFields | null,
  skillsRoot: string,
  agentsRoot: string,
): void {
  if (fields === null) return;
  for (const [root, nested] of [
    [skillsRoot, "SKILL.md"],
    [agentsRoot, "AGENT.md"],
  ] as const) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;
    for (const entry of fs.readdirSync(root).sort()) {
      const full = path.join(root, entry);
      if (fs.statSync(full).isDirectory()) stampFile(path.join(full, nested), fields, "html");
      else if (entry.endsWith(".md")) stampFile(full, fields, "html");
    }
  }
}

/** The YAML block of a command converted to a skill, as lines for its frontmatter. */
export function commandYaml(fields: ProvenanceFields | null): string[] {
  return fields === null ? [] : markerYaml(fields).split("\n");
}

/** `crewrig-provenance.json` at the root of an output (R5); nothing when there are no fields. */
export function writeSidecar(outDir: string, fields: ProvenanceFields | null): void {
  if (fields === null) return;
  const pairs: Array<readonly [string, JsonValue]> = [["package", fields.package]];
  const rest: Array<readonly [string, string | undefined]> = [
    ["extension", fields.extension],
    ["version", fields.version],
    ["canonical", fields.canonical],
    ["feedback", fields.feedback],
  ];
  for (const [key, value] of rest) if (value !== undefined) pairs.push([key, value]);
  fs.writeFileSync(path.join(outDir, SIDECAR), writeJsonText(obj(pairs)));
}
