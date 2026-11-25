---
id: "0015"
slug: overlay-starter-templates
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1823
version: 2.0.0
---

# Overlay Starter Templates (delta-01)

This delta corrects R2 and the first scenario of spec 0015 for one key.
`canonical_repo` is no longer a placeholder the adopter replaces: it defaults to
the real upstream URL. Upstream-owned components resolve
`provenance.canonical` and `provenance.feedback` from it, so an adopter who
replaced it with their own repository misrouted upstream frictions to the
wrong tracker. Surfaced by reviewer seat `review/1823`, finding `i1-F1`
(class `spec`), on the change to `crewrig.config.toml.template` made for #1823.

## ADDED

1. **Scenario:** An upstream-owned component's feedback still reaches the canonical upstream after an adopter followed the template

   Given an adopter who copied `crewrig.config.toml.template` to
   `crewrig.config.toml`, replaced only the `feedback_repo` placeholder with
   their own repository URL, and left `canonical_repo` at its default
   When the build pipeline builds a component from an upstream-owned tier
   (`artifacts/core`, `artifacts/library`, `extensions/core`,
   `extensions/library`)
   Then the built component's `provenance.canonical` and `provenance.feedback`
   both resolve to `https://github.com/crewrig/crewrig`, and the adopter's
   `feedback_repo` is used only for adopter-owned tiers.

## MODIFIED

1. **R2.** Original:

   > `crewrig.config.toml.template` SHALL define, at minimum, the following keys
   > with placeholder string values and inline comments explaining each field:
   > `canonical_repo` (the URL of the upstream repository this fork was created
   > from, used for audit trail and license traceability) and `feedback_repo` (the
   > URL of the repository where the harness curator SHALL open feedback issues).
   > Copying `crewrig.config.toml.template` to `crewrig.config.toml` and replacing
   > the placeholder values with valid URLs SHALL be sufficient to produce a green
   > `bash scripts/build-components.sh` run.

   Replacement:

   > `crewrig.config.toml.template` SHALL define, at minimum, the following keys
   > with inline comments explaining each field: `canonical_repo` (the URL of the
   > upstream repository this fork was created from, used for audit trail,
   > license traceability and the feedback routing of upstream-owned components)
   > and `feedback_repo` (the URL of the repository where the harness curator
   > SHALL open feedback issues for adopter-owned components). `canonical_repo`
   > SHALL default to the real upstream URL `https://github.com/crewrig/crewrig`,
   > not to a placeholder; forks SHALL keep that value, and it SHALL be changed
   > only by a deployment whose repository IS the canonical upstream.
   > `feedback_repo` SHALL keep a placeholder string value that the adopter
   > replaces. Copying `crewrig.config.toml.template` to `crewrig.config.toml`
   > and replacing the `feedback_repo` placeholder alone with a valid URL SHALL
   > be sufficient to produce a green `node scripts/build-components.ts` run
   > (the current form of the retired `bash scripts/build-components.sh`;
   > `task build-components` wraps it).

2. **First scenario.** Original:

   > Given a developer at an adopting organization who has just forked the CrewRig
   > repository
   > When they copy `crewrig.config.toml.template` to `crewrig.config.toml` and
   > replace the `canonical_repo` and `feedback_repo` placeholder values with their
   > own repository URLs
   > Then `bash scripts/build-components.sh` exits zero and the built CLI output
   > directories are populated correctly.

   Replacement:

   > Given a developer at an adopting organization who has just forked the CrewRig
   > repository
   > When they copy `crewrig.config.toml.template` to `crewrig.config.toml`, leave
   > `canonical_repo` at its upstream default, and replace the `feedback_repo`
   > placeholder value with their own repository URL
   > Then `node scripts/build-components.ts` exits zero and the built CLI output
   > directories are populated correctly.

3. **Fourth scenario.** Original:

   > Given a `crewrig.config.toml.template` that omits the `feedback_repo` key
   > When a reviewer cross-checks the template against the fields consumed by
   > `scripts/build-components.sh`
   > Then the missing field is visible as a gap and the implementation PR fails
   > the spec review.

   Replacement:

   > Given a `crewrig.config.toml.template` that omits the `feedback_repo` key
   > When a reviewer cross-checks the template against the fields consumed by
   > `scripts/build-components.ts`
   > Then the missing field is visible as a gap and the implementation PR fails
   > the spec review.

## REMOVED

None.
