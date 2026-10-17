// check-model-mappings.ts — hermetic checker for model-mappings/<target>.yml and its org
// channel <target>.org.yml (spec 0197 R46-R51, spec 0199 R29-R36); TypeScript twin of
// scripts/check-model-mappings.sh (spec 0262).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-model-mappings.ts
//          [--print-selection] [file ...]
// Exit: 0 conform / lines printed, 1 rejections or a runtime failure, 2 a missing input.

import path from "node:path";

import { runCheck } from "./lib/model-mappings/entry.ts";
import { loadDependency } from "./lib/require-dependency.ts";

const repoDir = process.env["CREWRIG_REPO_DIR"] || path.resolve(import.meta.dirname, "..");
const outcome = runCheck(process.argv.slice(2), repoDir, await loadDependency("js-yaml"));
if (outcome.stdout !== "") process.stdout.write(outcome.stdout);
if (outcome.stderr !== "") process.stderr.write(outcome.stderr);
process.exitCode = outcome.code;
