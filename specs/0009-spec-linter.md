---
id: "0009"
slug: spec-linter
status: implemented
complexity: standard
interaction-mode: AUTO
related-issue: 178
version: 1.0.0
---

# ✍️ Spec format linter

## Intent

The spec linter ensures that every specification file under `/specs/` strictly adheres to the normative format defined in `docs/spec-format.md`. This automation preserves the technical integrity of the SPECS stage by catching formatting errors, missing metadata, and structural drift before they reach the main branch.

## Requirements

1. The linter SHALL be accessible via a `task` command: `task spec:lint`.
2. The linter SHALL accept an optional path to a specific file or directory to lint; if omitted, it SHALL lint every `.md` file under `/specs/` (excluding `_template.md` and `README.md`).
3. The linter SHALL verify that every targeted file passes `markdownlint` using the project's `.markdownlintrc`.
4. The linter SHALL validate the YAML frontmatter against the schema defined in `docs/spec-format.md`:
    - All mandatory fields (`id`, `slug`, `status`, `complexity`, `version`, `related-issue`) MUST be present.
    - `interaction-mode` MUST be present if `status` is not `draft`.
    - `id` MUST match the file name prefix.
    - `slug` MUST match the file name slug.
    - Enum-valued fields (`status`, `complexity`, `interaction-mode`) MUST contain values from their respective allowed sets.
    - `version` MUST be a valid SemVer string.
    - `related-issue` MUST be an integer.
5. For original spec files, the linter SHALL verify the presence and order of the five mandatory H2 headings: `## Intent`, `## Requirements`, `## Scenarios`, `## Out of scope`, `## Open questions`. Heading text MUST match verbatim.
6. For delta-spec files (identified by `.delta-NN.md` suffix), the linter SHALL verify the presence and order of the three mandatory H2 headings: `## ADDED`, `## MODIFIED`, `## REMOVED`. Heading text MUST match verbatim.
7. The linter SHALL exit with a non-zero status code if any violation is found.
8. The linter SHALL provide clear, actionable error messages for every violation, including the file path and the nature of the error.
9. A new GitHub Actions job SHALL be created (or an existing one extended) to run the spec linter on every PR that modifies files under `/specs/` or `docs/spec-format.md`.
10. All existing files under `/specs/` SHALL be updated to pass the linter.

## Scenarios

**Scenario:** Linting a valid spec file

Given a spec file `/specs/0001-valid-spec.md` that strictly follows the format
When I run `task spec:lint -- /specs/0001-valid-spec.md`
Then the command SHALL exit with status 0

**Scenario:** Linting a spec with missing mandatory heading

Given a spec file `/specs/0042-missing-heading.md` that omits the `## Intent` section
When I run `task spec:lint -- /specs/0042-missing-heading.md`
Then the command SHALL exit with a non-zero status
And the output SHALL report that `## Intent` is missing

**Scenario:** Linting a spec with frontmatter id mismatch

Given a spec file `/specs/0009-spec-linter.md` with `id: "0010"` in frontmatter
When I run `task spec:lint -- /specs/0009-spec-linter.md`
Then the command SHALL exit with a non-zero status
And the output SHALL report that the `id` in frontmatter ("0010") does not match the file prefix ("0009")

**Scenario:** Linting a delta-spec with wrong heading order

Given a delta-spec file `/specs/0001-valid-spec.delta-01.md` where `## MODIFIED` appears before `## ADDED`
When I run `task spec:lint -- /specs/0001-valid-spec.delta-01.md`
Then the command SHALL exit with a non-zero status
And the output SHALL report that headings are out of order

## Out of scope

- Auto-fixing violations (the linter only reports).
- Linting non-spec Markdown files (e.g., in `docs/`).
- Validating the *content* of sections (e.g., checking if requirements use "SHALL").

## Open questions

- Should the linter be implemented as a shell script using `yq` and `grep`, or a more robust Node.js/TypeScript tool since the project uses `package.json`? (Given the complexity of YAML validation and heading checks, a TypeScript tool might be more maintainable).
