// merge-spec-pr.ts — exclusive merge mechanism for spec-PRs (spec 0262).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/merge-spec-pr.ts [gh pr merge args...]
//
// Refuses a spec-PR whose spec file is `status: draft`; otherwise delegates to
// `gh pr merge --squash` with every argument passed through.
// Exit: 1 on a draft spec; otherwise the exit status of `gh`.

import { runMergeSpecPr } from "./lib/governance/merge-spec-pr.ts";

process.exitCode = runMergeSpecPr(process.argv.slice(2));
