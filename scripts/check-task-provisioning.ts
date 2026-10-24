// check-task-provisioning.ts — guard of the pinned, verified Task provisioning (spec 0282 R6).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-task-provisioning.ts
// REPO_DIR overrides the repository root. Exit: 0 clean, 1 finding or unreadable input.

import path from "node:path";

import { checkTaskProvisioning } from "./lib/task-provisioning/index.ts";

const repoDir = process.env["REPO_DIR"] || path.resolve(import.meta.dirname, "..");
const outcome = checkTaskProvisioning(repoDir);
if (outcome.code === 0) process.stdout.write("check-task-provisioning: OK\n");
else for (const f of outcome.findings) process.stderr.write(`check-task-provisioning: ${f}\n`);
process.exitCode = outcome.code;
