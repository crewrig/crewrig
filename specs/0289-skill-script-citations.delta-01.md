---
id: "0289"
slug: skill-script-citations
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 1863
version: 1.1.0
---

# Skill script citations resolve or are repo-scoped

*Delta 01 of `specs/0289-skill-script-citations.md`. Source: issue #1863, the follow-up that spec 0289 left out of scope for agent bodies. The delta extends R1, R2 and R8 from skill bodies to agent bodies and fixes what an agent citation can resolve to. Version 1.1.0, a MINOR bump. Requirements modified: none. This delta opens no question.*

## ADDED

<!-- markdownlint-disable MD029 -->

12. **R12 (what an agent citation resolves to).** An agent body (`artifacts/*/agents/*/AGENT.md`) installs on its own, with no `scripts/` directory beside it. Every `scripts/...` path cited in an agent body SHALL therefore sit inside a CrewRig-repository-only fence (R2) with visible prose stating that the step applies to the CrewRig repository only. No file, neither one next to the agent source nor one in a skill directory, exempts a citation from the fence. A script that ships with a skill SHALL be cited from an agent body as `<skill-dir>/scripts/...` (the installed directory of that skill), which is not a `scripts/...` citation.
13. **R13 (same scanning rules as the skill linter).** The check of R12 SHALL scan with the semantics of the skill linter of R8: the fence markers and their nested, stray and unterminated findings, fenced code blocks (a `yaml` or `yml` block ignored), the leading frontmatter skipped, and the citation pattern (a path containing `..` is never accepted). It SHALL name the file, the line and the cited path of every finding.
14. **R14 (separate repository-side check).** The check of R12 SHALL run from the CrewRig repository, as a repository script with its own tests, and SHALL NOT be added to the skill linter bundled with `pr-reviewer`. Rationale: an agent body is checked where the sources live, and the bundled linter has to stay self-contained, so it cannot share code with a repository library, and a change under the `pr-reviewer` skill directory invalidates that skill's evaluation attestation. The scanner is therefore duplicated, and an automated test SHALL run both implementations on the same skill fixtures and fail when their findings differ on the scanning layer (fence markers, code blocks, the citation pattern, the nested, stray and unterminated findings). The two differ by design on resolution only: a citation that resolves inside a skill directory passes the skill linter and fails the agent check, so resolution is outside the parity comparison.
15. **R15 (enforcement in CI).** The check of R12 SHALL be part of the CI governance group, run by the existing source-lint job through the repository's task and path-filter conventions, so that a change to an agent body, to the check or to its fixtures runs it.
16. **R16 (checked behaviour).** The check SHALL be covered by automated tests with fixtures for at least: an unfenced citation (fail), a fenced citation (pass), a `<skill-dir>/scripts/...` path (pass), a sibling `scripts/` file that does not resolve the citation (fail), and an unterminated fence (fail).
17. **R17 (no regression).** After the change the check SHALL pass on every agent body currently in the repository, and every source modified to achieve it SHALL carry a bumped `metadata.provenance.version` with the built outputs regenerated (R10).
18. **R18 (no unresolvable path in the three artifacts).** The `pr-reviewer` agent, `docs/plan-format.md` and the `harness-curator` skill SHALL NOT cite a path that does not resolve for their reader: the documentation cites the repository-root comment-size check and the copy bundled with `pr-reviewer`, and the `harness-curator` skill cites its scripts relative to its installed directory (`scripts/...`). An automated test SHALL fail when a core or library skill or agent body cites a source-tree path of the form `artifacts/<layer>/skills/<name>/scripts/...`, a form the citation pattern cannot see, and when `docs/plan-format.md` no longer cites both the repository-root and the bundled comment-size check.

## MODIFIED

Nothing is modified.

## REMOVED

Nothing is removed. The out-of-scope statement of the parent about agent bodies, `Skills outside core and library layers, and citations of paths that do not begin with scripts/`, is unchanged: agent bodies are covered here, not by widening the skill linter.
