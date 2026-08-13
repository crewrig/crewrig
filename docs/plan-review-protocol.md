<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# Plan review protocol

<!-- crewrig-doc: published=false -->

**Authoring rule.** The plan SHALL be authored by the existing
`architect` role on the team (per *Agent Team Protocol → Standard
Team Templates*); no new specialist role is introduced. The same
`architect` invocation that runs the PLAN stage owns the comment.

**Review rule.** The plan SHALL be reviewed by a **second
`architect`** spawned cold — no authoring context, no prior session
state — to preserve independence. The reviewer posts the review as a
follow-up comment on the same logbook issue. The review header and
verdict line follow `docs/plan-format.md` → *Header conventions*.
When the orchestrator and the reviewer share the same GitHub
identity, the shared-identity workaround from *Standard Team
Templates → Template 1* applies (post the verdict as a regular
comment).

**Finding class taxonomy.** Every plan-review finding SHALL carry
exactly one `class:` field whose value drives the loop target:

- `class: tech` — DEV-stage fix (e.g. a step names the wrong file
  path or omits a required edit).
- `class: arch` — PLAN-stage rework (e.g. the approach is unsound;
  the blast radius missed a downstream consumer).
- `class: spec` — SPECS-stage rework (e.g. a requirement is
  ambiguous; the spec admits the plan but the plan reveals the WHAT
  is under-specified).

The full routing matrix — re-spawn composition, delta-spec impact,
termination — lives in `AGENTS.md` → *Retroactive review loop*; this
list states the taxonomy, not the routing.

**REQUEST CHANGES blocks DEV.** A plan-review verdict of `### Verdict:
REQUEST CHANGES` SHALL block the DEV stage from starting until a
revised plan is posted and re-reviewed cold.

**PLAN-loop cap.** The loop halts when a further plan revision would
exceed the tier's cap (numbers per the ADR-0010 → *Complexity tiers
and team sizing* table, not restated here). On halt, the orchestrator
SHALL post a structured summary on the logbook issue and escalate to
the user regardless of interaction mode; it SHALL NOT auto-approve the
halted plan, and the loop resumes only on explicit user instruction,
which MAY lift the cap for that ticket (R3–R4 of spec 0138). A review
returned for retagging — a malformed verdict per `docs/plan-format.md`
→ *Finding tag schema* and `docs/retroactive-loop.md` → *Class tagging
discipline* — does not count as a revision (R5 of spec 0138). A plan
approved on its first cold review consumes zero revisions.

These clauses bound the plan's size and the loop's length; they remove no item from the reviewer's checklist at any tier.

**Plan-validation gate.** In the modes that gate the PLAN stage (FULL
and INTERMEDIATE per *Interaction modes → Behavioral contract per (mode
× stage) cell*), the user gate that validates the plan comment before
DEV starts is realised through the `user-validate` skill — not through a
direct `AskUserQuestion` call. That keeps the user's configured
validation backend (including `plannotator`) in effect.
