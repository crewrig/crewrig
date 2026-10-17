// check-file.ts — `check_file` (check-model-mappings.sh:1033-1050): one file, one pass.
// Every pass of the shell, in its order: A0, shape, surfaces, offerings, projection, guard,
// totality, zero/observed, then the org overrides for an org file.

import fs from "node:fs";

import { checkGuard } from "./pass-guard.ts";
import { checkOfferings } from "./pass-offerings.ts";
import { checkOrgOverrides } from "./pass-org.ts";
import { checkReasoningProjection } from "./pass-projection.ts";
import { checkSelectionTotality, checkZeroOfferingsAndObserved } from "./pass-totality.ts";
import { checkSurfaces } from "./pass-surfaces.ts";
import { checkDuplicateIdsAndRanks, checkTarget, checkToplevelShape } from "./pass-shape.ts";
import { ModelMappingsError, type Fail } from "./types.ts";
import { loadYq, YqParseError, type YqNode } from "../yq-accessors/index.ts";

/** Every pass of the shell is ported; kept so a future pass has one place to be listed. */
export const PENDING_PASSES: readonly string[] = [];

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
    checkReasoningProjection(scope);
    checkGuard(scope);
    checkSelectionTotality(scope);
    checkZeroOfferingsAndObserved(scope);
    if (isOrg) checkOrgOverrides(scope);
  } catch (e) {
    if (e instanceof ModelMappingsError) throw e;
    throw new ModelMappingsError(`${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
