---
id: "0193"
slug: command-source-provenance-guards
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 1079
version: 1.0.0
---

# Command Source Provenance Guards

## Intent

Ensure repository provenance guards and format documentation treat `command`-kind component sources under `artifacts/**/commands/` identically to `skill` and `agent` sources, preventing unbumped revisions or divergent feedback routing on command artifacts.

## Requirements

1. `scripts/check-skill-versions.sh` SHALL include `artifacts/core/commands/*.md`, `artifacts/library/commands/*.md`, and `artifacts/community/commands/*.md` in its set of monitored source paths.
2. `scripts/check-skill-versions.sh` SHALL enforce the `metadata.provenance.version` bump rule on modified command sources (git status `M`) identically to skills and agents, while allowing newly added command sources (git status `A`) at initial version without requiring a bump.
3. `scripts/check-feedback-routing.sh` SHALL inspect command sources under upstream-owned tiers (`artifacts/core/commands/*.md`, `artifacts/library/commands/*.md`).
4. `scripts/check-feedback-routing.sh` SHALL require that any upstream-owned command source declaring `metadata.provenance.feedback` routes feedback to `metadata.provenance.canonical` (i.e. `"${CANONICAL_REPO}"`).
5. `artifacts/FORMAT.md` under *Version semantics* SHALL name command sources alongside `SKILL.md` and `AGENT.md` sources for the version bump requirement.
6. `docs/version-bump-convention.md` SHALL include `artifacts/*/commands/*.md` in its list of affected paths and remove any statement claiming commands carry no provenance or version.
7. Automated regression test suites for `check-skill-versions.sh` and `check-feedback-routing.sh` SHALL include test cases verifying correct enforcement on command sources.

## Scenarios

**Scenario:** Modified command source without version bump fails check-skill-versions

Given a git repository containing an existing command source at `artifacts/core/commands/my-cmd.md` with `version: "1.0.0"`
When the command body is modified without bumping `metadata.provenance.version`
Then `bash scripts/check-skill-versions.sh` SHALL exit with non-zero status and report `artifacts/core/commands/my-cmd.md` as failed.

**Scenario:** Modified command source with version bump passes check-skill-versions

Given a git repository containing an existing command source at `artifacts/core/commands/my-cmd.md` with `version: "1.0.0"`
When the command source is modified and `metadata.provenance.version` is bumped to `"1.0.1"`
Then `bash scripts/check-skill-versions.sh` SHALL exit with status 0.

**Scenario:** Newly added command source passes check-skill-versions without bump

Given a git repository
When a brand-new command source is added at `artifacts/core/commands/new-cmd.md` at initial version `"1.0.0"`
Then `bash scripts/check-skill-versions.sh` SHALL exit with status 0.

**Scenario:** Upstream-owned command source with divergent feedback fails check-feedback-routing

Given a repository containing `artifacts/core/commands/my-cmd.md` declaring `canonical: "${CANONICAL_REPO}"` and `feedback: "${FEEDBACK_REPO}"`
When `bash scripts/check-feedback-routing.sh` is executed
Then `scripts/check-feedback-routing.sh` SHALL exit with non-zero status and report the offending command source.

**Scenario:** Upstream-owned command source with canonical feedback passes check-feedback-routing

Given a repository containing `artifacts/core/commands/my-cmd.md` declaring `canonical: "${CANONICAL_REPO}"` and `feedback: "${CANONICAL_REPO}"`
When `bash scripts/check-feedback-routing.sh` is executed
Then `scripts/check-feedback-routing.sh` SHALL exit with status 0.

## Out of scope

- Modifying the build generation of commands in `scripts/build-components.sh` (already implemented in spec 0191).
- Modifying extension provenance guards for commands (commands live in `artifacts/`, not `extensions/`).
- Promoting additional commands beyond `init-personal-profile` and `init-soul`.

## Open questions

- None.
