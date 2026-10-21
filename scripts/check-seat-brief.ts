// check-seat-brief.ts — form check of a seated-pass brief before the spawn (spec 0276).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-seat-brief.ts [path|-]
//        node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-seat-brief.ts --template <specs|plan|review>
// With no path, or `-`, the brief is read from stdin. Author-side tool: the orchestrator runs it
// on every seated-pass brief and does not spawn on a non-zero exit; CI only checks fixtures.
//
// Exit: 0 conforming, 1 breach, 2 unreadable input or usage error.
// Output: `OK: seat <key>` on stdout, or one `BREACH <rule>: line <n>: <excerpt>` per violation on stderr.

import { fatal, ok } from "./lib/governance/report.ts";
import { runSeatBrief } from "./lib/governance/seat-brief.ts";

const outcome = runSeatBrief(process.argv.slice(2));
if (outcome.stdout !== "") ok(outcome.stdout.replace(/\n$/, ""));
if (outcome.stderr !== "") fatal(outcome.stderr.replace(/\n$/, ""));
process.exitCode = outcome.code;
