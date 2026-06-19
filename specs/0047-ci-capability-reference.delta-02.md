---
id: "0047"
slug: ci-capability-reference
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 389
version: 1.2.0
---

# CI capability reference contract

## ADDED

One requirement extends the parent's `## Requirements` list (cumulative
numbering R12):

**R12.** Each capability marked portable SHALL declare its engine-agnostic
execution requirements — the runtime and version, the additional tools, and
the source-history depth needed to run its invocation command — such that a
supported engine's pipeline for that capability can be derived from the
reference alone. The execution requirements describe the need, not the
mechanism: the engine-specific setup boilerplate that satisfies them is
produced by the derivation, never stored in the reference.

**Scenario:** A portable capability's execution need is satisfied per engine

```text
Given a portable capability declares an execution requirement (a runtime
      version, a tool, a history depth)
When a supported engine's pipeline for that capability is derived from the
     reference
Then the derived job sets up that engine's boilerplate satisfying the
     declared requirement, with no execution need taken from any source
     other than the reference
```

**Scenario:** A portable capability missing a needed execution requirement is rejected

```text
Given a portable capability whose invocation command needs a runtime or
      tool that the capability does not declare as an execution requirement
When the reference is judged against its format description
Then it is rejected, requiring the execution requirement before the
     capability is accepted as derivable
```

## MODIFIED

_None of the parent's requirement text changes. This delta clarifies the
boundary already implied by delta-01 R10 and the original R7 "Adding a
further engine" rule: the "engine's setup boilerplate" produced by the
derivation (delta-01 R10) is what satisfies the execution requirements this
delta adds (R12). The boilerplate stays on the engine-mapping side (HOW);
the requirement is the portable capability's own property (WHAT). No
existing requirement is weakened or removed._

## REMOVED

_None._
