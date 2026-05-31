---
id: "0002"
slug: spec-author-skill
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 168
version: 1.0.0
---

# `spec-author` skill and slim agent counterpart

## Intent

An author working on a non-trivial CrewRig ticket has a single,
mode-aware authoring surface that turns their raw intent into a draft
specification file under `/specs/` conforming to `docs/spec-format.md`.
Whether the author invokes the surface explicitly, is routed to it by
the orchestrator at the start of a ticket, or re-enters it after a
`spec`-class REVIEW finding, the qualification experience is the same:
a structured interview proportioned to the chosen interaction mode, an
explicit gate on unresolved questions, and exactly one Markdown artefact
that the rest of the lifecycle can consume without rework.

## Requirements

1. The repository SHALL contain a fat skill at
   `community-config/skills/spec-author/SKILL.md` and a slim agent
   wrapper at `community-config/agents/spec-author/AGENT.md`, both
   carrying `metadata.provenance.version: 1.0.0`.
2. The skill SHALL activate on any of the following triggers: an
   explicit user invocation (e.g. `/spec`), orchestrator routing of a
   fresh ticket whose complexity tier is not `trivial`, or a
   `spec`-class REVIEW finding on a ticket that already has a parent
   spec.
3. The skill SHALL support the four interaction modes `FULL`,
   `INTERMEDIATE`, `MINIMAL`, and `AUTO`, and SHALL select the mode in
   priority order: explicit invocation flag, parent ticket's declared
   mode, framework default `INTERMEDIATE`.
4. The skill MUST conduct a mode-keyed interview: zero questions in
   `AUTO`, three questions in `MINIMAL`, six questions in
   `INTERMEDIATE`, and `INTERMEDIATE` plus per-section sign-off in
   `FULL`.
5. The skill SHALL emit exactly one new Markdown file per invocation:
   `/specs/<NNNN>-<slug>.md` for an original spec, or
   `/specs/<NNNN>-<slug>.delta-<NN>.md` when a parent spec for the
   ticket already exists.
6. The skill MUST allocate `<NNNN>` as the next free monotonic id
   across `/specs/`, zero-padded to four digits, computed by listing
   numbered files (excluding `_template.md`, `README.md`, and
   `*.delta-*.md`), parsing each prefix, and selecting
   `max(existing) + 1` (or `0001` when none exist), and SHALL NOT
   reuse an id from an archived or superseded spec.
7. The skill MUST populate every required frontmatter field defined in
   `docs/spec-format.md` and SHALL ensure the filename slug matches
   the frontmatter `slug` exactly.
8. The skill MUST emit the five mandatory body sections `## Intent`,
   `## Requirements`, `## Scenarios`, `## Out of scope`, and
   `## Open questions`, in that order, with heading text verbatim;
   `## Requirements` SHALL contain only lines using `SHALL` or `MUST`,
   and `## Scenarios` SHALL contain at least one happy-path and at
   least one failure-path scenario in Given/When/Then form.
9. In delta mode, the skill MUST emit the three delta sections
   `### ADDED`, `### MODIFIED`, and `### REMOVED` in that order, all
   present even when empty, in place of the five mandatory body
   sections.
10. In `MINIMAL`, `INTERMEDIATE`, and `FULL` modes, the skill SHALL
    block exit while any entry in `## Open questions` is unresolved,
    until the entry is either rewritten as a requirement, scenario, or
    out-of-scope bullet, or explicitly parked with the user's recorded
    consent under the `[USER-PARKED]` prefix; in `AUTO` mode the skill
    SHALL apply the same discipline with no user round-trip, parking
    unresolved items under the `[AUTO-PARKED]` prefix.
11. The skill MUST self-validate the drafted file before writing by
    re-reading `docs/spec-format.md` and confirming locally that all
    five headings are present in order, the frontmatter parses as
    YAML, and every required field has a value of the right type.
12. The skill SHALL invoke the `harness-report` skill — rather than
    reimplement the protocol inline — whenever any of the
    spec-author-specific friction triggers fires (twice-rewritten
    intent; self-validation failure root-caused to ambiguous
    `docs/spec-format.md` wording; malformed `<NNNN>` in `/specs/`;
    more than five `[AUTO-PARKED]` items in `AUTO` mode; a repeat
    `spec`-class finding citing a question the prior interview pass
    already attempted).
13. The slim `AGENT.md` MUST delegate operational detail to the skill,
    declare the same sole deliverable (one Markdown file under
    `/specs/`), and restate the open-questions discipline; it SHALL
    NOT duplicate the interview script.
