---
id: "0072"
slug: fork-release-workflow-guard
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 491
version: 1.0.0
---

# Release workflows stay inert on non-canonical forks

## Intent

An organization that adopts CrewRig by forking the canonical repository —
including the fork-with-full-history path that Step 1 of the adoption guide
documents — pushes to its own `main` branch, and later to its own version
tags, without ever seeing the release automation exit with a failure caused
by resolving pull-request or issue references that belong to the upstream
project instead of their own repository. The adoption guide itself tells the
adopter, ahead of the very first push the guide instructs them to make, that
release automation is reserved for the canonical repository and is expected
to stay quiet on their fork, so the gap between what the guide promises and
what the fork's Actions tab shows on day one closes.

## Requirements

1. The monorepo release workflow and the extension release workflow SHALL
   NOT execute their respective release logic when the triggering push or
   tag push originates from a repository other than the canonical upstream
   repository (`crewrig/crewrig` on GitHub).
2. A non-canonical-repository run of either release workflow SHALL complete
   without exiting non-zero due to resolving a pull-request or issue
   reference that does not exist in that repository.
3. A push to `main` on the canonical upstream repository, and a tag push
   matching the extension release pattern on the canonical upstream
   repository, SHALL continue to trigger the existing release logic of the
   respective workflow, unchanged from current behavior.
4. The adoption guide SHALL carry a warning co-located with Step 1's
   instruction to push the newly forked repository to `main` — the first
   point in the documented adoption path where a push to `main` occurs —
   stating that release automation is reserved for the canonical upstream
   repository and is expected to run inert on an adopted fork.
5. The adoption guide's troubleshooting section SHALL document the symptom,
   cause, and resolution for an adopter whose fork still exhibits the
   release-workflow failure this specification originates from — covering
   both a fork that has not yet synced this fix and a fork that wants to
   pre-emptively disable the workflow.

## Scenarios

**Scenario:** fresh fork with inherited history pushes to `main` (happy path)

```text
Given an adopter has cloned crewrig/crewrig with full upstream commit
      history and pushed it to their own Git host per adoption-guide Step 1,
When  the monorepo release workflow runs on that push,
Then  the workflow completes without executing its release logic and
      without reporting a failure, and the fork's Actions tab shows no red
      run for "Analyze & Release (Monorepo)".
```

**Scenario:** canonical repository push keeps releasing (non-regression)

```text
Given a push lands on `main` of the canonical crewrig/crewrig repository
      itself,
When  the monorepo release workflow runs,
Then  it executes its full existing release logic exactly as before this
      specification, including surfacing a genuine semantic-release failure
      if one legitimately occurs.
```

**Scenario:** extension tag on a fork does not attempt a release

```text
Given an adopter's fork carries a tag matching the extension release
      pattern (for example `hello-world-v1.2.3`),
When  the extension release workflow runs on that tag push,
Then  the workflow completes without packaging or publishing a GitHub
      Release, and without reporting a failure.
```

**Scenario:** adopter on a pre-fix fork hits the documented symptom (failure path)

```text
Given a fork synced from an upstream commit predating this fix, so its
      release-monorepo.yml still lacks the canonical-repository guard,
When  the adopter pushes to `main` and "Analyze & Release (Monorepo)" fails
      with "Could not resolve to an issue or pull request",
Then  the adoption guide's troubleshooting section names this exact
      symptom, states the root cause, and gives a resolution — disable the
      workflow or sync to pick up the fix — without requiring the adopter to
      read workflow source or open an upstream issue.
```

## Out of scope

- Changes to any workflow other than the monorepo release workflow and the
  extension release workflow (e.g. `build.yml`, `scripting-conventions.yml`,
  `pages.yml`) — the originating report confirms `Build & Validate` already
  behaves correctly on forks.
- A GitLab CI equivalent guard — `.gitlab-ci.yml` (generated per specs
  0046-0050) carries no release job, and `ci/ci-capabilities.yml` already
  models both release capabilities as GitHub-Actions-only
  (`portability: specific`, hand-authored), so there is no GitLab surface to
  guard.
- Renumbering, restructuring, or renaming any existing step or anchor in
  `docs/adoption-guide.md` (e.g. the `#dirty-core-refusal` anchor) — the new
  content is additive only.
- Retroactively notifying adopters who forked before this fix lands — the
  guide update is forward-looking; an already-forked adopter self-serves via
  the troubleshooting entry (Requirement 5) or their next upstream sync.
- Disabling, gating, or otherwise altering release automation for the
  canonical `crewrig/crewrig` repository itself.
- Changes to `scripts/monorepo-release.sh`, its `semantic-release`
  configuration, or any other release-tooling internals — this
  specification is scoped to when the workflows run, not what they do once
  running.

## Open questions

- [AUTO-PARKED] `ci/ci-capabilities.yml` cites exact line ranges as evidence
  for the `release` and `package-and-release` capabilities (for example
  "lines 9-43" for `release-monorepo.yml`, "lines 69-74" for
  `release-extension.yml`). Adding a canonical-repository guard to either
  workflow will shift line numbers within the file. Both capabilities are
  `portability: specific` and hand-authored (not generated), so no CI-parity
  generator breaks — but the evidence prose will describe a stale line
  range. PLAN should decide whether refreshing those evidence line
  references belongs in this ticket's implementation diff or is deferred as
  routine documentation drift.
