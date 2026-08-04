---
id: "0109"
slug: spec-status-invariant-on-main
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 700
version: 1.0.0
---

# A spec's recorded status tells the truth about the spec

## Intent

A reader — human or agent — who inspects a spec's `status` field learns
something true about that spec. A spec that has merged is never recorded as a
draft, so `status` distinguishes "merged and in force" from "proposed but never
landed", which is the question the field exists to answer. The invariant holds
because a mechanical check enforces it on every change, not because every
author remembers a two-command sequence at the moment their attention has
moved to the merge.

## Requirements

1. No spec file present on `main` other than a delta-spec SHALL carry
   `status: draft`. A spec reaches `main` only by its own merged pull request,
   which is the trigger `docs/spec-format.md` assigns to `approved`, so `draft`
   on `main` is a contradiction rather than a lagging value.
2. The spec linter SHALL fail when a non-delta spec that is present on the base
   branch of the change under test carries `status: draft`, and SHALL name every
   offending file. Presence on the base branch is the discriminator: a spec
   being introduced by the change under test is legitimately `draft` up until
   the frontmatter edit its own merge mechanic prescribes, and SHALL NOT be
   flagged.
3. The check SHALL derive the set it examines from the repository at check time,
   never from a count, a list of filenames, or any figure recorded when this
   spec was written.
4. Every non-delta spec on `main` that carries `status: draft` when this spec is
   implemented SHALL be corrected to the status that reflects its true state.
5. A correction per requirement 4 SHALL be metadata-only: it changes `status`
   and nothing else — no body line, no `id`, no `slug`, no `interaction-mode`,
   no `version` — per the lifecycle-metadata carve-out in
   `docs/spec-format.md` → *Recording a status transition*.
6. The correction of requirement 4 and the check of requirement 2 SHALL land
   together, in a single change. A check that arrives before the corrections
   would fail on `main` and on every subsequent pull request; corrections that
   arrive without the check leave the invariant unenforced and free to decay
   again.
7. `docs/spec-format.md` SHALL state the invariant of requirement 1 as a rule a
   reader can find, rather than leaving it implicit in a transition table, and
   SHALL name the check of requirement 2 as its enforcement.
8. The check of requirement 2 SHALL be covered by the spec linter's own test
   suite, with at least one case that fails when the check is removed.

## Scenarios

**Scenario:** a draft spec already on the base branch is rejected

```text
Given a spec file present on the change's base branch carrying status: draft
And   it is not a delta-spec
When  the spec linter runs
Then  it reports a violation naming that file and exits non-zero
```

**Scenario:** a spec being introduced by the change is not rejected

```text
Given a spec file that exists only in the change under test, carrying
      status: draft, absent from the base branch
When  the spec linter runs
Then  it reports no violation for that file
```

**Scenario:** a delta-spec carrying draft is not rejected

```text
Given a delta-spec present on the base branch carrying status: draft
When  the spec linter runs
Then  it reports no violation for that file
```

**Scenario:** the corrected corpus passes its own check

```text
Given every non-delta spec on main has been corrected per requirement 4
When  the spec linter runs against main
Then  it reports no status violation
```

**Scenario:** removing the check is caught

```text
Given the check of requirement 2 is deleted from the spec linter
When  the spec linter's test suite runs
Then  at least one case fails
```

## Out of scope

- **What status a delta-spec should carry, and whether the invariant of
  requirement 1 should extend to delta-specs.** Deliberately unresolved rather
  than decided here. The corpus does not support a convention: measured on
  `main` at `860adb0`, the 37 delta-specs are **30 `draft`, 5 `approved`, 2
  `implemented`**. A rule that only one instance follows is not a convention,
  and the reasoning available for either answer is weak — a delta is an
  amendment to its parent rather than an independently tracked lifecycle object,
  which argues for exempting it; but a merged delta recorded as a draft
  misinforms a reader exactly as a merged parent does, which argues against.
  Requirement 2 therefore exempts delta-specs so this spec does not codify a
  guess, and the question is left for its own ticket with the measurement above
  as its starting evidence.
- Changing the lifecycle states themselves, their triggers, or their
  authorities. `docs/spec-format.md` → *Lifecycle states* is the contract; this
  spec makes the corpus obey it and does not amend it.
- The `draft` → `approved` merge mechanic. It already exists and is already
  correct; the defect is that nothing detects a failure to follow it.
- Backdating a corrected spec's history, or reconstructing which of `approved`
  and `implemented` a spec passed through and when. Requirement 4 records the
  spec's state as it is at correction time, not a timeline.
- Any change to how `related-issue` is used, validated, or resolved.

## Open questions

None. The one question the anchor issue raised — whether the corrections of
requirement 4 need per-spec judgement — was settled by measurement before this
spec was written: all 44 candidate specs have a `related-issue` that is
CLOSED/COMPLETED, and four spot-checks confirmed the implementation is present
on `main` (`0009` → `scripts/lib/spec-linter.js`; `0095` → Rule 5 in
`docs/agent-team-protocol.md`; `0090` → the *Forge Access* section in
`AGENTS.md`; `0100` → the session-boundary worktree-hygiene subsection). The
correction is therefore mechanical. Requirement 4 is deliberately phrased as
"the status that reflects its true state" rather than naming `implemented`, so
that a spec whose ticket is closed without a shipped implementation is recorded
honestly rather than forced to match the majority.
