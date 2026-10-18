// check-description-length.ts — fails when a skill or agent `description` exceeds 300
// characters (spec 0269 R11), on artifacts/ sources and compiled outputs alike.
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-description-length.ts
// `CREWRIG_REPO_DIR` overrides the repository root (default: this repository).
//
// Exit: 0 clean, 1 over-long descriptions, 2 prerequisite failure (js-yaml missing).
// Finding lines (stdout): `FAIL <file> — description <n> chars (max 300)`.

import path from "node:path";
import { MAX_DESCRIPTION_CHARS, findOverlong } from "./lib/governance/description-length.ts";
import { fail, fatal, ok } from "./lib/governance/report.ts";
import { repoRootFrom } from "./lib/paths.ts";
import { MissingDependencyError, loadDependency } from "./lib/require-dependency.ts";

const envRoot = process.env["CREWRIG_REPO_DIR"];
const repoDir =
  envRoot !== undefined && envRoot !== "" ? envRoot : path.resolve(repoRootFrom(import.meta.url));

try {
  const yaml = (await loadDependency("js-yaml")) as { load(input: string): unknown };
  const findings = findOverlong(repoDir, yaml);
  if (findings.length === 0) {
    ok(`OK: every description is at most ${MAX_DESCRIPTION_CHARS} characters`);
  } else {
    fail(
      findings
        .map((f) => `FAIL ${f.file} — description ${f.length} chars (max ${MAX_DESCRIPTION_CHARS})`)
        .join("\n"),
    );
    process.exitCode = 1;
  }
} catch (err) {
  if (!(err instanceof MissingDependencyError)) throw err;
  fatal(err.message);
  process.exitCode = 2;
}
