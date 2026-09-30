// release-pr.ts — CLI entry of the GitHub release-PR sync (issue #1379).
//
// The logic lives in scripts/lib/release-pr.ts (exercised by
// scripts/tests/release-pr.test.ts); scripts/monorepo-release.sh runs this
// entry point after it has pushed the release branch.
//
// Usage:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/release-pr.ts sync <base> <head> <entries.json>

import { main } from "./lib/release-pr.ts";

process.exitCode = await main(process.argv.slice(2), process.env);
