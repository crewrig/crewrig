---
name: harness-report
description: 'Tags a friction met during real work as a FRICTION payload in the harness-friction wing, attributed to the component that caused it, so the curator can turn it into a feedback issue. Use when a recognition signal fires: the user corrects or reverts an action, a tool surprises a second time, a rule forces a workaround, a documented step is missing or wrong, or a prompt misled. Also use to file the friction as an issue on the offender''s repository when MemPalace is unreachable. Trigger terms: friction, harness feedback, tag a friction, user pushback, tool surprise, workaround. Not for filing a product bug unrelated to the harness (use the forge CLI) or for clustering accumulated frictions (harness-curator).'
type: skill
license: Apache-2.0
compatibility: Requires Node.js 24 or later for the bundled friction script and the mempalace MCP server for the normal write; without the server the friction is filed directly on the offender's forge through gh, glab or tea.
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "2.1.0"
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

Build the payload with the flags `resolve` printed. Read `references/provenance-and-values.md` only when
`resolve` exits `1`, when its flags leave a field empty, or when you must choose a value (`canonical`,
`feedback`, `severity`, `subcategory`) that no flag supplies:

```sh
node scripts/friction.ts resolve <offender path> [--hook <id> | --server <name>]
node scripts/friction.ts build --title "<one line>" --room <room> --writer-agent <your id> \
  --evidence "<commit>:<path>:<line>" [--package <name> --extension <name> --version <semver>] \
  [--canonical <repo url>] [--feedback <repo url>] [--severity low|med|high] \
  [--subcategory <anchor>] [--suggestion "<fix idea>"]
```

`build` prints the payload on stdout. Exit `0` is a valid payload, `1` an error finding whose message states
the fix, `2` a usage error. Use `node scripts/friction.ts validate <file|->` for a payload written by hand.

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
