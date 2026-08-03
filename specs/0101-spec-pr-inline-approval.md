---
id: "0101"
slug: spec-pr-inline-approval
status: draft
complexity: small
related-issue: 610
version: 1.0.0
---

# Record a spec's `draft` → `approved` transition in its own spec-PR

## Intent

A contributor who has just secured approval to merge a specification pull
request should see that specification land on `main` already carrying its
`approved` status, rather than land as a `draft` and then require a second,
metadata-only pull request to flip it to `approved`. Today the format
contract treats every status transition — including the very first one,
`draft` → `approved` — as an edit made to an already-merged spec, which
forces that first transition to become a separate follow-up pull request:
a single spec-approval event then costs two pull requests, two merge
authorizations, and two worktrees. That second pull request records a
decision that was already made, because the merge-authorization request
that every interaction mode fires before a spec-PR merges is itself the
approval event. This spec closes the gap so that the `draft` → `approved`
transition is recorded together with the spec-PR it approves, a merged
specification is never at once merged and still `draft`, and no second
pull request is needed to record a spec's approval.

## Requirements

1. `docs/spec-format.md` SHALL be amended so that its *Recording a status
   transition* section distinguishes the `draft` → `approved` transition
   from every other status transition, and states that the
   `draft` → `approved` transition is recorded together with the spec-PR
   that introduces the spec, not as an edit to an already-merged spec.
2. The amended *Recording a status transition* section SHALL state that
   when a spec-PR is merged to `main`, the merged spec file carries
   `status: approved` at the moment it lands on `main`, so a merged
   specification is never simultaneously merged and still `draft`.
3. The amended *Recording a status transition* section SHALL state that a
   separate, post-merge, metadata-only pull request SHALL NOT be required
   to carry out the `draft` → `approved` transition.
4. The rule SHALL apply independently of interaction mode — in `FULL`,
   `INTERMEDIATE`, `MINIMAL`, and `AUTO` alike — because the
   merge-authorization request that authorizes a spec-PR's merge is fired
   in every mode and is the approval event that the `approved` status
   records.
5. The amended section SHALL require that the `draft` → `approved`
   transition be recorded only after the spec-PR's merge-authorization
   approval has been secured, so that a spec's recorded `approved` status
   always reflects an approval decision that has actually been made and
   never one presumed ahead of that authorization.
6. The `draft` → `approved` transition recorded in the spec-PR SHALL stay
   metadata-only in the sense the *Recording a status transition* section
   already defines: it SHALL set `status` to `approved` and, when
   `interaction-mode` was omitted while the spec was `draft`, SHALL set
   `interaction-mode` to the mode the spec was qualified under (as the
   frontmatter schema already requires of any `approved` spec), and it
   SHALL NOT alter the spec's normative body content, `id`, `slug`, or
   `version`.
7. The *Lifecycle states* table's `approved` row SHALL be made consistent
   with the amended rule: it SHALL NOT retain or introduce any wording
   implying that the `draft` → `approved` transition requires a separate
   post-merge pull request, and its accompanying-artifact entry SHALL make
   explicit that the merged spec-PR's own commit carries the `approved`
   status.
8. The amendment SHALL leave every status transition other than
   `draft` → `approved` — in particular `approved` → `implemented`,
   `→ superseded`, and `→ archived` — recorded as a post-merge
   metadata-only edit, because each of those is triggered by a genuinely
   later, separate event and cannot be folded into the spec-PR that
   introduces the spec.

## Scenarios

**Scenario:** A spec-PR lands already approved with no follow-up pull request

```text
Given a spec-PR authored in INTERMEDIATE mode with `status: draft`
And   the merge-authorization gate for that spec-PR has been granted
When  the spec-PR is merged to `main` with its `draft` → `approved`
      transition recorded in the same commit
Then  the merged spec file on `main` carries `status: approved`
And   no separate post-merge status-transition pull request is opened for
      that transition
```

**Scenario:** The rule applies in AUTO mode because the merge gate is invariant

```text
Given a spec-PR authored autonomously in AUTO mode with `status: draft`
And   the merge-authorization gate — invariant across every mode, AUTO
      included — has been granted for that spec-PR
When  the spec-PR is merged to `main`
Then  the merged spec file carries `status: approved`, recorded in the
      spec-PR's own commit, exactly as in the other three modes
And   no separate post-merge status-transition pull request is required
```

**Scenario:** Recording approval before the merge gate is a violation

```text
Given a spec-PR still awaiting its merge-authorization gate, with
      `status: draft`
When  an agent sets the spec's frontmatter to `status: approved` before
      that gate has been granted
Then  the change is a violation, because a recorded `approved` status must
      reflect an approval decision that has actually been made, not one
      presumed ahead of the authorization
```

## Out of scope

- Any change to a status transition other than `draft` → `approved`. The
  `approved` → `implemented`, `→ superseded`, and `→ archived` transitions
  remain post-merge metadata-only edits, each triggered by a genuinely
  later, separate event (an implementation PR merging, a superseding spec
  landing, a ticket closed without implementation) that cannot be folded
  into the spec-PR that introduces the spec.
- Any change to the append-only rule that freezes a merged spec's
  normative content. The `draft` → `approved` fold is a lifecycle-metadata
  transition, not a normative-content edit; the immutability of
  `## Intent`, `## Requirements`, `## Scenarios`, `## Out of scope`,
  `## Open questions`, `id`, and `slug` after merge is untouched.
- Any change to the delta-spec convention. Corrections to a merged spec's
  normative content still chain through delta-spec files; nothing here lets
  a normative change ride along with the status flip.
- Any change to the `spec-author` skill's behavior of writing
  `status: draft` on first write. The spec is authored `draft` and stays
  `draft` throughout authoring and review; only the merge that approves it
  records `approved`.
- Any change to the merge-authorization gate itself or to the
  `interaction-mode` frontmatter semantics. This spec relies on both as
  fixed constraints; it sets `interaction-mode` at the `approved`
  transition only to satisfy the existing frontmatter schema, and does not
  alter when or how the gate fires.
- Any change to the spec-PR *one-file rule* or the *independence rule* in
  `docs/spec-pr-workflow.md`. The spec-PR still introduces exactly one spec
  file; recording the status in that same file adds no second file, and the
  independence of the spec-PR from its implementation-PR is unaffected.
- New tooling or automated enforcement — for example, a linter check that a
  merged spec-PR carries `status: approved`. This spec amends the written
  process contract only; whether tooling later enforces the rule is a
  separate concern.
- Any change to how the approval is recorded in the logbook. The logbook
  comment recording the approval (per the *Lifecycle states* table) is
  unchanged; only the spec file's own `status` metadata moves into the
  spec-PR.

## Open questions

None outstanding. Two decisions were resolved during authoring rather than
left open: (1) the rule is mode-independent — it was tempting to condition
it on solo-authorship or `AUTO`, but the merge-authorization gate that
constitutes the approval event is itself invariant across all four modes
(`AUTO` included), so no mode lacks a real approval event to record, and a
mode-conditional rule would have no coherent basis; (2) the obligation is a
`SHALL`, not a `MAY`, because a permissive rule would let the two-PR
overhead recur and would tolerate a merged-but-`draft` spec, a state the
*Lifecycle states* table already contradicts by triggering `approved` on
the merge itself.
