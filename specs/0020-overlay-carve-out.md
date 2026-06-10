---
id: "0020"
slug: overlay-carve-out
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 264
version: 1.0.0
---

# Overlay carve-out — org content in core zones with policy-driven sync

## Intent

An adopting organization can add its own specifications and documentation
inside the upstream-owned `specs/` and `docs/` trees, extend the agent rules
without editing the upstream `AGENTS.md`, and customize the project
`README.md` — all without the upstream synchronization overwriting that work.
Everything the organization has not touched keeps receiving upstream updates;
the moment it adds content to a designated org area or customizes a designated
file, the synchronization leaves that work alone, permanently.

## Requirements

1. The repository SHALL provide org-owned overlay subdirectories `specs/org/`
   and `docs/org/`, nested within the upstream-owned `specs/` and `docs/`.
2. The upstream synchronization SHALL NOT modify, delete, restore, or refuse
   to proceed because of any content under `specs/org/` or `docs/org/`.
3. The organization SHALL be able to add agent rules without editing the
   upstream `AGENTS.md`; the upstream `AGENTS.md` SHALL load an org-owned
   `AGENTS.org.md` so that org rules take effect alongside the upstream rules.
4. The org-rules inclusion SHALL take effect on every supported CLI — Claude
   Code, Gemini CLI, and GitHub Copilot CLI. Where a CLI does not resolve the
   inclusion mechanism natively, an equivalent SHALL deliver the org rules to
   that CLI, with no silent parity gap.
5. On a fresh clone, the adopter SHALL receive the upstream `README.md`.
6. While the adopter has not modified `README.md` relative to upstream, the
   synchronization SHALL update it to the latest upstream version.
7. Once the adopter has modified `README.md`, the synchronization SHALL never
   overwrite it again; the organization's version SHALL be preserved on every
   subsequent sync.
8. The synchronization SHALL classify every managed path under exactly one
   policy: **strict** (upstream-owned; a local modification halts the sync),
   **adopt-on-edit** (upstream-owned until the adopter modifies it, then
   preserved permanently), or **excluded** (org-owned; never touched).
9. `README.md` SHALL carry the **adopt-on-edit** policy; `specs/org/` and
   `docs/org/` SHALL carry the **excluded** policy; `AGENTS.md` SHALL remain
   **strict** (the organization extends it through `AGENTS.org.md`, never by
   editing it).

## Scenarios

**Scenario:** Org spec is excluded while upstream specs update

```text
Given the organization has committed a spec under specs/org/
When  the upstream sync runs
Then  the org spec is left untouched and the upstream specs/ files update to
      the latest upstream version
```

**Scenario:** An unmodified README is updated from upstream

```text
Given the adopter has not modified README.md and upstream published a new one
When  the upstream sync runs
Then  README.md is updated to the upstream version
```

**Scenario:** A modified README is frozen, not overwritten

```text
Given the adopter has modified README.md and upstream published a new one
When  the upstream sync runs
Then  README.md is left as the adopter's version, the sync does not overwrite
      it, and the sync does not abort on its account
```

**Scenario:** Org rules take effect under every CLI

```text
Given org rules are defined in AGENTS.org.md
When  an agent loads the working rules under Gemini CLI or GitHub Copilot CLI
Then  the org rules are in effect — natively or via the documented per-CLI
      equivalent
```

## Out of scope

- Extensions `core`/`org` segmentation (the adopter's separate concern) — a
  later spec.
- The en-GB to en-US orthographic sweep and the editorial-edit append-only
  carve-out — spec 0022.
- The build/install scope model — delivered by spec 0019 (#261).
- The concrete sync-manifest syntax, the baseline-detection algorithm for
  "modified" under adopt-on-edit, and the per-CLI include-fallback design —
  these are planning and implementation concerns (HOW), not the WHAT.
- Applying the adopt-on-edit policy to files other than `README.md`: this spec
  introduces the category and classifies only the named paths; broader
  reclassification is a separate change.

## Open questions

- [USER-PARKED] Whether Gemini CLI and GitHub Copilot CLI natively resolve a
  file-include directive for `AGENTS.org.md` is unverified. R4 mandates parity
  regardless; the implementation's first task is the investigation, and if
  native support is absent it SHALL provide a per-CLI fallback or record
  gap-acceptance evidence per `docs/cli-matrix-maintenance.md`. Parked because
  the answer is a DEV-time finding, not a WHAT decision.
