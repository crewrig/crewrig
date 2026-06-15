---
name: harness-report
description: "Tag a friction encountered during real work. Activate the moment
  any recognition signal fires (user pushback, second-time tool surprise,
  sibling-skill workaround, etc.). The single canonical implementation of
  the friction-tagging protocol — all other skills point here."
type: skill
license: Apache-2.0
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "1.2.2"
claude:
  allowed-tools:
    - Read
  user-invocable: true
---

# Harness Report

The skill every other skill invokes when a friction signal fires. The
protocol contract (payload schema, wing routing, fixed categories,
what NOT to tag) lives in `config/TOOLS.md` → *Friction Reporting*.
This skill is the *operational* counterpart: how to recognize a
signal, how to fill the payload correctly, and especially how to
attribute the friction to the right offender even when you are not
currently operating under that offender's skill.

## When to activate

The moment any recognition signal fires. Listed in canonical form in
`config/TOOLS.md` → *Friction Reporting → Recognition signals*; the
short reminder list:

- **User pushback** — the user contests, corrects, or reverts the
  action you just took, or reformulates the same intent because your
  previous response was misaligned.
- **Sibling-skill workaround** — you find yourself contorting around
  a constraint set by another skill or agent, not the user's request.
- **Tool surprise (second time)** — a tool produced surprising or
  inconsistent behavior for the second time in the same session.
  First time is bad luck; second time is a pattern.
- **Process gap** — a documented workflow step turned out to be
  missing, ambiguous, contradictory, or out of date.
- **Safeguard friction** — a rule or guard blocked a legitimate action
  and forced a workaround you had to explain explicitly to the user.

If a signal fires, **tag the friction before resuming work**. Not
"consider tagging". Not "when convenient". Tagging takes seconds and
costs nothing; failing to tag loses the signal forever.

## Operating mode

### 1. Pause and identify the offender

The trickiest part of friction reporting is **getting the attribution
right**. You are likely operating under some skill X when the friction
manifests, but the *offender* might be:

- Skill X itself (its prompt led you astray).
- A *different* skill or agent you read earlier in the session.
- A document (`AGENTS.md`, a `config/*.md` file).
- A tool (`gh`, `jq`, `yq`, an MCP server).
- A process step in `config/TOOLS.md` or similar.

Before composing the payload, ask yourself: *what specifically led to
the contested action?* Trace the chain backwards from the action to
its closest source. That source is the offender, and its URL or path
belongs in `canonical:` — **never the path to this `harness-report`
skill**, which is just the orchestrator.

If you genuinely cannot pinpoint the offender, leave `canonical:`
empty and let `evidence:` carry the trail. A routing failure (caught
by the Curator at consumption time) is better than a wrong-target MR.

### 2. Pick the room

One of the 5 fixed categories per `config/TOOLS.md`:

- `tool` — an MCP tool, CLI, or script behaved unexpectedly.
- `prompt` — a skill/agent prompt was misleading or led you astray.
- `format` — an output format broke parsing or mixed concerns.
- `behavior` — an agent did something it should not have, or skipped
  something it should have done.
- `process` — a documented workflow step is missing or out of date.

When in doubt between `prompt` and `behavior`: ask whether the prompt
*told* you to do the wrong thing (→ `prompt`) or whether you went off
the prompt's rails on your own (→ `behavior`).

### 3. Fill the payload

Mandatory fields (the script will skip the drawer if either is
missing or empty):

- `writer_agent` — your own identifier (`claude-code`, `gemini-cli`,
  …). Non-empty.
- ≥1 `evidence:` entry — at minimum a file path with line number; a
  commit hash + path + line is better (the file may move but the
  commit is permanent).

Strongly encouraged:

- `subcategory` — a free-form clustering anchor. Frictions sharing a
  `subcategory` get bundled into the same MR by the Curator.
- `canonical` — the canonical **repo** URL of the offending
  component's home, in the GitHub `https://github.com/<owner>/<repo>`
  form (as set in the component's `provenance.canonical` block at
  build time). NOT a file URL: the Curator's apply step routes the
  issue via `gh issue create --repo <owner>/<repo>` by stripping the
  `https://github.com/` prefix (see
  `artifacts/library/skills/harness-curator/scripts/apply.py:23-36`),
  so a `/blob/<branch>/<path>` URL produces a malformed `--repo`
  argument and the issue fails to land. Put the file path in
  `evidence:` instead.
- `severity` — `low` / `med` / `high`. Default `med`. Reserve `high`
  for blockers; it bypasses the cluster threshold and forces an MR.
  See *Reactive trigger for `severity: high`* below — high-severity
  reports SHOULD be surfaced immediately, not deferred to the weekly
  sweep.
- `suggestion` — what you think would fix it. The Curator weighs
  clusters with suggestions higher.

The full schema, including the inline `evidence: <single-value>`
short form, lives in `config/TOOLS.md` → *Payload schema*. Do not
re-derive it here; refer to it.

### 4. Tag

One MCP call. Fire and forget — do not wait for an acknowledgment,
do not block, return to your task:

```text
mempalace_add_drawer(
  wing="harness-friction",
  room="<one of the 5 categories>",
  content="""
FRICTION: <one-line title>

writer_agent: <you>
subcategory: <optional anchor>
canonical: <URL of offender, if known>
severity: <low|med|high — default med>
evidence:
  - <commit_hash>:<path>:<line>
  - <URL>
suggestion: <optional fix idea>
"""
)
```

### 5. Resume

Return to the task that was interrupted by the signal. The friction
is now in the wing; the Curator will pick it up on its next run.

### Reactive trigger for `severity: high`

When you file a `FRICTION:` payload with `severity: high`, you SHOULD
surface it immediately rather than wait for the next scheduled curator
sweep. After the `mempalace_add_drawer` call returns, run:

```bash
bash artifacts/library/skills/harness-curator/scripts/curate.sh --apply --dedup --max-issues 5
```

Dedup is on, so re-running is safe — already-open clusters are skipped.
The curator's high-severity bypass (`cluster_qualifies` in `curate.py`)
promotes the singleton even before a second report arrives. Skip this
step for `low` / `med`: those wait for the weekly sweep.

## Output expectations

- A single `mempalace_add_drawer` MCP call to
  `wing="harness-friction"`. Nothing else — no summary to the user,
  no inline narration. The point of fire-and-forget is to keep the
  flow.
- If the user explicitly asked you to tag a friction, briefly confirm
  it landed (one sentence). Otherwise stay silent.

## Self-reporting bias

A known weakness: the agent who produced the contested action is the
one being asked to tag the friction. Rationalisation is easier than
self-correction. To counteract this:

- **When in doubt, tag.** Over-reporting is curatable; under-reporting
  is lost forever. Curation cost is cheap relative to the cost of an
  unflagged systemic friction.
- **A user correction is always a recognition signal**, even when you
  privately think "the user just changed their mind". The Curator
  will downgrade if the cluster proves to be preference rather than
  defect.

## Friction reporting (recursive)

If `harness-report` itself led to a malformed payload, a wrong
attribution, or made you skip a tag that should have happened — tag
it like any other friction, with `canonical` pointing at this skill's
own URL. The reporter is not exempt from the loop it serves.
