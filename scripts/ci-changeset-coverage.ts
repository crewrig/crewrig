// ci-changeset-coverage.ts — exhaustive run of every changeset-gated check (spec 0147 delta-01
// R21); TypeScript twin of scripts/ci-changeset-coverage.sh (spec 0262 req 11).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ci-changeset-coverage.ts
// Exit: 0 every command passed, 1 a command failed, 2 yq or the reference is missing.

import { runCoverage } from "./lib/ci-changeset-coverage/entry.ts";

process.exitCode = runCoverage(process.argv[1] ?? "ci-changeset-coverage.ts", process.env);
