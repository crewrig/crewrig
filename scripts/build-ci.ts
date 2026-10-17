// build-ci.ts — derives .gitlab-ci.yml from ci/ci-capabilities.yml; TypeScript twin of
// scripts/build-ci.sh (spec 0262, dark until the shell is retired).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/build-ci.ts [--check]
// REPO_DIR overrides the repository root. Exit: 0 ok, 1 drift or generation failure,
// 2 missing reference.

import path from "node:path";

import { run } from "./lib/build-ci/entry.ts";

const repoDir = process.env["REPO_DIR"] || path.resolve(import.meta.dirname, "..");
const outcome = run(process.argv.slice(2), repoDir);
if (outcome.stdout !== "") process.stdout.write(outcome.stdout);
if (outcome.stderr !== "") process.stderr.write(outcome.stderr);
process.exitCode = outcome.code;
