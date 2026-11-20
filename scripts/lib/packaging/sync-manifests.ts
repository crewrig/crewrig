// sync-manifests.ts — rewrite the `version` of the two sibling manifests (spec 0257 R16, D2).
// Replaced `release_sync_cmd` and the loop of `release_prepare_cmd` in
// the former shell library scripts/lib/monorepo-release-lib.sh (removed): `jq --arg v <v> '.version=$v'` on `package.json` and
// `extension.json` of one directory, each only when the file exists (lockstep, spec 0044).
// Spec 0312 R6: also the `version="…"` of the provenance carrier of every `skills/*/SKILL.md`
// and `agents/*/AGENT.md` of that directory, so the release commit carries them in lockstep.

import fs from "node:fs";
import path from "node:path";

import { carrierField, firstBodyLine } from "../governance/carrier.ts";
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

const CARRIER_PREFIX = "<!-- crewrig-provenance:";

/** The `skills/*\/SKILL.md` and `agents/*\/AGENT.md` files of `dir` that exist, sorted. */
function carrierFiles(dir: string): string[] {
  const out: string[] = [];
  for (const [group, name] of [
    ["skills", "SKILL.md"],
    ["agents", "AGENT.md"],
  ] as const) {
    const root = path.join(dir, group);
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(root).sort();
    } catch {
      continue;
    }
    for (const entry of entries) {
      const file = path.join(root, entry, name);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) out.push(file);
    }
  }
  return out;
}

/** The text with the carrier's `version` set; `undefined` when the file has no versioned carrier. */
function rewriteCarrier(file: string, version: string): Rewrite | undefined {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${file}: ${reason(error)}`);
  }
  const line = firstBodyLine(text);
  if (!line.startsWith(CARRIER_PREFIX) || carrierField(line, "version") === "") return undefined;
  const next = line.replace(/\bversion="[^"]*"/, `version="${version}"`);
  return { file, text: text.replace(line, () => next) };
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
  for (const file of carrierFiles(dir)) {
    const carrier = rewriteCarrier(file, version);
    if (carrier !== undefined) rewrites.push(carrier);
  }
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
