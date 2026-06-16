---
id: "0024"
slug: extension-tiers
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 343
version: 1.0.1
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
  >   source is governed by
  >   [`specs/0041-extension-artifact-lifecycle.md`](0041-extension-artifact-lifecycle.md),
  >   not by this tier-segmentation spec. This spec asserts no position on whether
  >   extension components are compiled; `scripts/build-components.sh` itself still
  >   compiles `artifacts/` only.

  Rationale: the original bullet could be read as a standing assertion that
  extension components are never compiled. Spec 0041 R2 introduces exactly such a
  rendering step, so the framing is narrowed to "out of scope for the
  tier-segmentation concern" without asserting the absence of any extension build
  in the framework. No requirement of spec 0024 changes.

## REMOVED

None.
