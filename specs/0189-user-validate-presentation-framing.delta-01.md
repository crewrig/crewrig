---
id: "0189"
slug: user-validate-presentation-framing
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 1155
version: 1.1.0
---

# 0189 — user-validate-presentation-framing (delta-01)

This delta specification addresses issue #1155, refining the `illustration` cross-cutting option in user validation presentations to mandate pedagogical purpose and prohibit purely decorative illustrations.

During real-world user gate presentations, the `illustration` option triggered decorative AI-generated images (via `nano-banana`), incurring unnecessary generation costs and visual distraction without providing instructional value. Human reviewers require visual aids that genuinely clarify complex architectural boundaries, schema structures, sequence flows, or arbitration trade-offs. This delta establishes normative rules restricting image generation to pedagogical diagrams and prioritizing self-contained inline SVG for schematic structures.

## ADDED

Added to `## Requirements`:

- **6.** Generated images or graphical assets in validation presentation documents SHALL be reserved strictly for pedagogical benefit (such as explaining architectural schemas, component boundaries, sequence flows, or decision trade-offs). Generating purely decorative illustrations SHALL be prohibited.
- **7.** When schematic diagrams or structural visualizations are needed in a presentation document, authors SHALL prefer self-contained inline SVG markup over AI-generated raster images.

Added to `## Scenarios`:

**Scenario:** Presentation requires structural architecture diagram

Given an active validation configuration with illustrations enabled and an architecture decision requiring visual schema
When the presentation document is constructed
Then an inline SVG diagram or a pedagogically grounded schema is embedded
And no purely decorative AI-generated images are generated.

**Scenario:** Presentation rejects decorative illustration

Given an active validation configuration with illustrations enabled and a text-only policy change
When the presentation document is constructed
Then no decorative image is generated and the presentation remains focused on textual substance.

## MODIFIED

Requirement 4 in `specs/0189-user-validate-presentation-framing.md` is amended to incorporate the pedagogical requirement:

- **4.** When illustrations or local graphical assets are included in a presentation document for browser-based validation, they SHALL conform to the pedagogical requirement of requirement 6, and all referenced image data SHALL be embedded as self-contained inline base64 data URIs rather than local file system path URIs.

## REMOVED

(None.)
