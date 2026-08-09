#!/bin/bash
# worktree-claim.sh — An exclusive, attributable claim on a shared ticket
# worktree, so that a whole-tree git operation cannot silently destroy a sibling
# agent's uncommitted work (spec 0114).
#
# The failure this removes is not a merge conflict but an anonymous erasure. A
# ticket's worktree is shared: every agent staffed on that ticket writes into one
# checkout with one index. `git reset --hard`, `git checkout -- .`, `git stash`
# and `git clean` respect no ownership, so one agent's routine verification step
# discards another agent's uncommitted work outright — and announces nothing. The
# suite still runs green at its older case count, and the traces left behind
# establish that a whole-tree operation happened but not which agent ran it.
#
# THE MECHANISM. A claim is a DIRECTORY created with `mkdir` under the
# repository's git common directory:
#
#   <common>/crewrig/worktree-claims/<ticket>/{holder,since,since_epoch,operation}
#
# `mkdir` on an existing directory exits non-zero — an atomic create-or-fail, no
# lock file and no polling. The common directory is the right home for three
# independent reasons: `git rev-parse --git-common-dir` names the SAME directory
# from every worktree and from the main checkout (unlike `--git-dir`, which from
# inside a worktree returns `.git/worktrees/<name>`); nothing under `.git/` is
# reachable by the four operations the claim exists to guard, so the guard cannot
# die to its own subject; and a carrier inside the worktree would dirty
# `git status`, corrupting the very clean-tree gate that depends on it.
#
# THE LEDGER is `<common>/crewrig/worktree-claims/<ticket>.log` — a SIBLING of
# the claim directory, never a child, so `release` (an `rm -rf` of the directory)
# can never take the history with it. Append-only, tab-separated:
#
#   <iso8601-utc><TAB><action><TAB><agent><TAB><ticket><TAB><detail>
#
# Requirement 7 asks who held the worktree AFTER the claim is released, which is
# the only moment an investigation into a destroyed change ever runs. That is why
# the ledger outlives both the claim and — being outside the worktree — the
# worktree itself.
#
# RESOLVING THE CLAIM ROOT — `pwd -P`, not `pwd`. `git rev-parse
# --git-common-dir` returns a path relative to the cwd outside a worktree (`.git`
# from the checkout root, `../../.git` from a subdirectory) and an absolute path
# from inside one. Absolutizing with a bare `cd … && pwd` is NOT enough: bash's
# `pwd` is logical — it echoes the shell's `$PWD` — so on a host where `/var` is a
# symlink to `/private/var` the main checkout and its worktree yield two distinct
# strings for one directory. `pwd -P` yields one string from all four cwds.
# String equality is not load-bearing for the `mkdir` guarantee (both strings name
# the same inode, so two contenders still contend on the same directory); it is
# load-bearing for the paths this script PRINTS, which a human must be able to
# paste, and for a regression suite that asserts across cwds.
#
# THE GUARD IS SCOPED PER SUBCOMMAND. The four mutating subcommands require the
# caller's toplevel to be under `.worktrees/`, because they act on a shared ticket
# worktree. `status` and `history` are read-only and carry NO such guard: they
# must answer from the MAIN CHECKOUT, after the documented per-ticket cleanup has
# removed `.worktrees/<ticket>`, which is exactly the moment requirement 7 is
# exercised. A blanket guard at the top of the script would make the ledger
# unreachable precisely where it is needed.
#
# THE CLEAN-TREE GATE IS EVALUATED ON EVERY `take` AND EVERY `run`, INCLUDING
# WHEN THE CALLER ALREADY HOLDS THE CLAIM. Git records no author for uncommitted
# changes, so "changes the acting agent did not author" (requirement 4) is not
# decidable; this script implements the strict superset — a whole-tree operation
# proceeds only over an EMPTY `git status --porcelain --untracked-files=all`.
# Holding a claim, however acquired, is never an input to that gate. `takeover`
# therefore unblocks the CLAIM and never the OPERATION: it exists so a claim whose
# holder has ended does not block the worktree forever (requirement 8), and it
# grants no clean-tree waiver. `takeover` itself does not evaluate the gate — the
# residue the ended holder left behind is the reason a takeover is needed — and it
# touches no working-tree file, so it destroys nothing by construction.
#
# `--untracked-files=all` buys an honest diagnostic rather than a stronger gate. A
# bare `--porcelain` reports `?? newdir/` where `-uall` reports
# `?? newdir/nested/f.txt`; both make the gate non-empty, so detection is
# unaffected. But `git clean -fd` removes the file inside that directory, and an
# agent told only `newdir/` cannot see what it was about to lose. Nobody should
# later "optimise" the flag away believing it was load-bearing for correctness.
#
# WHERE THE GATE STOPS IS IGNORED STATE, AND THAT LIMIT IS PART OF THE CONTRACT.
# `git status` reports nothing about a path matched by `.gitignore` — `-uall`
# widens the UNTRACKED view, not the ignored one — so the gate reads an EMPTY
# status over a tree full of ignored build output and local scratch files, and
# `git clean -fdx` / `-fdX` delete exactly those. A `run` wrapping `git clean
# -fdx` therefore passes the gate, destroys them, and exits 0. The guarantee this
# script offers is consequently NARROWER than "a whole-tree operation cannot
# destroy work": it is that no such operation proceeds over work git can NAME as
# tracked or untracked. Ignored state is outside the claim's protection, and an
# agent reaching for `-x` or `-X` under a claim has left the mechanism's cover.
#
# That limit is deliberate and `--ignored` is NOT the fix. A gate that refused
# over ignored state would refuse permanently in any checkout carrying build
# output, and a guard that always refuses gets routed around rather than obeyed —
# which costs more than the residual hazard it would close. What is NOT acceptable
# is leaving the limit unstated: an undocumented boundary in a safety mechanism
# manufactures exactly the false confidence this ticket exists to remove, so the
# boundary is named here, in the usage block, and in the paragraph
# `docs/agent-team-protocol.md` devotes to the gate.
#
# `since` IS WRITTEN TWICE — ISO-8601 for humans and `since_epoch` for
# arithmetic — deliberately: parsing an ISO timestamp back needs GNU `date -d` or
# BSD `date -j -f`, and neither is portable.
#
# WHAT THIS SCRIPT CANNOT DO is stop the command. Nothing in this repository can
# intercept an agent's shell call; CI sees a diff and the hazard leaves no trace
# in one. The script makes the compliant path cheaper than the destructive one,
# and the residual enforcement is the REVIEW-stage audit obligation recorded in
# `docs/agent-team-protocol.md` → *Worktree Isolation*.
#
# Usage:
#   bash scripts/worktree-claim.sh run      --agent <name> [--ticket <id>] -- <command…>
#   bash scripts/worktree-claim.sh take     --agent <name> [--ticket <id>] [--operation "<cmd>"]
#   bash scripts/worktree-claim.sh release  --agent <name> [--ticket <id>]
#   bash scripts/worktree-claim.sh takeover --agent <name> [--ticket <id>] [--stale-after <minutes>]
#   bash scripts/worktree-claim.sh status            [--ticket <id>]
#   bash scripts/worktree-claim.sh history           [--ticket <id>]
#   bash scripts/worktree-claim.sh --help
#
# `run` is the RECOMMENDED form: it takes the claim, executes the command, and
# releases from a `trap … EXIT`, so requirement 2's "for the whole duration of the
# operation" is structural rather than remembered. `take` / `release` remain for an
# operation that is not a single command.
#
# That automatic release is CONDITIONAL on still being the holder. A `takeover` can
# land while the wrapped command is in flight, and dropping the claim afterwards
# would evict the taker silently — so the trap leaves such a claim intact and
# records a `release-declined` line naming the agent that displaced us. See
# `run_release_on_exit`.
#
# Exit contract — authoritative:
#
#   0   Success.
#   1   Genuine failure — not a repository, `--agent` missing, an unwritable
#       common directory, an unknown argument; for the four MUTATING subcommands
#       additionally: the toplevel is not under `.worktrees/`; for `status` /
#       `history` additionally: no `--ticket` and none derivable.
#   4   Refused (`take`, `takeover`, `release`) — the worktree is claimed by
#       another agent (`take`), the claim is not stale or does not exist
#       (`takeover`), or the caller is not the holder (`release`). stdout names
#       the holder and `since`.
#   5   Refused (`take`, `run` ONLY) — the tree is not clean. stdout is the
#       `git status --porcelain --untracked-files=all` listing. NEVER raised by
#       `takeover`, `release`, `status` or `history`.
#   6   `release` on an unclaimed worktree — a warning, not an error.
#   n   `run` propagates the wrapped command's own exit code.
#
# `take` order is check → `mkdir` → re-check: the clean-tree gate runs BEFORE the
# claim so a refused operation leaves no claim behind, and AGAIN after it, so a
# tree dirtied inside the TOCTOU window releases the claim and exits 5.
#
# Environment:
#   CREWRIG_REPO_DIR   Repository context override; every git invocation runs
#                      with `git -C` against it. Default: the current directory.
#                      Used by the regression suite, which drives fixture
#                      repositories under `mktemp -d`.

