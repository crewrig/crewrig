<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# Interaction modes

<!-- crewrig-doc: published=false -->

## User-gate definition

A **user gate** is defined narrowly as one of two actions:

1. An **artifact-validation gate** — presenting a spec, a plan, or a set
   of REVIEW findings to the user for a validation decision — realised
   through the `user-validate` skill. The skill dispatches to the
   configured backend; the default-floor (`internal`) backend realizes the
   gate as a call to `AskUserQuestion` (or the equivalent interactive
   prompt exposed by the host CLI), while an opt-in backend such as
   `plannotator` realizes it as a rich browser review. Agents invoke the
   skill; they do NOT call `AskUserQuestion` directly to realise such a
   gate.
2. The pre-merge authorization request mandated by *Branching
   Strategy* — the explicit "may I merge?" question the agent MUST
   ask JUST BEFORE every `gh pr merge` invocation. This is a distinct
   action-authorization, NOT an artifact-validation gate, and is NOT
   realised through the `user-validate` skill.

Both gates **block** agent execution until the user responds. Nothing
else does. **A prose question or status message directed at the user is
NOT a gate, even when it ends with `?`. The host CLI's text-output
guidance biases toward prose communication; that bias does NOT override
this contract. Every INTERMEDIATE or FULL mode artifact-validation gate
SHALL NOT be realised as a bare prose question — it MUST be realised
through the `user-validate` skill.**

The following outputs are explicitly **NOT** user gates and
SHALL NOT pause the agent:

- Logbook comments (per *Logbook Issues → Rule B*) — informational.
- Progress messages and intermediate `SendMessage` traffic between
  teammates — coordination, not consent.
- Idle notifications, status pings, and harness-level events —
  observational.
- ADR drafts, plan comments, review verdicts posted to a PR or issue
  — artifacts of stage execution, audited asynchronously.

The mode table above governs only the two gating actions. Whether the
agent posts ADRs, plan comments, or REVIEW iteration notices in a
given mode is fixed by the lifecycle contract (ADR-0010), independent
of mode.

## Behavioral contract per (mode × stage) cell

Each cell below names precisely the user gates the orchestrator SHALL
fire while running that stage in that mode. "—" means no gate; the
stage runs autonomously and the user is informed (if at all) only via
non-blocking artifacts (logbook comments, PR/spec-PR diffs to audit
post hoc).

| Stage \ Mode | FULL | INTERMEDIATE | MINIMAL | AUTO |
|---|---|---|---|---|
| **SPECS** | `AskUserQuestion` per interview turn during `spec-author`; merge-authorization gate before merging the spec-PR. | `AskUserQuestion` per interview turn during `spec-author`; merge-authorization gate before merging the spec-PR. | `AskUserQuestion` per interview turn during `spec-author`; merge-authorization gate before merging the spec-PR. | No interview gate (spec authored autonomously); merge-authorization gate before merging the spec-PR. |
| **PLAN** | Validate the plan comment through the `user-validate` skill before DEV starts; second `architect` cold-review remains autonomous. | Validate the plan comment through the `user-validate` skill before DEV starts; second `architect` cold-review remains autonomous. | — (plan authored and cold-reviewed autonomously; DEV starts on APPROVE without user prompt). | — (plan authored and cold-reviewed autonomously). |
| **DEV** | Merge-authorization gate before merging the implementation-PR (and before merging any delta-spec PR produced by the loop). | Merge-authorization gate before merging the implementation-PR (and before merging any delta-spec PR produced by the loop). | Merge-authorization gate before merging the implementation-PR (and before merging any delta-spec PR produced by the loop). | Merge-authorization gate before merging the implementation-PR (and before merging any delta-spec PR produced by the loop). |
| **REVIEW** | Non-blocking notification posted on the logbook issue at the start and end of every iteration (per the FULL-mode rule above), **plus** a bounded triage of the non-blocking findings of each pass realised through the `user-validate` skill (spec 0006 R10 / spec 0005 R10 FULL branch). That triage is the sole REVIEW-loop gate. | — (loop runs autonomously; iteration count visible via the `iter:N` PR label). | — (loop runs autonomously). | — (loop runs autonomously; halt at max-iteration guardrail pages the user per *Retroactive review loop*). |

Notes on the matrix:

- The merge-authorization gate is **invariant across modes**: every
  mode, including AUTO, MUST ask the user before any `gh pr merge`.
  *Branching Strategy* is not waivable.
- FULL-mode REVIEW notifications are non-blocking — posting them does
  not pause the loop. The one FULL-mode REVIEW gate is the bounded
  non-blocking-finding triage realised through the `user-validate` skill
  (spec 0006 R10), under which only FULL consults the user on optional
  findings; INTERMEDIATE, MINIMAL, and AUTO fire no REVIEW gate. The
  per-iteration notifications themselves are not gates.
- The max-iteration guardrail (*Retroactive review loop*) pages the
  user in **every** mode, including AUTO. That paging is a gate by
  exception — the loop has halted and the user must decide whether
  to relax the iteration cap, accept the partial work, or close the
  ticket. It is not part of the steady-state matrix above.
