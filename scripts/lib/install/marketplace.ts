// marketplace.ts — the shared local marketplace of the Claude installer (spec 0045; spec 0255 R10).
// Twin of the manifest and `jq` steps of scripts/install-claude-plugin.sh: `loadManifest` is the
// missing-manifest line and the shape guard (which run before ANY write), `upsertMarketplace`
// writes `<home>/.claude-plugin/marketplace.json` as the shell's `jq -n` did: name `<repo>-local`,
// owner, the prior plugin list minus the same name, the new entry last. The reader and the writer
// keep key order and write the `jq` pretty form byte for byte.

import fs from "node:fs";
import path from "node:path";

import { parseJson } from "../extension/json-ordered.ts";
import { obj, writeJsonText } from "../extension/json-write.ts";
import { readManifest, textOr, valueAt } from "../extension/manifest.ts";
import type { Manifest } from "../extension/manifest.ts";
import { assertCurrentShape } from "../extension/shape-guard.ts";
import { ExtError } from "../extension/types.ts";
import type { Io, JsonValue } from "../extension/types.ts";
import { writeJsonKeepingMode } from "./write-mode.ts";

/** The manifest, or `null` after the diagnostic (stdout for a missing file, stderr for a legacy shape). */
export function loadManifest(extDir: string, libDir: string, io: Io): Manifest | null {
  const file = path.join(extDir, "extension.json");
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    io.out(
      `Error: No extension.json found in ${extDir} — run scripts/migrate-extension.sh if this is an old-shape extension (see docs/adoption-guide.md).`,
    );
    return null;
  }
  const manifest = readManifest(file);
  const lines = assertCurrentShape(file, manifest, libDir);
  for (const line of lines) io.err(line);
  return lines.length === 0 ? manifest : null;
}

/** `<basename of the repository>-local`. */
export function marketplaceName(repoDir: string): string {
  return `${path.basename(repoDir)}-local`;
}

/** `.claude.author.name // .author.name // "Unknown"`. */
export function authorName(manifest: Manifest): string {
  const fallback = textOr(valueAt(manifest, "author", "name"), "Unknown");
  return textOr(valueAt(manifest, "claude", "author", "name"), fallback);
}

/** The plugins already listed, minus any entry of the same name (`[.plugins[] | select(.name != $n)]`). */
function priorPlugins(file: string, name: string): JsonValue[] {
  if (!fs.existsSync(file)) return [];
  const doc = parseJson(fs.readFileSync(file, "utf8"), file);
  const plugins = doc instanceof Map ? doc.get("plugins") : undefined;
  if (!Array.isArray(plugins)) throw new ExtError(`${file}: .plugins is not an array`);
  return plugins.filter((entry) => !(entry instanceof Map && entry.get("name") === name));
}

/** Upsert `name` into `<marketHome>/.claude-plugin/marketplace.json` and print the shell's line. */
export function upsertMarketplace(
  marketHome: string,
  market: string,
  name: string,
  manifest: Manifest,
  io: Io,
): void {
  const dir = path.join(marketHome, ".claude-plugin");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "marketplace.json");
  const entry = obj([
    ["name", name],
    ["description", textOr(manifest.get("description"), "")],
    ["author", obj([["name", authorName(manifest)]])],
    ["source", `./${name}`],
  ]);
  const doc = obj([
    ["name", market],
    ["owner", obj([["name", "crewrig contributors"]])],
    ["plugins", [...priorPlugins(file, name), entry]],
  ]);
  writeJsonKeepingMode(file, writeJsonText(doc));
  io.out(`  Generated marketplace manifest: ${market}`);
}