set -euo pipefail

REPO_DIR="${CREWRIG_REPO_DIR:-$PWD}"

# Reuses the wall-clock budget already established in
# `docs/agent-team-protocol.md` → *Team Communication → Bounded wait before
# declaring death*, rather than inventing a second timeout. A claim is normally
# held for seconds, so 30 minutes is generous by construction.
STALE_DEFAULT_MINUTES=30

# --- Diagnostics -------------------------------------------------------------

fail() {
  echo "Error: $*" >&2
  exit 1
}

note() { echo "$*" >&2; }

usage() {
  cat <<'USAGE'
worktree-claim.sh — exclusive, attributable claims on a shared ticket worktree
(spec 0114).

  bash scripts/worktree-claim.sh run --agent <name> [--ticket <id>] -- <command…>
      RECOMMENDED. Take the claim, run the command, release on exit. The claim
      is held for the whole duration of the operation by construction.

  bash scripts/worktree-claim.sh take --agent <name> [--ticket <id>] [--operation "<cmd>"]
      Take the claim for an operation that is not a single command.

  bash scripts/worktree-claim.sh release --agent <name> [--ticket <id>]
      Release a claim you hold.

  bash scripts/worktree-claim.sh takeover --agent <name> [--ticket <id>] [--stale-after <minutes>]
      Take over a claim whose holder has ended. Transfers the claim and NOTHING
      else: no clean-tree waiver, and no working-tree file is touched.

  bash scripts/worktree-claim.sh status [--ticket <id>]
      Who holds the worktree right now. Read-only; runs from anywhere.

  bash scripts/worktree-claim.sh history [--ticket <id>]
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
                        Default: 30.
  -h, --help            This block.

Read-only subcommands (status, history) carry no .worktrees/ guard, so an
investigation can run from the main checkout after the worktree is cleaned up.
The clean-tree gate is evaluated by take and run on EVERY invocation, including
when the caller already holds the claim.

The gate reads `git status`, which says nothing about files matched by
.gitignore. `git clean -fdx` and `-fdX` reach that state and destroy it while the
gate reads clean and the run exits 0. The claim protects work git can name as
tracked or untracked; ignored build output and local scratch files are outside
its cover, whoever holds the claim.

Exit codes: 0 success | 1 genuine failure | 4 refused, claim state
| 5 refused, tree not clean (take/run only) | 6 release on an unclaimed worktree
| n run propagates the wrapped command's exit code.
USAGE
}

