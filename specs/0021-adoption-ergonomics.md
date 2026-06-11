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
seniority examples and keeps receiving upstream improvements to them — until it
customizes a given file for its own needs, at which point that file becomes the
organization's and is never overwritten. A broader catalogue of role examples
ships to start from, and the organization can create its own role and team
files through a guided interview. Identity around roles, teams, and levels
becomes both current-by-default and safely customizable.

## Requirements

1. `config/expertise/`, `config/teams/`, and `config/level/` SHALL follow the
   **adopt-on-edit** sync policy (introduced by spec 0020): each file is synced
   from upstream until the adopting organization modifies it, after which that
   file is preserved permanently and never overwritten.
2. The adoption guide SHALL explain this model for `config/expertise/`,
   `config/teams/`, and `config/level/`: the organization customizes the
   example files it needs — freezing them — keeps receiving upstream updates to
   the files it has not touched, and may add its own role and team files.
3. The expertise example catalogue SHALL include role files for **Security
   Engineer**, **Software Architect**, **Product Manager**, and **Site
   Reliability Engineer**, each following the established `config/expertise/`
   file shape, shipped under the adopt-on-edit policy.
4. An adopter SHALL be able to create and populate a new expertise file through
   a guided interactive flow that asks for the role's responsibilities and
   practices and writes a conformant file.
5. An adopter SHALL be able to create and populate a new team file through a
   guided interactive flow that asks for the team's mission, stack, and
   practices and writes a conformant file.
6. A guided flow SHALL NOT silently overwrite an existing file of the same
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
  script, or both) and the concrete wiring of the adopt-on-edit policy for
  these paths (the per-path sync mechanism from spec 0020) — both are planning
  and implementation concerns (HOW).

## Open questions

- None. The upstream-examples import concern (the adopter's point 10 — choosing
  which upstream examples to keep and update) is resolved by the adopt-on-edit
  policy in R1: customized files freeze and untouched files keep updating from
  upstream, so no separate one-shot import picker is needed.
