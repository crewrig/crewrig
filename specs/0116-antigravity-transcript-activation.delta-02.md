---
id: "0116"
slug: antigravity-transcript-activation
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 724
version: 2.1.0
---

# 0116 — antigravity-transcript-activation (delta-02)

Requirement 23, introduced by delta-01, cannot be violated detectably. This delta
gives it the enforcement clause it was written without.

R23 obliges an event's firing frequency to be **measured** before the event is
registered, and forbids accepting a single-prompt probe as evidence of per-turn
cardinality. The obligation is sound — it exists because the parent spec's
mislabelling of `PreInvocation` survived three cold review passes on exactly that
kind of evidence. But as written it names no scenario, no continuous-integration
check, and no review consequence, so nothing in the repository can report a
violation of it. An agent that registers an event on the strength of its name
alone breaks R23 and every check stays green.

The project's sibling process rules do not have that gap. `AGENTS.md` →
*Pre-Edit Guard* and → *Session Bootstrap* each close with the same shape:

> A REVIEW pass that audits a session where the guard was bypassed SHALL emit a
> `class: tech` finding citing this section.

R23 was modelled on those rules and ended up weaker than them. This delta closes
the difference.

**Why enforcement is by review rather than by a check.** R23 constrains
*evidence*, not an artifact. A script can read what a manifest registers — the
regression suite already pins the registered event set and denies the four
high-frequency names — but no script can establish whether the author measured
the cardinality or inferred it from a name. The check that already exists stops a
future agent from registering a high-frequency event with continuous integration
green; what it cannot do is distinguish a registration backed by measurement from
a lucky one. That distinction is visible only to a reader of the change, so the
review pass is the only place the obligation can bite.

**Why the measurement's record is required rather than merely encouraged.** A
measurement that is not written down is indistinguishable, to every later reader,
from an inference. Delta-01 already records its own measurement in
`docs/cli-matrix.md`, which is what allowed the iteration-5 reviewer to check it
against R23's bar and to find that a single-turn probe did not clear it. Without
a recorded measurement there is nothing for a review pass to audit, and the
enforcement clause added below would have no subject.

The version bump is **MINOR** (`2.0.0` → `2.1.0`). No existing requirement's
obligation is narrowed or withdrawn: R23 continues to oblige exactly what it
obliged. The delta constrains a case delta-01 left unspecified — what happens
when R23 is violated, and where the measurement lives — which is an additive
normative change under `docs/spec-format.md` → *Delta-spec convention →
Versioning*.

## ADDED

**Requirements.**

1. **Requirement 26 — the measurement SHALL be recorded where a reviewer can
   audit it.** A change that registers a lifecycle event SHALL record, in the
   repository, the measured firing frequency that justifies the registration: the
   events observed, their counts, and the shape of the exercise that produced
   them. A statement of frequency without the exercise that produced it does not
   satisfy this requirement.

**Scenarios.**

*Scenario:* an unmeasured registration is reported

```text
Given a change that registers a lifecycle event
And   no recorded measurement of that event's firing frequency
When  a REVIEW pass audits the change
Then  the pass SHALL emit a finding of class spec citing Requirement 23
```

*Scenario:* a registration justified only by a single-prompt probe is reported

```text
Given a change that registers a lifecycle event
And   the recorded measurement was taken from a session containing one turn
When  a REVIEW pass audits the change
Then  the pass SHALL emit a finding of class spec citing Requirement 23
```

*Scenario:* a measured registration passes

```text
Given a change that registers a lifecycle event
And   a recorded measurement taken from a session containing more than one turn,
      naming the events observed and their counts
When  a REVIEW pass audits the change
Then  the pass SHALL NOT emit a finding under Requirement 23
```

## MODIFIED

1. **Requirement 23 gains an enforcement clause.** Its obligation is unchanged;
   what follows the semicolon is new.

   - Original R23 (delta-01):

     > **R23.** An event SHALL NOT be registered on the strength of its name or
     > its documented description alone; its firing frequency relative to a turn
     > SHALL be measured against a real multi-step turn, and the measurement
     > recorded. A single-prompt probe SHALL NOT be accepted as evidence of
     > per-turn cardinality, because one invocation equals one turn in that case.

   - Replacement R23:

     > **R23.** An event SHALL NOT be registered on the strength of its name or
     > its documented description alone; its firing frequency relative to a turn
     > SHALL be measured against a real multi-step turn, and the measurement
     > recorded per Requirement 26. A single-prompt probe SHALL NOT be accepted
     > as evidence of per-turn cardinality, because one invocation equals one
     > turn in that case. **A REVIEW pass that audits a change registering a
     > lifecycle event without a recorded measurement satisfying this
     > requirement SHALL emit a `class: spec` finding citing this requirement.**

Requirements 1 through 22, 24 and 25 are **UNCHANGED** and remain in force,
including delta-01's replacement of Requirement 3.

## REMOVED

Nothing.