# --- Argument parsing --------------------------------------------------------

if [ "$#" -eq 0 ]; then
  usage
  exit 1
fi

SUBCOMMAND="$1"
shift

case "$SUBCOMMAND" in
  -h|--help)
    usage
    exit 0
    ;;
  run|take|release|takeover|status|history) ;;
  *)
    fail "unknown subcommand '$SUBCOMMAND'. Expected one of:
       run, take, release, takeover, status, history. Run with --help."
    ;;
esac

AGENT=""
TICKET=""
OPERATION=""
STALE_AFTER="$STALE_DEFAULT_MINUTES"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent)       AGENT="${2:-}"; shift 2 ;;
    --ticket)      TICKET="${2:-}"; shift 2 ;;
    --operation)   OPERATION="${2:-}"; shift 2 ;;
    --stale-after) STALE_AFTER="${2:-}"; shift 2 ;;
    -h|--help)     usage; exit 0 ;;
    --)            shift; break ;;
    *)             fail "unknown argument '$1'. Run with --help for the usage block." ;;
  esac
done
# Everything after `--` stays in the positional parameters; it is the command
# `run` wraps. No other subcommand accepts one.

case "$STALE_AFTER" in
  ""|*[!0-9]*) fail "--stale-after must be a non-negative integer number of minutes, got '$STALE_AFTER'." ;;
