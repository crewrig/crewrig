---
name: harness-report
description: 'Tags a friction met during real work as a FRICTION payload in the harness-friction wing, attributed to the component that caused it, so the curator can turn it into a feedback issue. Use when a recognition signal fires: the user corrects or reverts an action, a tool surprises a second time, a rule forces a workaround, a documented step is missing or wrong, or a prompt misled. Trigger terms: friction, harness feedback, tag a friction, user pushback, tool surprise, workaround. Not for filing a product bug on the forge (use the forge CLI) or for clustering accumulated frictions (harness-curator).'
type: skill
license: Apache-2.0
compatibility: Requires Node.js 24 or later for the bundled friction script and the mempalace MCP server for the normal write; without the server the friction is filed directly on the offender's forge through gh, glab or tea.
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "2.0.0"
claude:
  allowed-tools:
    - Read
    - Bash
  user-invocable: true
---

# Harness Report

A friction that is not tagged misleads the next agent the same way, and the maintainers never learn of it.
This skill is the one place that says how to tag it: recognise the signal, attribute the friction to the
right offender, build a valid payload, file it, and go back to the task.

## Recognition signals

Tag before resuming work, not when convenient: a tag costs seconds, a lost signal is lost for good.

- **User pushback:** the user contests, corrects or reverts what you just did, or restates the same intent
  because your answer missed. A correction always counts, even when it looks like a change of mind; the
  curator downgrades preference from defect, you do not have to.
- **Sibling-skill workaround:** you contort around a constraint set by another skill or agent, not by the
  user's request.
- **Tool surprise, second time:** a tool behaved surprisingly or inconsistently for the second time in the
  session. The first time is bad luck, the second a pattern.
- **Process gap:** a documented step is missing, ambiguous, contradictory or out of date.
- **Safeguard friction:** a rule or guard blocked a legitimate action and you had to explain the workaround.

When unsure, tag: curation discards noise, whereas silence cannot be recovered.

## Step 1: identify the offender and the room

Read `references/identify-and-route.md`. The offender is the closest source of the contested action, which
is often not the skill you were running, and never this skill. The room is one of `tool`, `prompt`,
`format`, `behavior`, `process`.

## Step 2: build the payload

```sh
node scripts/friction.ts build --title "<one line>" --room <room> --writer-agent <your id> \
  --evidence "<commit>:<path>:<line>" --canonical <repo url> [--severity low|med|high] \
  [--subcategory <anchor>] [--suggestion "<fix idea>"]
```

It prints the payload on stdout. Exit `0` is a valid payload, `1` an error finding whose message states the
fix (a missing `writer_agent` or evidence entry, a bad room or severity, a file URL as canonical), `2` a
usage error. Use `node scripts/friction.ts validate <file|->` for a payload written by hand.

Choosing the values:

- `writer_agent` is your own identifier (`claude-code`, `gemini-cli`). Evidence needs at least a file path
  and a line; a commit hash in front survives the file moving.
- `canonical` is the offender's repository root, `https://github.com/<owner>/<repo>`, never a file URL: the
  curator routes the issue by stripping the host, so a `/blob/` URL breaks the route. The file path goes in
  evidence. Leave it empty if you cannot name the offender; a routing failure beats a wrong target.
- `severity` defaults to `med`. `high` is for blockers and forces the curator to promote the friction
  without a second report.
- `subcategory` bundles frictions of one cause into one issue; `suggestion` helps the curator weigh the cluster.

## Step 3: file it

One MCP call, fire and forget, no summary to the user:

```text
mempalace_add_drawer(wing="harness-friction", room="<room>", content="<the payload>")
```

If the call is refused or the server is unreachable, read `references/operating-mode.md` for the fallback
that files the friction directly on the offender's forge. If the user asked you to tag it, confirm in one
sentence that it landed; otherwise stay silent.

## Step 4: resume

Return to the interrupted task. For `severity: high`, `references/operating-mode.md` says how to surface it
without waiting for the weekly sweep.

If this skill itself led to a malformed payload or a wrong attribution, tag that too, with `canonical` set to
this skill's own repository.
