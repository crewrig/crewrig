# Agent Team Protocol — Worktree Isolation

<!-- crewrig-doc: published=false -->
<!-- markdownlint-disable MD033 -->

<a id="worktree-isolation"></a>

## Worktree Isolation

Parallel agent teams operating on the same git working directory collide on branch checkout and the staging index, corrupting each other's work. To prevent this, the orchestrating agent **MUST** create a dedicated git worktree **before** issuing the `Agent` spawn for the ticket — and before any `TaskCreate` call too, when the harness exposes it:

```sh
git worktree add -b <branch-name> .worktrees/<ticket-id> crewrig/main
```

**Ticket pickup check first.** Before that `git worktree add` — and before any branch or spec-id reservation for the ticket — the orchestrator runs the cross-contributor ownership check from the shared checkout, `task -x ticket-pickup -- --issue <N>`, and stops on any non-zero exit ([`docs/ticket-ownership.md`](../ticket-ownership.md), spec 0244 R2/R11). The check coordinates different contributors; the worktree claim below still coordinates the sessions of one contributor (spec 0244 R17).

All file edits performed by the team — by every specialist, without exception — **MUST** happen inside `.worktrees/<ticket-id>/`. The main working directory is off-limits for the duration of the ticket; treat it as read-only.

**Cwd verification (every spawned role).** Before issuing its first `Write`, `Edit`, or file-mutating `Bash` call, a sub-agent whose brief names a worktree path (`.worktrees/<ticket-id>/`) as its working location MUST verify that its own working directory resolves inside that worktree. This obligation attaches to the brief's target, not to the role — it applies identically to `developer`, `tester`, `doc-writer`, `architect`, or any other spawned specialist whenever the brief names a worktree path. Embed the following instruction verbatim in the spawned `Agent` prompt whenever the brief targets a worktree:

> Before your first `Write`, `Edit`, or file-mutating `Bash` call, `cd` into `.worktrees/<ticket-id>/` and confirm the resolved working directory (e.g. via `pwd`) actually resolves inside that worktree. If it does not, `cd` into the worktree and re-verify before proceeding — do not issue any mutating call until the check passes.

This is a distinct, actionable check from the "treat the main directory as read-only" expectation above: that sentence states the constraint, this is the step that catches a session whose working directory silently defaulted to the main checkout before any file lands there.

