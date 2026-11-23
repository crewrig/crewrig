// validate-provenance.ts — the `provenance` declaration of `extension.json` (spec 0316 R7).
// Pure: returns the `VALIDATION-ERROR` lines; the caller prints them.
//   - `provenance` must be an object, `canonical` and `feedback` non-empty strings.
//   - At `extensions/core` and `extensions/library` (the upstream tiers) `canonical` is required,
//     `feedback` must equal it (spec 0043 R5), and the extension's `package.json` must carry a
//     `name` and a `version` (R2). Any other tier only warns, elsewhere (provenance-stamp.ts).

import fs from "node:fs";
import path from "node:path";

import type { JsonValue } from "./types.ts";

const UPSTREAM_TIERS: readonly string[] = ["core", "library"];

/** True for an extension under `extensions/core/<name>` or `extensions/library/<name>`. */
export function isUpstreamTier(extDir: string): boolean {
  const abs = path.resolve(extDir);
  const tier = path.basename(path.dirname(abs));
  const root = path.basename(path.dirname(path.dirname(abs)));
  return root === "extensions" && UPSTREAM_TIERS.includes(tier);
}

function nonEmptyString(value: JsonValue | undefined): boolean {
  return typeof value === "string" && value !== "";
}

/** The `package.json` of `extDir` as an object, or null when absent or unreadable. */
export function readPackageJson(extDir: string): Record<string, unknown> | null {
  try {
    const doc: unknown = JSON.parse(fs.readFileSync(path.join(extDir, "package.json"), "utf8"));
    return typeof doc === "object" && doc !== null && !Array.isArray(doc)
      ? (doc as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Every `VALIDATION-ERROR` line the `provenance` declaration and the R2 sources earn. */
export function validateProvenance(
  manifestPath: string,
  manifest: Map<string, JsonValue>,
): string[] {
  const errors: string[] = [];
  const fail = (member: string, why: string): void => {
    errors.push(`VALIDATION-ERROR: ${manifestPath}: \`${member}\` ${why}`);
  };
  const extDir = path.dirname(manifestPath);
  const upstream = isUpstreamTier(extDir);
  const declared = manifest.get("provenance");
  let canonical: JsonValue | undefined;
  let feedback: JsonValue | undefined;
  if (declared !== undefined) {
    if (!(declared instanceof Map)) {
      fail("provenance", "must be an object");
    } else {
      canonical = declared.get("canonical");
      feedback = declared.get("feedback");
      if (canonical !== undefined && !nonEmptyString(canonical)) {
        fail("provenance.canonical", "must be a non-empty string");
      }
      if (feedback !== undefined && !nonEmptyString(feedback)) {
        fail("provenance.feedback", "must be a non-empty string");
      }
    }
  }
  if (upstream) {
    if (!nonEmptyString(canonical) && canonical === undefined) {
      fail(
        "provenance.canonical",
        "is required for an extension of extensions/core or extensions/library",
      );
    }
    if (nonEmptyString(canonical) && nonEmptyString(feedback) && feedback !== canonical) {
      fail(
        "provenance.feedback",
        "must equal `provenance.canonical` for an upstream extension (spec 0043 R5)",
      );
    }
    if (!nonEmptyString(manifest.get("name"))) {
      fail("name", "must be a non-empty string for an upstream extension (spec 0316 R1, R2)");
    }
    const pkg = readPackageJson(extDir);
    for (const member of ["name", "version"]) {
      if (pkg === null || typeof pkg[member] !== "string" || pkg[member] === "") {
        errors.push(
          `VALIDATION-ERROR: ${path.join(extDir, "package.json")}: \`${member}\` must be a non-empty string for an upstream extension (spec 0316 R2)`,
        );
      }
    }
  }
  return errors;
}
