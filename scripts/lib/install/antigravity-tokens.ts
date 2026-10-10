// antigravity-tokens.ts — twin of `ext_antigravity_resolve_tokens`, scripts/lib/extension-install.sh
// (spec 0183 R19; spec 0255 R10). After the tool's own install, the neutral `${extensionRoot}` token
// is resolved in every string value of the installed `mcp_config.json`. The installed directory is
// located through the identity the tool reports (the rendered plugin.json `.name`), never the
// source basename. No `jq`, no `mv`: the file is rewritten atomically by `writeFileAtomic`.

import fs from "node:fs";
import path from "node:path";

import { parseJson } from "../extension/json-ordered.ts";
import { writeJsonText } from "../extension/json-write.ts";
import { textOr, valueAt } from "../extension/manifest.ts";
import type { Io, JsonValue } from "../extension/types.ts";
import { writeFileAtomic } from "../tmp-file.ts";

const TOKEN = "${extensionRoot}";

/** `walk(if type == "string" then gsub(token; root) else . end)`: object keys are left as they are. */
export function replaceLeaves(value: JsonValue, root: string): JsonValue {
  if (typeof value === "string") return value.split(TOKEN).join(root);
  if (Array.isArray(value)) return value.map((item) => replaceLeaves(item, root));
  if (value instanceof Map) {
    const next = new Map<string, JsonValue>();
    for (const [key, item] of value) next.set(key, replaceLeaves(item, root));
    return next;
  }
  return value;
}

/** `jq -r '.name // empty'` of plugin.json; unreadable or malformed reads as empty (stderr discarded). */
function pluginName(file: string): string {
  try {
    return textOr(valueAt(asMap(parseJson(fs.readFileSync(file, "utf8"), file)), "name"), "");
  } catch {
    return "";
  }
}

function asMap(value: JsonValue): Map<string, JsonValue> {
  return value instanceof Map ? value : new Map<string, JsonValue>();
}

/** Resolve the token under `<home>/.gemini/config/plugins/<name>`; `false` after a diagnostic on stderr. */
export function resolveTokens(outputDir: string, home: string, io: Io): boolean {
  if (!fs.existsSync(path.join(outputDir, "mcp_config.json"))) return true;
  const name = pluginName(path.join(outputDir, "plugin.json"));
  if (name === "") {
    io.err(
      `Error: ${outputDir}/plugin.json carries no (or an empty) .name — cannot locate the installed directory. The install-time resolution requires the identity the tool itself reports; there is no fallback to the source directory's basename (spec 0183 R19).`,
    );
    return false;
  }
  const root = path.join(home, ".gemini", "config", "plugins", name);
  const mcp = path.join(root, "mcp_config.json");
  if (!isFile(mcp)) {
    io.err(
      `Error: expected ${mcp} after install (spec 0180 R16: a target that receives a declaration without the artifacts it names is a failure).`,
    );
    return false;
  }
  try {
    const doc = parseJson(fs.readFileSync(mcp, "utf8"), mcp);
    // The shell `mv`d a `mktemp` file (0600) over the config: `writeFileAtomic`'s 0600 is that mode.
    writeFileAtomic(mcp, writeJsonText(replaceLeaves(doc, root)));
  } catch {
    io.err(`Error: failed to rewrite ${TOKEN} in ${mcp}`);
    return false;
  }
  io.out(`  Resolved ${TOKEN} -> ${root} in ${mcp}`);
  return true;
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
