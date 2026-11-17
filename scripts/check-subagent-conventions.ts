// check-subagent-conventions.ts — verify the subagent conventions block of every compiled agent
// (spec 0306 R17, R18).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-subagent-conventions.ts
// Override the repository root with CREWRIG_REPO_DIR (default: the parent of scripts/).
//
// Exit: 0 everything holds (OK line on stdout), 1 findings (`- <path>: <rule>` on stderr),
// 2 the fragment is absent or the repository root cannot be resolved.

import path from "node:path";
import { checkSubagentConventions } from "./lib/governance/subagent-conventions.ts";
import { fatal, ok } from "./lib/governance/report.ts";

const envDir = process.env["CREWRIG_REPO_DIR"];
const repoDir =
  envDir !== undefined && envDir !== "" ? envDir : path.resolve(import.meta.dirname, "..");
process.exitCode = checkSubagentConventions(repoDir, { out: ok, err: fatal });
