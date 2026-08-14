---
id: "0140"
slug: spec-linter-leaked-scaffolding-guard
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 890
version: 1.0.0
---

# Spec linter rejects leaked tool scaffolding

## Intent

Spec files in the repository must not contain leaked LLM tool scaffolding or invocation markup.
Today, `scripts/lib/spec-linter.js` validates frontmatter metadata, heading hierarchy, and base-branch invariants, but ignores raw tool scaffolding XML tags (such as `</content>`, `</invoke>`, `<tool_call>`, etc.). As a result, a spec carrying leaked tool scaffolding passes linting with exit code 0 (`green-signal-certifies-adjacent-property`). This spec extends `scripts/lib/spec-linter.js` to detect leaked tool scaffolding tags and fail linting with an explicit diagnostic.

## Requirements

1. `scripts/lib/spec-linter.js` SHALL inspect the content of every linted spec file for leaked LLM tool scaffolding markup.
2. The linter SHALL recognize tool scaffolding markup patterns including standalone or leaked opening/closing tool execution tags such as `</content>`, `</invoke>`, `<invoke...>`, `<tool_call>`, `</tool_call>`, `<thought>`, `</thought>`, `<tool_use>`, `</tool_use>`, `<function_call>`, and `</function_call>`.
3. Lines within markdown code blocks (fenced by ` ``` `) SHALL be exempt from this check when they serve as illustrative code examples or documentation.
4. When any leaked tool scaffolding tag is detected outside code blocks, `scripts/lib/spec-linter.js` SHALL emit a semantic error specifying the file path, line number, and offending tag, and increment the failure count so the linter exits with code 1.
5. The regression test suite `scripts/tests/test-spec-linter.sh` SHALL include test cases asserting that a spec containing leaked tool scaffolding fails linting with exit code 1, while a valid spec passes cleanly.

## Scenarios

**Scenario:** spec file with leaked `</content>` and `</invoke>` tags fails linting

Given a spec file containing lines `</content>` and `</invoke>` outside code blocks
When `scripts/lib/spec-linter.js` lints the file
Then linting fails with exit status 1
And the output reports the file, line number, and detected tool scaffolding tag

**Scenario:** spec file with tool tag inside a fenced code block passes linting

Given a spec file containing `</invoke>` inside a markdown code block (` ``` `)
When `scripts/lib/spec-linter.js` lints the file
Then linting passes with exit status 0

## Out of scope

- Auto-remediation or automatic stripping of leaked tags by the linter (the linter reports and fails; removal remains the author's responsibility).
- Extending the check to non-spec markdown files outside the scope of `spec-linter.js`.

## Open questions

(None.)
