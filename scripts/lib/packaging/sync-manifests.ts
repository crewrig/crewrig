// sync-manifests.ts — rewrite the `version` of the two sibling manifests (spec 0257 R16, D2).
// Replaced `release_sync_cmd` and the loop of `release_prepare_cmd` in
// the former shell library scripts/lib/monorepo-release-lib.sh (removed): `jq --arg v <v> '.version=$v'` on `package.json` and
// `extension.json` of one directory, each only when the file exists (lockstep, spec 0044).

import fs from "node:fs";
import path from "node:path";

import { writeFileAtomic } from "../tmp-file.ts";

/** The manifests kept in lockstep, in the order the shell loop visits them. */
const MANIFESTS: readonly string[] = ["package.json", "extension.json"];

interface Rewrite {
  readonly file: string;
  readonly text: string;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The rewritten text of one manifest; the key order is kept, a missing `version` goes last. */
function rewrite(file: string, version: string): Rewrite {
  let parsed: unknown;
  try {
    // JSON whitespace includes CR, so CRLF input parses; the output is always LF.
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${file}: ${reason(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`cannot rewrite ${file}: not a JSON object`);
  }
  // Assigning an existing key keeps its position; a new key lands last, as `jq` does.
  const manifest = parsed as Record<string, unknown>;
  manifest["version"] = version;
  return { file, text: `${JSON.stringify(manifest, null, 2)}\n` };
}

/**
 * Set `version` in the `package.json` and `extension.json` of `dir` and return the files
 * rewritten. A file that fails to parse or write throws an Error naming it. Every manifest is
 * parsed before the first is written, so a malformed sibling never leaves the pair half-synced
 * (the shell loop could).
 */
export function syncManifests(dir: string, version: string): string[] {
  const rewrites: Rewrite[] = MANIFESTS.map((name) => path.join(dir, name))
    .filter((file) => fs.existsSync(file))
    .map((file) => rewrite(file, version));
  for (const { file, text } of rewrites) {
    try {
      // The mode the manifest already has is kept: the temporary file is created 0600, and a
      // manifest committed 0644 must not turn private (the shell's `jq > tmp && mv` made a
      // fresh file at the umask's default instead).
      const mode = fs.statSync(file).mode & 0o777;
      writeFileAtomic(file, text);
      fs.chmodSync(file, mode);
    } catch (error) {
      throw new Error(`cannot write ${file}: ${reason(error)}`);
    }
  }
  return rewrites.map((r) => r.file);
}
