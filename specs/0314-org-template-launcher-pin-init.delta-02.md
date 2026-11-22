---
id: "0314"
slug: org-template-launcher-pin-init
status: approved
complexity: trivial
interaction-mode: INTERMEDIATE
related-issue: 2109
version: 1.1.1
---

# Organization template, launcher contract, pin file and `crewrig init` scaffold (WP3 of epic 1822)

Resolves issue 2109. The scenario "init refuses without a usable origin" lists
the origin `git@github.com:acme/crewrig-config.git` as unusable (exit 2), while
R14 as amended by delta-01 converts a GitHub scp-style origin to
`https://github.com/<owner>/<repo>` and R19 as amended by delta-01 tests that
conversion. This delta replaces that scenario and changes one thing in it: the
scp-style example becomes a non-GitHub remote, which R14 still refuses. Nothing
else changes.

Cumulative effect: this delta changes no requirement. Read with delta-01, the
parent spec is the version 1.0.0 text, amended by delta-01 and by the one
scenario below; every requirement and every other scenario is as delta-01
leaves it. The new text of this scenario supersedes the original one.

## ADDED

(none)

## MODIFIED

### Scenario "init refuses without a usable origin"

Original scenario:

```text
Given a cached pinned version and a fresh template copy, with no git repository, or no origin, or an origin `git@github.com:acme/crewrig-config.git`, or an origin holding credentials
When  the author runs `node crewrig init`
Then  it exits with code 2 asking for --feedback-repo, and nothing is written, so no feedback can default to the public upstream repository.
```

Replacement:

```text
Given a cached pinned version and a fresh template copy, with no git repository, or no origin, or an origin `git@gitlab.com:acme/crewrig-config.git`, or an origin holding credentials
When  the author runs `node crewrig init`
Then  it exits with code 2 asking for --feedback-repo, and nothing is written, so no feedback can default to the public upstream repository.
```

## REMOVED

(none)
