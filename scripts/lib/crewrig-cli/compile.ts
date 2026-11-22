// compile.ts — the compile of the organization components that `build` and `setup` share (spec 0315 R5, R6).
// Framework data comes from the version root, the organization's configuration and components from the
// organization directory, and the output goes to a temporary directory the caller owns. The YAML library is the
// one staged in the version root (framework-release vendor step), imported here and handed to the build.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { main as buildComponents } from "../build-components/main.ts";
import type { Io } from "../build-components/types.ts";

/** The compiled tier of the organization sits at `<out>/dist/org`. */
export const ORG_TIER = "org";

/** Where the vendored js-yaml ESM build lives, relative to the version root. */
const YAML_FILE = path.join("dist", "vendor", "js-yaml", "js-yaml.mjs");

/** The organization's own components, the two directories `build` compiles (spec 0315 R5). */
const COMPONENT_DIRS = ["skills", "agents"] as const;

/** A directory of the organization that holds no component: at most a `.gitkeep`. */
function holdsNothingButKeep(dir: string): boolean {
  try {
    return fs.readdirSync(dir).every((name) => name === ".gitkeep");
  } catch {
    return true;
  }
}

/** Whether the organization defines at least one component (a skill or an agent). */
export function definesComponent(orgDir: string): boolean {
  return COMPONENT_DIRS.some((kind) => !holdsNothingButKeep(path.join(orgDir, "artifacts", ORG_TIER, kind)));
}

/** The notice of spec 0315 R5/R6 when `artifacts/community/hooks` holds anything but `.gitkeep`. */
export function hooksNotice(orgDir: string): string | undefined {
  const dir = path.join(orgDir, "artifacts", "community", "hooks");
  if (!fs.existsSync(dir) || holdsNothingButKeep(dir)) return undefined;
  return "crewrig: organization hooks in artifacts/community/hooks are not installed by this version; the directory is reserved and nothing in it is read.";
}

/** A fresh temporary directory, outside the organization directory (spec 0315 R6). */
export function temporaryDirectory(): string {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-compile-")));
}

/** The vendored YAML namespace of the version root. */
export async function loadVendoredYaml(versionRoot: string): Promise<unknown> {
  return import(pathToFileURL(path.join(versionRoot, YAML_FILE)).href) as Promise<unknown>;
}

export interface CompileInput {
  readonly versionRoot: string;
  readonly orgDir: string;
  /** The output root: the tier lands at `<outDir>/dist/org`. */
  readonly outDir: string;
  readonly io: Io;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
}

/** Compile the organization tier into `outDir`; returns the build status (0 on success). */
export async function compileOrganization(input: CompileInput): Promise<number> {
  const yaml = await loadVendoredYaml(input.versionRoot);
  return buildComponents({
    argv: ["--tier", ORG_TIER],
    env: input.env,
    platform: input.platform,
    entryFile: path.join(input.versionRoot, "scripts", "build-components.ts"),
    io: input.io,
    roots: { framework: input.versionRoot, source: input.orgDir, out: input.outDir },
    yaml,
  });
}
