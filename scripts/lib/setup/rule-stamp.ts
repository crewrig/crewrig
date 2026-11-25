// rule-stamp.ts — deploy-time stamping of rules and system-context files (spec 0316 R11, R12).
//
// A deployed rule or store file is a stamped copy: the authored provenance block of the source is
// replaced by the one-line marker of the shared writer. Layer 1: node built-ins and repository
// modules only (setup runs before the dependency step).

import fs from "node:fs";
import path from "node:path";

import { loadConfig, resolvePlaceholders } from "../build-components/config.ts";
import { readAuthoredProvenance, stripAuthoredBlock } from "../provenance-authored.ts";
import { replaceMarker } from "../provenance-marker.ts";
import type { ProvenanceFields } from "../provenance-marker.ts";

export interface StampSource {
  readonly path: string;
  /** The repository-relative name used in diagnostics. */
  readonly name: string;
}

export interface StampContext {
  readonly repoDir: string;
  readonly platform: NodeJS.Platform;
}

export type StampBase = ReturnType<typeof stampBase>;

/** The `package` of the root `package.json`, and the resolver of the build's own placeholders. */
export function stampBase(ctx: StampContext): {
  readonly pkg: string;
  readonly resolve: (value: string) => string;
} {
  const raw = JSON.parse(fs.readFileSync(path.join(ctx.repoDir, "package.json"), "utf8")) as {
    name?: unknown;
  };
  if (typeof raw.name !== "string" || raw.name === "") {
    throw new Error("package.json: `name` is missing");
  }
  // Silent: the run's own build steps already warn when `crewrig.config.toml` is missing, and the
  // placeholders then stay literal here exactly as they do in the build.
  const quiet = { out: () => {}, err: () => {}, errRaw: () => {} };
  const config = loadConfig(ctx.repoDir, ctx.platform, quiet);
  return {
    pkg: raw.name,
    resolve: (value) => resolvePlaceholders(config, value),
  };
}

/** The stamped bytes of one source: the authored block replaced by the R3 line. */
export function stampText(text: string, name: string, base: StampBase): string {
  const authored = readAuthoredProvenance(text, name, "html");
  const fields: ProvenanceFields = {
    package: base.pkg,
    version: authored.version,
    ...(authored.canonical === undefined ? {} : { canonical: base.resolve(authored.canonical) }),
    ...(authored.feedback === undefined ? {} : { feedback: base.resolve(authored.feedback) }),
  };
  return replaceMarker(stripAuthoredBlock(text, name, "html"), fields, "html");
}

/** The `.md` files directly inside `dir`, sorted. */
export function markdownIn(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

/** Validate every source before anything is placed: the first failure names its file. */
export function preflight(sources: readonly StampSource[], base: StampBase): void {
  for (const source of sources) stampText(fs.readFileSync(source.path, "utf8"), source.name, base);
}
