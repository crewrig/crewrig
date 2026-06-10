---
id: "0019"
slug: artifact-build-install-scope
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 258
version: 1.0.0
---

# Artifact build/install scope — tier-agnostic build with routed install

## Intent

Building CrewRig compiles every artifact tier — including the `org` tier,
which today is an empty, never-compiled placeholder — and each compiled
component reaches the right place: `core` components land in the project
automatically, `library` components land in the user's home automatically,
and `community` and `org` components land in the user's home only when the
user opts them in. A reader notices that the `organisation` tier is now named
`org`, that a component dropped into any tier is actually built, and that
nothing experimental appears in their home unless they asked for it.

## Requirements

1. The build SHALL compile artifact components for every tier present under
   `artifacts/`, including a tier added later, without relying on a fixed
   enumeration of tier names.
2. The organisation tier SHALL be named `artifacts/org/`, replacing
   `artifacts/organisation/`.
3. A component placed under `artifacts/org/` SHALL be compiled identically to
   a component in any other tier.
4. Every reference to the former `artifacts/organisation/` path outside the
   immutable specification history SHALL refer to `artifacts/org/`.
5. `core` components SHALL be installed into the project, and that
   installation SHALL be automatic.
6. `library` components SHALL be installed into the user home, and that
   installation SHALL be automatic.
7. `community` components SHALL be installed into the user home only upon an
   explicit user opt-in.
8. `org` components SHALL be installed into the user home only upon an
   explicit user opt-in.
9. Building a component SHALL be independent of installing it: a successful
   build SHALL NOT, on its own, install any non-`core` component.
10. The build's drift-detection mode SHALL cover every tier the build
    compiles.

## Scenarios

**Scenario:** An `org` component builds and installs on opt-in

```text
Given a component exists under artifacts/org/
When  the build runs and the user opts the org tier into their home
Then  the component is compiled and installed into the user home
```

**Scenario:** A newly added tier is compiled without changing the build

```text
Given a new tier directory is added under artifacts/ with one component
When  the build runs
Then  the new tier's component is compiled like the existing tiers
```

**Scenario:** An experimental component is not installed without opt-in

```text
Given a component exists under artifacts/community/
When  the build runs and the user does not opt the community tier in
Then  the component is compiled but is not installed into the user home
      nor into the project
```

## Out of scope

- `config/ORGANIZATION.md` keeps its name, and the deployed priority-20 rules
  slot (`~/.claude/rules/20-organization.md` and its Gemini/Copilot
  equivalents) is unchanged.
- The en-GB to en-US prose and orthography sweep — deferred to a later spec,
  gated on amending the specification append-only rule.
- The overlay carve-out primitive (`specs/org`, `docs/org`, `AGENTS.org.md`,
  sync-manifest exclusions) — a separate spec.
- Editing merged specification files: the historical `organisation` name
  remains frozen in `/specs/` under the append-only rule.
- The concrete install entry point, the opt-in selection surface, and the
  staging-directory layout — these are planning and implementation decisions,
  not part of the WHAT.

## Open questions

- None — the build/install doctrine is fixed by ADR-0011; this spec realises
  it and carries the `community`/`org` scope requirements that ADR-0011's
  *Consequences* assign to it.
