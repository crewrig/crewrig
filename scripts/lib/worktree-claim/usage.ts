// usage.ts — the `--help` block (spec 0248 R14, R19, R38(a)).
//
// Byte-identical to the shell tool's block except the invocation lines, which
// name `node scripts/worktree-claim.ts` because `bash scripts/worktree-claim.sh`
// is not available on Windows. The block states the limit of the clean-tree
// gate (ignored state) and the overlap of the exit codes; keep both.

export const USAGE = `\
worktree-claim.sh — exclusive, attributable claims on a shared ticket worktree
(spec 0114).

  node scripts/worktree-claim.ts run --agent <name> [--ticket <id>] -- <command…>
      RECOMMENDED. Take the claim, run the command, release on exit. The claim
      is held for the whole duration of the operation by construction. The
      command runs in the worktree root — the same tree the gate certified —
      whatever directory you invoked this from.

  node scripts/worktree-claim.ts take --agent <name> [--ticket <id>] [--operation "<cmd>"]
      Take the claim for an operation that is not a single command.

  node scripts/worktree-claim.ts release --agent <name> [--ticket <id>]
      Release a claim you hold.

  node scripts/worktree-claim.ts takeover --agent <name> [--ticket <id>] [--stale-after <minutes>]
      Take over a claim whose holder has ended. Transfers the claim and NOTHING
      else: no clean-tree waiver, and no working-tree file is touched.

  node scripts/worktree-claim.ts status [--ticket <id>]
      Who holds the worktree right now. Read-only; runs from anywhere.

  node scripts/worktree-claim.ts history [--ticket <id>]
      Who held it and when, including after the claim — and the worktree — are
      gone. Read-only; runs from anywhere.

Options:
  --agent <name>        The acting agent. Required for run/take/release/takeover:
                        an anonymous holder defeats requirements 6 and 7.
  --ticket <id>         The ticket whose worktree is claimed. Defaults to the
                        basename of the toplevel when that is under
                        .worktrees/; required otherwise.
  --operation "<cmd>"   Recorded with the claim and in the ledger (take).
  --stale-after <min>   Minutes after which a claim counts as stale (takeover).
                        A non-negative integer of at most 9 digits — the width at
                        which 'minutes * 60' still fits the arithmetic that
                        evaluates it. Default: 30.
  -h, --help            This block.

Read-only subcommands (status, history) carry no .worktrees/ guard, so an
investigation can run from the main checkout after the worktree is cleaned up.
The clean-tree gate is evaluated by take and run on EVERY invocation, including
when the caller already holds the claim.

The gate reads \`git status\`, which says nothing about files matched by
.gitignore. \`git clean -fdx\` and \`-fdX\` reach that state and destroy it while the
gate reads clean and the run exits 0. The claim protects work git can name as
tracked or untracked; ignored build output and local scratch files are outside
its cover, whoever holds the claim.

Exit codes: 0 success | 1 genuine failure | 4 refused, claim state (take,
takeover, release, run) | 5 refused, tree not clean (take/run only) | 6 release
on an unclaimed worktree | n run propagates the wrapped command's exit code.

Those last four overlap. run emits 1, 4 and 5 on its OWN behalf, always before
the wrapped command is started, and each is also a code that command may return
by itself: a 4 from run can mean the claim is held by another agent and your
command never ran at all. The code does not separate the two cases -- the
diagnostic does. Every refusal run raises itself prints \`Refused:\` (stdout) or
\`Error:\` (stderr), and on that path the wrapped command produced no output,
because it never ran. Branch on that output, not on the number alone.
`;
