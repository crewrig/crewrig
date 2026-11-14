---
name: web-tester
description: "Automates web tests and accessibility checks: writes Playwright or RobotFramework scenarios with page objects, scans a page or a local HTML file with axe-core and ranks violations by impact, checks a page against a design system or spec, and runs regression or visual-diff passes. Use when writing or fixing an end-to-end browser test, auditing a page for WCAG or axe violations, turning a user journey into an executable scenario, or running a smoke or regression pass on staging. Trigger terms: Playwright, RobotFramework, end-to-end test, axe-core, accessibility audit, WCAG, page object, visual regression, regression pass, conformity. Not for unit or integration tests (tester), manual keyboard and ARIA review (accessibility-auditor agent), HTML or CSS authoring (frontend) or CI workflow files (github-actions)."
type: skill
license: Apache-2.0
compatibility: "Requires Node.js 24 for scripts/axe-scan.ts. A live axe scan also needs @axe-core/playwright, or playwright plus axe-core, with an installed browser, in the project; --from-json needs none of them."
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "2.0.0"
claude:
  allowed-tools:
    - Read
    - Write
    - Edit
    - Bash
    - Grep
    - Glob
    - WebFetch
  user-invocable: true
---

# Web Tester

End-to-end tests cover what a unit test cannot reach: real rendering, network conditions, the accessibility tree, visual output. Prefer a few sharp scenarios on critical user journeys over exhaustive click-throughs.

## When to use

- **Conformity check**: a page against a design system, functional spec or API contract.
- **Accessibility audit**: automated axe-core scan. Keyboard operability and ARIA semantics need a human-style pass: hand them to the `accessibility-auditor` agent.
- **Scenario authoring**: a user journey as a Playwright or RobotFramework script.
- **Regression or visual pass**: run the existing suite against staging or production, diff against a baseline or across viewports.

When the project has no web-test infrastructure and the user did not ask for one, say so and stop: inventing a framework is a larger decision than the task.

## Rules that decide most choices

- Use the framework already in the project; Playwright for a new suite. Details and the Playwright MCP fallback: `references/toolchain.md`.
- Page objects own the selectors, tests own the assertions. Fixtures set up state once per worker. Independent tests run in parallel. Retry only known flaky network steps. Conventions, reporting and CI wiring: `references/conventions.md`.
- A scenario is one journey and one outcome. Stop adding scenarios when the next one is contrived.
- Report an unverified result as unverified. A scan that did not run is not a clean page.

## Accessibility scan

Run from this skill's directory, or give the script's full path:

```sh
node scripts/axe-scan.ts <url-or-html-file> [--fail-on <impact>] [--json]
node scripts/axe-scan.ts --from-json <axe-results.json> [--fail-on <impact>] [--json]
```

It lists violations by impact (critical, serious, moderate, minor) with the rule id, help URL and node count. `--fail-on` sets the lowest impact that fails the run and defaults to `serious`. A live scan uses the project's own packages, looked up from the current directory: `@axe-core/playwright`, or `playwright` with `axe-core`. The script installs nothing. `--from-json` classifies an axe results file (one results object, or an array of them) without a browser, which suits a results file produced in CI or by another tool.

Network: the only network use is the browser navigating to the URL you pass. A local HTML file and `--from-json` use none. Only scan URLs the user gave.

| Exit | Meaning | What to do |
|---|---|---|
| `0` | No violation at or above `--fail-on`. Lower impacts may be listed. | Report them as non-blocking. Automated rules find only part of the WCAG issues, so do not claim full conformance. |
| `1` | At least one violation at or above `--fail-on`. | Report each rule id with its help URL and node count, then fix or hand off. |
| `2` | Usage error (unknown option, bad `--fail-on`, missing or extra argument). | Fix the command line. |
| `3` | Precondition failure: the finding names the missing package or browser and the install command, or the input is unreadable or not an axe results file. | Tell the user what is missing. Install it only when they agree, or classify an existing results file with `--from-json`. Never report exit 3 as a pass. |

`--json` prints one `{ok, data, findings}` object on standard output; each violation is a finding with the rule `axe:<rule id>`, an error at or above `--fail-on` and a warning below it.

## Friction

When something in this workflow misleads or blocks you, tag it with the `harness-report` skill.
