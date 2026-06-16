---
id: "0038"
slug: review-loop-immediate-launch
delta: "01"
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 315
version: 1.1.0
---

# REVIEW loop must launch immediately after PR creation without prompting the user

## ADDED

(none)

## MODIFIED

**R4** — replace:

> The implementation PR number SHALL be recorded in the `iter:1` label on
> the PR before spawning (per the existing iteration-counter rule in
> `retroactive-loop.md`).

with:

> The `iter:1` label SHALL be applied to the implementation PR before
> spawning the first reviewer. This is the authoritative timing for the first
> iteration label; no prior authority is cited because this delta supersedes
> the conflicting `Initial label` timing in `retroactive-loop.md` (see
> modified R5 below).

**R5** — replace:

> No other section of `retroactive-loop.md` is modified by this spec.

with:

> The implementation of spec 0038 SHALL also amend the `Initial label`
> paragraph in `## Iteration counter — GitHub label` of
> `docs/retroactive-loop.md` to align its timing description with the
> launch-trigger rule (applying `iter:1` before spawning rather than at
> verdict consumption time). No other section of `retroactive-loop.md` is
> modified.

## REMOVED

(none)
