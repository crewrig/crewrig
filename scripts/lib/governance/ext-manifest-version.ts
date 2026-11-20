// ext-manifest-version.ts — logic of check-extension-manifest-version (spec 0259; replaces
// scripts/check-extension-manifest-version.ts, spec 0044 R5/R6 as amended by delta-01).
//
// Usage: evaluateVersions(cwd, libDir) -> { code, stdout, stderr }
// Walks `extensions/{core,library}/*/package.json` under `cwd` (the shell's relative roots; the
// repo dir only locates the shared lib), compares each sibling `extension.json` `.version` with
// the authoritative package.json `.version`. Reuses extension/manifest.ts (readManifest,
// textOr, jqText rendering) and extension/shape-guard.ts (assertCurrentShape).
// Spec 0312 R5: also compares every skill/agent provenance carrier of the extension with the
// extension directory name (`extension`) and the package.json `.version` (`version`).
// Exit codes: 0 all agree, 1 divergence, 2 an unparseable manifest (jq's own exit 2 under
// `set -e`; the jq-absent exit 2 does not exist in TypeScript).
// Finding-line format: `  FAIL <dir>/<file> — ...`, `  OK   <dir> (version <v>)`, summary block.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { carrierField, firstBodyLine } from "./carrier.ts";
import { findFiles } from "./walk.ts";
import { assertCurrentShape } from "../extension/shape-guard.ts";
import { readManifest, textOr } from "../extension/manifest.ts";
import type { Manifest } from "../extension/manifest.ts";
import { ExtError } from "../extension/types.ts";

export interface VersionOutcome {
  code: 0 | 1 | 2;
  stdout: string;
  stderr: string;
}

const TIER_ROOTS = ["extensions/core", "extensions/library"] as const;
const SIBLINGS = ["extension.json"] as const;

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** `for pkg in "$root"/*\/package.json; [ -f ]` then `sort`: relative dirs, code-unit order. */
function extensionDirs(cwd: string): string[] {
  const dirs: string[] = [];
  for (const root of TIER_ROOTS) {
    if (!isDir(`${cwd}/${root}`)) continue;
    for (const name of readdirSync(`${cwd}/${root}`)) {
      if (name.startsWith(".")) continue;
      if (isFile(`${cwd}/${root}/${name}/package.json`)) dirs.push(`${root}/${name}`);
    }
  }
  return dirs.sort();
}

/** `jq -r '.version // empty'`: a non-object document makes jq fail (null reads as empty). */
function versionOf(manifest: Manifest): string {
  return textOr(manifest.get("version"), "");
}

/** Every extension directory (package.json or not) under the tier roots, relative, sorted. */
function allExtensionDirs(cwd: string): string[] {
  const dirs: string[] = [];
  for (const root of TIER_ROOTS) {
    if (!isDir(`${cwd}/${root}`)) continue;
    for (const name of readdirSync(`${cwd}/${root}`)) {
      if (name.startsWith(".")) continue;
      if (isDir(`${cwd}/${root}/${name}`)) dirs.push(`${root}/${name}`);
    }
  }
  return dirs.sort();
}

/** Findings for the carriers of one extension; `expectedVersion` is undefined with no package. */
function carrierFindings(
  cwd: string,
  dir: string,
  expectedVersion: string | undefined,
): { stdout: string; files: string[] } {
  let stdout = "";
  const files: string[] = [];
  const name = dir.slice(dir.lastIndexOf("/") + 1);
  const rels = findFiles(`${cwd}/${dir}`, (rel) => /(^|\/)(SKILL|AGENT)\.md$/.test(rel));
  for (const rel of rels) {
    const file = `${dir}/${rel}`;
    const carrier = firstBodyLine(readFileSync(`${cwd}/${file}`, "utf8"));
    if (!carrier.startsWith("<!-- crewrig-provenance:")) continue; // R7 owns a missing carrier
    if (expectedVersion === undefined) {
      stdout += `  FAIL ${file} — carrier in an extension directory with no package.json\n`;
      files.push(file);
      continue;
    }
    for (const [field, expected] of [
      ["extension", name],
      ["version", expectedVersion],
    ] as const) {
      const value = carrierField(carrier, field);
      if (value === "") {
        stdout += `  FAIL ${file} — carrier field '${field}' is absent or empty\n`;
        files.push(file);
      } else if (value !== expected) {
        stdout += `  FAIL ${file} — ${field} '${value}' != '${expected}'\n`;
        files.push(file);
      }
    }
  }
  return { stdout, files };
}

