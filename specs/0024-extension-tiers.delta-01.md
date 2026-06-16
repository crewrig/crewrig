---
id: "0024"
slug: extension-tiers
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 343
version: 1.1.0
---

# Extension tiers — core, library, and org segmentation

## ADDED

None.

## MODIFIED

- `## Out of scope`, original bullet:

  > - Building extensions — extensions are installed (copied/linked), not compiled
  >   by `scripts/build-components.sh`.

  replaced with:

  > - The per-command-line-tool rendering of extension components from their pivot
  >   source is governed by spec 0041 (extension artifact lifecycle, issue #342),
  >   not by this tier-segmentation spec. This spec asserts no position on whether
  >   extension components are compiled; `scripts/build-components.sh` itself still
  >   compiles `artifacts/` only.

  Spec 0041 is cited by name and ticket rather than by file path, so this
  amendment's normative content holds on `main` regardless of the relative merge
  order of the two independent spec-PRs.

  Rationale: the original bullet could be read as a standing assertion that
  extension components are never compiled. Spec 0041 R2 introduces exactly such a
  rendering step, so the framing is narrowed to "out of scope for the
  tier-segmentation concern" without asserting the absence of any extension build
  in the framework. No `## Requirements` line of spec 0024 changes; the amendment
  narrows a normative boundary in `## Out of scope`, which is why this delta is a
  MINOR bump (1.1.0) rather than a PATCH.

## REMOVED

None.
