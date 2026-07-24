---
id: "0106"
slug: gate-docs-name-user-validate
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 663
version: 1.0.0
---

# Name the `user-validate` skill as the artifact-validation gate mechanism in point-of-use lifecycle docs

## Intent

When a lifecycle document describes a user gate that validates an artifact —
a spec, a plan, or a set of review findings — the reader (a human, or an
orchestrator agent following the doc) should be pointed to the single
sanctioned gate mechanism, so the user's configured validation experience is
honored and never silently bypassed. Today several point-of-use lifecycle
docs name the raw `AskUserQuestion` primitive as the gate mechanism, which
contradicts the standing rule that artifact-validation gates are realised
through the `user-validate` skill, and has already led an orchestrator to
call `AskUserQuestion` directly for a plan-validation gate — bypassing the
user's configured rich-review backend. This spec makes the point-of-use docs
name `user-validate` as the mechanism for artifact-validation gates and treat
`AskUserQuestion` as merely one backend's realization, while leaving
requirement-elicitation prompts and the merge-authorization request untouched.

## Requirements

1. The point-of-use lifecycle docs SHALL name the `user-validate` skill as the
   mechanism for **artifact-validation user gates** — user gates that present a
   spec, a plan, or a set of review findings to the user for a validation
   decision — rather than naming the raw `AskUserQuestion` primitive as the
   gate mechanism.
2. The point-of-use lifecycle docs SHALL make evident that `AskUserQuestion`
   is the realization of the `user-validate` skill's `internal` backend, not a
   primitive to be invoked directly to realise an artifact-validation user
   gate, consistent with the standing mandate in
   `artifacts/core/rules/60-tools.md` → *User-gate validation backend*.
3. `docs/interaction-modes.md` → *User-gate definition* SHALL be amended so
   that its artifact-validation gate action names the `user-validate` skill as
   its mechanism, SHALL NOT instruct that an INTERMEDIATE or FULL
   artifact-validation gate "MUST be an `AskUserQuestion` call", and SHALL
   preserve the guarantee that such a gate is never realised as a bare prose
   question (spec 0037).
4. `docs/interaction-modes.md` → *User-gate definition* SHALL continue to
   define the pre-merge "may I merge?" authorization request mandated by
   *Branching Strategy* as a distinct user gate that is NOT an
   artifact-validation gate and is NOT realised through the `user-validate`
   skill.
5. In the *Behavioral contract per (mode × stage) cell* matrix of
   `docs/interaction-modes.md`, the PLAN-stage plan-comment validation gate
   (the FULL and INTERMEDIATE cells) SHALL be described as realised through the
   `user-validate` skill, not as a direct `AskUserQuestion` call.
6. In the *Behavioral contract per (mode × stage) cell* matrix and its
   accompanying notes, the FULL-mode REVIEW non-blocking-finding triage gate
   SHALL be described as realised through the `user-validate` skill, not as a
   direct `AskUserQuestion` call.
7. The SPECS-row cells of the *Behavioral contract per (mode × stage) cell*
   matrix SHALL continue to describe the per-interview-turn `spec-author`
   prompts as `AskUserQuestion` (requirement elicitation, not an
   artifact-validation gate) and the spec-PR approval as the
   merge-authorization gate; this spec SHALL NOT convert either of those to a
   `user-validate` gate.
8. `docs/plan-review-protocol.md` SHALL carry a reminder that the PLAN-stage
   user gate validating the plan comment is realised through the
   `user-validate` skill, not through a direct `AskUserQuestion` call.
9. The trivial-tier row of the complexity-tier table in
   `docs/agent-team-protocol.md` SHALL name the artifact-validation gate(s) of
   the declared interaction mode as realised through the `user-validate` skill,
   while preserving the merge-authorization gate as a distinct
   action-authorization that still applies to inline work.
10. The change SHALL be confined to documentation prose in the named
    point-of-use docs (`docs/interaction-modes.md`,
    `docs/plan-review-protocol.md`, `docs/agent-team-protocol.md`) and SHALL
    introduce no code, no configuration, and no build-output changes.

## Scenarios

**Scenario:** An orchestrator is directed to `user-validate` for the plan gate

```text
Given the amended point-of-use lifecycle docs name the `user-validate` skill
      as the mechanism for the PLAN-stage plan-comment validation gate
When  an orchestrator running INTERMEDIATE mode reaches the plan-comment
      validation gate and consults those docs
Then  the docs direct it to invoke the `user-validate` skill — honoring the
      user's configured backend, including `plannotator` — rather than to call
      `AskUserQuestion` directly
```

