# Ticket ownership

<!-- crewrig-doc: section=lifecycle nav_order=30 published=true title="Ticket ownership" -->

This document is the reference for the multi-contributor ticket-assignment
convention mandated by
[`specs/0244-multi-contributor-assignment.md`](../specs/0244-multi-contributor-assignment.md)
(cited below as R1…R17). The ownership model is recorded in
[ADR 0018](adr/0018-forge-assignment-ownership.md).

**In one sentence.** An issue's assignee owns it; nobody else authors on it,
and every agent checks ownership with one tool before its first authoring
action.

## The rule

- **Free.** An issue with no current assignee is free. Anyone may take it.
- **Owned.** Otherwise it has exactly one owner, determined from the forge's
  assignment record alone (R1). Agent memory, local files, comments and chat
  messages never override it.
- **Exclusive.** Nobody but the owner performs an authoring action on the
  ticket (R2): creating any of its branches (spec, delta-spec,
  implementation), securing its spec id, opening its worktree, opening or
  pushing to any of its pull requests. Reading, commenting and reviewing stay
  open to everyone.
- **One assignee.** An issue carries at most one assignee (R4). Others
  contribute through comments, review suggestions, or commit co-authorship.
- **Take before you author.** A contributor taking a free ticket becomes its
  assignee before the first authoring action (R3).

## The pickup check

Every agent runs the check at ticket pickup, before any branch, spec id or
worktree for the ticket, from the shared checkout — that is, before
`git worktree add` (R11, R15). The primary form is the Taskfile entry:

```sh
task ticket-pickup -- --issue <N>
```

Without `task`, run the two commands it wraps as **two separate steps**, the
second only when the first exits `0`:

```sh
node scripts/lib/node-floor-guard.js
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ticket-pickup.ts --issue <N>
```

The steps are deliberately not chained with `&&`: Windows PowerShell 5.1,
the shell some CLIs use on Windows, rejects that operator.

`--read-only` reports the owner and writes nothing. Use it to confirm that a
human transfer or takeover (below) passed through the free state.

The agent **stops on any non-zero exit** and never hand-rolls the assignment
mechanics. Proceeding without the check requires the user's explicit
instruction in the same session (R13).

### Exit codes

| Exit | Meaning | State left behind |
|---|---|---|
| `0` | Proceed: the current forge user owns the ticket. | Own assignment present (added or restored if needed). |
| `1` | Usage or wiring error (bad argument, malformed delay key). | Nothing written. |
| `2` | Cannot determine (R13): forge unreachable, identity unknown, record unreadable or inconsistent, own write never became visible, or a write failed partway. | Reported on stderr and in `actions[]`, e.g. "owner A restored, own assignment still present". |
| `3` | Owned by another contributor. The owner is named and the permitted paths are listed: ask the owner (R7), wait for the stale-lock path (R8), or pick another ticket. | Any own assignment withdrawn, the owner's restored if it had been displaced. |
| `4` | Undecidable (R4, R13): a tie in the record. | Any own assignment left in place and reported. |
| `5` | The self-assignment did not take (R14), typically a fork contributor without permission to assign themselves. | Issue still free; one maintainer request posted (see below). |

Output is one JSON line on stdout — `verdict`, `owner`, `self`, `forge`,
`actions[]` (every write attempted and its outcome), `delays` — and one
human sentence on stderr.

### How the owner is determined

The tool replays the issue's assignment history as a sequence of
**changes**:

- on GitLab, a change is one assignment system note;
- on GitHub and Gitea, a change is a group of events that share both their
  timestamp (one-second resolution) and their actor.

The set is replayed from empty. **Last free** is the last change boundary
at which the set was empty. The **owner** is the single contributor added by
the first change after last free (R1). Whether the owner is still assigned
does not change who the owner is; it only selects the repair.

**Creation seeding.** On a forge that does not record assignees set when
the issue was created, the replay starts with a synthetic change dated at
creation. It seeds the users whose first recorded item is a removal, and —
only when the history holds no assignment item at all — the current
assignees. Any other current assignee without a recorded item makes the
replay inconsistent, and the check exits `2` rather than guess an owner.

**Undecidable.** Exactly two cases, the ones the spec names:

- a **tie**: the first change after last free adds two or more
  contributors, or changes by different actors share one instant and their
  order would change last free or the first taker → exit `4`;
