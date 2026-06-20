---
id: "0058"
slug: antigravity-cli-matrix
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 428
version: 1.0.0
---

# Spec 0058 — Antigravity CLI matrix and CI workflow

## Intent

crewrig's reference documentation and CI surface are updated to recognise
Antigravity CLI (`agy`) as the fourth fully-documented CLI alongside Claude
Code, Gemini CLI, and GitHub Copilot CLI. A developer reading
`docs/cli-matrix.md` can see, for every integration point, whether
Antigravity CLI is present, absent with a documented gap, or not yet
investigated. The `AGENTS.md` opening section names Antigravity CLI
explicitly, the `scripts/manage-antigravity-component.sh` script satisfies
the symmetric-script rule for component management, the `Taskfile.yml`
carries the two remaining CLI-prefixed task entries, and the CI gap for
Antigravity CLI is either resolved (if `agy --print` proves suitable as a
non-interactive entry point) or recorded with evidence in the matrix.

## Requirements

1. `docs/cli-matrix.md` SHALL add an Antigravity CLI column to every
   existing row (rows 1 through 25) of the feature matrix, marking each
   cell ✅, ❌, or ⚠️ as appropriate and citing the source of truth for
   each entry.

2. Every Antigravity CLI cell that cannot be ✅ SHALL carry a `[GAP]`,
   `[GAP-soft]`, or `[GAP-confirmation]` annotation consistent with the
   `docs/cli-matrix.md` *Parity gaps* conventions, together with
   gap-acceptance evidence satisfying the rule in
   `docs/cli-matrix-maintenance.md` → *Gap-acceptance evidence rule*.

3. The Antigravity CLI column SHALL be audited against every item of the
   "Adding a new CLI" checklist in `docs/cli-matrix.md` lines 129–151; each
   checklist item SHALL be explicitly addressed in the column (present,
   absent with evidence, or deferred with prior user authorisation captured
   in the logbook).

4. Row 5b of `docs/cli-matrix.md` (extension command render) SHALL record
   the Antigravity CLI cell as "package/install model — no pivot render
   required" consistent with OQ5 Outcome B (sub-spec F, spec 0057 R9);
   `scripts/build-extension-pivot.sh` is confirmed untouched.

5. `docs/cli-matrix.md` SHALL add an entry to its `Supported CLIs` table for
   Antigravity CLI, listing its config root (`~/.gemini/antigravity-cli/`),
   workspace entry point (`.agents/ANTIGRAVITY.md`), and plugin install dir
   (`~/.gemini/config/plugins/`).

6. `AGENTS.md` SHALL be updated so that the "What is CrewRig?" section pillar
   1 description and pillar 5 description each name Antigravity CLI as the
   fourth supported CLI alongside Claude Code, Gemini CLI, and GitHub Copilot
   CLI.

7. `docs/cli-matrix-maintenance.md` SHALL NOT receive any structural edits;
   the symmetric-script rule as written already covers the Antigravity CLI
   pattern. A prose note is not required. The spec records this explicitly
   so the implementation PR does not attempt to edit the file.

8. A `scripts/manage-antigravity-component.sh` script SHALL exist (or
   `scripts/manage-workspace-component.sh` SHALL be extended with an
   `--target antigravity` branch) to satisfy the symmetric-script rule in
   `docs/cli-matrix-maintenance.md` lines 75–82 for the component-management
   script category.

9. `Taskfile.yml` SHALL include a `setup-antigravity-interactive` task entry
   (invoking `scripts/setup-antigravity-interactive.sh`) and an
   `import-antigravity-history` task entry (invoking
   `scripts/import-antigravity-history.sh`), following the CLI-prefixed
   naming convention established by the existing tasks for Claude Code,
   Gemini CLI, and Copilot CLI.

10. If `agy --print` provides a non-interactive invocation path equivalent to
    `claude -p "…"` or `gemini -p "…"` suitable for CI use, a
    `.github/workflows/antigravity.yml` workflow file SHALL be added,
    following the pattern of `.github/workflows/claude.yml`. If `agy` offers
    no non-interactive entry point confirmed by empirical or documentation
    evidence, row 18 of `docs/cli-matrix.md` (CI workflow) SHALL record the
    Antigravity CLI cell as `[GAP]` with the evidence citation.

11. `docs/cli-matrix.md` SHALL add corresponding entries to its *Parity gaps*
    section for any Antigravity CLI cell that is not ✅, consistent with the
    existing per-gap narrative style in that section.

12. The `docs/cli-matrix-maintenance.md` *Symmetric-script rule* summary
    table (lines 75–82) describes `manage-<cli>-component.sh` as a trigger
    script. R8 satisfies this obligation; the implementation PR SHALL update
    `docs/cli-matrix.md` row 12 to reflect the chosen approach (new script
    vs. extended `manage-workspace-component.sh`) and SHALL add the
    corresponding `Taskfile.yml` entry for the component-management task
    if one is absent.

## Scenarios

**Scenario:** Developer reads the matrix to understand Antigravity CLI support

Given `docs/cli-matrix.md` with the Antigravity CLI column implemented
When a developer reads any row of the feature matrix
Then each row has exactly four CLI columns (Claude Code, Gemini CLI,
     Copilot CLI, Antigravity CLI) and every Antigravity CLI cell is
     either ✅ with a source-of-truth reference, or ❌/⚠️ with a
     `[GAP]`/`[GAP-soft]`/`[GAP-confirmation]` annotation and evidence