**Scenario:** No point-of-use doc invites a direct-primitive bypass

```text
Given the docs previously named `AskUserQuestion` as the artifact-validation
      gate action, which invited a direct call that bypassed the user's
      configured `plannotator` backend (the friction reported in issue #663)
When  a reader consults any of the amended point-of-use lifecycle docs at an
      artifact-validation gate
Then  no such doc names the raw `AskUserQuestion` primitive as the
      artifact-validation gate mechanism, so the configured backend is not
      silently bypassed
```

**Scenario:** Elicitation prompts and the merge gate are preserved

```text
Given the amendment names the `user-validate` skill for artifact-validation
      gates only
When  a reader consults the SPECS-row matrix cells or the pre-merge
      authorization request in *User-gate definition*
Then  the `spec-author` interview turns still read as `AskUserQuestion`
      (requirement elicitation) and the merge-authorization gate still reads as
      a distinct action-authorization, neither of them converted to a
      `user-validate` gate
```

## Out of scope

- The `internal`-backend description in `docs/cli-matrix.md` row 27b and its
  `[GAP-confirmation]` note. That row correctly documents `AskUserQuestion` as
  the `internal` backend's realization; this spec does not change it.
- The enumeration in `artifacts/core/rules/60-tools.md` → *User-gate validation
  backend* that names `AskUserQuestion` as the `internal` default-floor backend.
  That statement is correct and stays; this spec aligns the point-of-use docs
  with the mandate that file already sets, rather than editing the mandate.
- `artifacts/library/skills/user-validate/SKILL.md`. The skill's own
  `internal`-backend documentation — the `AskUserQuestion` realization and the
  non-Claude structured-equivalent gap — is correct and is not touched.
- The `spec-author` requirement-elicitation interview turns
  (`artifacts/core/skills/spec-author/SKILL.md` and the SPECS-row
  "`AskUserQuestion` per interview turn" wording in the interaction-modes
  matrix). These are requirement **elicitation**, not artifact-validation gates,
  and they remain `AskUserQuestion`. The SPECS-stage **approval** of a spec is
  the spec-PR merge, gated by the merge-authorization request below — not a
  `user-validate` gate — so the SPECS matrix cell is deliberately left
  unchanged and MUST NOT be over-edited.
- The merge-authorization ("may I merge?") gate defined in *Branching Strategy*
  and appearing in the SPECS/DEV matrix cells, the invariant-across-modes note,
  and the trivial-tier row. It is a simple action-authorization, not an
  artifact-validation gate, and is not realised through `user-validate`; it is
  preserved wherever it appears.
- Any change to the `user-validate` skill itself — its backends, its
  backend-selection logic, its invocation command, its decision mapping, or the
  semantics of `validation.conf`. This spec redirects the point-of-use docs to
  the skill; it does not modify the skill.
- Any change to the `plannotator` backend, to the `AskUserQuestion` /
  `internal` backend realization, or to the set of user gates, their blocking
  semantics, or their mode-conditional firing. This spec renames the mechanism
  the docs cite at artifact-validation gates; it adds, removes, or re-times no
  gate.
- New tooling or automated enforcement — for example a linter check that no
  point-of-use doc names `AskUserQuestion` as the mechanism for an
  artifact-validation gate. This spec amends the written process docs only.
- Code changes of any kind and build-output regeneration. The target files are
  `docs/*.md`, not `artifacts/**`, so no `scripts/build-components.sh` run is
  required. *CLI Matrix Maintenance* applies only if a matrix-governed path is
  actually touched; this spec touches none (and `docs/cli-matrix.md` row 27b is
  explicitly excluded above), so no `docs/cli-matrix.md` update is entailed.

## Open questions

None outstanding. Three boundary decisions were resolved during authoring by
explicit exclusion rather than left open: (1) the `spec-author` interview turns
are requirement elicitation, not artifact-validation gates, so they stay
`AskUserQuestion` and the SPECS matrix cell is not converted; (2) the
merge-authorization "may I merge?" gate is an action-authorization, not an
artifact-validation gate, and is not realised through `user-validate`; (3) the
`internal`-backend descriptions in `docs/cli-matrix.md`,
`artifacts/core/rules/60-tools.md`, and the `user-validate` skill correctly
present `AskUserQuestion` as that backend's realization and are left untouched.
