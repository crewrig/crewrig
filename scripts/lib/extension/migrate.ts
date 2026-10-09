// migrate.ts — the extension migration tool (spec 0254 R20).
// Twin of the whole of scripts/migrate-extension.sh (spec 0183 R15): detect the retired
// declaration forms, convert a temporary copy, replace the source tree only on full success.
// Errors go to stderr, the `Already migrated:` / `Migrated:` summary to stdout; the status
// is returned, never exited with.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { globToRegExp } from "../glob-engine.ts";
import { legacyShapePath, readGeneratedClass, readLegacyShape } from "./descriptors.ts";
import type { LegacyShape } from "./descriptors.ts";
import { parseJson } from "./json-ordered.ts";
import { writeJsonText } from "./json-write.ts";
import { readTextLf } from "../line-endings.ts";
import type { Manifest } from "./manifest.ts";
import { resolveExtensionDir } from "./resolve.ts";
import { detectShape } from "./shape-guard.ts";
import { copyTree, emptyDir } from "./tree-copy.ts";
import type { Io, JsonValue } from "./types.ts";

export interface MigrateCtx {
  readonly repoDir: string;
  readonly libDir: string;
  readonly io: Io;
}

const PER_CLI_SECTIONS = ["gemini", "claude", "copilot", "antigravity"];

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** The manifest as the shell's `jq ... 2>/dev/null` saw it: unreadable or non-object reads as empty. */
function readManifestLenient(file: string): Manifest {
  try {
    const doc = parseJson(readTextLf(file), file);
    return doc instanceof Map ? doc : new Map();
  } catch {
    return new Map();
  }
}

/** Pathname expansion of `"$dir"/$glob`: `*` stops at `/` and skips a leading dot; regular files only. */
function expandGlob(dir: string, glob: string): string[] {
  let bases = [""];
  for (const segment of glob.split("/")) {
    const next: string[] = [];
    for (const base of bases) {
      if (!segment.includes("*")) {
        next.push(base === "" ? segment : `${base}/${segment}`);
        continue;
      }
      const re = globToRegExp(segment);
      let names: string[];
      try {
        names = fs.readdirSync(base === "" ? dir : `${dir}/${base}`);
      } catch {
        continue;
      }
      for (const name of names.sort()) {
        if (name.startsWith(".") && !segment.startsWith(".")) continue;
        if (re.test(name)) next.push(base === "" ? name : `${base}/${name}`);
      }
    }
    bases = next;
  }
  return bases.filter((rel) => isFile(`${dir}/${rel}`));
}

function generatedHits(dir: string, libDir: string): string[] {
  if (!isFile(`${libDir}/extension-generated-class.json`)) return [];
  const cls = readGeneratedClass(libDir);
  const hits = cls.manifestClass.filter((rel) => rel !== "" && isFile(`${dir}/${rel}`));
  for (const glob of cls.generatedGlobs) if (glob !== "") hits.push(...expandGlob(dir, glob));
  return hits;
}

function subjectEnabled(manifest: Manifest, shape: LegacyShape, subject: string): boolean {
  const components = manifest.get(shape.componentsKey);
  return components instanceof Map && components.get(subject) instanceof Map
    ? (components.get(subject) as Map<string, JsonValue>).get("enabled") === true
    : false;
}

/** Convert the manifest in place; returns the reasons it could not be fully converted. */
function convert(manifest: Manifest, shape: LegacyShape, perCliHits: string[], has: boolean) {
  const unconverted: string[] = [];
  if (has) {
    for (const subject of shape.componentsSubjects) {
      if (subject === "" || !subjectEnabled(manifest, shape, subject)) continue;
      if (manifest.has(subject) && manifest.get(subject) !== null) {
        unconverted.push(
          `components.${subject} (enabled) conflicts with an existing top-level '${subject}' section`,
        );
        continue;
      }
      const options = new Map(
        (manifest.get(shape.componentsKey) as Manifest).get(subject) as Manifest,
      );
      options.delete("enabled");
      manifest.set(subject, options);
    }
    if (unconverted.length === 0) manifest.delete(shape.componentsKey);
  }
  if (unconverted.length === 0 && perCliHits.length > 0) {
    for (const hit of perCliHits) {
      const dot = hit.indexOf(".");
      const section = manifest.get(dot < 0 ? hit : hit.slice(0, dot));
      if (section instanceof Map) section.delete(dot < 0 ? hit : hit.slice(dot + 1));
    }
    for (const name of PER_CLI_SECTIONS) {
      const section = manifest.get(name);
      if (section instanceof Map && section.size === 0) manifest.delete(name);
    }
  }
  return unconverted;
}

/** Run the migration for one extension directory or name; returns the exit status. */
export function migrateExtension(ctx: MigrateCtx, arg: string): number {
  const { io, repoDir, libDir } = ctx;
  const shapePath = legacyShapePath(libDir);
  const read = readLegacyShape(libDir);
  if (read.kind === "missing") {
    io.err(`Error: legacy-shape enumeration not found at ${shapePath} (spec 0183 R12).`);
    return 1;
  }
  if (read.kind === "malformed") {
    io.err(`Error: legacy-shape enumeration at ${shapePath} is malformed (spec 0183 R12).`);
    return 1;
  }
  const shape = read.shape;
  const resolved = resolveExtensionDir(arg, repoDir);
  if (!resolved.ok) {
    io.err(resolved.message);
    return 1;
  }
  const dir = resolved.dir;
  const manifestPath = `${dir}/extension.json`;
  if (!isFile(manifestPath)) {
    io.err(`Error: No extension.json found in ${dir} — nothing to migrate.`);
    return 1;
  }
  const found = detectShape(readManifestLenient(manifestPath), shape);
  const hits = generatedHits(dir, libDir);
  if (!found.hasComponents && found.perCliHits.length === 0 && hits.length === 0) {
    io.out(`Already migrated: ${dir} carries none of the retired declaration forms.`);
    return 0;
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-extension-"));
  try {
    copyTree(dir, work);
    const manifest = readManifestLenient(`${work}/extension.json`);
    const unconverted = convert(manifest, shape, found.perCliHits, found.hasComponents);
    if (unconverted.length > 0) {
      io.err(`Error: ${dir} could not be fully converted; the source tree was left unchanged.`);
      for (const item of unconverted) io.err(`  - ${item}`);
      return 1;
    }
    if (found.hasComponents || found.perCliHits.length > 0)
      fs.writeFileSync(`${work}/extension.json`, writeJsonText(manifest));
    for (const rel of hits) fs.rmSync(`${work}/${rel}`, { force: true });
    emptyDir(dir, repoDir);
    copyTree(work, dir);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  io.out(`Migrated: ${dir}`);
  if (found.hasComponents)
    io.out("  - converted the retired 'components' object to generic top-level sections");
  if (found.perCliHits.length > 0)
    io.out(`  - dropped retired per-CLI keys: ${found.perCliHits.join(" ")}`);
  if (hits.length > 0) io.out(`  - de-committed generated-output-class file(s): ${hits.join(" ")}`);
  return 0;
}