**Per-command cwd anchoring.** Every Bash command that operates on worktree content, or names a repository-relative path, SHALL begin with `cd <abs-worktree> &&`; no repository-relative path SHALL be used without that prefix. The rule binds every agent issuing Bash commands against a ticket worktree — every specialist and the orchestrating session alike; the failure it closes was observed in both roles in the originating incident (the developer session and the team-lead's DEV brief). The Tier 1 ref-based inspection recipes above (`git fetch` / `git log` / `git show` / `git diff` against `crewrig/<branch>`) are exempt: they deliberately run from the shared checkout on ref-scoped paths, not repository-relative filesystem paths. Embed the following instruction verbatim in every spawned sub-agent brief that targets a worktree:

> Begin every Bash command that operates on worktree content, or names a repository-relative path, with `cd <abs-worktree> &&` — never use a repository-relative path without that prefix.

This complements — does not replace — the cwd-verification check above: the check covers the session's first mutating call, the rule covers the whole session, including a Bash-tool cwd reset that occurs after the check has passed.

**Host-safety (every spawned role and the orchestrating session).** A harness or test never mutates a path it did not create itself. This binds every specialist — `developer`, `tester`, `doc-writer`, `architect`, or any other spawned role — and the orchestrating session alike. Embed the following instruction verbatim in every spawned `Agent` prompt whose task runs, writes or changes test or harness code:

> Never delete, restore, move or overwrite a path outside the scratch directory you created yourself; derive nothing destructive from environment variables, arguments, `HOME` or `PATH`.

A destructive path found at run time in a harness (taken from the environment, from arguments, from `HOME` or from a `PATH` entry) is reported to the orchestrator, never worked around, and the orchestrator surfaces it to the user. A REVIEW pass that finds such a brief without this instruction emits a `class: tech` finding citing this clause. The check that enforces the matching static rule, and its limits, are documented in [`docs/host-safety-check.md`](../host-safety-check.md).

**Stray-file discovery — no unilateral action.** Discovering a file on the main repository checkout that appears misplaced from a worktree-scoped ticket — whether the discoverer is the orchestrator or a sibling sub-agent — does NOT trigger deletion of that file, on sight or by any other means. A file's location does not establish its provenance: a sibling agent's own in-flight write may be transiting through that same path at the moment of discovery, and location alone cannot distinguish an abandoned stray from a write still in progress. Instead:

1. **Flag, don't act.** The discoverer flags the file to the orchestrator (or `team-lead`) for adjudication.
2. **Relocate only after provenance is confirmed.** The file is moved into the correct worktree path only once its provenance has been confirmed — it is never deleted or relocated unilaterally by the discoverer.

**Whole-tree git operations need an exclusive claim over a clean tree.** `git reset --hard`, `git checkout -- .`, `git stash`, and `git clean` — and every other operation that discards, reverts, or relocates uncommitted changes across a whole tree rather than a named set of files — SHALL NOT run inside `.worktrees/<ticket-id>/` unless the acting agent holds the claim below for the **whole duration** of the operation and `git status --porcelain --untracked-files=all` is empty. The claim never waives the clean-tree condition: git records no author for an uncommitted change, so an empty status is the only proof that nothing you did not author is at risk. Their usual motive is verification: use the recipes below instead. The gate reads `git status`, which is blind to a path matched by `.gitignore`, so the guarantee is narrower than *nothing gets destroyed*: no whole-tree operation proceeds over work git can **name** as tracked or untracked. Ignored build output and local scratch are outside it — `git clean -fdx` passes the gate, deletes them, and exits `0` — so adding `-x` or `-X` leaves the claim's cover: enumerate with `git clean -ndx` **run at the worktree root** first, and treat whatever it lists as a sibling's until provenance says otherwise. Run the enumeration at the root because that is where `run` executes the destructive form (spec 0126): standing in a subdirectory scopes the dry run to that subtree while the wrapped deletion takes the whole worktree, so the look that exists to show you the damage would under-report it. To clean one subtree deliberately, say so with a pathspec from the root — `git clean -ndx -- <subdir>/` to enumerate, `git clean -fdx -- <subdir>/` to delete — never by standing in it.

**Taking, inspecting, and releasing the claim.** Prefer `run` — it takes the claim, executes, and releases on exit, so *whole duration* is structural. `run` executes the wrapped command **at the worktree root**, the same tree its clean-tree gate certified, whatever directory you invoked it from — so a relative path in the wrapped command resolves against the root, and a cwd-scoped operation acts on the whole worktree.

The tool is TypeScript and needs Node.js 24 or later. Check that once per session, as a separate step run before the first invocation (the way `docs/ticket-ownership.md` documents `ticket-pickup`):

```sh
node scripts/lib/node-floor-guard.js
```

Below the floor it prints one diagnostic and exits non-zero; nothing has touched the filesystem. Then:

```sh
node scripts/worktree-claim.ts run     --agent <name> -- <command…>
node scripts/worktree-claim.ts take    --agent <name>   # then release --agent <name>
node scripts/worktree-claim.ts status
```

Exit `4` names the current holder; `5` prints the uncommitted changes that closed the gate. `status` answers without asking any agent; it and `history` also run from the main checkout, given `--ticket <id>`. `node scripts/worktree-claim.ts --help` prints the full contract. The former `scripts/worktree-claim.sh` shim was removed (see `docs/shell-removal.md`); the `node` form is the only form and also works on Windows.

**The guard that enforces the claim needs Node.js 24 or later when it fires.** `hooks/worktree-git-guard.ts` is the pre-tool hook that refuses a prohibited whole-tree operation without a claim (`docs/cli-matrix.md` row 29). Setup checks the Node.js floor before it wires the hook and writes nothing below it, but it cannot check at the moment the hook fires. A Node.js downgraded after setup makes the hook fail with Node.js's own non-zero status until setup is re-run, and the CLI then reads that status according to its own rule: Copilot CLI documents `preToolUse` as fail-closed, so a failing guard stops every tool call there. An installation still wired to the old `bash …/worktree-git-guard.sh` path (shim retired in #1344) has no guard until setup is re-run, which re-points it.

**Who held the worktree, after the fact.** `node scripts/worktree-claim.ts history --ticket <id>` prints the append-only ledger — every take, release, and takeover, with agent, timestamp, and operation. It lives inside the shared `.git`, as a sibling of the claim directory and never a child, so releasing a claim cannot take the history with it; being outside the worktree, it also survives the cleanup below.

**A claim whose holder has ended.** `node scripts/worktree-claim.ts takeover --agent <name>` transfers a claim untouched for 30 minutes (`--stale-after <minutes>` overrides) and records both agents in the ledger. It rewrites the claim only — never a working-tree file — and grants **no** clean-tree waiver: the gate is re-evaluated on every `take` and `run`, whoever holds the claim.

**Residue left by an agent that ended.** When a takeover finds the tree dirty, adjudicate on authorship, not convenience. Residue you authored: commit it — that is the route back to a clean tree. Residue you did not author is not yours: flag it to `team-lead` under *Stray-file discovery* above and stop — do not commit another agent's work, run a whole-tree operation, or remove the worktree. The orchestrator adjudicates: commit on the branch, respawn the role that owns it, or route to a human operator.

**`git worktree remove --force` is not an escape hatch.** Plain `git worktree remove` exits `128` on a worktree carrying uncommitted changes; `--force` exits `0` having destroyed them. It belongs to the prohibited class above; the refusal is your signal to escalate. The one exception is a scratch tree you created yourself under `$TMPDIR` (Tier 2b).

**Verification without touching a shared worktree — the default.** Reserve the claim for operations that must act on the shared tree itself; observe everything else from outside. `git fetch` writes only into `.git`, never into a working tree, so Tier 1 — inspection — destroys nothing:

```sh
git fetch crewrig <branch>
git --no-pager log --oneline -5 crewrig/<branch>
git --no-pager show "crewrig/<branch>:<path>"
git --no-pager diff crewrig/main...crewrig/<branch>
```

Tier 2, when a check must *execute* against a clean state, extracts it instead of cleaning a shared one:

```sh
scratch="$(mktemp -d)"
git fetch crewrig <branch>
git archive "crewrig/<branch>" | tar -x -C "$scratch"
( cd "$scratch" && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/<suite>.test.ts )
rm -rf "$scratch"
```

Tier 2b, when the check needs git metadata or dependencies: `git worktree add --detach "$scratch/tree" <ref>` under `$TMPDIR`, removed with `git worktree remove --force "$scratch/tree"` in the same step.

**Commit before you report or hand off.** No outcome you report — a passing test run above all — may exist only in a working tree. Commit what you authored first, so the result survives from committed state.

**Measure from the suite's own fixture.** When a test suite already constructs the state you need to observe, measure from that fixture, not from a fresh probe. A measurement whose setup cannot be shown to have reached the subject is no measurement at all; report a failed probe, not a number.

**Enforcement.** A REVIEW pass that audits a session in which a whole-tree git operation ran in a shared worktree without a recorded claim SHALL emit a `class: tech` finding citing this section.

Before pushing, always rebase the worktree branch against the upstream main to avoid merge conflicts on shared files:

```sh
git fetch crewrig && git rebase crewrig/main
```

If the rebase raises conflicts, resolve them, then `git rebase --continue`. Record the conflict as a bullet in the next logbook transition comment (Rule B).

Once the PR is merged and the linked logbook issue closed (see *Logbook Issues → Rule C* in AGENTS.md), clean up the worktree and its branch in this **exact order**:

1. **Verify the merge landed.** `gh pr view <pr-number> --json state,mergedAt` — proceed only when `state == MERGED`.
2. **Remove the worktree.** `git worktree remove .worktrees/<ticket-id>` — this releases the branch reference held by the worktree.
3. **Delete the local branch.** `git branch -D <branch-name>` — required because `gh pr merge --delete-branch` only deletes the **remote** branch; the local ref survives.
4. **Close the logbook issue** per *Logbook Issues → Rule C* (if not already closed by the merge).

**Why this order matters.** Git refuses to delete a branch that is checked out by an active worktree. Running `gh pr merge --delete-branch` (or `git branch -D`) while the worktree still exists fails with `error: cannot delete branch '<name>' checked out at '.worktrees/<ticket-id>'`. Removing the worktree first releases the ref so step 3 can proceed cleanly.

```sh
# canonical sequence
gh pr view <pr-number> --json state,mergedAt
git worktree remove .worktrees/<ticket-id>
git branch -D <branch-name>
gh issue close <issue-number> --reason completed
```

Any obstacle encountered during the worktree lifecycle — merge conflicts, CI failures, friction declarations, scope changes, rebases that resolve conflicts — is recorded as a bullet in the next logbook transition comment (a DEV checkpoint comment when a hand-off or repeated CI failure comes first). See **Rule B** in `docs/logbook-issues.md` for the bullet kinds.

<a id="session-boundary-worktree-hygiene"></a>

### Session-boundary worktree hygiene

The per-ticket cleanup above runs at the single moment one ticket's pull request merges. It does not, on its own, account for the whole `.worktrees/` directory at the boundaries of a session — yet a session can begin on top of a backlog left by earlier sessions, and can end for reasons unrelated to any ticket completing (context exhaustion, the user stopping, an unrelated wrap-up). Left unchecked, worktrees whose work has already merged accumulate unnoticed and slow later sessions. The two steps below add session-boundary triggers that **reuse** the ordered cleanup above; they are **additional to, and do not replace,** the per-ticket cleanup that runs the moment a ticket's pull request merges.

Both steps confirm merge status the same way the ordered cleanup's step 1 does — from the pull request's own state, **never** from `git branch --merged`. Under the project's squash-merge workflow a squash-merged branch is not reported as merged by `git branch --merged` (the squash commit does not carry the branch's commits as ancestors), so that signal both misses genuinely-merged worktrees and misreads them as still in flight. Worktrees are keyed by branch name — `.worktrees/<ticket-id>/` has `<branch-name>` checked out — so resolve each worktree's pull request by its head branch:

```sh
gh pr view <branch-name> --repo crewrig/crewrig --json state,mergedAt
```

A `state == MERGED` result is positive confirmation the branch has merged. A branch with no associated pull request, or any result that does not positively confirm `MERGED`, counts as **unconfirmable** — treated as still in flight, never as merged.

**Session start — non-destructive surfacing.** Before opening a new ticket worktree, enumerate the existing worktrees (`git worktree list`), resolve each one's branch to its pull request with the command above, and **report** every worktree whose pull request is `MERGED` as a stale backlog item — so the agent is aware of the accumulated backlog before piling new work on top of it. This step is strictly report-only: it removes no worktree and deletes no branch, so a sibling session's in-flight worktree is never destroyed at another session's start.

**Session end — confirmed-merge sweep.** When the session reaches its end, account for the worktrees under `.worktrees/` and, for every worktree whose pull request is positively confirmed `MERGED` by the command above, remove the worktree together with its local branch by following the ordered cleanup procedure documented earlier in this section (verify the merge landed → `git worktree remove` → `git branch -D` → close the logbook issue) — do not invent a new sequence. A worktree whose pull request is still open, whose branch carries unmerged or uncommitted work, or whose merge status cannot be positively confirmed SHALL be left in place and surfaced for later adjudication — never removed. This mirrors the *Stray-file discovery — no unilateral action* discipline above: a worktree's mere presence or apparent staleness never authorizes removal, and positive confirmation of a merged pull request is the sole precondition for removing any worktree.

When an orchestrator pre-allocates a spec id for a sibling session at this kickoff moment, see `docs/spec-pr-workflow.md` → *Pre-allocating an id for a sibling session* for the obligation to actually secure it via `reserve-spec-id.ts --id <ID> --issue <N>` before asserting it "reserved."
