---
id: "0080"
slug: configurable-validation-backend
status: draft
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 557
version: 1.0.0
---

# Configurable user-gate validation backend

## Intent

When a workflow asks the user to validate an artifact — a spec, a plan, or any
document — the user can choose between a rich visual review experience and a
simpler built-in prompt, and can tune how much context and explanation each
request carries, so that answering a validation request costs less effort and is
more likely to be completed. When the rich experience is unavailable the request
still completes through the simpler prompt without losing the gate. The same
validation capability is offered once and is reusable by CrewRig's own lifecycle
stages and by any workflow beyond it.

## Requirements

1. The framework SHALL offer two user-gate validation backends: `plannotator`
   (opt-in) and `internal` (the default fallback backend).
2. The active backend SHALL be selectable at configuration time through the
   `setup-*-interactive.sh` scripts.
3. Backend selection SHALL be available symmetrically across all four supported
   CLIs — Claude Code, Gemini CLI, GitHub Copilot CLI, and Antigravity CLI — and
   SHALL NOT introduce a silent parity asymmetry.
4. When `plannotator` is the selected backend but its binary is absent from PATH
   at gate time (presence detected by `plannotator --version`), the agent SHALL
   fall back to the `internal` backend and SHALL inform the user of the fallback.
5. The `internal` backend SHALL realise a gate through `AskUserQuestion` (or the
   host CLI's equivalent interactive prompt) and SHALL NOT realise a gate as a
   prose question — consistent with, and not weakening,
   [`specs/0037-validation-gate-must-use-askuserquestion.md`](0037-validation-gate-must-use-askuserquestion.md).
6. The `plannotator` backend SHALL invoke `plannotator annotate <artifact-file>
   --gate --json`, passing the artifact to validate as a file argument.
7. The `plannotator` backend SHALL treat a decision as complete only when BOTH
   the process exit status is zero AND stdout carries a valid gate JSON object; a
   nonzero exit status OR absent/malformed stdout SHALL be treated as
   non-approval.
8. The `plannotator` backend SHALL map the returned decision as follows:
   `approved` → pass (proceed); `annotated` → changes-requested, carrying the
   returned `feedback` text to the upstream stage; `dismissed` → non-approval (do
   not proceed).
9. A single canonical skill named `user-validate` SHALL be the sole
   implementation of the gate protocol; CrewRig lifecycle stages and any external
   workflow SHALL invoke `user-validate` rather than reimplementing the protocol
   inline.
10. Per invocation, `user-validate` SHALL accept the artifact (or element) to
    validate and the precise ask, and SHALL return a structured outcome that is
    exactly one of: approved, changes-requested (with feedback), or rejected.
11. The `setup-*-interactive.sh` scripts SHALL capture three cross-cutting
    options at opt-in time: (a) translation of spec/plan documents into the
    user's preferred language (on/off); (b) pedagogy level, one of `simple`,
    `contextual`, or `professor`; (c) illustration generation (on/off).
12. Translation, when enabled, SHALL apply ONLY to the transient gate
    presentation shown to the user; repository artifacts SHALL remain in English
    per the `AGENTS.md` → *Language* rule.
13. The pedagogy level SHALL determine the framing of each validation request:
    `simple` presents brief context plus the user's role; `contextual` presents
    the global context, the concerned part, and the precise ask; `professor`
    presents a full pedagogical re-explanation of the arbitration situation.
14. Illustration generation SHALL be honoured ONLY when the backend is
    `plannotator` AND an image-displaying surface is available; otherwise it SHALL
    be silently ignored. When honoured, it SHALL be best-effort using an available
    image-generation tool.
15. Per-user backend and option selections SHALL NOT be written into any
    core-layer file; the core rule `artifacts/core/rules/60-tools.md` SHALL carry
    only the static protocol — both backends, the three options, and how to
    discover the active configuration.
16. Per-user selections SHALL be persisted in the overlay layer by the
    `setup-*-interactive.sh` scripts and SHALL be discoverable by the agent at
    gate time.
17. The change SHALL update `docs/cli-matrix.md` with the per-CLI integration
    points and any accepted parity gaps, per the CLI-matrix maintenance protocol.

## Scenarios

**Scenario:** Plannotator backend, reviewer approves

Given the user opted into the `plannotator` backend at setup time
And a PLAN gate fires for an artifact `plan.md`
When `user-validate` runs `plannotator annotate plan.md --gate --json`
And the reviewer clicks Approve in the browser annotation UI
Then stdout is `{"decision":"approved"}` with exit status 0
And the gate passes
And the DEV stage proceeds

**Scenario:** Internal backend with contextual pedagogy

Given the user is on the `internal` backend with pedagogy level `contextual`
And a SPECS gate fires
When `user-validate` issues an `AskUserQuestion` whose framing recalls the global
context, the concerned part, and the precise ask
And the user selects Approve
Then the gate passes
And no prose question was used to realise the gate

**Scenario:** Plannotator binary absent — graceful fallback

Given the selected backend is `plannotator`
And `plannotator --version` fails because the binary is absent from PATH
When a gate fires
Then the agent falls back to the `internal` backend
And the agent informs the user of the fallback
And the gate still completes

**Scenario:** Plannotator returns annotated feedback

Given the `plannotator` backend is active
And the reviewer annotates the artifact rather than approving it
When `plannotator annotate <artifact-file> --gate --json` returns
`{"decision":"annotated","feedback":"<feedback text>"}` with exit status 0
Then the gate reports changes-requested
And the returned `feedback` is routed to the upstream stage for revision

**Scenario:** Dismissed decision or nonzero exit — non-approval

Given the `plannotator` backend is active
When the invocation returns `{"decision":"dismissed"}`, OR exits with a nonzero
status, OR produces absent/malformed stdout
Then the outcome is treated as non-approval
And the agent does not proceed
And the agent surfaces the situation to the user

**Scenario:** Translation applied to the presentation only

Given the translation option is enabled and the user's preferred language is not
English
And a SPECS gate fires for an English spec file
When `user-validate` presents the artifact for validation
Then the artifact copy shown to the user is translated into the preferred language
And the committed spec file in the repository remains in English

## Out of scope

- Reimplementing Plannotator's own hooks, skills, or commands — its installer
  owns and deploys those for detected agents.
- Adding an MCP-server backend for Plannotator — none exists today; the
  Plannotator surface is CLI-only.
- Changing the existing user-gate definition or the invariant merge-authorization
  gate; spec 0037 and the interaction-modes contract stand unchanged.
- Choosing the exact overlay persistence mechanism for the per-user selections —
  this is decided at the PLAN stage (see *Open questions*).
- Guaranteeing image display on any specific CLI surface; illustration generation
  is best-effort and silently ignored where unsupported (R14).

## Open questions

- [USER-PARKED] Deferred to PLAN: how to reconcile the Claude Code Bash-tool
  600000 ms (10-minute) ceiling with a synchronous, blocking `plannotator` gate,
  given human review can run far longer (Plannotator's native plan hooks allow
  345600 s / 4 days). Candidate directions: async handoff, leaning on
  Plannotator's native hook path, or documenting the constraint. A real friction
  already hit in another project.
- [USER-PARKED] Deferred to PLAN: the exact overlay persistence mechanism for the
  per-user selections (a generated priority-62 rule file vs a dedicated config
  file vs settings environment variables). R15 and R16 fix the layering
  constraint (core carries the static protocol; overlay carries the selections)
  but deliberately leave the mechanism to PLAN.
- [USER-PARKED] Deferred to PLAN: should a `dismissed` decision abort the workflow
  or re-prompt the user? R8 currently maps `dismissed` to non-approval / do-not-
  proceed; the abort-vs-re-prompt behaviour is unresolved.
- [USER-PARKED] Deferred to PLAN: per-CLI availability of an image-displaying
  Plannotator surface across the four CLIs, which conditions how the illustration
  option (R14) behaves on each CLI and what parity gaps R17 must record.
