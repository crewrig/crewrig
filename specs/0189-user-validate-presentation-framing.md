---
id: "0189"
slug: user-validate-presentation-framing
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 1062
version: 1.0.0
---

# User validation presentation framing and asset compliance

## Intent

When human reviewers inspect artifacts through rich user-gate validation backends, the presented document must faithfully honor their configured presentation preferences, language settings, and pedagogical depth without visual degradation or sandbox security blocks. Currently, passing raw repository files straight through to browser-based reviewers bypasses translation and pedagogical framing, and references to local image assets fail to render in browser sandboxes. This specification mandates that user validation presentations render configured translations, apply the active pedagogical framing, and embed image assets as self-contained data URIs so reviews are complete, readable, and pedagogically grounded.

## Requirements

1. When rich browser validation is active and any cross-cutting presentation preference is enabled, the validation workflow SHALL generate a bespoke presentation document reflecting the configured language translation, pedagogical framing level, and theme settings rather than passing raw unrendered repository source files verbatim.
2. The generated presentation document SHALL preserve and embed the concrete substance of the artifact or change under review while providing pedagogical context and decision implications matching the configured pedagogical level.
3. When translation is enabled, all framing commentary, contextual explanations, and presented artifact text within the transient review document SHALL be translated into the user's preferred language, while the underlying repository artifact files remain in English.
4. When illustrations or local graphical assets are included in a presentation document for browser-based validation, all referenced image data SHALL be embedded as self-contained inline base64 data URIs rather than local file system path URIs.
5. In the absence of enabled translation, custom pedagogy levels, or illustrations, raw artifact passthrough to the validator SHALL remain supported.

## Scenarios

**Scenario:** User validation presentation with active translation and pedagogical framing

Given an active validation configuration specifying translation and professor pedagogical framing
When a user-gate validation is initiated on an artifact through rich browser review
Then a bespoke presentation document is constructed containing translated contextual framing and complete artifact substance
And the transient presentation document is provided to the reviewer without modifying the English source file in the repository.

**Scenario:** Presentation embeds local illustrations as inline data URIs

Given an active validation configuration with illustrations enabled and an image asset generated
When the presentation document is prepared for browser review
Then the image asset is encoded and embedded as an inline base64 data URI
And no local file system paths are referenced in rendered image elements.

**Scenario:** Default passthrough when no cross-cutting enhancements are active

Given a validation configuration with default contextual framing, translation disabled, and no illustrations
When a validation gate is invoked on an artifact
Then the raw artifact is passed directly to the validator without requiring an intermediate bespoke document.

## Out of scope

- Modifying the underlying gate decision mapping protocol or outcome statuses.
- Writing translated or pedagogically framed presentation artifacts back into the version-controlled repository tree.
- Automated image generation algorithms (delegated to existing image skills).

## Open questions

(None.)
