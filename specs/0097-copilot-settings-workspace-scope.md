---
id: "0097"
slug: copilot-settings-workspace-scope
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 605
version: 1.0.0
---

# Scope the strict-core sync guard away from the locally-mutated Copilot workspace settings file

## Intent

An operator who opts into GitHub Copilot CLI transcript hooks during
`setup-copilot-interactive.sh` — an action that deliberately writes an
absolute hook path into the tracked `.github/copilot/settings.json` file —
can afterward run the routine upstream-sync step without it aborting, and
without a stray timestamped backup file cluttering their `git status`
output. Today, that same opt-in leaves the working tree unable to sync at
all, because the sync step treats any local difference in that file as an
upstream-owned violation, even though writing to that exact file for that
exact purpose is the documented, intended behavior of the opt-in — not a
mistake made by the operator or the setup script.

## Requirements

1. `.crewrig/core-paths.txt` SHALL classify `.github/copilot/settings.json`
   as an `excluded` entry nested under the existing `.github/copilot`
   `strict` parent entry, mirroring the nested-exclusion syntax already
   used for `specs/org`, `docs/org`, and `AGENTS.org.md`.
2. After the reclassification in Requirement 1, a local content difference
   confined to `.github/copilot/settings.json` SHALL NOT cause
   `scripts/sync-from-upstream.sh` to report `.github/copilot` as dirty,
   and SHALL NOT be reverted when the sync subsequently restores
   `.github/copilot`'s other members from upstream.
3. A local content difference in any other member of `.github/copilot/`
   (for example `.github/copilot/extension.json`) SHALL continue to cause
   `scripts/sync-from-upstream.sh` to abort exactly as it does today — the
   reclassification in Requirement 1 SHALL apply to
   `.github/copilot/settings.json` alone, not to the whole
   `.github/copilot` directory.
4. `.gitignore` SHALL ignore the timestamped backup file that
   `scripts/lib/common.sh`'s `backup_file()` writes next to
   `.github/copilot/settings.json` during the hook-merge opt-in, so that
   file SHALL NOT appear as an untracked file in `git status` after the
   opt-in runs.
5. `docs/layers.md` SHALL be updated in the same diff as Requirement 1 to
   record that `.github/copilot/settings.json` is carved out of the
   `.github/copilot` core-layer entry's sync guard, per `AGENTS.md` →
   *Core-paths manifest co-maintenance*.
6. This spec's fix SHALL NOT change where `scripts/setup-copilot-interactive.sh`
   writes the opt-in hook merge — it SHALL continue merging into the
   tracked `.github/copilot/settings.json` file, because that placement is
   the decision already recorded in
   `docs/adr/0001-copilot-cli-integration-strategy.md` (Discovery finding
   #8: "the committed `settings.json` has `\"hooks\": []` by design" and
   the opt-in rewrites it locally with an absolute path), not a defect
   introduced by drift from that decision.
7. `scripts/setup-claude-interactive.sh` and
   `scripts/setup-gemini-interactive.sh` SHALL remain confirmed unaffected
   by this spec — both write their settings file only under the
   operator's home directory, outside the tracked repository tree, so
   neither exhibits the strict-dirty abort or the backup-noise symptom
   named in issue #605.
8. A regression check SHALL assert that, given a `.github/copilot/settings.json`
   content mutation representative of the hook-merge opt-in,
   `scripts/sync-from-upstream.sh` completes its strict dirty-guard for
   `.github/copilot` without aborting.
9. A regression check SHALL assert that a mutation confined to
   `.github/copilot/extension.json` still causes
   `scripts/sync-from-upstream.sh`'s strict dirty-guard for
   `.github/copilot` to abort, so the narrow scope of Requirement 3 does
   not regress silently.
10. A regression check SHALL assert that `.gitignore`'s updated pattern
    matches a representative `.github/copilot/settings.json.bak.<timestamp>`
    filename in the shape produced by `backup_file()`. The pattern SHALL be
    scoped narrowly to `.github/copilot/settings.json.bak.*` — not a
    directory-wide `.github/copilot/*.bak.*` — to keep the diff auditable
    and confined to the one file this spec addresses.
