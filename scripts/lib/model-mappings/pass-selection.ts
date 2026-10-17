// pass-selection.ts — the `--print-selection` printer (check-model-mappings.sh:1054-1086).
// No assertion runs. Default mode prints each target's MAPPING IN FORCE; with named
// files each file is read directly. One line per rung: `<label>\t<rung>\t<offering-id>`.

import fs from "node:fs";
import path from "node:path";

import { ModelMappingsError, type TargetEntry } from "./types.ts";
import { loadOfferings, intelNameAt, RankError, selectForRung } from "./select.ts";
import { loadYq, YqParseError, type YqNode } from "../yq-accessors/index.ts";

/** Read and parse a mapping; a failure is the shell's aborted `yq` (req 24 (c), (d), (f)). */
export function loadFile(file: string): YqNode {
  try {
    return loadYq(fs.readFileSync(file, "utf8"));
  } catch (e) {
    const reason = e instanceof Error ? (e.message.split("\n")[0] ?? "") : String(e);
    if (e instanceof YqParseError || e instanceof Error) {
      throw new ModelMappingsError(`${file}: ${reason}`);
    }
    throw e;
  }
}

function linesFor(label: string, file: string): string {
  const offerings = loadOfferings(file, loadFile(file));
  let out = "";
  try {
    for (let rung = 1; rung <= 7; rung++) {
      out += `${label}\t${intelNameAt(rung)}\t${selectForRung(offerings, rung)}\n`;
    }
  } catch (e) {
    if (e instanceof RankError) throw new ModelMappingsError(`${file}: ${e.message}`);
    throw e;
  }
  return out;
}

/** `inForce(target)` is `mapping_in_force_for`: a handle path, or "" when none exists. */
export function printSelection(
  entries: readonly TargetEntry[],
  files: readonly string[],
  named: boolean,
  inForce: (target: string) => string,
): string {
  let out = "";
  if (!named) {
    for (const { target } of entries) {
      const handle = inForce(target);
      if (handle === "") throw new ModelMappingsError(`${target}: no mapping in force`);
      out += linesFor(`model-mappings/${target}`, handle);
    }
    return out;
  }
  for (const file of files) {
    const stem = path.basename(file, ".yml");
    const target = stem.endsWith(".org") ? stem.slice(0, -".org".length) : stem;
    out += linesFor(`model-mappings/${target}`, file);
  }
  return out;
}
