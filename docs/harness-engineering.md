# Harness engineering

<!-- crewrig-doc: section=harness-engineering nav_order=10 published=true title="Harness engineering" -->

The crew of agents CrewRig deploys is not static. When an agent hits a sharp
edge during real work — a misleading prompt, a tool that does the wrong thing,
an output format that breaks downstream parsing — that signal needs to reach the
people who maintain the agent system, or the same friction repeats forever.
Harness engineering is the built-in feedback loop that captures those signals
and turns them into tracked work.

This page is the conceptual overview. The two skills that implement the loop are
`harness-report` and `harness-curator`, both under
[`artifacts/library/skills/`](../artifacts/library/skills/).

## The loop

Frictions become shipped improvements through a four-stage loop:

1. **Tag** — during real work, an agent invokes the `harness-report` skill the
   moment a recognition signal fires. Each tag lands as a structured entry in
   the global `harness-friction` memory wing.
2. **Cluster** — the `harness-curator` skill reads the tagged frictions,
   clusters them by subcategory, and opens one descriptive GitHub issue per
   cluster against the repository declared in each component's provenance block.
3. **Fix** — the issues are addressed through the normal branch/PR workflow; the
   internal agent crew handles the implementation cycle.
4. **Re-install** — after a fix ships, the build is regenerated and reinstalled.
   The `metadata.provenance.version` bump in every modified source signals that
   a new version is available.

The tagging step is **fire-and-forget**: the reporting agent does not block or
wait for an acknowledgment. It tags the friction and returns to the task. Reading
the friction wing is the curator's job, not the working agent's.

## Recognition signals — when to tag

A friction is tagged when one of a fixed set of recognition signals fires.
Tagging is mandatory the moment a signal fires, not optional or deferred:

- **User pushback** — the user contests, corrects, or reverts the agent's
  action, or reformulates the same intent because the previous response was
  misaligned.
- **Sibling-skill workaround** — the agent contorts around a constraint set by
  another skill or agent, not by the user's request.
- **Tool surprise (second time)** — a tool behaves surprisingly or
  inconsistently for the second time in a session. First time is bad luck;
  second is a pattern.
- **Process gap** — a documented workflow step turns out to be missing,
  ambiguous, contradictory, or out of date.
- **Safeguard friction** — a rule or guard blocks a legitimate action and forces
  a workaround the agent had to explain to the user.

When in doubt, tag. Over-reporting is curatable; an un-reported friction that
bites the next agent is the failure mode the loop exists to prevent.

## The friction taxonomy

Every friction is filed into exactly one of five fixed categories, which become
the memory room it is written to. Finer sub-categorization is free-form inside
the payload (a `subcategory:` field used as the clustering key):

| Category | Used for |
|----------|----------|
| `tool` | An MCP tool, CLI, or script behaved unexpectedly or has a sharp edge. |
| `prompt` | A skill or agent prompt was misleading, ambiguous, or led the agent astray. |
| `format` | An output format broke parsing, mixed concerns, or was hard to consume. |
| `behavior` | The agent did something it should not have, or skipped something it should have done. |
| `process` | A documented workflow step is missing, contradictory, or out of date. |

Each friction carries a structured payload — at minimum a non-empty
`writer_agent` and one `evidence:` entry, plus optional `canonical`, `severity`,
and `suggestion` fields. The full payload schema, the recognition-signal
definitions, and the rules for what *not* to tag are specified normatively in
the framework's tool rules (the priority-60 core rules file), which the
`harness-report` skill operationalizes.

## What not to tag

The loop is for defects in the *agent system itself*, not for everything that
goes wrong:

- One-off mistakes the agent made that the system did not cause belong in the
  agent's diary, not the friction wing.
- Bugs in the user's code under review belong in the project logbook issue.
- Missing features belong in a regular GitHub issue, not a friction report.

## Where to read next

- The reporting skill: [`artifacts/library/skills/harness-report/SKILL.md`](../artifacts/library/skills/harness-report/SKILL.md).
- The curator skill: [`artifacts/library/skills/harness-curator/SKILL.md`](../artifacts/library/skills/harness-curator/SKILL.md).
- How these components are owned and deployed:
  [Layer taxonomy and boundary contract](layers.md).
