// check-comment-size.ts — fails when a plan or verdict comment body exceeds 12288 bytes.
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-comment-size.ts [path|-]
// With no argument, or `-`, the body is read from stdin. Author-side tool (spec 0275 R-E2):
// run it on the comment body before posting; CI only checks it against committed fixtures.
//
// Exit: 0 within budget, 1 over budget or unreadable input.
// Output: `OK: <n> bytes (budget: 12288 bytes)` on stdout, or an `ERROR:` / `Error:` line on stderr.

import { evaluateCommentSizeOfFile, evaluateStdin } from "./lib/governance/comment-size.ts";
import { fatal, ok } from "./lib/governance/report.ts";

const arg = process.argv[2];
const outcome = arg === undefined || arg === "-" ? evaluateStdin() : evaluateCommentSizeOfFile(arg);
if (outcome.stdout !== "") ok(outcome.stdout.replace(/\n$/, ""));
if (outcome.stderr !== "") fatal(outcome.stderr.replace(/\n$/, ""));
process.exitCode = outcome.code;
