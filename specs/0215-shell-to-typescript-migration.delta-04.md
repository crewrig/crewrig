---
id: "0215"
slug: shell-to-typescript-migration
status: draft
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 1231
version: 4.1.0
---

# Shell-to-TypeScript migration (parent spec)

## ADDED

The remaining work of epic #1231 lands on a dedicated release branch instead of
`main`, and reaches `main` in one single final merge. The owner decided this on
2026-09-30, on the ground that the migration's intermediate states — shell and
TypeScript coexisting, shims, a partly retired `scripts/lib/` — are not states
worth exposing to users of `main`, who install from the repository checkout
(requirement 3). This delta is the only piece of the epic that merges on
`main` after row B. Every "verified at" pointer below is a `path:line` in the
repository at `main @ 982a657`.

1. **New requirement (R27) — Release branch and scoped derogation (release-branch regime).** All
    remaining work of epic #1231 SHALL land on the branch
    `release/1231-ts-migration`, cut from `main` once this delta has merged, and
    on no other branch. "Remaining work" is every sub-ticket row of the epic
    that has not merged on `main` when this delta merges — at authoring time
    C1 #1326 through J4 #1344 — plus any row the epic adds later; rows A1
    #1321, A2 #1324 and B #1322 are already on `main` and are not concerned.
    For those tickets only, the ordering rule of `specs/0003-spec-pr-workflow.md`
    and `docs/spec-pr-workflow.md` (*Ordering rule*: the spec merged on `main`
    before the implementation branch is cut) reads with
    `release/1231-ts-migration` in place of `main`. This is a derogation scoped
    to epic #1231: it SHALL NOT be read as an amendment of spec 0003, SHALL NOT
    be generalised to any other ticket, and sunsets at the final merge of
    requirement 37. A ticket that is not a row of epic #1231 keeps flowing
    through `main`, unchanged, for the whole life of the branch.

1. **New requirement (R28) — Branch protection and sequencing.** A repository ruleset targeting
    `refs/heads/release/**` SHALL be active before the first pull request
    targets the release branch, carrying at least the `deletion` and
    `non_fast_forward` rules and the required status checks `ratchet` and
    `lint-typescript` — the same three rules `main-protected` (ruleset id
    16466901) carries, verified with `gh api repos/crewrig/crewrig/rulesets`,
    whose `conditions.ref_name.include` is `~DEFAULT_BRANCH` only and therefore
    leaves the release branch unprotected without it. Creating that ruleset is a
    repository-administration act performed by the owner or the orchestrating
    session holding admin rights, never by a `spec-author`, `developer` or
    reviewer agent. No sub-ticket branch SHALL be cut and no pull request SHALL
    be opened against the release branch until, in this order: this delta has
    merged; the branch exists; the ruleset is active; the epic body table of
    requirement 32 reads in the new form. When any of these does not hold, an
    agent SHALL stop and report the missing precondition to the owner instead
    of opening the pull request against `main` as a fallback.

1. **New requirement (R29) — Targeting, lifecycle and merge authorisation.** Every pull request of a
    row of epic #1231 — spec-PR, delta-spec PR and implementation PR alike —
    SHALL target `release/1231-ts-migration`. Branch prefixes and names keep
    their existing conventions (`spec/<NNNN>-<slug>`, `feat/<NNNN>-<slug>`, and
    the like); only the branch each is cut from and merged into changes. The
    one-file rule of a spec-PR is unchanged. A spec reaches `status: approved`
    when its spec-PR merges on the release branch and `status: implemented`
    when its implementation PR merges there (`docs/spec-format.md` → *Lifecycle
    states*, which names `main` in both triggers, reads accordingly for these
    tickets). The rule of `AGENTS.md` → *Branching Strategy* that no pull
    request merges without the user's formal permission, asked immediately
    before the merge, applies to every merge into the release branch exactly as
    to a merge into `main`.

