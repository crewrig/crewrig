---
name: web-tester
description: "Web test automation skill. Activate when writing Playwright or RobotFramework tests, auditing page conformity or accessibility, authoring test scenarios, or running regression passes on a web application."
license: Apache-2.0
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "1.0.2"
---


# Web Tester

End-to-end web testing covers behaviors a unit test cannot reach: real
browser rendering, network conditions, accessibility tree, visual
output. Bias toward fewer, sharper scenarios that exercise critical
user journeys — not exhaustive click-throughs.

## When to activate

- **Conformity checks** — verify a page matches a design system,
  functional spec, or API contract.
- **Accessibility audits** — automated WCAG 2.1/2.2 scans via
  axe-core. For keyboard operability and ARIA semantics, delegate
  to the `accessibility-auditor` agent.
- **Scenario authoring** — translate a user journey into an
  executable Playwright or RobotFramework script.
- **Regression passes** — run an existing suite against staging or
  production, diff against a baseline.
- **Visual regression** — screenshot diff across viewports to catch
  unintended layout or styling drift.

If the project has no web-test infrastructure and the user has not
asked for one, do not invent it — say so and stop.

## Toolchain

- **Playwright** (TypeScript or Python) — primary choice for new
  suites. Built-in waiting, tracing, screenshot/video capture, and
  parallel execution.
- **RobotFramework** with **Browser Library** (Playwright-backed) or
  **SeleniumLibrary** — preferred when the project already runs
  Robot, or when keyword-driven tests serve non-developer authors.
- **pytest-playwright** — when the Python side of the project
  already standardizes on pytest.
- **axe-core** via `@axe-core/playwright` (TS), `axe-playwright`
  (Python), or `robotframework-axelibrary` — for accessibility
  assertions inside functional tests.

Match the project's existing convention. Do not introduce a second
framework alongside the one already present.

## Playwright MCP server (optional)

At session start, detect whether `@playwright/mcp` is registered in
the harness. If present, **prefer the MCP tools** for browser
interaction — DOM inspection, screenshot capture, network
introspection, and step-by-step exploration are faster and produce
better artifacts than subprocess invocations.

If absent, fall back to:

- `npx playwright` (Node projects) or `python -m playwright`
  (Python projects) for direct CLI invocation.
- `subprocess` / `Bash` for one-shot scripts.

Installation is opt-in and lives in **global user config only**:

```sh
task setup:playwright-mcp
```

Never add the MCP server to a project-level config — the dependency
is the operator's choice, not the repository's.

## Conventions

- **Page-object model** — one class per page or component, exposing
  semantic methods (`login(email, password)`) rather than raw
  selectors. Selectors live inside the page object, never inline in
  the test.
- **Data-driven tests** — parameterize with fixtures or
  `test.describe.each`. Inline test data only when it is small and
  unique to one assertion.
- **Fixtures** — set up authenticated state, seeded data, and
  service mocks once per worker. Avoid per-test login when storage
  state suffices.
- **Parallel execution** — design tests to be independent. Shared
  mutable state (a single user, a single record) serializes the
  suite and hides flakiness.
- **Meaningful assertion messages** — `expect(locator,
  "checkout button visible after adding item").toBeVisible()` beats
  a bare `toBeVisible()` when the failure log is read at 02:00.
- **Retry strategy** — retry on `retries: 1` for known flaky
  network-dependent steps; never blanket-retry to hide real
  failures. Quarantine flaky tests, do not silence them.

## Reporting

- **HTML report** — `playwright show-report` for local triage.
- **JUnit XML** — for CI integration (`reporter: 'junit'`).
- **Allure** — when the project already publishes Allure dashboards.
- **GitHub Actions wiring** — headless Chromium on
  `ubuntu-latest`, install browsers with
  `npx playwright install --with-deps chromium`, upload
  `playwright-report/` and `test-results/` as artifacts on failure
  for trace inspection.

## Test quality bar

Same philosophy as the `tester` skill: high-signal tests, not
coverage theater. A scenario that exercises five clicks to assert
one outcome is one test, not five. A scenario that asserts ten
unrelated outcomes is a leaky fixture, not a test.

Stop adding scenarios when the marginal one becomes contrived.
Coverage of contrived journeys costs maintenance forever.

## Friction reporting

When a recognition signal fires (see `config/TOOLS.md` →
*Friction Reporting → Recognition signals*), invoke the
`harness-report` skill rather than reimplementing the protocol
inline.
