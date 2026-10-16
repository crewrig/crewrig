---
id: "0261"
slug: e2e-harness-probes-typescript
status: implemented
complexity: standard
interaction-mode: MINIMAL
related-issue: 1342
version: 1.1.0
---

# End-to-end harness and probes in TypeScript

*Delta 01 of `specs/0261-e2e-harness-probes-typescript.md`. Source: the plan review of
ticket 1342 (seat `plan/1342`, finding v1-F2) and the obligation that row J1a recorded on
the logbook (issue #1342, comment 6210468980) from its spec `specs/0260-*` (pull request
1617, requirement 3): group G15 of `scripts/tests/test-usage-capture.sh`, which sources
`scripts/lib/usage-headless.sh`, is ported by row J1a to `scripts/tests/usage-headless-agy.test.ts`,
and row J3 deletes that test in the same pull request as the library. It runs under the
release-branch regime of `specs/0215-shell-to-typescript-migration.delta-04.md`: its
spec-PR targets `release/1231-ts-migration`, and the base ref of every protocol is
`origin/release/1231-ts-migration` (requirement 34 of that delta). This delta modifies
requirement 17 and one scenario. The version is a MINOR bump: it adds a duty and a proof
obligation and changes no behaviour of the shell. This delta opens no question.*

## ADDED

**Scenario:** The ported library test is deleted with the library

Given row J1a has merged `scripts/tests/usage-headless-agy.test.ts`, which spawns `bash`
to source `scripts/lib/usage-headless.sh` and asserts the six checks of its group G15, and
the TypeScript test of `scripts/lib/usage-headless.ts` asserts the same six checks
When the last pull request of this row retires the library
Then that pull request deletes `scripts/lib/usage-headless.sh`, its allowlist line and
`scripts/tests/usage-headless-agy.test.ts` together, with the CI wiring of the test, and
`git grep` finds no `source` of the library.

## MODIFIED

Requirement 17, its last sentence. Original: "This row SHALL delete each of the two
files in its last pull request when `git grep` finds no `source` of it and no
sandbox-mutating suite that reads its text; when a consumer of another row remains, this
row SHALL leave the file, its allowlist line and its path filters untouched and SHALL
record the retirement as ledgered for the row that removes the last consumer (J4 at the
latest), with the consumers named, in the logbook of #1342." Replacement: "This row SHALL
delete each of the two files in its last pull request when `git grep` finds no `source` of
it and no sandbox-mutating suite that reads its text, except that a consumer that row J1a
has ported and declared in its spec `specs/0260-*` as a test this row deletes with the
library (at authoring time `scripts/tests/usage-headless-agy.test.ts`, the port of group
G15 of `test-usage-capture.sh`) is deleted in that same pull request, with its CI wiring,
and is not a reason to leave the library. Before that deletion, the TypeScript test of
`scripts/lib/usage-headless.ts` SHALL assert every check of group G15 (the reply written
to the out file byte for byte; exactly one record stored and the canary absent from the
usage root; no temporary file ever held the reply; the temporary directory empty
afterwards; a non-JSON file and a non-string `response` left byte-identical), so that the
deletion drops no assertion. When any other consumer of another row remains, this row SHALL
leave the file, its allowlist line and its path filters untouched and SHALL record the
retirement as ledgered for the row that removes the last consumer (J4 at the latest), with
the consumers named, in the logbook of #1342. A test file that is not on the release branch
when the last pull request is rebased is not a consumer."

Scenario "A retired library still has a consumer". Original: "Given
`scripts/tests/test-usage-capture.sh` still sources `scripts/lib/usage-headless.sh` / When
the last pull request of this row runs `git grep` for its `source` / Then the file is left
in place, its retirement is ledgered with the consumer named, and the allowlist line is
untouched." Replacement: the same scenario, with the Given reading "`scripts/tests/test-usage-capture.sh`
or any other suite of another row that row J1a has not declared as deleted by this row
still sources `scripts/lib/usage-headless.sh`".

## REMOVED

Nothing.
