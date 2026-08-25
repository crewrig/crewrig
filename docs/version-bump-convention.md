<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# Version Bump Convention

<!-- crewrig-doc: published=false -->

Affected paths:

- `artifacts/core/skills/*/SKILL.md`
- `artifacts/library/skills/*/SKILL.md`
- `artifacts/community/skills/*/SKILL.md`
- `artifacts/core/agents/*/AGENT.md`
- `artifacts/library/agents/*/AGENT.md`
- `artifacts/community/agents/*/AGENT.md`
- `extensions/core/skills/*/SKILL.md`
- `extensions/library/skills/*/SKILL.md`
- `extensions/core/agents/*/AGENT.md`
- `extensions/library/agents/*/AGENT.md`

For an extension component the `version` lives in the provenance carrier
(the first-body-line `<!-- crewrig-provenance: version="…" … -->` HTML
comment per spec 0043), NOT in frontmatter — Gemini CLI 0.42.0+ rejects
non-`name`/`description` frontmatter keys on the in-place source. The bump
is enforced by `scripts/check-extension-version-bump.sh` (spec 0044), which
compares the carrier version against the base ref. `extensions/org` is
adopter-owned and exempt; commands carry no provenance/version.

**Exemption — new components do not bump in-branch.** Components
introduced on a feature branch start at `1.0.0` and stay there until the
branch is merged. In-branch fixes to a brand-new component MUST NOT bump
its version — the version is only meaningful once the component ships on
`main`. CI enforces this: only files with `git diff --name-status` status
`M` (modified) trigger the check; newly added files (`A`) are skipped.

**Not the same mechanism as an extension's own manifest version.** This
page covers only the per-component provenance-carrier bump above — an
individual skill or agent's own version, checked against its git history.
An extension's `extension.json`/`package.json` `version` (the field spec
0044's lockstep requirement governs, and spec 0183 requirement 22 extends
to the published release artifact — the artifact's own rendered
`gemini-extension.json` must declare the same version the release
declares) is a SEPARATE, whole-extension version, written by
`scripts/monorepo-release.sh` at release time via `@semantic-release/exec`,
not hand-bumped and not covered by `check-extension-version-bump.sh`. See
`docs/cli-matrix.md` row 17 for the manifest lockstep and row 13/14 for
where each version write happens.
