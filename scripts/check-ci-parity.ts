// check-ci-parity.ts — 3-way CI drift harness; TypeScript twin of scripts/check-ci-parity.sh
// (spec 0262, dark until the switch pull request). Every section is ported: reference validity,
// traceability, arm 1, arm 2 (spawns scripts/build-ci.ts --check), arm 3 and the path filters.
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-ci-parity.ts
// CREWRIG_REPO_DIR overrides the repository root. Exit: 0 clean, 1 drift, 2 missing reference.

import path from "node:path";

import { run } from "./lib/ci-parity/entry.ts";

const repoDir = process.env["CREWRIG_REPO_DIR"] || path.resolve(import.meta.dirname, "..");
const outcome = run(process.argv.slice(2), repoDir);
if (outcome.stdout !== "") process.stdout.write(outcome.stdout);
if (outcome.stderr !== "") process.stderr.write(outcome.stderr);
process.exitCode = outcome.code;
