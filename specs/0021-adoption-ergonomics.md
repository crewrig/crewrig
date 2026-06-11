---
id: "0021"
slug: adoption-ergonomics
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 267
version: 1.0.0
---

# Adoption ergonomics — adopt-on-edit example dirs, richer catalogue, guided init flows

## Intent

An organization adopting CrewRig receives the shipped persona, team, and
seniority examples and keeps receiving upstream improvements — including newly
added examples — until it makes a file its own. Customizing a file freezes it;
deleting a file keeps it deleted; everything untouched stays current. A broader
catalogue of role examples ships to start from, and the organization can create
its own role and team files through a guided interview. Identity around roles,
teams, and levels becomes current-by-default and safely the organization's to
shape.

## Requirements

1. `config/expertise/`, `config/teams/`, and `config/level/` SHALL follow the
   **adopt-on-edit** sync policy (introduced by spec 0020), applied per file:
   each file is synced from upstream until the adopting organization modifies
   it, after which that file is preserved permanently and never overwritten.
2. A deletion of an adopt-on-edit file by the organization (recorded in the
   organization's git history) SHALL be honored: the sync SHALL NOT restore or
   re-create it. A deletion is treated like a modification — the organization
   has taken ownership of that path's absence.
3. A new adopt-on-edit file published upstream SHALL be synced into the
   organization clone if and only if that path has **never existed** in the
   organization clone's history. A path the organization previously deleted
   SHALL NOT be re-added.
4. The adoption guide SHALL explain this model for `config/expertise/`,
   `config/teams/`, and `config/level/`: untouched files keep updating from
   upstream and newly published examples arrive; customizing a file freezes it;
   deleting a file keeps it deleted; and the organization may add its own role
   and team files.
5. The expertise example catalogue SHALL include role files for **Security
   Engineer**, **Software Architect**, **Product Manager**, and **Site
   Reliability Engineer**, each following the established `config/expertise/`
   file shape, shipped under the adopt-on-edit policy.
6. An adopter SHALL be able to create and populate a new expertise file through
   a guided interactive flow that asks for the role's responsibilities and
   practices and writes a conformant file.
7. An adopter SHALL be able to create and populate a new team file through a
   guided interactive flow that asks for the team's mission, stack, and
   practices and writes a conformant file.
8. A guided flow SHALL NOT silently overwrite an existing file of the same
   name; it SHALL surface the collision and require an explicit decision.

## Scenarios

**Scenario:** An untouched example role updates from upstream

```text
Given the adopter has not modified config/expertise/SECURITY-ENGINEER.md and
      upstream has improved it
When  the sync runs
Then  the file is updated to the upstream version
```

**Scenario:** A customized example role is frozen, not overwritten

```text
Given the adopter has customized config/expertise/BACKEND-JAVA.md for their org
When  the sync runs and upstream has changed that file
Then  the adopter's version is preserved and not overwritten
```

**Scenario:** A newly published upstream role arrives; a deleted one stays gone

```text
Given upstream has added config/expertise/DATA-ENGINEER.md (never present on the
      org clone) and the org previously deleted config/expertise/QA-AUTOMATION.md
When  the sync runs
Then  DATA-ENGINEER.md is added to the org clone and QA-AUTOMATION.md is not
      re-created
```

**Scenario:** A new role file is created through the guided flow

```text
Given the adopter starts the guided expertise flow for a role not yet defined
When  they answer the prompts for responsibilities and practices
Then  a new conformant config/expertise file is created and populated, and —
      having no upstream version — it is the organization's own
```

**Scenario:** The guided flow refuses to clobber an existing file

```text
Given an expertise or team file of the chosen name already exists
When  the adopter runs the guided flow for that same name
Then  the flow does not overwrite it silently; it surfaces the collision and
      requires an explicit decision
```

## Out of scope

- The en-GB to en-US orthographic sweep and the editorial-edit append-only
  carve-out — spec 0022.
- Extensions `core`/`org` segmentation — a separate spec.
- Enriching the seniority-level (`config/level/`) content itself — this spec
  sets its sync policy and documents it, but does not add level examples.
- The concrete delivery mechanism of the guided flows (interactive skills
  following the `init-soul` / `init-personal-profile` pattern, a scaffold
  script, or both) and the concrete wiring of the per-file adopt-on-edit policy
  — including the add/delete history tracking — onto these directory paths (the
  sync mechanism from spec 0020): both are planning and implementation concerns
  (HOW).

## Open questions

- None. The upstream-examples import concern (the adopter's point 10 — choosing
  which upstream examples to keep, update, drop, or receive anew) is fully
  resolved by the adopt-on-edit policy (R1–R3): customized files freeze,
  untouched files keep updating, deletions stay deleted, and genuinely new
  upstream files arrive — so no separate import picker is needed.
