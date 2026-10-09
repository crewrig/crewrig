// check-arms.ts — the `--check` arms of `build-extension` (spec 0254 R14, R19).
// Twins `check_extension`, `declared_outputs`, `check_gaps`, `check_version_drift`,
// `check_skeleton_name_axis` and `cleanup_stray_plugin_dist` (scripts/build-extension.sh:462-700).
// Every line goes to `ctx.io.out`; each arm function returns its failure count.

import fs from "node:fs";
import path from "node:path";

import { classScan, nameAxisScan, nameAxisTokens } from "./check-scan.ts";
import { declaredCommands } from "./context-declared.ts";
import { readGeneratedClass, readJsonFile } from "./descriptors.ts";
import { gapKey } from "./gap-record.ts";
import { resolvedEntries } from "./hooks-resolve.ts";
import {
  contextSource,
  extBuildDir,
  extGapDir,
  manifestName,
  readManifest,
  subjectLocation,
  subjectPresent,
  textOr,
  valueAt,
} from "./manifest.ts";
import type { Manifest } from "./manifest.ts";
import { renderExtension } from "./render-extension.ts";
import { TARGETS } from "./types.ts";
import type { ExtCtx, Io, JsonValue } from "./types.ts";

const NAME_AXIS_MESSAGE =
  "is named for a supported command-line tool but no declaration generates it; the permitted paths are to delete the file or to declare the subject that produces it";

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** `sort -u`, in code-unit order, without the empty lines the shell loops skip. */
function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].filter((v) => v !== "").sort();
}

/** `declared_outputs`: the Gemini in-place target's declared output set (R10(c)). */
export function declaredOutputs(ctx: ExtCtx, extDir: string, manifest: Manifest): string[] {
  const name = manifestName(manifest) ?? "null";
  const declared = ["gemini-extension.json"];
  if (contextSource(manifest) !== "") {
    declared.push(
      ctx.table.gemini.contextOutput.split("{ext}").join(name).split("{name}").join(""),
    );
  }
  if (subjectPresent(manifest, "commands")) {
    const location = subjectLocation(manifest, "commands", "commands/");
    const loc = location.endsWith("/") ? location.slice(0, -1) : location;
    for (const stem of declaredCommands(manifest, extDir, ctx.renderCommand)) {
      declared.push(`${loc}/${stem}.toml`);
    }
  }
  if (resolvedEntries("gemini", manifest, ctx.table).length > 0) declared.push("hooks/hooks.json");
  return declared;
}

function keysOf(file: string): string[] {
  if (!isFile(file)) return [];
  const doc = readJsonFile(file);
  const records = Array.isArray(doc) ? doc : [];
  return sortedUnique(records.filter((r) => r instanceof Map).map((r) => gapKey(r)));
}

/** Arm (d): observed gaps against `accepted-gaps.json`. Returns 0 or 1. */
export function checkGaps(ctx: ExtCtx, extDir: string, name: string): number {
  const observed = keysOf(path.join(extGapDir(ctx.repoDir, name), "observed-gaps.json"));
  const accepted = keysOf(`${extDir}/accepted-gaps.json`);
  let ok = 0;
  for (const k of observed) {
    if (accepted.includes(k)) continue;
    ctx.io.out(
      `  FAIL GAP-UNDECLARED ${name} — observed gap '${k}' has no matching entry in ${extDir}/accepted-gaps.json`,
    );
    ok = 1;
  }
  for (const k of accepted) {
    if (observed.includes(k)) continue;
    ctx.io.out(
      `  FAIL GAP-STALE ${name} — ${extDir}/accepted-gaps.json declares '${k}' but the render no longer observes it`,
    );
    ok = 1;
  }
  if (ok === 0) ctx.io.out(`  OK   GAP ${name}`);
  return ok;
}

function versionOf(file: string): string {
  const doc: JsonValue = readJsonFile(file);
  return doc instanceof Map ? textOr(valueAt(doc, "version"), "") : "";
}

/** Arm (e): the built manifest's version against the authoritative declaration. Returns 0 or 1. */
export function checkVersionDrift(ctx: ExtCtx, extDir: string, name: string): number {
  const built = `${extBuildDir(ctx.repoDir, name)}/gemini-extension.json`;
  if (!isFile(built)) {
    ctx.io.out(`  FAIL VERSION-DRIFT ${name} — ${built} was not produced by the render`);
    return 1;
  }
  const builtVersion = versionOf(built);
  const authoritative = versionOf(
    isFile(`${extDir}/package.json`) ? `${extDir}/package.json` : `${extDir}/extension.json`,
  );
  if (builtVersion !== authoritative) {
    ctx.io.out(
      `  FAIL VERSION-DRIFT ${name} — built gemini-extension.json version '${builtVersion}' != authoritative version '${authoritative}'`,
    );
    return 1;
  }
  ctx.io.out(`  OK   VERSION-DRIFT ${name} (version ${builtVersion})`);
  return 0;
}

