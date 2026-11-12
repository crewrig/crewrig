---
name: spec-author
description: "Qualifies a ticket's intent and drafts one specification file under specs/ (frontmatter, Intent, Requirements, Scenarios, Out of scope, Open questions), or a delta-spec for a spec-class review finding, with a bundled script that secures the spec id first. Use when a non-trivial ticket needs a spec before planning, or the user asks to write, draft or specify a feature, requirements or Given/When/Then scenarios, or to author a delta-spec. Not for implementation plans, ADRs, PR descriptions or commit messages."
license: Apache-2.0
compatibility: "Requires Node.js 24 (scripts run as node scripts/<name>.ts) and git. In the CrewRig repository the script wraps scripts/ticket-pickup.ts and scripts/reserve-spec-id.ts; elsewhere it falls back to a manual id."
allowed-tools:
  - Read
  - Glob
  - Write
  - Bash
user-invocable: true
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "1.12.0"
---


# Spec Author

Turns a raw intent into one draft specification under `specs/` that follows
`docs/spec-format.md`. You own qualification, the question "what does the
user actually want". You do not plan, design or implement: those stages come
after the spec and are judged against it, so a spec that smuggles in a design
choice pre-empts them.

## When to activate

1. The user asks for a spec (`/spec`, optional `--mode=FULL|INTERMEDIATE|MINIMAL|AUTO`
   and `--issue=<number>`). Without `--issue`, infer the ticket from context.
2. The orchestrator routes a fresh ticket that is not `trivial`. Trivial
   tickets skip the spec and are handled inline.
3. A `class: spec` review finding re-invokes you. You then author a
   **delta-spec only**: the approved spec on `main` is immutable, so a
   correction travels as `specs/<NNNN>-<slug>.delta-<NN>.md`. If the request
   has no `class:` tag, or asks you to re-author an existing spec, say so and
   stop: the routing was wrong, and fixing it silently hides the defect.

Inputs: a free-form intent, or `--issue <N>` (read it with
`gh issue view <N> --json title,body,comments`), or the orchestrator's context.

Pick the interaction mode in this order: invocation flag, the parent ticket's
declared mode, then the default **INTERMEDIATE**. AUTO asks no question.

## Workflow

1. **Interview.** Read `references/interview-script.md` before asking anything.
2. **Ownership and id** (new spec): run the script below with `--id-only`.
   For a delta-spec, run `task -x ticket-pickup -- --issue <N>` yourself first
   and stop on any non-zero exit (the script makes no call in delta mode).
3. **Branch.** Cut `spec/<NNNN>-<slug>` in its worktree with that id.
4. **Ground.** Read `references/pre-write-grounding.md` before drafting.
5. **Write.** Run the script again without `--id-only`, then fill the
   skeleton. Read `references/output-contract.md` for the frontmatter, the body
   sections, delta mode and self-validation.
6. **Close the open questions** (below), then self-validate and hand over.

## Script

Run `node <skill-dir>/scripts/scaffold-spec.ts` from the repository root or one
of its worktrees; add `--json` for a machine-readable result.

| Call | Purpose |
|---|---|
| `--issue <N> --slug <slug> --complexity <tier> --mode <mode> --id-only` | Run the ticket pickup check and reserve the id; print the id; write nothing. |
| the same without `--id-only` | Pickup, reservation, then write `specs/<NNNN>-<slug>.md`. |
| `--delta --parent <NNNN> --issue <N>` | Write the next delta-spec of that parent. No tool is called. |
| add `--dry-run` | Run no tool and write nothing; print the path, the content and the commands. |

The slug is ASCII kebab-case, 40 characters at most. Rerunning is safe: the
pickup check passes again for the ticket's owner and the reservation returns
the issue's existing id.

| Exit | Meaning | What you do |
|---|---|---|
| `0` | Done. `data.unsecured` is true when the id could not be secured; the file then carries `unsecured-id: true`. | Continue. Leave that line in place: CI reads it. |
| `1` | A finding, named in `findings[].rule`. `ticket-pickup`: the ticket belongs to someone else or its owner is unknown. `id-reservation`: the reservation failed. `branch-mismatch`: the branch id or slug differs from the reserved one (an unsecured reservation computes a fresh id each time). | Stop and tell the user. Never retry hoping for a different answer, never compute `max(existing) + 1` yourself, never assign or unassign anyone. For `branch-mismatch`, rename the branch to the reserved id and slug, or ask the user. |
| `1` | A refused input: `slug`, `complexity`, `mode`, `target-exists`, `parent-missing`. | Nothing was written and no tool ran. Correct the input and rerun. For `parent-missing` the parent spec is not under `specs/` of this checkout: check the id; if the parent was given to you as a file, write the delta yourself from the output contract. |
| `2` | Usage error. | Fix the call. |
| `3` | The repository tools are absent (not the CrewRig repository, or no repository). | Do the manual equivalent: read the issue's assignees and stop if someone else owns it; take the next unused number after fetching the default branch and checking open pull requests and branches. If the caller gave you the id, use it. Then run with `--dry-run` and write that file yourself with the id in place of `NNNN`; add `unsecured-id: true` to the frontmatter unless the id is known to be secured. |

The ticket assignment, any comment on the issue and the reservation ref are
written by the two repository tools, not by the script. Only the user may tell
you to proceed without the ownership check, and only for that session.

## Open questions

An unresolved entry in `## Open questions` blocks exit in MINIMAL,
INTERMEDIATE and FULL until it is resolved (rewritten as a requirement,
scenario or out-of-scope bullet) or parked with the user's consent, kept in
place with the prefix `[USER-PARKED]`. In AUTO the same applies with no
round-trip: unresolved items get `[AUTO-PARKED]` and the user audits them in
the spec PR. A dropped question comes back as a `spec`-class finding and costs
a whole review iteration, so never drop one silently.

## Self-check on every requirement

Before finalizing, check that each requirement answers the null or degenerate
case (nothing to process, the target already exists) and names a permitted
path, not only what is forbidden. A requirement that states only a prohibition
leaves the implementer to guess the legal route.

## Review findings

You take part in the review loop at both ends. See
`references/shared-finding-class-taxonomy.md` for the `class:` tag rule.

- **As reviewer** of a spec-PR (original or delta), every finding carries one
  `class:` tag, and the pass runs on the `specs/<ticket>` seat described in
  `docs/reviewer-seat.md` (the `seat:` line, `s<N>-F<M>` identifiers). A fresh
  delta-spec PR is a replaced artifact: examine it in full.
- **As the target** of a `spec` finding, work in delta mode only (above).

## Friction

See `references/shared-friction-reporting.md`. These spec-author situations
also call for a `harness-report` tag:

| Situation | `room` |
|---|---|
| The user rewrites the drafted intent twice in a row (the intent question misleads). | `prompt` |
| A draft fails self-validation because `docs/spec-format.md` is ambiguous (subcategory `spec-format`; evidence: the spec path and the sentence). | `format` |
| A malformed existing filename in `specs/` stops id allocation (subcategory `spec-id-allocation`). | `process` |
| In AUTO, more than five questions end up `[AUTO-PARKED]` on one spec: the ticket is ill-defined, suggest INTERMEDIATE. | `behavior` |
| A second `spec`-class review iteration cites a question you already tried to resolve (subcategory `delta-spec-interview`). | `prompt` |
