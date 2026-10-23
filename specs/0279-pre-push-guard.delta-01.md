---
id: "0279"
slug: pre-push-guard
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1763
version: 1.1.0
---

# Pre-push guard

Delta-01 raises the per-capability admission cap of requirement R9 from 20 s to
30 s. Measured on the development changeset, three capabilities whose CI
commands bundle the checker's own self-test suites with the check take 23 to
27 s alone, so the 20 s cap as written would drop `lint-specs`, `path-ownership`
and `frontmatter` from the fast tier. The 60 s total wall-clock budget, the pool
and every other requirement of the base spec are unchanged.

## ADDED

### Requirements

- **R9a. Measurement record behind the amendment.** On the reference machine
  (macOS, warm `node_modules`, idle machine, each capability run alone) the
  measured times are: `lint-specs` 23 s, `path-ownership` 23 s and
  `frontmatter` 27 s, because their CI commands run the checkers' own self-test
  suites in addition to the check (R3); all 19 other capabilities of the initial
  list take 0 to 9 s. `ci:pre-push` end to end on the development changeset
  takes 29 s for 21 of the 22 capabilities (including `frontmatter`), against
  the unchanged 60 s total budget. These figures are the snapshot that motivates
  the amendment, not normative values: timings depend on the machine and its
  load (R9 and R17(b) keep the re-measurement). With a 20 s
  cap, the admission rule of R9 would drop `lint-specs` (the first failure class
  of #1761, required by R12), `path-ownership` (the static net R17a relies on)
  and `frontmatter`. With the 30 s cap of the MODIFIED R9 below, all three are
  admitted; in particular `frontmatter` is admitted. `ci/pre-push-tier.json`
  SHALL record a measured value for every capability of the tier list, as R9
  already requires; the figures above are the snapshot that motivates the
  amendment, not values the file must reproduce.

### Acceptance

The budget test of R9 bounds each recorded value of `ci/pre-push-tier.json` at
30 s (a value above 30 fails it), and `ci/pre-push-tier.json` records a measured
value for every capability of the tier list. The existing sum bound and the
missing-time check of R9 are unchanged.

### Alternatives considered

- **A named exception list for two capabilities** (keep 20 s, exempt
  `lint-specs` and `path-ownership`): rejected, it special-cases a SHALL, and
  `frontmatter` at 27 s would still need a third entry.
- **Raise the cap to 25 s**: rejected, `frontmatter` at 27 s fails it.
- **Split each self-test suite from its check** so every capability falls under
  20 s: rejected here, it changes every affected capability command and belongs
  to WP-C of epic #1761.

## MODIFIED

Only R9 changes. Two sentences of R9 are amended; the rest of R9 is verbatim.

1. Admission rule. Original:

   > Admission rule: a capability is admitted only if it is deterministic, needs
   > no container, network, Windows host or secret, and its measured time is at
   > most 20 s alone.

   Replacement:

   > Admission rule: a capability is admitted only if it is deterministic, needs
   > no container, network, Windows host or secret, and its measured time is at
   > most 30 s alone.

2. Budget guard. Original (the first clause of the guard's sentence, abridged
   here to the clause that changes; the rest of the sentence is kept):

   > Budget guard: a test SHALL fail when the sum of the recorded seconds of the
   > always-run capabilities exceeds 60 times the reference pool size, [...] or
   > when a capability of the tier list has no recorded time, so an admission
   > without a measurement fails in CI;

   Replacement (adds the per-value bound; sum bound and missing-time check
   unchanged):

   > Budget guard: a test SHALL fail when the sum of the recorded seconds of the
   > always-run capabilities exceeds 60 times the reference pool size, [...] or
   > when a capability of the tier list has no recorded time, or when any
   > recorded time exceeds 30 s, so an admission without a measurement, or above
   > the cap, fails in CI;

3. Re-measurement removal threshold. Original:

   > Re-measurement is a manual step recorded in the PR (R17), and a capability
   > whose recorded time exceeds 20 s is removed from the tier.

   Replacement:

   > Re-measurement is a manual step recorded in the PR (R17), and a capability
   > whose recorded time exceeds 30 s is removed from the tier.

Consequential, wording only: the risk-table row of the base spec reading
"admission rule capped at 20 s per capability (R9)" reads "30 s" after this
delta. The total wall-clock budget of 60 s, the pool `min(4, available cores)`,
the reference pool size of 4, the initial capability list and every other
requirement (R1 to R8, R10 to R20) are unchanged.

## REMOVED

Nothing is removed.
