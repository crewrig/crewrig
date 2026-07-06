---
id: "0067"
slug: agents-md-size-budget
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 495
version: 1.0.0
---

# Reduce AGENTS.md below the most-restrictive CLI context budget

## Intent

`AGENTS.md` stays small enough that every supported CLI loads it in full —
including the most space-constrained one — so no working rule is ever silently
dropped when an agent loads its context. The single file continues to serve
every CLI unchanged; only its size shrinks, and every rule it once carried
remains reachable to any agent.

## Requirements

1. `AGENTS.md` SHALL NOT meet or exceed the budget of the most-restrictive
   supported CLI, fixed at **22 000 bytes** — a safety margin held below the
   tightest current truncation point (Antigravity, reported at 24 000 bytes) so
   that surrounding load-time overhead cannot push the effective size past that
   point.
2. The project build SHALL fail when `AGENTS.md` meets or exceeds the budget,
   and the failure message SHALL state the measured size and the budget.
3. The budget SHALL be measured in bytes.
4. The budget SHALL apply to `AGENTS.md` alone; reference material relocated to
   subordinate documents SHALL NOT count against it.
5. Every rule present in `AGENTS.md` before the reduction SHALL remain
   reachable afterwards — stated inline, or preserved in a referenced document
   linked from `AGENTS.md`. No rule SHALL be deleted or have its meaning altered
   by the reduction.
6. `AGENTS.md` SHALL remain a single file loaded identically by every supported
   CLI; the reduction SHALL NOT introduce a per-CLI variant of the file.

## Scenarios

**Scenario:** AGENTS.md within budget passes the build

Given `AGENTS.md` is 21 500 bytes
When  the size check runs during the build
Then  the check passes and reports the size against the 22 000-byte budget

**Scenario:** AGENTS.md over budget fails the build

Given `AGENTS.md` is 22 500 bytes
When  the size check runs during the build
Then  the build fails with a message stating the measured size (22 500) and the
      budget (22 000)

**Scenario:** a relocated rule stays reachable

Given a rule that lived inline in `AGENTS.md` before the reduction
And   that rule was moved into a subordinate referenced document to fit the budget
When  an agent loads its context after the reduction
Then  the rule is still reachable — either inline or through the reference in
      `AGENTS.md` — with its meaning unchanged

## Out of scope

- The user-space layered context system and every MemPalace, runtime-retrieval,
  or cross-CLI filesystem-read (sandbox) concern — owned solely by
  issue #496. `AGENTS.md` has no relationship to those.
- Per-CLI generated bundles and any build or generation step for `AGENTS.md`;
  it remains a single static file.
- `AGENTS.org.md` (adopter-owned): its own size is not changed here. Its
  contribution to any concatenated load-time size is acknowledged only as the
  rationale for the safety margin in requirement 1.
- Which specific sections of `AGENTS.md` are relocated — a PLAN/DEV decision,
  not a spec-level requirement.
- Rewriting or re-scoping any rule; the reduction relocates content, never
  changes what a rule obliges, permits, or forbids.

## Open questions

- [USER-PARKED] The 24 000-byte Antigravity truncation figure is not documented
  in `docs/` or `specs/` on `main`, and it is unconfirmed whether Antigravity
  truncates `AGENTS.md` directly or a concatenated context file (see
  spec 0061). The 22 000-byte safety margin (requirement 1) was chosen
  deliberately to absorb this uncertainty; confirming an authoritative source
  for the limit and the exact file it protects is deferred to PLAN/DEV, with the
  owner's recorded consent to proceed under the margin.
