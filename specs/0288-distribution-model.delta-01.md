---
id: "0288"
slug: distribution-model
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 2071
version: 1.1.0
---

# Distribution model and release-branch regime (parent spec of epic 1822)

## ADDED

(none)

## MODIFIED

The scenario "A prerelease tag is pushed on the release branch" is replaced.
Per the owner decision of 2026-11-17 (spec 0310 R3), a prerelease asset is
named after the full version, `-next.<N>` included: the asset of
`crewrig-v1.0.0-next.1` is `crewrig-1.0.0-next.1.tgz`. Only the asset name in
the `Then` clause changes. R4, R5 and R8 already build the name from the full
version and need no change.

Original scenario:

```text
**Scenario:** A prerelease tag is pushed on the release branch

Given WP2 has merged on the release branch, whose tree carries the prerelease workflow, `main` carries no such workflow, and WP2's verification record of R31 exists on #1822
When a maintainer pushes the tag `crewrig-v1.0.0-next.1` on the head of `release/1822-distribution`
Then the workflow of the tagged commit runs, all three guards pass, and a GitHub Release `crewrig-v1.0.0-next.1` is created, marked prerelease and not latest, carrying `crewrig-1.0.0.tgz` and its digest; no stable `crewrig-v1.0.0` tag exists.
```

Replacement scenario:

```text
**Scenario:** A prerelease tag is pushed on the release branch

Given WP2 has merged on the release branch, whose tree carries the prerelease workflow, `main` carries no such workflow, and WP2's verification record of R31 exists on #1822
When a maintainer pushes the tag `crewrig-v1.0.0-next.1` on the head of `release/1822-distribution`
Then the workflow of the tagged commit runs, all three guards pass, and a GitHub Release `crewrig-v1.0.0-next.1` is created, marked prerelease and not latest, carrying `crewrig-1.0.0-next.1.tgz` and its digest; no stable `crewrig-v1.0.0` tag exists.
```

## REMOVED

(none)
