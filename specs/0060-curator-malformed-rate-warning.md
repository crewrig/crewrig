---
id: "0060"
slug: curator-malformed-rate-warning
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 376
version: 1.0.0
---

# Curator emits a prominent warning when the malformed-friction rate is high

## Intent

When the curator sweeps the friction wing and finds that a significant fraction
of drawers cannot be parsed as valid frictions, it emits a human-readable
warning to stderr so that operators immediately see the degradation signal
without having to inspect the `skipped[]` array or compute the ratio themselves
from `stats.skipped_malformed / stats.total_drawers`.

The primary bugs reported in issue #376 — block-scalar suggestion bodies
silently dropped, and those same frictions wrongly classified as
`empty_suggestion` — were already fixed by specs 0032 and 0033. This spec
addresses the remaining "Relatedly" item from that issue: making the malformed
rate a first-class, visible signal rather than a number buried in the JSON
stats object.

## Requirements

1. After completing a friction sweep (excluding `--deep` mode, which produces a
   Markdown review document rather than a stats object), the curator SHALL
   compute the ratio `skipped_malformed / total_drawers`.
2. If the ratio exceeds a configurable threshold AND `total_drawers` is greater
   than zero, the curator SHALL emit a warning line to stderr.
3. The default threshold SHALL be `0.25` (25%): at least one quarter of all
   drawers malformed signals a systematic problem worth surfacing prominently.
4. The threshold SHALL be overridable via the environment variable
   `WARN_SKIPPED_RATIO`, which accepts a decimal value in `[0.0, 1.0]`. Values
   outside this range SHALL be silently clamped to the nearest bound (0.0 or
   1.0) so the caller cannot disable the guard entirely by passing a negative
   number.
5. The warning line SHALL be emitted to stderr, never to stdout, leaving the
   JSON payload or deep-review document on stdout unmodified.
6. The warning line SHALL be human-readable and include at minimum: the count of
   malformed drawers, the total drawer count, and the rounded percentage.
7. When `total_drawers` is zero, no warning SHALL be emitted (empty wing; the
   ratio is undefined).
8. The behaviors in requirements 1–7 SHALL be covered by automated regression
   scenarios in
   `artifacts/library/skills/harness-curator/scripts/test.sh`.

## Scenarios

**Scenario:** High malformed rate triggers a warning

Given a friction wing with 10 total drawers, of which 4 are malformed (40%,
above the 25% default threshold)
When the curator completes a sweep
Then a warning line is emitted to stderr
And the warning contains the malformed count (4), the total (10), and the
percentage (40%)
And the stdout JSON output is unchanged (no contamination from stderr)

**Scenario:** Low malformed rate produces no warning

Given a friction wing with 10 total drawers, of which 2 are malformed (20%,
below the 25% default threshold)
When the curator completes a sweep
Then no warning line is emitted to stderr

**Scenario:** Empty wing produces no warning

Given a friction wing with zero total drawers
When the curator completes a sweep
Then no warning is emitted to stderr

**Scenario:** Custom threshold overrides the default

Given `WARN_SKIPPED_RATIO=0.10` (10% threshold)
And a friction wing with 10 drawers, of which 2 are malformed (20%)
When the curator completes a sweep
Then a warning is emitted (20% exceeds the 10% custom threshold)

**Scenario:** Zero threshold is clamped, not accepted literally

Given `WARN_SKIPPED_RATIO=0.0`
And a friction wing with one valid and zero malformed drawers
When the curator completes a sweep
Then no warning is emitted (the 0.0 floor means 0 malformed = 0% = not above
the threshold; the clamp keeps the logic sound)

## Out of scope

- Modifying the JSON stats schema: `stats.skipped_malformed` remains the
  programmatic field; this spec adds a human-facing stderr signal on top.
- Adding individual malformed-drawer details to stderr: those are already
  available in the `skipped[]` array of the JSON output (spec 0010).
- Changing the behavior of `--deep` mode, which does not produce a stats
  object.
- Automated remediation or escalation beyond the single warning line.
- Surfacing the warning through a new top-level JSON field: the JSON contract
  is stable and consumers must not be forced to handle a new field.

## Open questions

- None. The scope is fully determined by the "Relatedly" paragraph of issue
  #376. The implementation is a post-stats stderr print in `curate.py`,
  gated on the computed ratio, with the threshold read from the environment.
  The version bump on `SKILL.md` follows the standard MINOR bump rule (additive
  change). No schema change, no new dependency.
