---
id: "0047"
slug: ci-capability-reference
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 383
version: 1.1.0
---

# CI capability reference contract

## ADDED

Two requirements extend the parent's `## Requirements` list (cumulative
numbering R10–R11):

**R10.** Each capability marked portable SHALL declare the business
invocation command that realizes the job — the work the job performs,
distinct from any engine-specific setup boilerplate (checkout, runtime
setup) — such that a supported engine's pipeline for that capability can be
derived from the reference alone, with no other source.

**R11.** A capability marked engine-specific SHALL NOT be required to
declare an invocation command; its body remains hand-authored under its
evidence-backed exception.

**Scenario:** A portable capability yields an executable job

```text
Given a portable capability declares its invocation command
When a supported engine's pipeline for that capability is derived from the
     reference
Then the derived job runs that command wrapped in the engine's setup
     boilerplate, using no source other than the reference
```

**Scenario:** A portable capability missing its command is rejected

```text
Given a capability is marked portable but declares no invocation command
When the reference is judged against its format description
Then it is rejected, requiring the command before the capability is
     accepted as portable
```

## MODIFIED

_None. This delta is purely additive: it introduces the invocation-command
obligation for portable capabilities without changing any existing
requirement. Requirement 1's job granularity is preserved — the invocation
command is the job's business command, not step-level mechanics, which
remain in the project's scripts outside the reference._

## REMOVED

_None._
