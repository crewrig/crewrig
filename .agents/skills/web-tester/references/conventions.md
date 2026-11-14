# Conventions, reporting and quality bar

## Contents

- Conventions
- Reporting
- Test quality bar

## Conventions

- **Page-object model.** One class per page or component, exposing semantic methods (`login(email, password)`) rather than raw selectors. Selectors live inside the page object, never inline in the test.
- **Data-driven tests.** Parameterize with fixtures or `test.describe.each`. Inline test data only when it is small and unique to one assertion.
- **Fixtures.** Set up authenticated state, seeded data and service mocks once per worker. Avoid a per-test login when storage state suffices.
- **Parallel execution.** Design tests to be independent. Shared mutable state (a single user, a single record) serializes the suite and hides flakiness.
- **Meaningful assertion messages.** `expect(locator, "checkout button visible after adding item").toBeVisible()` beats a bare `toBeVisible()` when the failure log is read at 02:00.
- **Retry strategy.** Use `retries: 1` for known flaky network-dependent steps; a blanket retry hides real failures. Quarantine flaky tests, do not silence them.

## Reporting

- **HTML report**: `playwright show-report` for local triage.
- **JUnit XML**: for CI integration (`reporter: 'junit'`).
- **Allure**: when the project already publishes Allure dashboards.
- **GitHub Actions wiring**: headless Chromium on `ubuntu-latest`, install browsers with `npx playwright install --with-deps chromium`, upload `playwright-report/` and `test-results/` as artifacts on failure for trace inspection.

## Test quality bar

Same philosophy as the `tester` skill: high-signal tests, not coverage theater. A scenario that exercises five clicks to assert one outcome is one test, not five. A scenario that asserts ten unrelated outcomes is a leaky fixture, not a test.

Stop adding scenarios when the marginal one becomes contrived. Coverage of contrived journeys costs maintenance forever.