/** An `Io` that appends both streams, in order, to one buffer (the shell's `>log 2>&1`). */
function bufferIo(): { readonly io: Io; text(): string } {
  let buffer = "";
  return {
    io: {
      out: (line) => void (buffer += `${line}\n`),
      err: (line) => void (buffer += `${line}\n`),
      errRaw: (text) => void (buffer += text),
    },
    text: () => buffer,
  };
}

/** Run the five arms against a forced `--target all` render; returns the failure count. */
export async function checkExtension(ctx: ExtCtx, extDir: string): Promise<number> {
  const manifest = readManifest(`${extDir}/extension.json`);
  const name = manifestName(manifest) ?? "null";
  let failures = 0;

  // Arm (a) — COMMITTED, on the source tree: the generated class, then the name axis.
  const committed = classScan(extDir, readGeneratedClass(ctx.libDir));
  const nameAxis = nameAxisScan(extDir, nameAxisTokens(ctx.libDir));
  if (committed.length > 0 || nameAxis.length > 0) {
    for (const f of committed) {
      ctx.io.out(
        `  FAIL COMMITTED ${name} — ${f} is a member of the generated-output class and MUST NOT be committed at all; delete it and reach it through one of the delivery paths in EXTENSION-FORMAT.md`,
      );
      failures += 1;
    }
    for (const f of nameAxis) {
      if (committed.includes(f)) continue;
      ctx.io.out(`  FAIL COMMITTED ${name} — ${f} ${NAME_AXIS_MESSAGE}`);
      failures += 1;
    }
  } else {
    ctx.io.out(
      `  OK   COMMITTED ${name} (no generated-output-class file committed, no undeclared tool-designated file)`,
    );
  }

  // Arm (b) — RENDER-FAIL: a forced full render, its output captured.
  const captured = bufferIo();
  if ((await renderExtension({ ...ctx, io: captured.io }, extDir, TARGETS)) !== 0) {
    ctx.io.out(`  FAIL RENDER-FAIL ${name} — a fresh --target all render failed:`);
    const text = captured.text();
    const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
    for (const line of lines) ctx.io.out(`         ${line}`);
    return failures + 1;
  }
  ctx.io.out(`  OK   RENDER-FAIL ${name} (fresh --target all render succeeded)`);

  // Arm (c) — MISSING/UNDECLARED, the in-place target only.
  const declared = sortedUnique(declaredOutputs(ctx, extDir, manifest));
  const produced = sortedUnique(
    classScan(extBuildDir(ctx.repoDir, name), readGeneratedClass(ctx.libDir)),
  );
  const missing = declared.filter((f) => !produced.includes(f));
  const undeclared = produced.filter((f) => !declared.includes(f));
  for (const f of missing) {
    ctx.io.out(`  FAIL MISSING ${name} — declared output '${f}' was not produced`);
    failures += 1;
  }
  for (const f of undeclared) {
    ctx.io.out(`  FAIL UNDECLARED ${name} — produced output '${f}' is not a declared output`);
    failures += 1;
  }
  if (missing.length === 0 && undeclared.length === 0) {
    ctx.io.out(`  OK   MISSING/UNDECLARED ${name} (produced set matches declared set)`);
  }

  failures += checkGaps(ctx, extDir, name);
  failures += checkVersionDrift(ctx, extDir, name);
  return failures;
}

/** The scaffold container's name-axis arm alone; returns the failure count. */
export function checkSkeleton(ctx: ExtCtx, skeletonDir: string): number {
  const hits = nameAxisScan(skeletonDir, nameAxisTokens(ctx.libDir));
  if (hits.length === 0) {
    ctx.io.out("  OK   COMMITTED extension-skeleton (no tool-designated file committed)");
    return 0;
  }
  for (const f of hits)
    ctx.io.out(`  FAIL COMMITTED extension-skeleton — ${f} ${NAME_AXIS_MESSAGE}`);
  return hits.length;
}

function subdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// Remove every `dist-*-plugin` directory exactly three levels under `extensions/`
// (`find -mindepth 3 -maxdepth 3 -type d`): extensions/<tier>/<name>/dist-*-plugin.
export function cleanupStrayPluginDist(repoDir: string): void {
  const root = path.join(repoDir, "extensions");
  for (const tier of subdirs(root)) {
    for (const ext of subdirs(path.join(root, tier))) {
      const extDir = path.join(root, tier, ext);
      for (const name of subdirs(extDir)) {
        if (name.length >= 12 && name.startsWith("dist-") && name.endsWith("-plugin")) {
          fs.rmSync(path.join(extDir, name), { recursive: true, force: true });
        }
      }
    }
  }
}