esac

case "$SUBCOMMAND" in
  run|take|release|takeover)
    if [ -z "$AGENT" ]; then
      fail "--agent <name> is required for '$SUBCOMMAND': a claim with no named
       holder answers neither requirement 6 (who holds it) nor requirement 7
       (who held it), which are the whole point of recording one."
    fi
    ;;
esac

if [ "$SUBCOMMAND" = "run" ] && [ "$#" -eq 0 ]; then
  fail "'run' needs a command: worktree-claim.sh run --agent <name> -- <command…>"
fi

# --- Repository context ------------------------------------------------------

git_here() { git -C "$REPO_DIR" "$@"; }

if ! TOPLEVEL_RAW="$(git_here rev-parse --show-toplevel 2>/dev/null)"; then
  fail "'$REPO_DIR' is not inside a git working tree, so there is no worktree to
       claim. Run this from a ticket worktree, or set CREWRIG_REPO_DIR."
fi
TOPLEVEL="$(cd "$TOPLEVEL_RAW" && pwd -P)"

if ! COMMON_RAW="$(git_here rev-parse --git-common-dir 2>/dev/null)"; then
  fail "cannot resolve the git common directory from '$REPO_DIR'."
fi
# `cd "$REPO_DIR"` first: the value is relative to the REPOSITORY, not to this
# script's cwd, whenever git returns the relative form. `pwd -P` and not `pwd` —
# see the header.
COMMON="$(cd "$REPO_DIR" && cd "$COMMON_RAW" && pwd -P)"

CLAIM_ROOT="$COMMON/crewrig/worktree-claims"

# --- The `.worktrees/` guard, scoped per subcommand --------------------------

# True iff the toplevel sits under a `.worktrees/` directory, which is where
# `AGENTS.md` → *Pre-Edit Guard* puts every ticket checkout.
toplevel_is_worktree() {
  case "$TOPLEVEL" in
    */.worktrees/*) return 0 ;;
    *) return 1 ;;
  esac
}

case "$SUBCOMMAND" in
  run|take|release|takeover)
    if ! toplevel_is_worktree; then
      fail "'$SUBCOMMAND' acts on a SHARED ticket worktree, and the toplevel here is
       '$TOPLEVEL', which is not under a '.worktrees/' directory. Run it from
       '.worktrees/<ticket-id>/'. (The read-only 'status' and 'history'
       subcommands carry no such guard and answer from anywhere.)"
    fi
    ;;
esac

# --- Ticket resolution -------------------------------------------------------

if [ -z "$TICKET" ]; then
  if toplevel_is_worktree; then
    TICKET="${TOPLEVEL##*/}"
  else
    # Deliberately NOT the repository directory's own basename: silently
    # guessing would answer a requirement-7 investigation with the wrong
    # ticket's ledger, which is worse than answering nothing.
    fail "no --ticket given and none derivable: the toplevel '$TOPLEVEL' is not
       under a '.worktrees/' directory, so its basename is the repository's own
       name and not a ticket id. Pass --ticket <id>."
  fi
