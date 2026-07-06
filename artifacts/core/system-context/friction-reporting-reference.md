# Friction Reporting — Reference Detail

## Where to write

Frictions live in a **global** wing, not in the project wing. A friction
discovered while working on project X often applies to projects Y and Z
that fork the same skill — scoping per project would hide the pattern.

```text
mempalace_add_drawer(
  wing="harness-friction",
  room="<category>",
  content="<payload>"
)
```

## Categories (5, fixed)

Use exactly one of these as `room`. Sub-categorization is free-form
inside the payload (`subcategory:` field).

| Category | Room name | Use for |
|----------|-----------|---------|
| Tool | `tool` | An MCP tool, CLI, or script behaved unexpectedly or has a sharp edge. |
| Prompt | `prompt` | A skill/agent prompt was misleading, ambiguous, or led you astray. |
| Format | `format` | An output format broke parsing, mixed concerns, or was hard to consume. |
| Behavior | `behavior` | The agent (you, or a sibling) did something it should not have, or skipped something it should have done. |
| Process | `process` | A documented workflow step is missing, contradictory, or out of date. |

## Payload schema

Plain text, structured like the `[TASK:*]` payloads. The `FRICTION:`
prefix on the first line is what the Curator searches for.

```text
FRICTION: <one-line title>

writer_agent: <agent-name>
subcategory: <free-form, optional — e.g. "yq-yaml-merge", "build-resolver">
session_id: <session id, if available>
project: <project name where it surfaced, if applicable>
canonical: <canonical URL of the offending component, if known>
severity: low | med | high      # default: med
evidence:
  - <path or URL #1>
  - <path or URL #2>
suggestion: <free-form fix idea, optional but encouraged>
```

### Field semantics

- `writer_agent` — required, **non-empty**. Same convention as the
  task-handoff drawer. Lets the Curator attribute clusters and lets the
  user trace who hit what. An empty value is treated as malformed and
  the drawer is skipped.
- `subcategory` — free-form clustering key. Frictions sharing a
  `subcategory` get bundled into the same MR by default.
- `evidence` — at least one entry is required. Path to the file, URL of
  the failing CI run, link to the transcript line, or a verbatim
  snippet. Without evidence the report is unactionable. The schema
  above shows the canonical list form; a single inline value
  (`evidence: <path-or-url>` on one line) is also accepted as a
  one-entry list — useful when the friction has a single pointer.
- `canonical` — when set, prefer the value of the offending
  component's own `provenance.canonical` block, which is the **repo**
  URL (`https://github.com/<owner>/<repo>`). NOT a file URL: the
  Curator routes the resulting issue via `gh issue create --repo
  <owner>/<repo>`, so a `/blob/<branch>/<path>` URL produces a
  malformed routing target. File paths and line numbers belong in
  `evidence:`. Hand-typing a different repo URL drifts the friction
  away from the component the Curator should route the MR against;
  if the offending component cannot be identified at tag time, leave
  `canonical` empty and let `evidence:` carry the trail.
- `severity` — `high` is reserved for blockers (e.g. agent corrupted
  data, leaked a secret, or violated a stated guarantee). `low` is for
  papercuts. Default `med`.
- `suggestion` — what *you* think would fix it. Optional, but the
  Curator weights MRs higher when one is present.

### Minimal example

```text
FRICTION: Skill prompt suggests yq merge syntax that does not exist on yq v4

writer_agent: claude-code
subcategory: yq-merge
canonical: https://github.com/crewrig/crewrig
severity: med
evidence:
  - artifacts/core/skills/architect/SKILL.md:42
suggestion: Replace `yq m -i` with `yq eval-all '. as $i ireduce ...'`.
```

## What NOT to tag

- One-off mistakes you made that the system did not actively cause —
  those belong in your diary, not in `harness-friction`.
- Bugs in the user's code under review — those belong in the project
  logbook issue.
- Missing features you wished existed — open a GitHub issue against
  the canonical repo instead. Friction reporting is for *defects in
  the agent system itself*, not feature requests.

## Read side

Reading `harness-friction` is the Curator agent's job, not the working
agents'. If you find yourself searching this wing during normal work,
you are off-task. The wing is write-mostly for everyone except the
Curator.