1. **New requirement (R30) — Up-to-date merge precondition.** For a row of epic #1231, the
    up-to-date precondition of `AGENTS.md` → *Branching Strategy* (which names
    `main`) reads: immediately before `gh pr merge`, the pull request's head
    SHALL be 0 commits behind `origin/release/1231-ts-migration`, every check
    SHALL be green on that head, and that head SHALL be the head the reviewer
    approved. When the release branch has advanced, the agent SHALL update the
    pull request's branch and re-verify before merging. A pull request's own
    feature branch is private to its author and MAY be rebased onto the release
    branch; the release branch itself is shared and SHALL NEVER be rebased,
    reset or force-pushed.

1. **New requirement (R31) — Drift control — `main` is merged into the release branch.** `main`
    SHALL be merged into `release/1231-ts-migration` after every row that
    lands on the release branch, and at least once every seven days for as
    long as the branch exists. Each sync SHALL go through a pull request of its
    own, from a branch named `chore/1231-sync-main-<YYYYMMDD>`, targeting the
    release branch, and SHALL be merged with the **merge commit** method — never
    squash, never rebase — because a squash would copy the content of `main`
    without making its commits ancestors of the release branch, and the final
    merge would then re-conflict on every file already reconciled. The pull
    request is required rather than a direct push because the release
    ruleset of requirement 28 requires the `ratchet` and `lint-typescript`
    checks on every commit that reaches the branch, and a merge commit made
    locally carries none (the same constraint `docs/github-release-pr.md`
    records for `main`); the repository allows the merge-commit method
    (`gh api repos/crewrig/crewrig` → `allow_merge_commit: true`). When `main`
    has no commit the release branch lacks, no sync pull request SHALL be
    opened and the sync is a recorded no-op. Conflicts SHALL be resolved inside
    the sync pull request. A change made on `main` to a shell script that the
    release branch has already migrated, removed or reduced to a shim SHALL be
    ported to the TypeScript version in the same sync pull request, or, when it
    cannot be ported there, SHALL be named in that pull request with a
    follow-up ticket — it SHALL NOT be dropped. A conflict on a
    `metadata.provenance.version` field (`AGENTS.md` → *Version Bump
    Convention*) SHALL resolve to the next SemVer step above the higher of
    the two values, so that the version-bump check still passes on the final
    merge.

1. **New requirement (R32) — Issue closing and epic tracking.** GitHub closes an issue through a
    closing keyword only when the pull request merges into the repository's
    default branch, so a row merged on the release branch closes nothing by
    itself. The agent that merges a row's pull request SHALL close that row's
    sub-ticket manually, immediately after the merge, with a closing comment
    that names the pull request — `AGENTS.md` → *Logbook Issues* Rule C is
    unchanged in its obligation and only changes its mechanism. A row's pull
    request MAY still carry its usual closing keyword, which is inert on the
    release branch; no pull request of the epic other than the final one of
    requirement 37 SHALL carry a closing keyword for #1231, per
    `docs/spec-pr-workflow.md` → *Independence rule*. The orchestrating session
    SHALL keep the epic body table *Decomposition seams (tracking)* current at
    every row state change (a standing requirement of the co-owner), and from
    the moment the release branch exists that table SHALL distinguish, for each
    row, *merged on the release branch* from *on `main`*; the line of specs
    present SHALL likewise name which are on `main` and which only on the
    release branch.

1. **New requirement (R33) — Spec ids stay collision-free.** New sub-spec files live only on the
    release branch until the final merge, so the `<remote>/main` tree that
    `scripts/reserve-spec-id.sh` reads as the first of the three sources of its
    allocated set (`scripts/reserve-spec-id.sh:344`, `merged_spec_paths`) does
    not contain them. What keeps their ids from being handed out twice is the
    other two sources, the reservation refs `refs/spec-ids/*` and
    `refs/tags/spec-id/*`, which the tool reads on every run
    (`load_allocated_ids`). Nothing in the tool deletes a reservation on the
    remote — the only refs it deletes are its own local scratch probes
    (`find_issue_reservation_in`) — and the documented contract is "no expiry, no
    reclamation pass, no release protocol" (`docs/spec-pr-workflow.md:55-56`).
    Therefore no reservation ref SHALL be deleted, pruned or reclaimed, by hand
    or by any cleanup, before the final merge of requirement 37 has landed and
    every spec file of the epic is present on `main`. A sub-spec author SHALL
    secure its id with `scripts/reserve-spec-id.sh --issue <N>` exactly as
    today, with `BASE_REF` left unset; a delta-spec of a sub-spec reuses its
    parent's id and secures nothing. `scripts/check-spec-id-reserved.sh`, run
    with `BASE_REF` set to the pull request's target branch
    (`.github/workflows/build.yml:1252`), needs no change: it reads the same
    reservation refs.