- a replayed set that does not equal the current assignee list → the record
  cannot be read reliably → exit `2`.

Undecidable means **not yours**: no contributor involved is the owner. They
settle it by agreement recorded in a comment, leave the issue free, and the
agreed contributor then takes it as a free ticket (R4).

### Verdicts

| Situation | Verdict | Writes | Exit |
|---|---|---|---|
| Free | `assign-self`, then re-determine | add self | per the new determination |
| Owner = self, assigned | `proceed` | none | `0` |
| Owner = self, displaced by a later assignment | `restore-self-then-proceed` | add self; others untouched | `0` |
| Owner ≠ self, self assigned | `restore-owner-then-withdraw` | restore owner, then remove self | `3` |
| Owner ≠ self, self not assigned | `owned-by-other` | none | `3` |
| Undecidable | — | none | `4` or `2` |

**Repairs never pass through the empty set** (R4 *Repairs preserve
ownership*): every write is add-only or remove-only at the forge's storage
level, or a single atomic set that contains the owner. The tool never
performs a transfer or a takeover (R8).

**Settle rule.** After any write the tool waits until its own event is
visible in the history, then a further settle delay of at least 2 s on the
local monotonic clock, and accepts `proceed` only after two consecutive,
identical, consistent reads at least 1 s apart. A successful pickup of a
free ticket therefore takes about 3 s longer.

**Silent drop (R14).** The case is classified from the current assignee
list, not from the history:

- self absent from the current list after the add → the forge dropped the
  assignment → exit `5`. The tool does not retry the self-assignment. It posts
  one comment asking a maintainer to assign the ticket, carrying the marker
  `<!-- crewrig:ticket-pickup assign-request -->`, deduplicated since last
  free. The ticket stays free until a maintainer records the assignment;
- self present in the current list but its event not yet in the history →
  a lagging read, retried a bounded number of times → exit `2` when the
  retries run out.

## Per-forge mechanics

The check behaves identically on the three forges, through each forge's own
CLI and the credential it already holds (R12, ADR 0015). Every call goes
through the CLI's raw `api` subcommand. The forge is detected from the
reference remote: `github.com`, then `gitlab.*` or a host listed in
`CREWRIG_GITLAB_HOSTS`, otherwise Gitea.

| | GitHub (`gh`) | GitLab (`glab`) | Gitea (`tea`) |
|---|---|---|---|
| Identity | `gh api user` → `.login` | `glab api user` → `.username` | `tea api user` → `.login` |
| Current assignees | `…/issues/N` → `.assignees[].login` | `projects/<path>/issues/N` → `.assignees[].username` | `…/issues/N` → `.assignees[].login` |
| History | timeline events `assigned` / `unassigned` | assignment system notes, parsed; any assignment note outside the grammar → exit `2` | timeline entries of `type: "assignees"` |
| Creation assignees recorded | yes | assumed not (pending live verification) | yes |
| Add self | `POST …/assignees` | `PUT` `assignee_ids`, only after reading the issue free | dedicated `POST …/assignees` where the server exposes it, else an add-only `PATCH` |
| Remove self | `DELETE …/assignees` | `PUT` `assignee_ids: current − {self}` (never empty: the owner is in it) | dedicated `DELETE …/assignees` where exposed, else a remove-only `PATCH` |
| Restore owner, withdraw self | add owner → confirming read → remove self | one atomic `PUT` of `(current − {self}) ∪ {owner}` | add-only step → confirming read → remove-only step; never one replacing `PATCH` |

Gitea's dedicated assignee endpoints are detected once per run from the
server itself (its version or its published API description), never inferred
from a failed write. A single replacing `PATCH` is never issued on Gitea:
the server deletes the old assignees before adding the new ones, in separate
transactions, which would expose a transient empty set.

Mechanics not yet verified live on a forge are recorded as gaps in
[`docs/cli-matrix.md`](cli-matrix.md) → *Parity gaps*; until verified, the
check fails closed on any record it cannot read.

## Human procedures

These are performed by the contributors concerned — by hand, or by an agent
at its user's explicit instruction in the same session — never by an agent
on its own initiative (R8).

### Release (R6)

Remove your own assignment and leave a status comment stating what is done
and what remains. A ticket with no remaining work is closed, not released.

| Forge | Remove own assignment |
|---|---|
| GitHub | `gh issue edit <N> --remove-assignee @me` |
| GitLab | `glab issue update <N> --unassign` (you are the sole assignee) |
| Gitea | the issue's assignee menu in the web UI |

