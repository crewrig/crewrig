// check-agent-profiles.ts — hermetic checker for an agent source's metadata.model:
// capability profile (spec 0195 R23-R25, spec 0198 R36-R39); TypeScript twin of
// scripts/check-agent-profiles.sh (spec 0262).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-agent-profiles.ts [file ...]
// No file: every artifacts/*/agents/*/AGENT.md under CREWRIG_REPO_DIR (default: the repository).
//
// Exit: 0 every profile conforms, 1 one or more rejections (`<file>: <id> <message>` on
// stderr), 2 a missing artifacts/ directory or named file.

import path from "node:path";

import { runCheck } from "./lib/governance/agent-profiles.ts";

const repoDir = process.env["CREWRIG_REPO_DIR"] || path.resolve(import.meta.dirname, "..");
const outcome = runCheck(process.argv.slice(2), repoDir);
if (outcome.stdout !== "") process.stdout.write(outcome.stdout);
if (outcome.stderr !== "") process.stderr.write(outcome.stderr);
process.exitCode = outcome.code;
