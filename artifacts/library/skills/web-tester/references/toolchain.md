# Toolchain and Playwright MCP

## Contents

- Toolchain choice
- Playwright MCP server (optional)
- Accessibility assertions

## Toolchain choice

- **Playwright** (TypeScript or Python): primary choice for new suites. Built-in waiting, tracing, screenshot and video capture, parallel execution.
- **RobotFramework** with **Browser Library** (Playwright-backed) or **SeleniumLibrary**: preferred when the project already runs Robot, or when keyword-driven tests serve non-developer authors.
- **pytest-playwright**: when the Python side of the project already standardizes on pytest.

Match the project's existing convention. A second framework next to the one already present doubles the maintenance and splits the reports.

## Playwright MCP server (optional)

At session start, detect whether `@playwright/mcp` is registered in the harness. When it is, prefer its tools for browser interaction: DOM inspection, screenshots, network introspection and step-by-step exploration are faster and leave better artifacts than subprocess calls.

When it is absent, fall back to:

- `npx playwright` (Node projects) or `python -m playwright` (Python projects) for direct CLI use.
- A one-shot script through Bash.

Installation is opt-in and lives in global user config only:

```sh
task setup:playwright-mcp
```

Do not add the MCP server to a project-level config: the dependency is the operator's choice, not the repository's.

## Accessibility assertions

axe-core runs inside functional tests through `@axe-core/playwright` (TypeScript), `axe-playwright` (Python) or `robotframework-axelibrary`. For a one-off scan of a page, or to classify an axe results file, use `scripts/axe-scan.ts` (see SKILL.md).
