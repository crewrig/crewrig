---
id: "0043"
slug: extension-provenance-routing
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 349
version: 1.0.0
---

# Extension provenance and harness routing

## Intent

A skill or agent shipped inside an extension carries a provenance block that
names where it comes from, so a friction tagged against it while installed
reaches the extension's own origin repository rather than whichever project
installed it. The origin is named in a self-contained way that does not depend
on the installing project's configuration, which is what lets a third-party
extension's frictions find their way home even from a fork that has re-pointed
its own feedback elsewhere. This second child of the extension artifact
lifecycle gives extension components the same feedback-loop reachability that
`artifacts/` components already have.

## Requirements

1. **(Provenance presence)** Every skill and agent shipped inside an extension
   SHALL carry a `metadata.provenance` block containing the `canonical`,
   `feedback`, and `version` fields.
2. **(Self-contained origin)** The `canonical` value of an extension component
   SHALL identify the extension's own origin repository as a literal,
   self-contained value, resolvable without reference to the configuration of
   the project that installs the extension.
3. **(Routing)** A friction tagged against an installed extension component
   SHALL route to the repository named by that component's `canonical`,
   regardless of which project installed the extension.
4. **(Preserve on install)** The install and link operations SHALL preserve an
   extension component's `metadata.provenance` block unchanged, so the installed
   component retains its routing identity.
5. **(Feedback invariant)** An extension component whose source lives in an
   upstream-owned extension tier (`extensions/core`, `extensions/library`) SHALL
   declare a `feedback` value equal to its `canonical` value, conformant with
   the per-tier feedback-routing invariant governed by spec 0030.
6. **(Version field present, not its dynamics)** The `metadata.provenance` block
   SHALL include the `version` field so the block is complete on arrival; the
   bump rule and the manifest-divergence enforcement for that field are governed
   by sibling sub-spec 0041-C and are out of scope here.
7. **(Presence guard)** A continuous-integration guard SHALL fail the build when
   an extension component in an upstream-owned extension tier lacks the
   `metadata.provenance` block required by requirement 1.
8. **(Back-fill)** Every existing in-scope extension component lacking a
   `metadata.provenance` block — today the `greeter` skill alone — SHALL be
   given a conformant block in the same change that introduces requirement 1, so
   no skill or agent under `extensions/` on the primary branch violates
   requirement 1.

## Scenarios

**Scenario:** A friction on an installed extension skill reaches the extension origin

```text
Given a project has installed an extension whose skill declares a literal
      canonical naming the extension's origin repository
When  an agent tags a friction against that skill during real work
Then  the friction routes to the extension's origin repository
And    it does not route to the repository of the project that installed the
      extension
```

**Scenario:** The provenance block survives installation unchanged

```text
Given an extension component carrying a metadata.provenance block
When  the extension is installed or linked into a project
Then  the installed component carries the same provenance block, byte for byte
```

**Scenario:** An upstream extension component declares feedback equal to canonical

```text
Given an extension component whose source lives in extensions/core or
      extensions/library
When  its provenance block is inspected
Then  its feedback value equals its canonical value
```

**Scenario:** The guard rejects an upstream extension component without provenance

```text
Given an upstream-owned extension component is added or edited without a
      metadata.provenance block
When  the continuous-integration guard runs against the change
Then  the guard fails the build and identifies the offending component
```

## Out of scope

- The version field's bump rule and the manifest-divergence enforcement —
  governed by sibling sub-spec 0041-C (extension versioning and manifest
  enforcement). This spec mandates only that the `version` field be present.
- The per-CLI metadata carrier that transports the provenance block through a
  command-line tool that restricts native frontmatter keys — owned by spec 0042
  (merged). The provenance block rides on that carrier; this spec does not
  re-mandate the carrier mechanism.
- The placeholder, build-time-resolved binding model used by `artifacts/`
  components for their `canonical` value — explicitly rejected for extensions: a
  consuming project's configuration cannot resolve a third-party extension's
  origin, so a resolved-at-the-consumer value would misroute frictions.
- Continuous-integration enforcement on third-party extension repositories not
  hosted in this project — they follow the same provenance contract, but the
  guard runs in their repositories.
- Any change to the provenance or feedback routing of `artifacts/` components —
  their contract is unchanged.
- The harness-curator's downstream routing of issues to the resolved feedback
  target — it consumes the `canonical`/`feedback` values and is unchanged here.

## Open questions

- [GROUNDING:] No in-scope extension component on the primary branch carries a
  `metadata.provenance` block today: the `greeter` skill
  (`extensions/core/hello-world/skills/greeter/SKILL.md`) declares only `name`
  and `description`, and it is the only skill or agent any extension ships. The
  `hello-world` command is a command, not a skill or agent, and is outside R1's
  scope (the provenance schema in `artifacts/FORMAT.md` is defined on skill and
  agent frontmatter, not on commands). The provenance schema
  (`canonical`/`feedback`/`version`) exists and is well-formed for `artifacts/`
  skills and agents, so the block has a coherent shape to add. Back-fill
  responsibility is resolved: requirement 8 adds the block to the `greeter`
  skill in the implementation PR for this spec, and the guard introduced by
  requirement 7 prevents regression.
