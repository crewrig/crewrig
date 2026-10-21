// check-plan-review.ts — decides whether a plan needs the cold second-architect review (spec 0277).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-plan-review.ts <spec-path> [<plan-path>|-] [--prior-review]
// With no plan path, or `-`, the plan comment body is read from stdin. Author-side tool: the
// orchestrator runs it at PLAN time and posts the output verbatim; CI only checks fixtures.
//
// Exit: 0 for every decision, 2 unreadable input or usage error.
// Output: `plan-review: <required|skipped|not-applicable>` then `reason:` lines on stdout.

import { fatal, ok } from "./lib/governance/report.ts";
import { runPlanReview } from "./lib/governance/plan-review-gate.ts";

const outcome = runPlanReview(process.argv.slice(2));
if (outcome.stdout !== "") ok(outcome.stdout.replace(/\n$/, ""));
if (outcome.stderr !== "") fatal(outcome.stderr.replace(/\n$/, ""));
process.exitCode = outcome.code;
