// git-shim.ts — a `git` the claim tool finds first on PATH (POSIX only), used
// to put the tool through what a real repository cannot be made to do on
// demand: a `git status` that fails (spec 0248 R19), a tree that becomes dirty
// between the gate and the claim (R17), a git that does not run at all (R8).
//
// The wrapper passes everything through to the real git except `status`, which
// it hands to `onStatus`, a fragment of POSIX shell that may use `$REAL` (the
// real git) and `$@`, and must `exit` or fall through to the plain pass-through.

import { cleanEnv, makePathDir, which } from "./worktree-fixtures.ts";

/** An environment whose first `git` is the wrapper; the rest of PATH is the parent's. */
export function gitShimEnv(onStatus: string): NodeJS.ProcessEnv {
  const real = which("git");
  if (real === null) throw new Error("git is needed by this test");
  const dir = makePathDir({
    scripts: {
      git: [
        `REAL=${JSON.stringify(real)}`,
        'for a in "$@"; do',
        '  if [ "$a" = status ]; then',
        onStatus,
        "  fi",
        "done",
        'exec "$REAL" "$@"',
      ].join("\n"),
    },
  });
  return cleanEnv({ PATH: `${dir}:${process.env["PATH"] ?? ""}` });
}
