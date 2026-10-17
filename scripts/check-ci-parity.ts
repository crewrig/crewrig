// check-ci-parity.ts — 3-way CI drift harness; TypeScript twin of scripts/check-ci-parity.sh
// (spec 0262, dark until the shell is retired). Slice 1: reference validity, traceability and
// Arm 3 are ported; arm 1, arm 2 and the path filters are pending (see lib/ci-parity/entry.ts).
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
