---
id: "0302"
slug: ci-agents-modernization
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 1942
version: 1.1.0
---

# Modernize the ci-debugger and ci-parity agents

*Delta 01 of `specs/0302-ci-agents-modernization.md`. Source: issue #1942, seat verdict `review/1942` pass 1 on pull request #1952 (finding i1-F4, class `spec`). R7 defines the exit codes of `scripts/classify-ci-drift.ts` for the clean, mixed, `Error:` and non-harness inputs but is silent on two inputs that fall between its lines. The implementation and its tests already pin both answers, and both fail closed; this delta records them so the exit table is complete. No behaviour changes. Requirements modified: R7 (exit codes and the validity-bullet sentence) and R11 (tests). R8 is unchanged: its instruction to read the footer count is the agent-side half of the partial-list rule recorded here. Every other requirement is unchanged. This delta opens no question.*

## ADDED

No requirement is added. Two scenarios are added.

### Failure path — a `FAILED:` footer or validity header with no divergence record is unreadable

- **Given** harness output that holds a `FAILED: <n> CI parity violation(s) detected` footer, or a `FAILED: <n> reference-validity violation(s)` header with no `- <error>` bullet after it, and no `DRIFT:` record, no `OK:` line and no unindented `Error:` line,
- **When** the classifier reads it,
- **Then** it exits `3` with one `precondition` finding stating that a `FAILED` line reports violations but no divergence record was found, and `data` is `null`, because the verdict is unreadable and the run must fail closed.

### Happy path (degraded) — records with no footer and no `OK:` line still exit 1

- **Given** harness output that holds one or more divergence records but no `FAILED: <n> CI parity violation(s) detected` footer, no `OK:` line and no unindented `Error:` line (the harness aborted without printing a footer or an `Error:` line),
- **When** the classifier reads it,
- **Then** it exits `1` with every record classified, one error finding per record and no warning finding, because exit `1` already fails closed, and the `ci-parity` agent compares the footer count it reads from the same file with the record count and reports the list as possibly partial when the footer is missing or its count differs.

## MODIFIED

<!-- markdownlint-disable MD029 -->

7. **R7 (classifier script), exit-codes clause, original:** "`3` when the input is unreadable, holds no record and neither an `OK:` line nor a `FAILED:` footer, or holds an unindented line beginning `Error:` (the harness aborted before a verdict; the finding names that line and the number of records seen before it)."

**Amended (R7, exit `3` clause, plus one sentence appended to the exit-code text):** Exit `3` holds when the input is unreadable, when it holds no record and no `OK:` line (whether or not a `FAILED:` footer or validity header is present: a `FAILED:` line with no record means the verdict is unreadable, so the finding is a `precondition` finding stating that a `FAILED` line reports violations but no record was found, and an input with neither `OK:` nor `FAILED:` is not harness output), or when it holds an unindented line beginning `Error:` (unchanged: the harness aborted before a verdict; the finding names that line and the number of records seen before it). A `- <error>` validity bullet counts as a record only after a `FAILED: <n> reference-validity violation(s)` header, so a header with no bullet is a `FAILED:` line with no record and exits `3`. Records with no `FAILED: <n> CI parity violation(s) detected` footer and no `OK:` line (the harness aborted without printing a footer or an `Error:` line) exit `1` with the records classified and no warning: the exit code already fails closed, and the `ci-parity` body (R8) reads the footer count from the same file and reports the list as possibly partial when the count differs from the record count or the footer is missing. The rest of R7 is unchanged.

11. **R11 (classifier tests), original:** "... non-harness input, an `Error:` line and an unreadable path (exit `3`); a usage error (exit `2`); ... A fixture file SHALL hold at least one sample line per normalized template."

**Amended (R11):** The test list also SHALL cover: a `FAILED:` footer with no record, and a validity header with no bullet (each exit `3` with a `precondition` finding and `data` null); and records with no footer and no `OK:` line (exit `1`, every record classified, no `mixed-input` or other warning finding). The drift-guard test feeds the validity-bullet sample lines to the classifier with a `FAILED: <n> reference-validity violation(s)` header prepended, because the samples file holds bullets without a header and bullets count only after that header (R7). The rest of R11 is unchanged.

## REMOVED

Nothing is removed.
