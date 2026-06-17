---
id: "0044"
slug: extension-versioning-manifest
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 351
version: 1.0.0
---

# Extension versioning and manifest enforcement

## Intent

An extension skill or agent carries its own version that moves when the
component itself changes, on the same convention `artifacts/` components already
follow, so a contributor reads one uniform bump rule whether they touch an
artifact or an extension component. Separately, the version of a distributable
extension is declared once and the build refuses to let the extension's several
manifests drift apart. This third and final child of the extension artifact
lifecycle closes the versioning gap: today extension components have no bump
discipline and an extension's manifests can silently diverge.

## Requirements

1. **(Independent component version)** An extension skill's or agent's
   `metadata.provenance.version` SHALL track that component's own revisions
   independently of the extension's package version.
2. **(Bump on modification)** A change that modifies an extension skill or agent
   already shipped on the primary branch SHALL bump that component's
   `metadata.provenance.version` in the same change.
3. **(New-component exemption)** A newly introduced extension component SHALL NOT
   bump its `metadata.provenance.version` in-branch; it ships at its initial
   version until merged, mirroring the `artifacts/` version-bump convention.
4. **(Bump guard)** A continuous-integration guard SHALL fail the build when a
   modified upstream-owned extension skill or agent ships without the required
   `metadata.provenance.version` bump.
5. **(Package single source)** The version of a distributable extension SHALL
   have a single authoritative declaration across its manifests.
6. **(Divergence guard)** A continuous-integration guard SHALL fail the build
   when a manifest of an extension declares a version divergent from that
   extension's single authoritative version declaration.
7. **(Documentation co-maintenance)** The change that introduces requirements 2
   through 4 SHALL extend the `AGENTS.md` version-bump convention affected-paths
   list and `artifacts/FORMAT.md` to name the upstream-owned extension tiers, so
   the documented convention and the enforced guard do not drift.

## Scenarios

**Scenario:** A modified extension component bumps its version and passes

```text
Given an extension skill already shipped on the primary branch
When  a change modifies that skill and bumps its metadata.provenance.version
Then  the continuous-integration guard passes for that component
```

**Scenario:** The guard rejects a modified component without a bump

```text
Given an upstream-owned extension skill already shipped on the primary branch
When  a change modifies it without bumping its metadata.provenance.version
Then  the continuous-integration guard fails the build and names the component
```

**Scenario:** A newly added extension component is exempt from the bump

```text
Given a change that adds a brand-new extension skill at its initial version
When  the continuous-integration guard runs against the change
Then  the guard does not require a version bump for the new component
```

**Scenario:** The guard rejects divergent extension manifests

```text
Given an extension whose manifests declare different versions
When  the continuous-integration guard runs against the change
Then  the guard fails the build and identifies the divergent manifest
```

## Out of scope

- The presence of the `version` field in the `metadata.provenance` block —
  mandated by sibling sub-spec 0041-B (spec 0043). This spec governs only the
  field's bump dynamics, not its presence.
- The provenance block schema and the per-CLI metadata carrier — owned by spec
  0043 and spec 0042 respectively; cross-referenced, not re-mandated.
- The choice of which manifest is the single authoritative source for an
  extension's package version — HOW, deferred to this sub-spec's PLAN stage.
- Any change to the `artifacts/` version-bump convention itself — it is the
  template this spec mirrors, not a target of change beyond the affected-paths
  list extension in requirement 7.
- The extension release and tagging mechanism (semantic-release driver) — it
  consumes the package version and is unchanged by this spec.

## Open questions

- [GROUNDING:] The bump guard (requirements 2-4) assumes extension skills and
  agents carry a `metadata.provenance.version` field; that field is delivered by
  spec 0043's implementation (the `greeter` back-fill), which is merged as a
  spec but whose implementation has not yet landed on the primary branch.
  Resolved as a DEV-sequencing dependency, already mandated by the #346 plan:
  this spec's implementation SHALL follow spec 0043's implementation, so the
  field exists before the guard keys on it.
- [GROUNDING:] The three `extensions/core/hello-world` manifests (`package.json`,
  `extension.json`, `gemini-extension.json`) currently all declare `0.1.0` and
  are consistent, so the divergence guard (requirements 5-6) passes as-is and no
  back-fill of existing manifests is required; the guard prevents future drift
  rather than repairing a current one.