### Transfer with consent (R7)

1. The new contributor asks for the ticket in a comment.
2. The current owner agrees in a comment on the issue.
3. The owner releases the ticket (above), leaving it **free**.
4. The new contributor runs the pickup check, which assigns them.

### Stale-lock takeover (R8)

1. The ticket shows no activity by its assignee — no comment on the issue,
   no commit on any of its branches, no update to any of its pull requests —
   for the **nudge delay** (default 14 days).
2. Another contributor comments, mentioning the assignee, asking for it.
3. With no answer after the **grace delay** (default 7 days), that
   contributor removes the assignee, leaving the issue **free**, then runs the
   pickup check, and leaves a takeover comment linking the unanswered request.
   A takeover is never silent.

| Forge | Remove the stale assignee |
|---|---|
| GitHub | `gh issue edit <N> --remove-assignee <login>` |
| GitLab | `glab issue update <N> --unassign` |
| Gitea | the issue's assignee menu in the web UI |

**Pass through free, visibly.** A transfer or takeover must leave the issue
free before the new assignment is recorded, so that R1 recognises the new
owner. On GitHub and Gitea, events by one actor in the same second form one
change, so a removal and an addition in the same second read as a
replacement and keep the old owner. Remove first, confirm with
`task ticket-pickup -- --issue <N> --read-only` that the issue reads as free,
then take it. This split is intended behaviour, not a record gap: it is the
only pattern R1 can read as a release followed by a take.

### Organization delays

An adopting organization overrides both delays in its overlay
`crewrig.config.toml`, as quoted `key = "value"` lines (see
`crewrig.config.toml.template`):

```toml
ticket_nudge_days = "14"
ticket_grace_days = "7"
```

The keys must be identical for every contributor, which is why they live in
the shared overlay file rather than an environment variable. A malformed
value makes the check exit `1`.

## Branches, pushes and hotspot files

- **No pushes to someone else's branch** (R9). Changes to another
  contributor's work go through review suggestions or a pull request that
  targets their branch. Two pushes stay permitted: bringing the branch up to
  date with the reference branch by the contributor about to merge it
  (`AGENTS.md` → *Branching Strategy* → *Up-to-date merge precondition*), and
  any push the owner explicitly invited in a comment.
- **Hotspot files** (R10) — at least `docs/cli-matrix.md`, `AGENTS.md`,
  `.crewrig/core-paths.txt` and compiled component outputs. A change to a
  shared contract in such a file is announced on the ticket's issue before
  the pull request opens, and the pull request is brought up to date with the
  reference branch before review is requested, in addition to the pre-merge
  update.

## Epics (R5)

Assigning an epic locks the epic issue only. Each sub-ticket is free or owned
by its own assignment. The epic's assignee arbitrates how sub-tickets are
split and distributed, and settles disputes over them.

## Boundary with the machine-scoped guards (R17)

This convention coordinates **different contributors**. Several agent
sessions of the **same** contributor on one ticket stay governed by the
existing machine-scoped guards — spec-id reservation
([`specs/0112-spec-id-reservation.md`](../specs/0112-spec-id-reservation.md))
and the worktree claim of
[`docs/agent-team-protocol.md`](agent-team-protocol.md) — which this
convention neither replaces nor weakens. The pickup check returns `0` to
every session of the owner.

## Accepted limits

- **Agent-only enforcement.** A pull request opened by hand, without an
  agent, bypasses the check (spec 0244 → *Out of scope*).
- **Lost-update race on replacing writes.** Where a remove or add is a
  replacing write computed from a read — GitLab's `PUT assignee_ids`, and
  Gitea's `PATCH` on servers without the dedicated endpoints — a rival's
  concurrent write between the read and the write can be erased; on Gitea it
  can also expose a transient empty set. The window is well under a second
  and needs a rival write inside it. The next pickup reads the resulting
  record and resolves it under R11, or stops on a tie.
- **Residual eventual consistency.** The settle rule shrinks the window to
  the forge's own propagation lag beyond about 3 s. A rival event that
  becomes visible even later makes the next pickup read a tie and stop.
- **Fork contributors.** A contributor whose reference remote is a fork
  queries the fork's issue, which usually has issues disabled: the check
  exits `2` with a `BASE_REF=<upstream>/main` hint.
