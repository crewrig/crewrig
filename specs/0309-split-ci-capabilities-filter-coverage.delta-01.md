---
id: "0309"
slug: split-ci-capabilities-filter-coverage
status: draft
complexity: standard
interaction-mode: AUTO
related-issue: 2012
version: 1.1.0
---

# Split the CI capability reference and check filter coverage

## ADDED

Delta-01 resolves two spec-class findings of the cold plan review of issue #2012 (verdict `https://github.com/crewrig/crewrig/issues/2012#issuecomment-6884933627`, seat `plan/2012`): v1-F2 (the deletion of `ci/ci-capabilities.yml` forces textual changes that R3, R4 and R12 forbid) and v1-F3 (R6 is fail-closed but has no rule for the reads of production code that a test drives). It also widens R12(a) for v1-F5. R1 to R11 stay as approved, except where MODIFIED below says otherwise.

**R13 (equivalence proof for R12(e)).** The PLAN SHALL prescribe, and the implementation SHALL perform and record in the pull request body that carries the split, this proof that R12(e) changes nothing else: (1) generate the output of the pre-split generator and the output of the post-split generator from the same logical reference (the capabilities moved, none edited); (2) in the pre-split output, and in the pre-split reference, replace only the occurrences R12(e) names; (3) the result SHALL equal the post-split output byte for byte when no include split is applied, and, when an include split is applied, SHALL equal it after the job-set comparison of R4; (4) the textual diff between the pre-split and the post-split outputs SHALL consist of exactly the lines R12(e) names, each listed with its count (path entries and header lines), and any other differing line fails the proof. When no occurrence of the old file is named in a path filter at implementation time (the count of R12(e) is zero), steps (2) and (4) hold with an empty list and the proof still runs. The proof SHALL be a script or a test run in the change, not a manual reading, so a reviewer can rerun it. Acceptance: the proof passes on the split tree; a fixture in which one further `paths:` entry differs between the two outputs fails it, naming the line.

**R14 (documented limit of R6).** `docs/ci-reference-format.md` SHALL state, in the style of the named gap of R4, the one residual limit of the input derivation of R6 as modified by this delta: a declaration of inputs (R6) is checked for form and for coverage, never for completeness, so a test or module whose declaration omits a path that its code reads at runtime is not detected. No other limit is accepted: a read that the derivation cannot resolve is a failure of the check (R6), never a named limit.

**Scenario:** A reference-only change still triggers the jobs that named the old file (R12(e), R13)

Given the split tree and a change that touches only one file of `ci/capabilities/`
When the triggered jobs are computed offline from the reference
Then every job whose `paths:` named `ci/ci-capabilities.yml` before the split is triggered on both engines, through the `ci/capabilities/**` entry, and the equivalence proof of R13 lists exactly those entries and the two header lines as the only textual differences.

**Scenario:** An unrelated path-filter edit hides behind the retargeting (R12(e), R13)

Given the post-split output differs from the pre-split output on a `paths:` entry that is not a self-reference to the old file
When the equivalence proof runs
Then it fails naming that line, and R12(e) does not excuse it.

**Scenario:** A test drives a library whose path it never names (R6)

Given a test imports `scripts/lib/ci-parity/reference-read.ts`, never writes `ci/capabilities` itself, and that module joins the root with the literal `ci/capabilities`
When the filter-coverage check derives the inputs of the test
Then `ci/capabilities/**` is an input of the test, and a job that runs the test with a filter that does not match it is reported as uncovered, naming the test, the input and the job.

**Scenario:** A library reads a path computed at runtime (R6, R14)

Given a test imports a repository module that reads a path taken from a parameter or a table, and neither the test nor the module declares its inputs
When the check runs
Then it fails naming the test and the call; with a declaration of the inputs added to the test it is checked like any other test, and a declaration that adds an input no job covers fails naming that input.

**Scenario:** A job for the reference-directory check is a permitted addition (R12(a))

Given the PLAN adds a job that runs only the tests this spec adds for the reference directory
When the invariants of R12 are checked
Then the job is permitted under (a), is listed in the pull request body, and no existing job gained or lost a command.

## MODIFIED

**R3, behaviour sentence.** Original: "The parity guard, the traceability, evidence and path-ownership checks, and the generator output SHALL behave as before for the same logical content: the set of jobs, their commands, triggers, path filters and stages, on both engines, does not change."

Replacement: "The parity guard, the traceability, evidence and path-ownership checks, and the generator output SHALL behave as before for the same logical content: the set of jobs, their commands, triggers, path filters and stages, on both engines, does not change, except for the self-reference retargeting of R12(e) and only that. After the split, every file of `ci/capabilities/` SHALL be owned by the path-ownership check."

**R4, equality clause.** Original: "when no include split is applied the output SHALL be line-for-line identical to the output of the pre-split generator on the same logical reference."

Replacement: "when no include split is applied the output SHALL be line-for-line identical to the output of the pre-split generator on the same logical reference, except for exactly the lines R12(e) names (the retargeted path entries and header lines 1 and 11), proved by R13. The effective-pipeline equality that precedes it is unchanged and holds after the same retargeting."

