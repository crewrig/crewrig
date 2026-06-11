---
id: "0024"
slug: extension-tiers
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 276
version: 1.0.0
---

# Extension tiers — core, library, and org segmentation

## Intent

CrewRig extensions are segmented into three tiers that mirror the artifact
tiers: upstream-shipped core extensions, upstream harness/shared library
extensions, and adopter-owned org extensions. An adopting organization can see
at a glance which extensions belong to upstream and which are its own, receives
upstream updates to the core and library extensions, and keeps its own
extensions entirely free of the upstream synchronization. The current flat,
ambiguous `extensions/` registry — where an upstream demo sits alongside the
adopter's space with no boundary — gives way to a clear ownership split.

## Requirements

1. The repository SHALL organize extensions into three tiers under
   `extensions/`: `extensions/core/` (upstream-shipped), `extensions/library/`
   (upstream harness and shared extensions), and `extensions/org/`
   (adopter-owned).
2. `extensions/core/` and `extensions/library/` SHALL be upstream-owned and
   synchronized from upstream under the **strict** policy: a local modification
   halts the sync, consistent with `artifacts/core/` and `artifacts/library/`.
3. `extensions/org/` SHALL be adopter-owned and **excluded** from the upstream
   sync — the sync SHALL NOT modify, restore, or halt on its contents.
4. The extension install, create, package, link, and unlink scripts SHALL
   operate over all three tiers (an extension's tier is determined by which
   tier directory it lives under).
5. The `hello-world` demo extension SHALL live under `extensions/core/` as the
   upstream example, and references to its path in scripts and documentation
   SHALL follow the move.
6. `docs/layers.md` SHALL classify the three extension tiers consistently
   (resolving the current wording that upstream extensions are "installed
   rather than committed"), and `.crewrig/core-paths.txt` SHALL list
   `extensions/core` and `extensions/library` as synced while leaving
   `extensions/org` excluded.

## Scenarios

**Scenario:** An org extension is excluded from the sync

```text
Given the organization has committed an extension under extensions/org/
When  the upstream sync runs
Then  the org extension is left untouched and the extensions/core and
      extensions/library extensions update to the latest upstream version
```

**Scenario:** The install scripts operate over all three tiers

```text
Given extensions exist under extensions/core/, extensions/library/, and
      extensions/org/
When  an extension install or package script runs
Then  it discovers and handles extensions from all three tiers
```

**Scenario:** A locally modified core extension halts the sync (strict)

```text
Given the adopter has modified an extension under extensions/core/
When  the upstream sync runs
Then  the sync halts on the dirty core path, directing the adopter to make an
      org extension instead of editing the upstream-owned one
```

## Out of scope

- A project-vs-home install-scope distinction for extensions: all tiers install
  to the CLI's extension home location uniformly, and the per-tier install
  trigger (automatic vs on-demand) is a planning and implementation concern
  (HOW), not part of this WHAT.
- Building extensions — extensions are installed (copied/linked), not compiled
  by `scripts/build-components.sh`.
- Populating `extensions/library/` with actual extensions — the tier directory
  is introduced (and ships empty, with a placeholder) but no library extension
  is authored here.
- A fourth or community extension tier — only core, library, and org are
  introduced.

## Open questions

- None.
