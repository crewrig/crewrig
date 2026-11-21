<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# Version Bump Convention

<!-- crewrig-doc: published=false -->

Affected paths:

- `artifacts/core/skills/*/SKILL.md`
- `artifacts/library/skills/*/SKILL.md`
- `artifacts/community/skills/*/SKILL.md`
- `artifacts/core/commands/*.md`
- `artifacts/library/commands/*.md`
- `artifacts/community/commands/*.md`
- `artifacts/core/agents/*/AGENT.md`
- `artifacts/library/agents/*/AGENT.md`
- `artifacts/community/agents/*/AGENT.md`

Extension skills and agents (`extensions/*`) are not on this list: an extension
has one version, the `version` of its `package.json`, written by
`scripts/monorepo-release.ts` at release time. The `version` of the
`crewrig-provenance` carrier of each of its skills and agents
(`<!-- crewrig-provenance: extension="…" version="…" … -->`, spec 0043 and
spec 0312) mirrors that package version; the release step rewrites it, and
`scripts/check-extension-manifest-version.ts` keeps it in lockstep.

**Exemption — new components do not bump in-branch.** Components
introduced on a feature branch start at `1.0.0` and stay there until the
branch is merged. In-branch fixes to a brand-new component MUST NOT bump
its version — the version is only meaningful once the component ships on
`main`. CI enforces this: only files with `git diff --name-status` status
`M` (modified) trigger the check; newly added files (`A`) are skipped.

**An extension's version.** An extension's `extension.json`/`package.json`
`version` (spec 0044's lockstep requirement, extended by spec 0183 requirement
22 to the rendered `gemini-extension.json`) is never hand-bumped. Neither are
the carrier versions of its skills and agents: the release step writes the
package version into both manifests and every carrier, and the release commit
stages them together. See `docs/cli-matrix.md` row 17 for the manifest
lockstep and row 13/14 for where each version write happens.