1. **New requirement (R34) — Base ref for every agent.** For every agent working a row of epic
    #1231 — whatever CLI runs it and whichever co-owner's session it belongs
    to — the base ref is `origin/release/1231-ts-migration` wherever the
    protocol names `main`: the worktree of the ticket is created from it
    (`docs/agent-team-protocol.md:144`, `git worktree add -b <branch>
    .worktrees/<ticket-id> <remote>/release/1231-ts-migration`); a
    `pr-reviewer` reads the pull request's actual `baseRefName` rather than
    assuming `main`, and diffs against it
    (`docs/agent-team-protocol.md:192`, the inspection recipe
    `git diff <remote>/main...<remote>/<branch>` becomes
    `git diff <remote>/release/1231-ts-migration...<remote>/<branch>`); and the
    pre-push rebase of a feature branch
    (`docs/agent-team-protocol.md:216`) targets it. An orchestrator briefing a
    sub-agent SHALL state the base ref in the brief, except for a
    reviewer-seat brief, whose closed reference list
    (`docs/reviewer-seat.md`) is unchanged: the seated `pr-reviewer` derives
    the base from the pull request itself.

1. **New requirement (R35) — CI coverage of the release branch.** The release branch SHALL rely on
    the checks that already trigger on it, and the gaps below are recorded, not
    silently accepted. Verified at the cited lines:

    - Run on a pull request to, or a push on, `release/**`: `build.yml`
      (`.github/workflows/build.yml:3-9`), which carries the required
      `ratchet` (`:1010`) and `lint-typescript` (`:1037`), `lint-specs`
      (`:1142`), `check-skill-versions` (`:1199`), `check-extension-version-bump`
      (`:1215`), `check-spec-id-reserved` (`:1231`) and the `windows-latest`
      job (`:1116-1117`) that requirement 17 depends on; and
      `scripting-conventions.yml`, `release-notes.yml`, `release-tests.yml`,
      `windows-hook-probe.yml` and the `usage-*.yml` workflows, each of which
      lists `release/**` beside `main`.
    - Do not run on the release branch: `pages.yml` (push on `main`,
      `communication/**` only), `release-monorepo.yml` (push on `main` and manual
      dispatch, see requirement 36), and `security-mcp.yml` (pull request to `main` only).
      `release-rehearsal.yml` is `workflow_dispatch`-only and can be dispatched
      on any ref by hand; `claude.yml` and `copilot.yml` react to comments and
      do not depend on a branch. `pages.yml` is not a gap: it publishes a site
      and its first run after the final merge deploys whatever
      `communication/**` then holds. `security-mcp.yml` **is** a gap: its
      `npm audit --audit-level=critical` guards changes to `package.json`,
      `settings.json`, `mcp.json`, `mcp.json.template` and `extension.json`, and
      without a trigger on the release branch it first runs on the final pull
      request. Until a pull request adds `release/**` to that workflow's
      `pull_request.branches`, a row that adds or changes a dependency
      (requirements 6 and 23) SHALL run that same audit command locally and
      record its result on its logbook comment.
    - Base-ref behaviour: `ratchet` and `lint-specs` take the pull request's
      target branch as `BASE_REF` on a pull request (`:1029`, `:1173`), so each
      row is measured against the release branch; on a push they fall back to
      `<remote>/main`, where their diff-based arms are cumulative against `main`
      and still meaningful, and the pull-request run stays authoritative for the
      merge. `scripts/ci-changeset-coverage.sh` falls back to `origin/main` on
      GitHub (`:49-57`), which over-approximates the changed files and so runs
      more of the suite, never less. `scripts/check-skill-versions.sh` diffs
      against `BASE_REF`, which `build.yml:1209` sets to
      `origin/<pull request target>`; it SHALL work unchanged against the
      release branch, and its rule that a modified component source bumps
      `metadata.provenance.version` is measured against the release branch.

