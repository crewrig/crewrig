---
id: "0112"
slug: spec-id-reservation
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 1265
version: 1.2.0
---

# 0112 — spec-id-reservation (delta-02)

Issue #1265 is a harness-friction cluster surfaced during real parallel-ticket
kickoff: an orchestrating agent declared a spec id "reserved" for a sibling
ticket (e.g. "0211 for issue #1174") inside a kickoff brief without ever
running `scripts/reserve-spec-id.sh --id <ID> --issue <N>` to secure it on the
remote — `git ls-remote origin 'refs/spec-ids/*'` at the time showed no id
past `0210`. The claimed reservation never existed
(<https://github.com/crewrig/crewrig/issues/1175#issuecomment-5813977165>).

Closing only that half of the gap would make the tool actively harmful the
moment an orchestrator does it right. `scripts/reserve-spec-id.sh`'s
`--issue <N>`-only path — the only path `artifacts/core/skills/spec-author/SKILL.md`
permits the skill to call, since it never passes `--id` — always computes a
fresh id via its highest-existing-plus-one logic and has no check for "does
this issue already hold a reservation?" So an orchestrator that correctly
pre-secures `0211` for issue #1174 up front, followed by the real spec-author
session for #1174 later running its ordinary `--issue`-only invocation, does
NOT get `0211` back: it silently computes and secures a different id (e.g.
`0212`), orphaning `0211` forever (requirement 5 forbids releasing a
reservation) and handing the session an id other than the one already
promised by the kickoff brief and any branch name derived from it. The same
absence of a per-issue check also makes the `--issue`-only path non-idempotent
under retry: a crashed or re-run invocation for the same issue allocates and
orphans a second id instead of recovering the first.

This delta closes both halves together: the tool is made to reuse whichever
id an issue already holds — however it came to hold it — before it ever
computes a new one, and the orchestrator obligation to actually secure a
pre-assigned id (not merely assert it) is stated as a normative process rule
alongside it. Neither half alone removes the friction; the tool fix without
the process rule leaves orchestrators free to keep asserting unsecured
claims that other id-space activity could still take, and the process rule
without the tool fix leaves a correctly-behaving orchestrator's
pre-allocation silently orphaned by the sibling's own session.

## ADDED

1. **R17.** When `scripts/reserve-spec-id.sh` is invoked without `--id` (the
   ordinary `--issue <N>`-only path) for an issue that already holds a
   secured reservation anywhere in the allocated set for its corpus — read
   across both upstream carriers, `refs/spec-ids/*` and
   `refs/tags/spec-id/*`, exactly as the tool already reads both when
   computing the allocated set regardless of which carrier is configured for
   writing — the tool SHALL return that existing id and SHALL make no
   additional push to secure a new one. The invocation SHALL still report
   success (the id is, and remains, secured).

2. **R18.** Requirement 17 SHALL hold identically regardless of how the
   issue's existing reservation was secured: by an earlier `--issue`-only
   invocation for the same issue, or by a separate `--id <ID> --issue <N>`
   invocation made on that issue's behalf — for example, an orchestrator
   pre-allocating an id for a sibling session before that sibling ever runs
   its own `--issue`-only invocation. The tool SHALL NOT distinguish these
   two origins when deciding whether to reuse.

3. **R19.** An orchestrating agent or session that declares, in a kickoff
   brief or any equivalent artifact handed to a sibling session, that a
   specific spec id is "reserved" for that sibling's ticket SHALL secure
   that id on the remote via
   `scripts/reserve-spec-id.sh --id <ID> --issue <N>` in the same step in
   which it creates the sibling's branch or spawns the sibling session, and
   SHALL do so before the "reserved" claim is communicated to the sibling or
   written into any brief. The claim SHALL NOT be asserted from a merely
   computed or predicted id that no invocation of the tool has secured.

4. **R20.** `artifacts/core/skills/spec-author/SKILL.md` and its paired
   `artifacts/core/agents/spec-author/AGENT.md` SHALL document the reuse
   behavior of requirements 17 and 18 at the point where the skill or agent
   invokes `scripts/reserve-spec-id.sh --issue <N>`, so a drafting session
   understands why calling `--issue <N>` alone remains safe and sufficient
   even when a parent orchestrator has pre-secured an id on the issue's
   behalf. This documentation SHALL NOT change the skill's or agent's own
   contract: per the existing text at `SKILL.md` → *ID allocation*, the
   skill SHALL continue to never pass `--id` and never compute an id from
   the local working tree.

5. **R21.** The orchestrator obligation of requirement 19 SHALL be
   documented in `docs/spec-pr-workflow.md` → *Reserving the spec id* — the
   document that already states the reservation contract and the analogous
   maintainer obligation to secure a fork contribution's id before merge —
   with a cross-reference from `docs/agent-team-protocol.md` →
   *Worktree Isolation*, the section that governs the orchestrator's
   per-ticket kickoff moment (branch and worktree creation) at which a
   sibling's id would be pre-allocated. Documenting it in one place only
   would leave it undiscoverable from whichever document a future
   orchestrator reads first.

6. **Scenario — orchestrator pre-secures, sibling reuses.** Given an
   orchestrator runs `reserve-spec-id.sh --id 0211 --issue 1174` while
   kicking off a sibling session, and given that sibling session later runs
   `reserve-spec-id.sh --issue 1174` with no `--id`, when the second
   invocation runs, then it returns `0211` — the same id the orchestrator
   already secured — makes no additional push, and the sibling session is
   never handed a different id than the one already written into its
   kickoff brief and derived branch name.

7. **Scenario — unsecured claim is never trusted, the true next free id is
   computed instead.** Given a kickoff brief merely states that an id is
   "reserved" for a sibling ticket without any invocation of the tool ever
   having secured it, when that sibling's session runs
   `reserve-spec-id.sh --issue <N>` with no `--id`, then the invocation finds
   no existing reservation for that issue, computes and secures the true
   next free id from the real allocated set, and the session is never
   silently handed the stale or fictional id the brief asserted.

8. **Scenario — idempotent retry.** Given an issue already secured an id
   through one `--issue`-only invocation, when a later `--issue`-only
   invocation for the same issue runs — for example after the first
   invocation's caller crashed before recording the result — then the later
   invocation returns the same id and secures no second, orphaned
   reservation for that issue.

9. **Out of scope — parsing kickoff-brief prose.** Detecting, validating, or
   mechanically verifying a free-text "reserved" claim inside a kickoff
   brief or any other prose artifact. Rejected: that stays the process
   obligation stated in requirement 19, not something continuous integration
   or the reservation tool can verify — the tool can only ever attest to
   what it has itself secured, never to what a brief asserts in prose.

## MODIFIED

(None. Requirement 1's distinctness guarantee already scopes to sessions
racing for an id at allocation time and is unaffected by one issue reusing
its own already-secured id; no existing requirement of spec 0112 or its
delta-01 is changed by this delta.)

## REMOVED

(None. This delta adds five requirements, three scenarios, and one
out-of-scope item. Requirements 1 through 16 of spec 0112 and its delta-01
stand unchanged, as do all of their scenarios and the remainder of their
out-of-scope lists.)
