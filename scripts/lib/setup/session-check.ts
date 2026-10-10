// session-check.ts — the `session-check` step (spec 0246 R11, shell: the `{ command -v node && node
// <floor guard> && node ... session-check-hooks.ts register <cli>; } || echo ... >&2` line that
// closes the hook writers of every setup). The registration stays a child `node` process, as in the
// shell. A failure never stops the run. The blank line that follows the check in the shell is NOT
// printed here: the step after it (summary, system-context-file) owns its own leading blank line.

import path from "node:path";

import type { StepFn } from "./descriptor.ts";

export const SESSION_CHECK_FAILED = "  Session check registration FAILED — setup continues.";

export const sessionCheckStep: StepFn = async ({ ctx, spawn }) => {
  const guard = path.join(ctx.repoDir, "scripts", "lib", "node-floor-guard.js");
  const hooks = path.join(ctx.repoDir, "scripts", "session-check-hooks.ts");
  // `command -v node` is the spawner's 127 for a missing `node`; the children write to the terminal.
  const ok =
    spawn(["node", guard], { inherit: true }).status === 0 &&
    spawn(["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", hooks, "register", ctx.cli], {
      inherit: true,
    }).status === 0;
  if (!ok) ctx.io.err(SESSION_CHECK_FAILED);
};