11. `docs/adr/0001-copilot-cli-integration-strategy.md` SHALL receive a
    short informational addendum, mirroring its existing
    "Addendum — 2026-05-20" section, noting that
    `.github/copilot/settings.json`'s local hook-merge mutation is now
    explicitly exempted from the strict sync guard (per Requirement 1),
    so a future reader is not required to cross-reference this spec to
    understand why the manifest treats that file differently from its
    sibling `extension.json`. This addendum SHALL NOT alter any normative
    decision already recorded in the ADR.

## Scenarios

**Scenario:** Hook opt-in no longer blocks a routine sync

```text
Given an operator ran `setup-copilot-interactive.sh` and opted into
      transcript hooks, leaving a local diff confined to
      `.github/copilot/settings.json`
When  the operator runs `scripts/sync-from-upstream.sh`
Then  the sync completes without aborting
And   the operator's hook-merge content in `.github/copilot/settings.json`
      is left untouched by the sync's restore step
And   no `.github/copilot/settings.json.bak.<timestamp>` file appears as
      untracked in `git status`
```

**Scenario:** An unrelated local edit to a sibling Copilot file still
blocks the sync

```text
Given an operator has a local content difference in
      `.github/copilot/extension.json` only, with
      `.github/copilot/settings.json` unmodified
When  the operator runs `scripts/sync-from-upstream.sh`
Then  the sync aborts, reporting `.github/copilot` as carrying a local
      modification, exactly as it does today
```

## Out of scope

- Redirecting the hook-merge opt-in from the tracked
  `.github/copilot/settings.json` to the gitignored
  `.github/copilot/settings.local.json` (one of the friction reporter's
  two suggested resolution shapes). This spec deliberately does not adopt
  it: it would reverse the explicit placement decision recorded in
  `docs/adr/0001-copilot-cli-integration-strategy.md` Discovery finding
  #8, and it is contingent on confirming that GitHub Copilot CLI actually
  loads and merges a `settings.local.json` sibling at runtime — an
  assertion the ADR's own row #7 makes but that no verification note
  under `docs/research/` currently backs. See *Open questions*.
- Any change to `scripts/setup-copilot-interactive.sh`'s current
  hook-merge behavior (see Requirement 6).
- Extending `scripts/sync-from-upstream.sh` to support a nested
  `adopt-on-edit` policy under a `strict`/`adopt-on-edit` parent — only
  nested `excluded` is mechanically supported today
  (`excluded_children_of` in `scripts/sync-from-upstream.sh` matches on
  the `excluded` policy value only). Adding that capability, if ever
  wanted, is a separate change to the sync engine itself.
- Migrating an operator checkout whose `.github/copilot/settings.json`
  is already locally dirtied from a hook opt-in performed before this
  fix ships — the manifest reclassification in Requirement 1 resolves
  the abort on that checkout's next sync with no separate migration
  step.
- `scripts/setup-claude-interactive.sh` and
  `scripts/setup-gemini-interactive.sh` (confirmed unaffected — see
  Requirement 7).
- Any change to the normative decisions recorded in
  `docs/adr/0001-copilot-cli-integration-strategy.md`. This spec treats
  the ADR's Discovery finding #8 as the settled design and fixes the
  manifest/gitignore gap around it, not the design itself.
- Updating `docs/cli-matrix.md`. `AGENTS.md` → *CLI Matrix Maintenance*'s
  trigger list does not include `.crewrig/core-paths.txt` or
  `.gitignore`, and this spec does not touch any path in that trigger
  list (no `scripts/setup-*.sh` file is modified).

## Open questions

None. All three questions raised at authoring time were closed by the
user before PLAN:

- ADR-0001 addendum: **yes** — see Requirement 11.
- Follow-up ticket for the `settings.local.json` redirection: **not
  opened now** — no concrete motivation exists today; revisit if a
  future friction independently motivates it (see *Out of scope*).
- `.gitignore` pattern scope: **narrow** (`settings.json.bak.*`) — see
  Requirement 10.