**R6, the derivation of inputs.** Original: "The inputs of a test are the repository files and globs the test opens, reads, lists or spawns: its own file, the files it opens, the directories it enumerates, every module it imports transitively from within the repository, and the Taskfile that resolves the `ci:<id>` command of each job that runs it (so a change to a task body that alters what runs is itself covered). Inputs are determinable only when every path the test touches is a string literal, or a join of literals with the repository-root constant, that the check can resolve statically. A test that builds any path from a table, a loop, an environment value or other computed data has undeterminable inputs, and the decidable rule is: it SHALL carry an explicit declaration of its inputs in a form the PLAN fixes (a table-built path set such as the one of `skill-size-budgets.test.ts` must declare it); a test with undeterminable inputs and no declaration SHALL fail, and a declaration is checked like static inputs. A declaration that is missing is never inferred as empty."

Replacement: "The inputs of a test are derived by this rule, the same on every run. (1) The modules considered are the test file, every repository module it imports transitively (static `import`, `require`, dynamic `import()` with a literal specifier, excluding `node:` built-ins and `node_modules`), and every repository script it spawns by a literal path, each treated as an imported module with its own transitive imports. (2) The inputs are: each of those files; every path-like literal, and every join of literals with the repository-root constant, that occurs in any of those modules, where a literal is path-like when it contains a glob metacharacter or, resolved against the repository root, names an existing repository file or directory, with the exact lexical test fixed by the PLAN and covered by a test; the Taskfile that resolves the `ci:<id>` command of each job that runs the test (so a change to a task body that alters what runs is itself covered); and the declaration of (4). Over-flagging (a literal that the test does not really read) is accepted and never under-flagging. (3) A test has undeterminable inputs when any of those modules calls a file read, list, existence, stat or spawn API (the closed list of APIs is fixed by the check and tested) with a path argument that is not a literal, a join of literals and the repository-root constant, or an identifier bound only to such an expression, so a parameter, a table, a loop, an environment value, a spawn that does not resolve to a repository script and any other computed path all count. (4) A test with undeterminable inputs SHALL carry an explicit declaration of the repository files and globs it reads, in a form the PLAN fixes, in the test file; a repository module MAY carry the same declaration, and every test that imports it transitively then inherits it. A declaration ADDS to the inputs of (2) and never replaces them. A declaration MAY list a literal-derived input as not read (an exclusion), each with a non-empty reason, and an exclusion that no longer matches a literal SHALL itself fail as stale. A table-built path set such as the one of `skill-size-budgets.test.ts` is declared this way. A test with undeterminable inputs and no declaration SHALL fail, naming the test and the call; a declaration is checked like derived inputs; a declaration that is missing is never inferred as empty. The one residual limit, accepted and documented under R14, is that a declaration is not verified for completeness."

**R12, lead and (a) and (d).** Original (a): "(a) the new jobs the spec requires, one for the filter-coverage check (R6) and, when the per-file limit test and the per-kind report need their own capability, those;"

Replacement (a): "(a) the new jobs the spec requires, each running only the checks and tests this spec adds: one for the filter-coverage check (R6) and, as the PLAN needs, the ones for the per-file limit test, the per-kind report, the shared reader and reference-directory tests, and the self-tests of the checks; no existing job gains or loses a command or a test through them;"

Original (d): "(d) the move of capabilities between files (R2) and the regenerated GitLab output (R4)."

Replacement (d): "(d) the move of capabilities between files (R2) and the regenerated GitLab output (R4), the latter equal to the pre-split output except for (e);" and a new item follows: "(e) the retargeting of self-references to the reference file, which the deletion of `ci/ci-capabilities.yml` (R2) makes unavoidable: every path-filter entry that is exactly `ci/ci-capabilities.yml` (18 `paths:` entries at `origin/main` `e06dd543`, each with its generated copy in `.gitlab-ci.yml`, a count the PLAN re-measures under R11) becomes exactly `ci/capabilities/**`, and the two generated header lines that name the file (lines 1 and 11 of `.gitlab-ci.yml` at that commit, produced by the generator header text) name the directory `ci/capabilities/` instead; those textual changes and nothing else in the reference, the workflow files and the generated output, proved by R13. The retargeted entry fires for the same logical event as before (a change of the reference) and is not a widening under (c)."

The closing words "Permitted changes, and only these" in the lead of R12 now include (e). Any other change to a job's command, trigger or path filter stays out of scope.

**Scenario "Behaviour is unchanged by the split (R3, R4, R12)", Then clause.** Original: "Then the generated GitLab output equals the generator output, the set of jobs with their commands, stages, needs and `rules:` is identical to the pre-split set, and the required contexts `ratchet` and `lint-typescript` are unchanged."

Replacement: "Then the generated GitLab output equals the generator output, the set of jobs with their commands, stages and needs is identical to the pre-split set, their `rules:` are identical except for the entries R12(e) retargets, and the required contexts `ratchet` and `lint-typescript` are unchanged."

## REMOVED

Nothing is removed. Superseded wording is replaced under MODIFIED; the strictness "identical", "do not change" and "and only these" of the originals are narrowed by exactly the one named exception, R12(e), and by no other.
