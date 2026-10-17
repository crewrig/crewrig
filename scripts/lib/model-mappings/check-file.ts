// check-file.ts — `check_file` (check-model-mappings.sh:1033-1050): one file, one pass.
// Ported: A0, the shape pass, surfaces, grounds and offerings; the remaining passes are listed in
// `PENDING_PASSES` and still owed by later slices.

import fs from "node:fs";

import { checkOfferings } from "./pass-offerings.ts";
import { checkSurfaces } from "./pass-surfaces.ts";
import { checkDuplicateIdsAndRanks, checkTarget, checkToplevelShape } from "./pass-shape.ts";
import { ModelMappingsError, type Fail } from "./types.ts";
import { loadYq, YqParseError, type YqNode } from "../yq-accessors/index.ts";

/** Still to port: reasoning projection, guard, totality, zero/observed, org overrides. */
export const PENDING_PASSES = [
  "check_frontmatter_reasoning_projection",
  "check_guard",
  "check_selection_totality",
  "check_zero_offerings_and_observed",
  "check_org_overrides",
] as const;

/** `yq e '.' file` failing is A0; multi-document and unknown tags are deliberate Error lines. */
function parse(file: string, fail: Fail): YqNode | undefined {
  try {
    return loadYq(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e instanceof YqParseError && e.kind !== "syntax" && e.kind !== "alignment") {
      throw new ModelMappingsError(`${file}: ${e.message.split("\n")[0] ?? ""}`);
    }
    const reason = e instanceof Error ? (e.message.split("\n")[0] ?? "") : String(e);
    fail("A0", `does not parse as YAML: ${reason}`);
    return undefined;
  }
}

export function checkFile(file: string, target: string, isOrg: boolean, fail: Fail): void {
  const doc = parse(file, fail);
  if (doc === undefined) return;
  const scope = { doc, isOrg, fail, file };
  try {
    checkTarget(scope, target, file);
    checkToplevelShape(scope);
    checkDuplicateIdsAndRanks(scope);
    checkSurfaces(scope);
    checkOfferings(scope);
  } catch (e) {
    if (e instanceof ModelMappingsError) throw e;
    throw new ModelMappingsError(`${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