function readDoc(file: string): Manifest {
  return readManifest(file);
}

export function evaluateVersions(cwd: string, libDir: string): VersionOutcome {
  let stdout = "";
  let stderr = "";
  const failures: string[] = [];
  let checked = 0;
  let carrierFailed = false;
  try {
    for (const dir of extensionDirs(cwd)) {
      checked++;
      const authoritative = versionOf(readDoc(`${cwd}/${dir}/package.json`));
      if (authoritative === "") {
        stdout += `  FAIL ${dir}/package.json — no .version field (authoritative source must declare one)\n`;
        failures.push(`${dir}/package.json`);
        continue;
      }
      let dirOk = true;
      for (const sib of SIBLINGS) {
        if (!isFile(`${cwd}/${dir}/${sib}`)) continue;
        const rel = `${dir}/${sib}`;
        const manifest = readDoc(`${cwd}/${rel}`);
        const shape = assertCurrentShape(rel, manifest, libDir);
        if (shape.length > 0) {
          stderr += shape.map((l) => `${l}\n`).join("");
          failures.push(rel);
          dirOk = false;
          continue;
        }
        const sibVersion = versionOf(manifest);
        if (sibVersion !== authoritative) {
          stdout += `  FAIL ${rel} — version '${sibVersion}' != authoritative package.json version '${authoritative}'\n`;
          failures.push(rel);
          dirOk = false;
        }
      }
      const car = carrierFindings(cwd, dir, authoritative);
      if (car.files.length > 0) {
        stdout += car.stdout;
        failures.push(...car.files);
        carrierFailed = true;
        dirOk = false;
      }
      if (dirOk) stdout += `  OK   ${dir} (version ${authoritative})\n`;
    }
    const withPkg = new Set(extensionDirs(cwd));
    for (const dir of allExtensionDirs(cwd)) {
      if (withPkg.has(dir)) continue;
      const car = carrierFindings(cwd, dir, undefined);
      stdout += car.stdout;
      failures.push(...car.files);
      if (car.files.length > 0) carrierFailed = true;
    }
  } catch (err) {
    if (err instanceof ExtError)
      return { code: 2, stdout, stderr: `${stderr}Error: ${err.message}\n` };
    throw err;
  }

  if (failures.length > 0) {
    stdout += `\nFAILED: ${failures.length} manifest(s) diverge from their extension's authoritative version:\n`;
    for (const f of failures) stdout += `  - ${f}\n`;
    stdout +=
      "\nPer spec 0044 (as amended by delta-01), an extension's package.json version\n" +
      "is authoritative; its committed extension.json sibling MUST declare the SAME\n" +
      "version (gemini-extension.json is a build output, asserted separately by\n" +
      "'node scripts/build-extension.ts --check'). The release driver\n" +
      "(scripts/monorepo-release.ts) syncs both in lockstep, so post-release drift\n" +
      "means a manual edit fell out of step.\n";
    if (carrierFailed)
      stdout +=
        '\nEvery skill/agent provenance carrier of an extension (extension="<dir name>"\n' +
        'version="<package version>") is held to the same lockstep (spec 0312).\n';
    return { code: 1, stdout, stderr };
  }
  stdout += `\nOK: ${checked} extension(s) declare a single authoritative version across their manifests.\n`;
  return { code: 0, stdout, stderr };
}
