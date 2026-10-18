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
    version: "1.5.2"
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
"consider tagging". Not "when convenient". Tagging normally takes
seconds and costs nothing — the one exception is when the MemPalace
write path is unavailable (a peer holds the write lock, or the server
is disconnected), a documented failure mode with a fallback in step 4
(`references/operating-mode.md`). Failing to tag loses the signal forever.

## Operating mode

### 1. Pause and identify the offender

### 2. Pick the room

Read `references/identify-and-route.md` for steps 1-2.

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
  See *Reactive trigger for `severity: high`* in
  `references/operating-mode.md` — high-severity
  reports SHOULD be surfaced immediately, not deferred to the weekly
  sweep.
- `suggestion` — what you think would fix it. The Curator weighs
  clusters with suggestions higher.

The full schema, including the inline `evidence: <single-value>`
short form, lives in `config/TOOLS.md` → *Payload schema*. Do not
re-derive it here; refer to it.

### 4. Tag

### 5. Resume

Read `references/operating-mode.md` for steps 4-5 and the reactive trigger for `severity: high`.

## Output expectations

- A single `mempalace_add_drawer` MCP call to
  `wing="harness-friction"`. Nothing else — no summary to the user,
  no inline narration. The point of fire-and-forget is to keep the
  flow.
- If the user explicitly asked you to tag a friction, briefly confirm
  it landed (one sentence). Otherwise stay silent.

## Self-reporting bias

Read `references/self-reporting-bias.md` at the Resume step.

## Friction reporting (recursive)

If `harness-report` itself led to a malformed payload, a wrong
attribution, or made you skip a tag that should have happened — tag
it like any other friction, with `canonical` pointing at this skill's
own URL. The reporter is not exempt from the loop it serves.
