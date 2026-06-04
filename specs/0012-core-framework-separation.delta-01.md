---
id: "0012"
slug: core-framework-separation
status: draft
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 224
version: 1.1.0
---

# Core Framework Separation

## ADDED

(none)

## MODIFIED

**R6** — Add harness agent set enumeration (plan-review iter:1 Finding 3: R8 used the
term "harness agent set" with no corresponding definition in the spec).

Original:

> 6\. The core layer SHALL include, at minimum: the lifecycle governance files
> (`AGENTS.md`, `docs/`), the harness skill set (`spec-author`,
> `harness-curator`, `harness-report`, `pr-logbook`, `pr-reviewer`), the
> build and install scripts (`scripts/`), and the specification history
> (`specs/`).

Replacement:

> 6\. The core layer SHALL include, at minimum: the lifecycle governance files
> (`AGENTS.md`, `docs/`), the harness skill set (`spec-author`,
> `harness-curator`, `harness-report`, `pr-logbook`, `pr-reviewer`), the
> harness agent set (`spec-author`, `harness-curator`, `pr-logbook`,
> `pr-reviewer`, `architect`), the build and install scripts (`scripts/`),
> and the specification history (`specs/`).

---

**R8** — Replace the undefined "harness agent set" reference with an explicit
enumeration of illustrative agents sourced from `community-config/agents/`
(plan-review iter:1 Finding 3).

Original:

> 8\. The examples directory SHALL include, at minimum: the illustrative role
> skills currently in `community-config/skills/` that are not part of the
> harness skill set (`architect`, `developer`, `tester`, `astro`, `frontend`,
> `doc-writer`, `security`, `web-tester`, `github-actions`, `copywriting`)
> and the illustrative agent definitions not belonging to the harness agent
> set.

Replacement:

> 8\. The examples directory SHALL include, at minimum: the illustrative role
> skills currently in `community-config/skills/` that are not part of the
> harness skill set (`architect`, `developer`, `tester`, `astro`, `frontend`,
> `doc-writer`, `security`, `web-tester`, `github-actions`, `copywriting`),
> and the illustrative agent definitions currently in
> `community-config/agents/` that are not part of the harness agent set
> defined in R6 (`accessibility-auditor`, `accessibility-tester`,
> `astro-developer`, `ci-configurator`, `ci-debugger`, `copywriter`,
> `designer`, `developer`, `doc-writer`, `frontend-developer`,
> `regression-sentinel`, `scenario-author`, `security`, `seo-specialist`,
> `tester`, `visual-regression-tester`, `web-conformity-checker`).

## REMOVED

(none)