fi
case "$TICKET" in
  ""|*/*|.|..) fail "invalid --ticket '$TICKET': a ticket id is a single path component." ;;
esac

CLAIM_DIR="$CLAIM_ROOT/$TICKET"
LEDGER="$CLAIM_ROOT/$TICKET.log"

# --- Ledger ------------------------------------------------------------------

now_epoch() { date -u +%s; }
now_iso()   { date -u +%Y-%m-%dT%H:%M:%SZ; }

# A tab or a newline in a free-text field would forge a column or a row, so both
# are flattened to a space before the value reaches the ledger.
flatten() { printf '%s' "${1:-}" | tr '\t\n\r' '   '; }

ledger_append() {
  if ! mkdir -p "$CLAIM_ROOT" 2>/dev/null; then
    fail "cannot create '$CLAIM_ROOT' — the git common directory is not writable."
  fi
  printf '%s\t%s\t%s\t%s\t%s\n' \
    "$(now_iso)" "$(flatten "$1")" "$(flatten "$AGENT")" "$(flatten "$TICKET")" "$(flatten "${2:-}")" \
    >> "$LEDGER"
}

# Field <n> of the ledger's last line, or the empty string when there is none.
ledger_last_field() {
  if [ ! -f "$LEDGER" ]; then
    return 0
  fi
  tail -n 1 "$LEDGER" | cut -f "$1"
}

# --- Claim state -------------------------------------------------------------

claim_field() {
  if [ -f "$CLAIM_DIR/$1" ]; then
    cat "$CLAIM_DIR/$1"
  fi
}

claim_exists() { [ -d "$CLAIM_DIR" ]; }

write_claim_state() {
  printf '%s\n' "$AGENT"      > "$CLAIM_DIR/holder"
  printf '%s\n' "$(now_iso)"  > "$CLAIM_DIR/since"
  printf '%s\n' "$(now_epoch)" > "$CLAIM_DIR/since_epoch"
  printf '%s\n' "${OPERATION:-}" > "$CLAIM_DIR/operation"
}

report_holder() {
  echo "ticket: $TICKET"
  echo "holder: $(claim_field holder)"
  echo "since: $(claim_field since)"
  echo "operation: $(claim_field operation)"
  echo "claim-dir: $CLAIM_DIR"
}

# Atomic create-or-fail. The ONLY place a claim comes into existence.
try_mkdir_claim() {
  if ! mkdir -p "$CLAIM_ROOT" 2>/dev/null; then
    fail "cannot create '$CLAIM_ROOT' — the git common directory is not writable."
  fi
  mkdir "$CLAIM_DIR" 2>/dev/null
}

release_claim_dir() {
  if [ -n "$CLAIM_DIR" ] && [ -d "$CLAIM_DIR" ]; then
    rm -rf "$CLAIM_DIR"
  fi
}

# --- The clean-tree gate -----------------------------------------------------

# Requirement 4, implemented as a deliberate strict superset: a whole-tree
# operation proceeds only over an EMPTY status. Never consults the claim.
DIRT=""
tree_is_clean() {
  local rc=0
  DIRT="$(git -C "$TOPLEVEL" status --porcelain --untracked-files=all)" || rc=$?
  # A failed `git status` leaves DIRT empty, and an empty DIRT is indistinguishable
  # from a clean tree — the false green this whole mechanism exists to remove,
  # arriving through its own gate. Refuse rather than report a state we could not
  # read.
  if [ "$rc" -ne 0 ]; then
    echo "Error: 'git status' failed in '$TOPLEVEL' (exit $rc), so this run proves" >&2
    echo "       nothing about the tree. Refusing to report it clean." >&2
    exit 1
  fi
  [ -z "$DIRT" ]
}

refuse_dirty() {
  echo "Refused: the worktree at '$TOPLEVEL' carries uncommitted changes."
  echo "A whole-tree git operation would discard changes no one can attribute:"
  echo "git records no author for an uncommitted change, so this gate refuses"
  echo "outright rather than guessing whose work it is about to destroy."
  echo ""
  printf '%s\n' "$DIRT"
  echo ""
  echo "Commit what you authored (spec 0114 R10). Residue you did NOT author is"
  echo "not yours to resolve: flag it to team-lead under docs/agent-team-protocol.md"
  echo "-> Worktree Isolation -> Stray-file discovery - no unilateral action."
  echo "Holding a claim does not waive this gate, however it was acquired."
  exit 5
}

# --- Subcommands -------------------------------------------------------------

cmd_status() {
  echo "ticket: $TICKET"
  echo "claim-root: $CLAIM_ROOT"
  echo "claim-dir: $CLAIM_DIR"
  echo "ledger: $LEDGER"
  if claim_exists; then
    echo "state: claimed"
    echo "holder: $(claim_field holder)"
    echo "since: $(claim_field since)"
    echo "operation: $(claim_field operation)"
  else
    echo "state: unclaimed"
    if [ -f "$LEDGER" ]; then
      # Requirement 7 read from the live surface: an investigation that asks
      # `status` after the claim is gone still gets a name, not a shrug.
      echo "last-action: $(ledger_last_field 2)"
      echo "last-holder: $(ledger_last_field 3)"
      echo "last-at: $(ledger_last_field 1)"
    fi
  fi
}

cmd_history() {
  echo "ticket: $TICKET"
  echo "claim-root: $CLAIM_ROOT"
  echo "ledger: $LEDGER"
  if [ -f "$LEDGER" ]; then
    echo "entries: $(wc -l < "$LEDGER" | tr -d '[:space:]')"
    echo ""
    cat "$LEDGER"
  else
    echo "entries: 0"
  fi
}

cmd_take() {
  # Gate BEFORE the claim, so a refused operation leaves no claim behind.
  if ! tree_is_clean; then
    refuse_dirty
  fi

  if ! try_mkdir_claim; then
    if [ "$(claim_field holder)" = "$AGENT" ]; then
      echo "Already held by '$AGENT'; nothing to take."
      report_holder
      exit 0
    fi
    echo "Refused: '$TICKET' is already claimed by another agent."
    report_holder
    exit 4
  fi
  write_claim_state

  # Re-check: a sibling can dirty the tree between the gate and the `mkdir`.
  # The residual window is bounded by the `mkdir` itself.
  if ! tree_is_clean; then
    release_claim_dir
    ledger_append "take-aborted" "tree became dirty inside the claim window"
    refuse_dirty
  fi

  ledger_append "take" "${OPERATION:-}"
  echo "Claimed '$TICKET' for '$AGENT'."
  report_holder
}

cmd_release() {
  if ! claim_exists; then
    echo "Notice: '$TICKET' is not claimed; nothing to release."
    exit 6
  fi
  HOLDER="$(claim_field holder)"
  if [ "$HOLDER" != "$AGENT" ]; then
    echo "Refused: the claim on '$TICKET' is held by '$HOLDER', not by '$AGENT'."
    report_holder
    exit 4
  fi
  release_claim_dir
  ledger_append "release" ""
  echo "Released '$TICKET' held by '$AGENT'."
  echo "ledger: $LEDGER"
}

cmd_takeover() {
  # Deliberately NO clean-tree gate: the residue an ended holder left behind is
  # the reason a takeover is needed, so gating here would refuse exactly when
  # requirement 8 fires. And deliberately no waiver either — `take` and `run`
  # re-evaluate the gate on every invocation, so the taker holds a claim it may
  # not immediately use over that residue. That is the trade this ticket makes:
  # a blocked operation beats an anonymous erasure.
  if ! claim_exists; then
    echo "Refused: '$TICKET' is not claimed, so there is nothing to take over."
    echo "Use 'take' — it evaluates the clean-tree gate, which 'takeover' does not."
    exit 4
  fi

  HOLDER="$(claim_field holder)"
  SINCE="$(claim_field since)"
  SINCE_EPOCH="$(claim_field since_epoch)"

  if [ "$HOLDER" = "$AGENT" ]; then
    echo "Already held by '$AGENT'; nothing to take over."
    report_holder
    exit 0
  fi

  case "$SINCE_EPOCH" in
    ""|*[!0-9]*)
      # An unreadable timestamp is treated as infinitely old rather than as a
      # reason to refuse: a claim whose state file never got written is exactly
      # the dead-holder case requirement 8 names.
      AGE_SECONDS=""
      ;;
    *)
      AGE_SECONDS="$(( $(now_epoch) - SINCE_EPOCH ))"
      ;;
  esac

  STALE_SECONDS="$(( STALE_AFTER * 60 ))"
  if [ -n "$AGE_SECONDS" ] && [ "$AGE_SECONDS" -lt "$STALE_SECONDS" ]; then
    echo "Refused: the claim on '$TICKET' is not stale."
    echo "held-for-seconds: $AGE_SECONDS"
    echo "stale-after-seconds: $STALE_SECONDS"
    report_holder
    exit 4
  fi

  write_claim_state
  ledger_append "takeover" "displaced=$HOLDER displaced-since=$SINCE stale-after-minutes=$STALE_AFTER"
  echo "Took over '$TICKET' from '$HOLDER' (held since $SINCE)."
  report_holder
  echo ""
  echo "This transfers the CLAIM and nothing else. It grants no clean-tree waiver:"
  echo "'take' and 'run' re-evaluate the gate on every invocation. Residue you"
  echo "authored, commit; residue you did not author, flag to team-lead and stop."
}

# `run`'s release path. Global because a `trap … EXIT` cannot take arguments,
# and because the wrapped command's exit code must survive it.
#
# HAVING ACQUIRED THE CLAIM IS NOT A LICENCE TO DROP IT. A `takeover` can land
# while the wrapped command is still in flight — and that is not an exotic race
# but the case `takeover` exists for, since a `run` wrapping a build or a suite is
# exactly what outlives the staleness threshold. From the instant the takeover
# lands, the claim belongs to the taker. So this path re-checks the holder for the
# same reason `cmd_release` does above: an unconditional release evicts the taker
# SILENTLY, leaving it believing it holds a worktree a THIRD agent can then claim
# — the simultaneous-belief state requirement 5 exists to make impossible.
#
# The ledger line matters as much as the guard. Writing `release <us>` after a
# takeover answers a requirement-7 investigation with the WRONG agent: we were not
# the holder at that instant, the taker was, and nothing would record that the
# taker's claim ended at all. Naming the wrong holder is worse than naming none,
# so a declined release is recorded explicitly and names the agent that displaced
# us. This does NOT change `run`'s exit code, which stays the wrapped command's
# own per the exit contract — being displaced says nothing about whether the
# command succeeded.
ACQUIRED=false
run_release_on_exit() {
  if [ "$ACQUIRED" != "true" ]; then
    return 0
  fi
  ACQUIRED=false

  if ! claim_exists; then
    # The claim went away without passing through us. Recording it as OUR release
    # would be the same lie as releasing a claim we no longer hold.
    ledger_append "release-declined" "run: claim was already gone at exit"
    note "Notice: the claim on '$TICKET' was already gone when this run exited;"
    note "       nothing was released. Run 'history' to see what happened to it."
    return 0
  fi

  CURRENT_HOLDER="$(claim_field holder)"
  if [ "$CURRENT_HOLDER" != "$AGENT" ]; then
    ledger_append "release-declined" "run: displaced by '$CURRENT_HOLDER'; claim left intact"
    note "Notice: '$CURRENT_HOLDER' took over the claim on '$TICKET' while this run"
    note "       was in flight. Releasing it here would evict them, so the claim is"
    note "       left intact and the ledger records a declined release."
    return 0
  fi

  release_claim_dir
  ledger_append "release" "run"
}

cmd_run() {
  # The gate first, so a dirty tree is refused with 5 before the claim state is
  # ever consulted. That ordering is what makes a takeover grant no waiver: the
  # taker holds the claim and is still refused here.
  if ! tree_is_clean; then
    refuse_dirty
  fi

  if try_mkdir_claim; then
    ACQUIRED=true
    write_claim_state
    ledger_append "take" "run: $*"
  else
    if [ "$(claim_field holder)" != "$AGENT" ]; then
      echo "Refused: '$TICKET' is already claimed by another agent."
      report_holder
      exit 4
    fi
    # Re-entrant: the caller already holds the claim (it ran `take`, or took it
    # over). Proceed WITHOUT acquiring, and therefore without releasing at exit —
    # releasing a claim this invocation did not acquire would silently drop the
    # caller's own hold.
    ledger_append "run-reentrant" "run: $*"
  fi

  trap run_release_on_exit EXIT INT TERM

  if ! tree_is_clean; then
    run_release_on_exit
    refuse_dirty
  fi

  RC=0
  "$@" || RC=$?

  run_release_on_exit
  trap - EXIT INT TERM
  exit "$RC"
}

# --- Dispatch ----------------------------------------------------------------

case "$SUBCOMMAND" in
  status)   cmd_status ;;
  history)  cmd_history ;;
  take)     cmd_take ;;
  release)  cmd_release ;;
  takeover) cmd_takeover ;;
  run)      cmd_run "$@" ;;
esac
