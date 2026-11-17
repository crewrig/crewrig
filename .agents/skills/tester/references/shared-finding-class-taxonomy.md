# Finding class taxonomy

A review finding is routed by one tag, so the tag has to be present and correct. The routing step reads that tag and nothing else to decide who fixes the finding next.

- Every finding carries exactly one `class:` field with the value `tech`, `arch` or `spec`.
  - `tech`: the change is wrong or incomplete and the fix is local to the implementation.
  - `arch`: the design or the plan has to change before the implementation can be right.
  - `spec`: the requirement itself is missing, contradictory or wrong, so the specification changes first.
- A finding without the tag is malformed. Retag it before the orchestrator consumes the verdict; a missing tag is a protocol error, not a hint to guess the target.
- When the class is ambiguous, escalate to the upstream class instead of defaulting to `tech`. A finding sent to the wrong loop costs a full iteration, and defaulting low hides design and specification defects.
- A skill acting on findings handles only its own class. A finding of another class that reaches it was misrouted: flag it and return it, do not fix it.
- The routing matrix and the tag schema are in `docs/retroactive-loop.md` and `docs/plan-format.md` in a CrewRig checkout; this reference gives the rule, those documents give the table.
