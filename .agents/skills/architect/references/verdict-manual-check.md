# Manual check of a plan or spec review verdict

Contents: [When to use it](#when-to-use-it) · [The checklist](#the-checklist) · [Size](#size)

## When to use it

Use this checklist when the `lint-verdict.ts` script of the `pr-reviewer` skill is not available (the skill is not installed next to this one), and say in the verdict that the manual check replaced the script. A check skipped silently leaves a malformed verdict for the routing step to trip over: a finding without its class tag costs a round trip.

## The checklist

Read the verdict body once, ignoring anything inside a code fence, and confirm each point:

1. **Header.** A plan review opens with `## PLAN review of v<N> — issue #<issue>` (or without `of v<N>` on the first pass), then a `### Verdict: …` line that says `APPROVE` or `REQUEST CHANGES`.
2. **Seat line.** The line `seat: plan/<ticket>` (or `seat: specs/<ticket>` for a spec review) follows the `### Verdict: …` line directly, on its own line. The surface in the seat line is the one reviewed, whatever the place the verdict is posted.
3. **Identifiers.** Every finding carries an identifier in its heading: `v<N>-F<M>` on a plan review, `s<N>-F<M>` on a spec review, where `<N>` is the pass ordinal. A lowercase letter after `<M>` marks a sub-finding (`v1-F2a`). No identifier appears twice.
4. **Class.** Every finding, blocking or not, has exactly one line `class: tech`, `class: arch` or `class: spec`. A heading above several findings does not tag them: tag each one.
5. **Prior findings.** From the second pass, the first section is an audit that names every prior identifier and says whether its disposition is accepted. A prior finding that is not addressed prevents an approving verdict.
6. **Grounding.** Every claim about a file, a count or a command cites the path, the command or the sentence of the brief it comes from.

## Size

A plan or verdict comment stays within 12288 bytes. Check it with `wc -c < comment.md`: the count must not exceed 12288. Move bulk to a linked artifact when it does.
