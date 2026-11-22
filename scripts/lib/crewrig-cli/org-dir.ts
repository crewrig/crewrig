// org-dir.ts — the organization directory of `build`, `setup` and `update` (spec 0315 R2, R4). It is checked
// before anything else is read: it exists, it holds `crewrig.config.toml`, and that file reads as the two
// string keys of 0314 R16. A refusal names the directory or the file and the defect, and writes nothing.

import fs from "node:fs";
import path from "node:path";

import { readOrgConfig, type OrgConfig } from "./toml-read.ts";

export const CONFIG_FILE = "crewrig.config.toml";

export type OrgDirResult =
  | { readonly ok: true; readonly dir: string; readonly config: OrgConfig }
  | { readonly ok: false; readonly message: string };

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** Resolve `--org-dir` (or the working directory) and check it (spec 0315 R4). */
export function checkOrgDir(cwd: string, command: string, flag: string | undefined): OrgDirResult {
  const dir = path.resolve(cwd, flag ?? ".");
  if (!isDirectory(dir)) {
    return {
      ok: false,
      message: `crewrig ${command}: the organization directory ${dir} does not exist.`,
    };
  }
  const file = path.join(dir, CONFIG_FILE);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return {
      ok: false,
      message: `crewrig ${command}: ${CONFIG_FILE} is missing in ${dir}; this is not an organization directory.`,
    };
  }
  const reading = readOrgConfig(text);
  if (!reading.ok) {
    return { ok: false, message: `crewrig ${command}: ${file} ${reading.reason}.` };
  }
  return { ok: true, dir, config: reading.config };
}
