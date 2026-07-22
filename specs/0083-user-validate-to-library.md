---
id: "0083"
slug: user-validate-to-library
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 570
version: 1.0.0
---

# Relocate the user-validate skill to the library tier

## Intent

The `user-validate` skill is available to every workflow on the user's
machine, not only inside a CrewRig project checkout, because it belongs to the
home-scoped library artifact tier alongside the other upstream-owned
cross-cutting tools. The `docs/layers.md` library-tier definition reads as a
general contract — upstream-owned cross-cutting machinery deployed at user-home
scope — of which friction reporting, friction curation, and user-gate
validation are instances, rather than an enumeration of a fixed member list.

## Requirements

1. The `user-validate` skill source SHALL belong to the library artifact tier
   and SHALL NOT belong to the core artifact tier.
2. The relocated `user-validate` skill SHALL be available to workflows that run
   outside a CrewRig project checkout, at user-home scope.
3. After the relocation, the committed project tree SHALL NOT contain any built
   copy of the `user-validate` skill.
4. `docs/layers.md` SHALL define the library tier by a general contract —
   upstream-owned cross-cutting machinery deployed at user-home scope — and
   SHALL present friction reporting, friction curation, and user-gate
   validation as instances of that contract rather than as its exhaustive
   definition.
5. `docs/layers.md` SHALL list `user-validate` under the library tier and SHALL
   NOT list it under the core tier.
6. The relocation SHALL preserve `user-validate` as the single canonical
   implementation of the gate protocol; its invocation contract, its backends,
   and its three outcomes SHALL be unchanged.
7. Every in-repository reference to the `user-validate` skill source SHALL name
   its library-tier location after the relocation, with no reference left
   pointing at the former core-tier location.
8. The `user-validate` skill body SHALL NOT depend on a repository-relative
   path that resolves only under project-scope deployment; references it needs
   SHALL remain valid when the skill is installed at user-home scope.
9. The relocation SHALL bump the `user-validate` skill's
   `metadata.provenance.version`.
10. The machine-readable core-paths manifest SHALL remain consistent with the
    layer taxonomy documented in `docs/layers.md` after the relocation.
11. `docs/cli-matrix.md` SHALL reflect the changed deployment scope of
    `user-validate` for every supported CLI.
12. The relocation SHALL NOT alter the per-user validation configuration
    mechanism nor the static gate-protocol rule that the core rules file
    carries; both SHALL remain as specified by spec 0080.

## Scenarios

**Scenario:** Gate available outside a CrewRig project

Given the user has completed the interactive setup that installs the library
tier to the user home
And the current working directory is not a CrewRig project checkout
When any workflow invokes `user-validate` to gate an artifact
Then the skill resolves and runs the configured gate backend
And returns exactly one of the three outcomes to its caller

**Scenario:** No core-tier copy remains after relocation

Given the relocation has been applied and the components have been rebuilt
When the committed project tree is inspected for the `user-validate` skill
Then no built `user-validate` skill copy is present in the committed tree
And `docs/layers.md` lists `user-validate` only under the library tier

**Scenario:** Library tier not installed — gate unavailable, surfaced not skipped

Given a CrewRig project checkout whose user has not installed the library tier
to the user home
When a lifecycle stage needs the user-gate validation
Then the `user-validate` skill is not resolvable
And the absence is surfaced to the user as a setup prerequisite
And the gate is not silently bypassed

## Out of scope

- Adding a project-scope fallback copy of `user-validate` for checkouts that
  skip the interactive setup; the user-home install prerequisite is accepted,
  identical to every other library-tier skill.
- Relocating any core skill or agent other than `user-validate`; this spec
  covers the single component.
- Changing the gate protocol, the backends, the invocation contract, or the
  three outcomes; spec 0080 stands unchanged.
- Changing the per-user validation configuration file or the static
  gate-protocol rule carried by the core rules file; spec 0080 R15 and R16
  stand unchanged.
- Modifying the interactive setup scripts' install logic beyond carrying the
  relocated skill, which the library-tier install path already covers.
- Reclassifying the sync policy of any path, or reclassifying any path other
  than `user-validate`.

## Open questions

- None; all qualification points were resolved during authoring. Accepted
  trade-offs are recorded under *Out of scope* (notably the user-home install
  prerequisite inherited from the library tier).
