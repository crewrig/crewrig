---
id: "0145"
slug: ci-relative-markdown-link-checker
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 872
version: 1.0.0
---

# CI relative Markdown link checker

## Intent

Broken relative Markdown links currently land undetected in documentation and specifications because CI has no link resolution check. This specification mandates a link checker script `scripts/check-markdown-links.sh`, a hermetic regression test suite `scripts/tests/test-check-markdown-links.sh`, CI workflow integration, and the repair of all pre-existing broken relative links across tracked `.md` files.

## Requirements

1. The repository SHALL ship a link-checker script at `scripts/check-markdown-links.sh` that scans tracked Markdown files for relative link targets (`](target)`).
2. The checker SHALL ignore absolute URL schemes (`http:`, `https:`, `mailto:`, `ftp:`), pure fragment anchors (`#...`), templated targets (`${...}`, `{{...}}`), and GitHub tree-escape patterns (such as `../../../../issues/NN`).
3. The checker SHALL strip trailing fragment anchors (`#anchor`) and percent-decode URL-encoded characters before resolving paths.
4. The checker SHALL resolve relative targets against the parent directory of the containing Markdown file and accept both existing file targets (`test -f`) and existing directory targets (`test -d`).
5. When a relative link fails to resolve, the checker SHALL output the source file, line number, raw target, and full resolved target path, exiting with status code 1.
6. The repository SHALL ship a hermetic test suite at `scripts/tests/test-check-markdown-links.sh` validating positive resolution, broken link detection, anchor stripping, percent-decoding, and tree-escape exemptions.
7. The checker SHALL be integrated into GitHub Actions CI workflows (`.github/workflows/claude.yml` and `.github/workflows/gemini.yml`) as part of documentation linting.
8. All pre-existing broken relative Markdown links across tracked repository `.md` files SHALL be repaired so `scripts/check-markdown-links.sh` passes cleanly with exit code 0.

## Scenarios

**Scenario:** Valid relative file link resolves cleanly

Given a Markdown file containing `[spec](specs/0145-ci-relative-markdown-link-checker.md)`
When `scripts/check-markdown-links.sh` runs
Then the link is resolved against the directory and passes without error.

**Scenario:** Broken relative link causes CI failure with detailed diagnostics

Given a Markdown file containing `[missing](docs/non-existent-file.md)`
When `scripts/check-markdown-links.sh` runs
Then the checker outputs the source file, line number, raw target, and resolved path `docs/non-existent-file.md`
And the script exits with status code 1.

**Scenario:** GitHub tree-escape pattern is exempted

Given a Markdown file containing `[issue](../../../../issues/80)`
When `scripts/check-markdown-links.sh` runs
Then the link is exempted from file-existence checks and passes without error.

## Out of scope

- Validating HTTP/HTTPS remote URL targets (network-dependent).
- Validating in-page HTML heading anchor targets (`#heading-id`).

## Open questions

(None.)