1. **New requirement (R36) — No release during the migration.** `release-monorepo.yml` runs on a
    push to `main` and on manual dispatch
    (`.github/workflows/release-monorepo.yml:3-8`), and a push to the release
    branch starts no run of it, so the release branch produces no tag, no GitHub release and no release pull
    request — this is intended, and no release of the migrated content SHALL be
    made from it. Releases of changes that are not part of the epic continue
    from `main` exactly as before, and the version commits they produce reach
    the release branch through the sync of requirement 31. The first push to
    `main` after the final merge is the first release opportunity for the
    migrated content, and the release pull request it opens is computed from
    all the commits the final merge brings.

1. **New requirement (R37) — Single final merge and sunset.** After J4 #1344 has merged on the
    release branch, exactly one pull request SHALL merge
    `release/1231-ts-migration` into `main`. There SHALL be no milestone or
    partial merge of the release branch. That pull request is the downstream
    pull request that `docs/post-merge-flow.md` (step 2, an "intermediate
    integration branch that must eventually reach `main`") requires after every
    merge into the release branch; step 3 of that flow, for a merge into the
    release branch, is satisfied by this standing statement, and an agent SHALL
    NOT open a per-row pull request toward `main`. The final pull request SHALL
    be opened only when: every termination condition of requirement 25 holds on
    the release branch head; the branch is 0 commits behind `main` (a last
    sync of requirement 31 has landed); every check is green, the `windows-latest`
    jobs included; and the user's formal permission is asked immediately before
    the merge. Its merge method is the owner's choice at that time. It carries the
    closing directive for #1231, being the pull request on which the epic's
    termination (requirement 25) becomes true on `main`. When the conditions do
    not hold, the pull request SHALL NOT be opened, and the release branch
    stays. After the final merge the derogation of requirement 27 ends: no pull
    request SHALL target the release branch any longer, the ruleset of
    requirement 28 and the branch are removed by the owner, and worktrees and
    base refs revert to `main`. Reservation refs are kept (requirement 33).

1. **New requirement (R38) — Reading of `main` in the parent requirements.** During the life of the
    release branch, a reference to `main` in the *process* rules that
    requirements 27-37 name (stage ordering, lifecycle status triggers, the
    up-to-date precondition, worktree and review base, the ratchet's and the
    linters' comparison base) reads as the branch the pull request targets.
    A reference to `main` as what *users, releases and termination* see is not
    changed: requirement 5's "shipped", requirement 25's "on `main`" and the
    installed checkout a user clones keep their meaning, and are satisfied for
    the whole migration only by the final merge. In particular, before that
    merge `main` still requires a POSIX shell to install CrewRig, and coexisting
    shell and TypeScript (requirement 8) is a property of the release branch.

**Scenario:** A row lands on the release branch and its sub-ticket is closed
by hand

Given the release branch and its ruleset exist, and the C1 spec-PR has merged on
the release branch with `status: approved`
When the implementation PR of C1 is cut from `origin/release/1231-ts-migration`,
reviewed, found 0 commits behind that branch with every check green on the
approved head, and merged there with the user's permission
Then the agent closes the C1 sub-ticket by hand with a comment naming the pull
request, the epic body table shows C1 as merged on the release branch and not on
`main`, and no pull request toward `main` is opened for C1.

**Scenario:** A row's pull request is opened against `main` by mistake

Given the release branch exists and a row of the epic has an open pull request
whose base is `main`
When a reviewer audits it
Then the reviewer raises a finding naming requirements 27 and 29, the pull
request is retargeted to `release/1231-ts-migration` (`gh pr edit --base`), and
it is not merged on `main`.

**Scenario:** The release ruleset is missing

Given this delta has merged and the branch exists, but no ruleset targets
`refs/heads/release/**`
When an agent picks up C1
Then it opens no pull request against the branch, reports the missing
precondition to the owner, and does not fall back to `main`.

**Scenario:** A weekly sync carries a change made on `main` to a migrated script

Given a fix merged on `main` to `scripts/foo.sh`, and the release branch has
migrated that script to `scripts/foo.ts` and reduced `scripts/foo.sh` to a shim
When the sync pull request `chore/1231-sync-main-<YYYYMMDD>` is prepared
Then the fix is ported to `scripts/foo.ts` in that same pull request or named in
it with a follow-up ticket, the pull request merges as a merge commit and not as
a squash or a rebase, and the release branch is never force-pushed.

**Scenario:** A sync with nothing to carry

Given `main` has no commit that the release branch lacks
When the weekly sync date arrives
Then no sync pull request is opened and the no-op is recorded on the epic.

**Scenario:** Two sub-specs never receive the same id

Given a sub-spec of C2 exists only on the release branch and its id is reserved
under `refs/spec-ids/*`, and a ticket outside the epic starts a spec on `main`
When the second `spec-author` runs `scripts/reserve-spec-id.sh --issue <N>`
Then the tool returns an id that is neither on the `main` tree nor among the
reservation refs, and no cleanup has deleted a reservation before the final
merge.

**Scenario:** The final merge

Given J4 #1344 has merged on the release branch and every condition of
requirement 25 holds on its head
When the last sync has landed, every check is green and the user gives formal
permission
Then exactly one pull request merges the release branch into `main` and closes
the epic (#1231), the first push on `main` runs the release workflow for the migrated
content, and the ruleset and branch are then removed.

**Scenario:** The final merge is attempted before the epic is complete

Given a row of the epic is not merged on the release branch, or a check is red
When an agent or a contributor proposes to merge the release branch into `main`
Then the pull request is not opened, or is not merged, and the release branch
stays unmerged.

## MODIFIED

Requirement 5 — the words "has shipped", which in a user-facing sentence
mean "has reached `main`", made explicit so that landing a row on the release
branch is not read as shipping it:

Original:

> A POSIX shell SHALL NOT be a prerequisite on any operating system once the
> setup/install/manage step (step (c) after delta-01's reorder of requirement
> 8) of the strangler order (requirement 8) has shipped.

Replacement:

> A POSIX shell SHALL NOT be a prerequisite on any operating system once the
> setup/install/manage step (step (c) after delta-01's reorder of requirement
> 8) of the strangler order (requirement 8) has shipped, which under
> delta-04 means has reached `main` through the final merge of requirement 37
> and not merely merged on the release branch.

Requirement 13 — the condition that releases the test's migration, read on
the branch the pull request targets rather than on `main`, so a row's test can
migrate while the release branch is the integration point:

Original:

> the test SHALL migrate only in a later pull request, after the TypeScript
> version has shipped green on Linux CI and on its `windows-latest` job
> (requirement 17).

Replacement:

> the test SHALL migrate only in a later pull request, after the TypeScript
> version has merged green — on the branch that pull request targets, which
> under delta-04 is `release/1231-ts-migration` — on Linux CI and on its
> `windows-latest` job (requirement 17).

The scenario "Windows user installs CrewRig without a POSIX layer" — the
step reference kept accurate, since "has shipped" is the user-facing event:

Original:

> When the user clones the repository and runs the Claude Code setup entry
> point from PowerShell after step (c) of the strangler order has shipped

Replacement:

> When the user clones the repository and runs the Claude Code setup entry
> point from PowerShell after step (c) of the strangler order has shipped on
> `main` (delta-04, requirement 38)

The scenarios "A new shell script is rejected by the ratchet" and "A new
non-TypeScript source file is rejected" — the ratchet is active on whichever
branch the pull request targets:

Original:

> Given the ratchet check is active on `main`

Replacement:

> Given the ratchet check is active on the branch the pull request targets
> (`main`, or `release/1231-ts-migration` under delta-04)

The replacement applies to both scenarios, whose "Given" line is identical.

## REMOVED

None.