**Scenario:** New CLI checklist is fully addressed

Given the "Adding a new CLI" checklist in `docs/cli-matrix.md` lines 129–151
When the implementation PR is opened
Then every one of the 20 checklist items maps to either a ✅ cell in the
     Antigravity CLI column, a `[GAP]`/`[GAP-soft]` annotation with
     gap-acceptance evidence, or a deferred item with explicit user
     authorisation recorded in the logbook

**Scenario:** manage-antigravity-component.sh satisfies symmetric-script rule

Given `scripts/manage-claude-component.sh`, `scripts/manage-workspace-component.sh`,
      and `scripts/manage-copilot-component.sh` each exist on main
When the implementation PR lands
Then either `scripts/manage-antigravity-component.sh` exists or
     `scripts/manage-workspace-component.sh` accepts `--target antigravity`,
     and `docs/cli-matrix.md` row 12 reflects the chosen approach

**Scenario:** Taskfile carries the two remaining Antigravity CLI task entries

Given `Taskfile.yml` on main (after sub-specs B–F)
When a developer runs `task --list | grep antigravity`
Then `setup-antigravity-interactive` and `import-antigravity-history` appear
     among the listed tasks (in addition to any tasks introduced by prior
     sub-specs)

**Scenario:** CI gap is documented when agy has no non-interactive flag

Given `agy --help` output confirms no `--print` or equivalent non-interactive
      flag suitable for CI, or the flag is confirmed non-equivalent to
      `claude -p`
When the implementation PR is opened
Then row 18 of `docs/cli-matrix.md` marks the Antigravity CLI cell as
     `[GAP]` with the evidence citation (command output or documentation
     reference), and no `.github/workflows/antigravity.yml` file is added

**Scenario:** AGENTS.md pillar 1 names four CLIs

Given the current `AGENTS.md` which lists three CLIs in the "What is
      CrewRig?" pillars
When the implementation PR lands
Then pillar 1 and pillar 5 in the "What is CrewRig?" section each reference
     Antigravity CLI as the fourth supported CLI alongside Claude Code,
     Gemini CLI, and GitHub Copilot CLI

**Scenario:** docs/cli-matrix-maintenance.md is left unmodified

Given the implementation PR diff
When a reviewer inspects every changed file
Then `docs/cli-matrix-maintenance.md` does not appear in the diff, confirming
     that no structural edit was made to that file

## Out of scope

- Implementation of `scripts/setup-antigravity-interactive.sh` and
  `scripts/import-antigravity-history.sh` — these are owned by sub-specs C
  (spec 0054) and D (spec 0055) respectively; this spec only mandates that
  `Taskfile.yml` references them.
- Implementation of `scripts/build-antigravity-plugin.sh` and
  `scripts/install-antigravity-plugin.sh` — owned by sub-spec F (spec 0057);
  this spec only ensures the corresponding Taskfile entries exist (they may
  already have been introduced by sub-spec F's Taskfile requirement).
- Implementation of `scripts/build-components.sh --target antigravity` —
  owned by sub-spec B (spec 0053); this spec only requires `docs/cli-matrix.md`
  row 15 reflects it.
- The Antigravity CLI hook manifest (`hooks/antigravity-transcript-hooks.json`)
  — owned by sub-spec E (spec 0056).
- The workspace layout (`.agents/` directory and `ANTIGRAVITY.md`) — owned
  by sub-spec A (spec 0052).
- The interactive setup script content and MCP server wiring — owned by
  sub-spec C (spec 0054).
- Extension command pivot rendering for Antigravity CLI — confirmed not
  required by OQ5 Outcome B (sub-spec F, spec 0057 R9); this spec records
  that confirmation in `docs/cli-matrix.md` row 5b.
- Modifications to `docs/cli-matrix-maintenance.md` — explicitly excluded
  by R7; no new exemption is needed.
- e2e scenario additions for Antigravity CLI — a distinct follow-up.
- Adoption guide or `CONTRIBUTING.md` / `DEVELOPMENT.md` prose updates beyond
  what the `docs/cli-matrix.md` and `AGENTS.md` changes already cover.
- Any change to existing CI workflows for Claude Code, Gemini CLI, or
  Copilot CLI.

## Open questions

- [USER-PARKED] **`agy --print` CI suitability.** Whether `agy --print`
  (confirmed present via `agy -h` according to the investigation) is a
  genuine non-interactive single-shot flag equivalent to `claude -p "…"` or
  `gemini -p "…"` has not been end-to-end verified. R10 branches on this
  finding: the implementation PR SHALL run `agy --print "ping"` in a
  headless shell and verify exit code and stdout shape before deciding
  whether to add `.github/workflows/antigravity.yml` or record a `[GAP]`.
  The chosen outcome SHALL be recorded in the logbook before the PR is
  opened.
- [USER-PARKED] **`manage-antigravity-component.sh` vs. extended
  `manage-workspace-component.sh`.** The symmetric-script rule (R8) allows
  either a new dedicated script or an `--target antigravity` branch in the
  existing `manage-workspace-component.sh`. The implementation PR SHALL pick
  one approach, document the rationale in the logbook, and ensure
  `docs/cli-matrix.md` row 12 reflects the chosen form.
