---
id: "0235"
slug: stop-writing-releaserc-into-extension-tree
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1235
version: 1.0.0
---

# Keep extension source directories clean during releases

## Intent

Monorepo release operations run without writing temporary release configuration
files (`.releaserc.json`) inside extension source trees (`extensions/**`), ensuring
extension working trees stay clean and preventing tooling artifacts from leaking
into release archives.

## Requirements

1. `scripts/monorepo-release.sh` SHALL NOT write `.releaserc.json` or any other
   transient release-tooling file inside `extensions/**` during publish or rehearsal.
2. The semantic-release configuration SHALL be passed to the engine externally.
3. Automated tests for monorepo release SHALL assert that `extensions/**` contains
   no transient release configuration files during or after execution.

## Scenarios

**Scenario:** Extension release rehearsal writes no files in extension tree

Given an extension located in `extensions/core/notes-fixture`
When `scripts/monorepo-release.sh` executes in rehearsal mode
Then no `.releaserc.json` file is written inside `extensions/core/notes-fixture`.

**Scenario:** Extension release publish writes no files in extension tree

Given an extension release in publish mode
When `scripts/monorepo-release.sh` executes
Then no `.releaserc.json` file is written inside `extensions/**`.

## Out of scope

- Altering the archive packaging format defined by spec 0183.
- Modifying how tags or SemVer numbers are calculated.

## Open questions

None.
