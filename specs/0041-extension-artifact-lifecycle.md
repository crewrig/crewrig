---
id: "0041"
slug: extension-artifact-lifecycle
status: approved
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 342
version: 1.0.0
---

# Lifecycle of artifacts shipped inside extensions

## Intent

A skill, agent, or command shipped inside an extension enjoys the same
lifecycle guarantees as one authored under `artifacts/`: it is authored once in
the pivot format and is available on every supported command-line tool, it
carries an independent per-component version that moves when the component
changes, and a friction tagged against it while installed reaches the
extension's own origin repository rather than whichever project happened to
install it. The current asymmetry — where extension components are
command-line-tool-native sources without provenance, versioned only at the
package level, and invisible to the harness feedback loop — disappears, so an
adopter forking the project or installing a third-party extension experiences
one uniform artifact lifecycle regardless of whether a component came from
`artifacts/` or from an extension.

## Requirements

1. **(Pivot parity)** Every skill, agent, and command shipped inside an
   extension SHALL be authored in the single pivot source format used by
   `artifacts/` components, and SHALL NOT be authored as a
   command-line-tool-native source directly.
2. Each pivot-format extension component SHALL be rendered for every supported
   command-line tool, so that authoring a component once makes it available on
   Claude Code, Gemini CLI, and GitHub Copilot CLI without a second
   hand-authored source.
3. Any unavoidable per-tool gap in R2 SHALL be documented with concrete evidence
   that the missing mechanism does not exist in the target command-line tool,
   consistent with the project's command-line-tool parity contract.
4. **(Provenance and harness routing)** Every skill and agent shipped inside an
   extension SHALL carry a `metadata.provenance` block.
5. The `metadata.provenance.canonical` value of an extension component SHALL
   identify the extension's own origin repository and SHALL be self-contained —
   resolvable without reference to the configuration of the project that
   installs the extension.
6. A friction tagged against an installed extension component SHALL route to the
   repository named by that component's `metadata.provenance.canonical`,
   regardless of which project installed the extension.
7. The install and link operations SHALL preserve an extension component's
   `metadata.provenance` block unchanged, so the installed component retains its
   routing identity.
8. The `metadata.provenance.feedback` value of an extension component whose
   source lives in an upstream-owned extension tier (`extensions/core`,
   `extensions/library`) SHALL satisfy the per-tier feedback-routing invariant
   defined in
   [`specs/0030-feedback-routing-upstream-tiers.md`](0030-feedback-routing-upstream-tiers.md);
   this spec adds the provenance blocks that invariant already governs rather
   than restating the invariant itself.
9. **(Versioning)** Every skill and agent shipped inside an extension SHALL carry
   a `metadata.provenance.version` value that is independent of the extension's
   package version.
10. A change that modifies an extension component already shipped on the primary
    branch SHALL bump that component's `metadata.provenance.version` in the same
    change; a newly introduced component SHALL NOT bump in-branch, mirroring the
    version-bump convention already in force for `artifacts/` components.
11. A continuous-integration guard SHALL fail the build when a modified extension
    component in an upstream-owned extension tier ships without the required
    `metadata.provenance.version` bump.
12. The version of a distributable extension SHALL have a single authoritative
    declaration, and a continuous-integration guard SHALL fail the build when any
    derived manifest of the same extension declares a divergent version.
13. **(Enforcement)** A continuous-integration guard SHALL fail the build when an
    extension component in an upstream-owned extension tier lacks the
    `metadata.provenance` block required by R4, so the absence of provenance is
    caught before merge rather than discovered as a routing failure at friction
    time.

## Scenarios

**Scenario:** A friction on an installed extension skill reaches the extension origin

```text
Given a project has installed an extension whose skill declares a
      metadata.provenance.canonical pointing at the extension's origin repository
When  an agent tags a friction against that skill during real work
Then  the friction routes to the extension's origin repository
And    it does not route to the repository of the project that installed the
      extension
```

**Scenario:** An extension component is authored once and available everywhere

```text
Given an extension ships a skill, an agent, and a command authored in the pivot
      source format
When  the extension is built
Then  each component is rendered for Claude Code, Gemini CLI, and GitHub Copilot
      CLI from its single pivot source
And    no component carries a separately hand-authored command-line-tool-native
      source
```

**Scenario:** The guard rejects an upstream extension component without provenance

```text
Given an upstream-owned extension component is edited without a
      metadata.provenance block
When  the continuous-integration guard runs against the change
Then  the guard fails the build and identifies the offending component
```

**Scenario:** The guard rejects a missing version bump on a modified extension component

```text
Given an upstream-owned extension component already on the primary branch is
      modified without bumping its metadata.provenance.version
When  the continuous-integration guard runs against the change
Then  the guard fails the build and names the component missing the bump
```

## Out of scope

- The late-binding, consumer-resolved placeholder model for an extension
  component's `canonical` identity. It is explicitly rejected: a consuming
  project's configuration cannot resolve the origin of a third-party extension,
  so resolving the placeholder at the consumer would misroute frictions to the
  consumer instead of the extension's origin.
- Any change to the provenance, versioning, or feedback-routing of `artifacts/`
  components — their contract is unchanged by this spec.
- The harness-curator's downstream routing of issues to the resolved feedback
  target — it consumes the `canonical` value and is unchanged by this spec.
- Defining or renaming extension tiers — the three-tier segmentation
  (`extensions/core`, `extensions/library`, `extensions/org`) is governed by
  [`specs/0024-extension-tiers.md`](0024-extension-tiers.md) and inherited as-is.
- Populating `extensions/library` with real extensions — this spec governs the
  lifecycle contract, not the catalog of extensions that satisfy it.
- The choice of which manifest is the single authoritative source for the
  extension package version, and the mechanism that renders pivot components per
  command-line tool — both are HOW, deferred to the PLAN stage.
- Enforcing this contract on third-party extension repositories not hosted in
  this project — third-party authors follow the same lifecycle contract, but
  continuous-integration enforcement runs in their repositories, not this one.

## Open questions

- [GROUNDING:] No extension component on the primary branch carries a
  `metadata.provenance` block today — the sole existing component,
  `extensions/core/hello-world/skills/greeter/SKILL.md`, declares only `name`
  and `description`. Back-fill responsibility is resolved: the implementation PR
  for this spec SHALL add the `metadata.provenance` block (with `canonical`,
  `feedback`, and `version`) to every existing extension component in the same
  diff, and the guard introduced by requirement 13 prevents regression.
- [SPEC-RELATION] R2 introduces a per-command-line-tool rendering step for
  extension components, which evolves the framing of
  [`specs/0024-extension-tiers.md`](0024-extension-tiers.md), whose
  `## Out of scope` deferred extension building ("extensions are installed
  (copied/linked), not compiled by `scripts/build-components.sh`"). That framing
  is requalified by a sibling delta-spec on 0024, tracked in issue #343 — cited
  here by ticket rather than by file path so the reference holds regardless of
  the relative merge order of the two independent spec-PRs. The rendering
  mechanism (a dedicated extension build path versus reuse of the `artifacts/`
  builder) remains a HOW deferred to the PLAN stage. No residual question.