14. `AGENTS.md` SHALL contain a `#### Step 0 — spec-author (every
    non-trivial template)` subsection inserted before `#### Template
    1` in the *Standard Team Templates* section, and each of Templates
    1, 2, and 3 SHALL gain a one-line preamble immediately under its
    heading pointing back to that subsection.

## Scenarios

**Scenario:** Author invokes the skill explicitly on a fresh ticket

Given the user opens a non-trivial ticket and types `/spec --issue=421`
and `/specs/` already contains `0001-spec-format-self.md`
When  the skill runs in the default `INTERMEDIATE` mode and the user
      answers all six interview questions with no unresolved open
      questions left
Then  the skill writes `/specs/0002-<slug>.md` with `status: draft`,
      `interaction-mode: INTERMEDIATE`, `related-issue: 421`,
      `version: 1.0.0`, all five mandatory body sections present in
      order, and at least one happy-path and one failure-path scenario.

**Scenario:** Orchestrator routes a fresh non-trivial ticket through step 0

Given a fresh ticket whose complexity tier is `standard` is picked up
      by the orchestrator
When  the orchestrator follows the *Standard Team Templates* in
      `AGENTS.md`
Then  the `spec-author` skill runs as step 0 before any architect,
      developer, or tester role is spawned, and the spec PR is merged
      before the team proceeds to PLAN/DEV.

**Scenario:** Delta mode on a `spec`-class REVIEW finding

Given a merged parent spec `/specs/0042-build-dryrun.md` exists on
      `main` and the REVIEW loop has produced a `spec`-class finding
      on the same ticket
When  the skill is re-invoked by the routing engine
Then  the skill detects the parent spec, switches to delta mode,
      writes `/specs/0042-build-dryrun.delta-01.md`, and the file
      contains the three sub-sections `### ADDED`, `### MODIFIED`, and
      `### REMOVED` in that order with all three present even when
      empty, while the original spec on `main` is left untouched.

**Scenario:** Exit is blocked while an open question is unresolved

Given the skill is running in `INTERMEDIATE` mode and the user has
      answered the first five questions
When  the open-questions review surfaces an unresolved item and the
      user neither resolves it nor explicitly parks it
Then  the skill refuses to write the spec file and surfaces the
      unresolved item again on the next turn.

**Scenario:** `AUTO` mode parks unresolved gaps after the fact

Given the skill is invoked in `AUTO` mode against a ticket whose body
      leaves three behaviours unspecified
When  the skill drafts the spec end-to-end with no user round-trip
Then  the three unspecified behaviours appear in `## Open questions`
      with the `[AUTO-PARKED]` prefix and the spec is written with
      `status: draft` for the user to audit via the merged spec PR.

## Out of scope

- Build-time multi-CLI distribution of the skill and agent into
  `~/.claude/`, `~/.gemini/`, and `~/.copilot/` install paths —
  tracked in #174.
- Wiring the retroactive routing engine that re-invokes the skill on
  `spec`-class REVIEW findings — tracked in #172. The skill declares
  the activation trigger; the engine that fires it lives in #172.
- Complexity-tier selection logic beyond asking the user
  (`INTERMEDIATE`/`FULL`) or proposing a reasonable default
  (`AUTO`/`MINIMAL`) — tracked in #173.
- Plan format and plan-review protocol — tracked in #169. The skill
  produces specs, never plans.
- The spec linter that enforces the invariants listed in
  `docs/spec-format.md` → *Linting hints* — tracked in #178. The
  skill self-validates best-effort; enforcement is the linter's job.
- The dedicated spec-PR branching and ordering workflow — tracked in
  #170. The skill writes the file; the workflow that ships it is
  #170's responsibility.

## Open questions

- `[USER-PARKED]` Delta-spec interview depth. The skill detects delta
  mode but reuses the original interview script verbatim. Whether
  delta authoring needs a constrained interview keyed to the three
  delta sections is deferred until #172 wires the trigger end-to-end.
- `[USER-PARKED]` Slug collision policy. Two near-simultaneous tickets
  could converge on the same slug; the id collision policy handles
  ids but slugs are not unique-keyed. The current skill does not
  state a disambiguation rule; revisit when AUTO mode is used in
  earnest.
- `[USER-PARKED]` `/spec` activation-phrase parity across CLIs.
  Whether each CLI maps `/spec` to the skill identically is a #174
  concern; if the spelling differs the activation trigger documented
  in this spec will need a delta-spec update.
- `[USER-PARKED]` Trivial-tier bypass enforcement. The skill states
  that trivial-tier tickets bypass it, but does not specify who
  pre-classifies the tier before the spec exists. The full tier
  engine is #173; until it lands, agents default to `standard` and
  run `spec-author` whenever in doubt.
