// mcp-json.ts — the JSON-config merge of the manage-* scripts (spec 0255 R8, plan step 9).
//
// Twins `merge_mcp_server` (copilot, antigravity) and `merge_json` (workspace, which also
// merges `themes`): create the config when it is absent, keep a `.bak` copy of what was
// there, set `.[key] = (.[key] // {}) + {(<name>): <declaration>}` and print the `Merged:`
// line. The files are read and written through the order-preserving Map tree, so the key
// order and the bytes are those of `jq .` (the shell's `jq ... > file`).
//
// Listed deviations: a declaration or a config that does not parse fails before the config
// is replaced (the shell truncated it through `> "$config_file"`); the write is atomic and goes through a
// link at the config path (the link survives, its target is updated); `.bak` stays beside the
// configured path, a plain copy of what the link pointed to, as `cp` made it; a link whose
// target cannot be created (its directory is missing) fails with one `Error:` line naming the
// link, the target and the corrective action, where the shell printed `Merged:` and wrote nothing.

import fs from "node:fs";
import path from "node:path";

import { parseJson } from "../extension/json-ordered.ts";
import { writeJsonText } from "../extension/json-write.ts";
import { ExtError } from "../extension/types.ts";
import type { Io, JsonValue } from "../extension/types.ts";
import { writeJsonKeepingMode } from "../install/write-mode.ts";

/** What the shell wrote into a config that did not exist yet (`echo` adds the line feed). */
export const INITIAL_MCP_CONFIG = '{"mcpServers":{}}\n';
export const INITIAL_SETTINGS = "{}\n";

export interface MergeRequest {
  /** The `*.json` declaration to merge; its basename without `.json` is the entry name. */
  readonly declFile: string;
  /** The config file (`mcp-config.json`, `settings.json`), created when absent. */
  readonly configFile: string;
  /** The key of the config that receives the entry: `mcpServers` or `themes`. */
  readonly key: string;
  /** The content of a config that does not exist: `INITIAL_MCP_CONFIG` or `INITIAL_SETTINGS`. */
  readonly initial: string;
}

/** jq's `x // {}`: null, false and absent read as the empty object. */
function orEmptyObject(value: JsonValue | undefined, what: string): Map<string, JsonValue> {
  if (value === undefined || value === null || value === false) return new Map();
  if (!(value instanceof Map)) throw new ExtError(`${what} is not an object, cannot add an entry`);
  return value;
}

/** The link's final target when it cannot be created (its directory is missing), else undefined. */
function uncreatableTarget(file: string): string | undefined {
  let current = file;
  for (let hops = 0; hops < 40; hops++) {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch {
      // Nothing at `current`: a missing file is written through only when its directory exists.
      return current === file || fs.existsSync(path.dirname(current)) ? undefined : current;
    }
    if (!stat.isSymbolicLink()) return undefined;
    current = path.resolve(path.dirname(current), fs.readlinkSync(current));
  }
  return undefined;
}

/**
 * Merge one declaration into `configFile` and print `  Merged: <name> into <key>`.
 * Throws an `ExtError` naming the file when the declaration or the config is not JSON, or
 * when the config's root or `<key>` member is not an object.
 */
export function mergeJsonEntry(req: MergeRequest, io: Io): void {
  const name = path.basename(req.declFile, ".json");
  const target = uncreatableTarget(req.configFile);
  if (target !== undefined) {
    throw new ExtError(
      `${req.configFile} is a symbolic link to ${target}, which cannot be created: create the directory ${path.dirname(target)} or remove the link`,
    );
  }
  fs.mkdirSync(path.dirname(req.configFile), { recursive: true });
  if (!fs.existsSync(req.configFile)) fs.writeFileSync(req.configFile, req.initial);
  fs.copyFileSync(req.configFile, `${req.configFile}.bak`);

  const declaration = parseJson(fs.readFileSync(req.declFile, "utf8"), req.declFile);
  const parsed = parseJson(fs.readFileSync(`${req.configFile}.bak`, "utf8"), req.configFile);
  // A `null` root reads as the empty object, as `null | .k = v` does in jq.
  const root = parsed === null ? new Map<string, JsonValue>() : parsed;
  if (!(root instanceof Map)) throw new ExtError(`${req.configFile} is not a JSON object`);
  const entries = orEmptyObject(root.get(req.key), `${req.configFile}: .${req.key}`);
  entries.set(name, declaration);
  root.set(req.key, entries);

  // The shell's `> "$config_file"` wrote through a link (dotfile manager); a rename would replace it.
  writeJsonKeepingMode(fs.realpathSync(req.configFile), writeJsonText(root));
  io.out(`  Merged: ${name} into ${req.key}`);
}
