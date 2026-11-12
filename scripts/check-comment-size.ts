// check-comment-size.ts — repository-root entry for the comment-size guard (spec 0289 R4).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-comment-size.ts [path|-]
// Delegates to the copy bundled with the pr-reviewer skill, so the two cannot diverge. The
// bundled file reads process.argv and sets process.exitCode when imported.
//
// Exit: 0 within budget, 1 over budget, 2 usage error, 3 unreadable input.

import "../artifacts/core/skills/pr-reviewer/scripts/check-comment-size.ts";
