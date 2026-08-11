<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# Interaction modes

<!-- crewrig-doc: published=false -->

## Modes and Rules

The lifecycle runs in one of four modes. Mode controls *user gating*, not stage execution — every mode runs all four stages.

| Mode | SPECS | PLAN | REVIEW loop |
|---|---|---|---|
| **FULL** | user interactive + validation | user interactive + validation | user notified at each iteration |
| **INTERMEDIATE** | user interactive + validation | user interactive + validation | autonomous |
| **MINIMAL** | user interactive + validation | autonomous | autonomous |
| **AUTO** | LLM-authored, no user gate | autonomous | autonomous |

Rules:

- Default mode is **INTERMEDIATE**.
- In FULL mode, the orchestrator MUST post a notification on the logbook issue at the start and end of every REVIEW iteration. "Notify" is non-blocking; it does not gate the next iteration.

The mode-driven engine — argument parsing, gate enforcement, user notification surface — lands in #173.

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

**Narrow discharge carve-out.** A SPECS-stage content-approval — the
artifact-validation gate (realised through the `user-validate` skill) that
validates a spec's content — of spec content that becomes a
**one-file spec-PR** (per the Spec-PR workflow *one-file rule*: exactly one
new file, no other edits) merging that content **unchanged** discharges the
pre-merge merge-authorization gate for that spec-PR. The orchestrator SHALL
NOT fire a second merge-authorization request for such a spec-PR, because
the artifact merged to `main` is the identical, unchanged artifact the
content-approval already approved. The lifecycle-metadata transition
(`status` and `interaction-mode`) mandated by `docs/spec-format.md` is
explicitly NOT a content change and does NOT forfeit this
merge-authorization discharge. This discharge is deliberately narrow —
it is not a general waiver of the gate. It does **not** apply in `AUTO`,
where no SPECS-stage content-approval gate runs to discharge it, so the
merge-authorization request there still fires and remains the sole approval
event. And the merge-authorization gate stays mandatory and separate for
every merge the carve-out does not cover — implementation-PRs, any
delta-spec PR whose content changed after its own content-approval, and
every non-spec-PR merge.

## Behavioral contract per (mode × stage) cell

Each cell below names precisely the user gates the orchestrator SHALL
fire while running that stage in that mode. "—" means no gate; the
stage runs autonomously and the user is informed (if at all) only via
non-blocking artifacts (logbook comments, PR/spec-PR diffs to audit
post hoc).

| Stage \ Mode | FULL | INTERMEDIATE | MINIMAL | AUTO |
|---|---|---|---|---|
| **SPECS** | `AskUserQuestion` per interview turn during `spec-author`; the SPECS-stage content-approval of the spec content discharges the resulting one-file spec-PR's merge-authorization gate (see *User-gate definition*), so no second ask fires for it. | `AskUserQuestion` per interview turn during `spec-author`; the SPECS-stage content-approval of the spec content discharges the resulting one-file spec-PR's merge-authorization gate (see *User-gate definition*), so no second ask fires for it. | `AskUserQuestion` per interview turn during `spec-author`; the SPECS-stage content-approval of the spec content discharges the resulting one-file spec-PR's merge-authorization gate (see *User-gate definition*), so no second ask fires for it. | No interview gate (spec authored autonomously); merge-authorization gate before merging the spec-PR — no SPECS-stage content-approval runs to discharge it. |
| **PLAN** | Validate the plan comment through the `user-validate` skill before DEV starts; second `architect` cold-review remains autonomous. | Validate the plan comment through the `user-validate` skill before DEV starts; second `architect` cold-review remains autonomous. | — (plan authored and cold-reviewed autonomously; DEV starts on APPROVE without user prompt). | — (plan authored and cold-reviewed autonomously). |
| **DEV** | Merge-authorization gate before merging the implementation-PR (and before merging any delta-spec PR whose content changed after its own content-approval; an unchanged one-file delta-spec PR is discharged per *User-gate definition*). | Merge-authorization gate before merging the implementation-PR (and before merging any delta-spec PR whose content changed after its own content-approval; an unchanged one-file delta-spec PR is discharged per *User-gate definition*). | Merge-authorization gate before merging the implementation-PR (and before merging any delta-spec PR whose content changed after its own content-approval; an unchanged one-file delta-spec PR is discharged per *User-gate definition*). | Merge-authorization gate before merging the implementation-PR (and before merging any delta-spec PR produced by the loop). |
| **REVIEW** | Non-blocking notification posted on the logbook issue at the start and end of every iteration (per the FULL-mode rule above), **plus** a bounded triage of the non-blocking findings of each pass realised through the `user-validate` skill (spec 0006 R10 / spec 0005 R10 FULL branch). That triage is the sole REVIEW-loop gate. | — (loop runs autonomously; iteration count visible via the `iter:N` PR label). | — (loop runs autonomously). | — (loop runs autonomously; halt at max-iteration guardrail pages the user per *Retroactive review loop*). |

Notes on the matrix:

- The merge-authorization gate is **mandatory and un-waived for every
  merge the one-file spec-PR discharge does not cover**: in every mode,
  including AUTO, the agent MUST ask the user before any `gh pr merge` of
  an implementation-PR, a delta-spec PR whose content changed after its
  own content-approval, or any other non-spec-PR — *Branching Strategy*
  is not waivable for those merges. The sole exception is the narrow
  discharge defined under *User-gate definition*: a one-file spec-PR's
  merge-authorization request is discharged by a prior SPECS-stage
  content-approval of the identical, unchanged spec content, so it is not
  fired a second time. That discharge is not a general waiver of the gate,
  and it does not apply in AUTO, where no content-approval runs to
  discharge it.
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
