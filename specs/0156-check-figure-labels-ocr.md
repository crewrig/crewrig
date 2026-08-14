---
id: "0156"
slug: check-figure-labels-ocr
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 881
version: 1.0.0
---

# Check Figure Labels in CI with OCR Protocol

## Intent

Mechanically verify PNG figure labels against sidecar prompt specifications using OCR (`tesseract`) in CI to prevent diagram text defects and ordering regressions.

## Requirements

1. **OCR Checker Script.** A script `scripts/check-figure-labels.sh` (delegating to `scripts/lib/check-figure-labels.py`) SHALL inspect every PNG in `docs/assets/` that has a sibling `.prompt.md` sidecar.
2. **Label Extraction and Order Verification.** The script SHALL parse expected box/diagram labels from sidecar prompts (such as `Box text: "..."` or quoted prompt lists), run OCR (`tesseract`), and verify that every expected label is present in the image and appears in the defined left-to-right / step sequence.
3. **Graceful Degradation.** If `tesseract` is absent from `$PATH`, `scripts/check-figure-labels.sh` SHALL print a `[SKIP]` notice and exit `0` to avoid blocking environments without OCR tooling.
4. **CI Integration.** A portable capability `figure-labels` SHALL be registered in `ci/ci-capabilities.yml` and wired into `.github/workflows/build.yml` and `.gitlab-ci.yml`.

## Scenarios

### Scenario 1: Figures match sidecar prompt labels in defined order

- **GIVEN** a PNG figure whose text labels match all expected sidecar `Box text:` strings in sequence
- **WHEN** `scripts/check-figure-labels.sh` is executed
- **THEN** all label checks pass and the script exits `0`.

### Scenario 2: Figure has missing or out-of-order text labels

- **GIVEN** a PNG figure with a missing or inverted label order
- **WHEN** `scripts/check-figure-labels.sh` is executed
- **THEN** the script reports `[FAIL]` detailing the missing/misordered label and exits `1`.

### Scenario 3: Tesseract is not installed

- **GIVEN** an environment where `tesseract` binary is missing
- **WHEN** `scripts/check-figure-labels.sh` is executed
- **THEN** the script outputs `[SKIP]` notice and exits `0`.

## Out of scope

- Converting raster PNG diagrams to Mermaid or SVG vector format.

## Open questions

- None.
