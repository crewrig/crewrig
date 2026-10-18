---
id: "0267"
slug: test-harness-host-safety
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1673
version: 1.0.0
---

# Test-harness host safety

_Complexity `small`: one new checker with its allowlist and CI step, plus one documentation clause; no architectural decision and no public contract changes. The friction behind it is the Harness Curator cluster on issue #1673 (single report, severity `high`: a test harness emptied `/opt/homebrew` on a developer host)._

## Intent

A contributor or an agent running the repository's test harnesses can no longer lose files outside the scratch directories those harnesses created. A change that introduces a delete, copy-over or move whose target comes from the process environment or the command line, with no proof that the target lies inside a directory the harness made itself, is rejected before merge with a message naming the file, the line and the way to fix it. Every agent told to run or write test code is also told, in its brief, that it never mutates a path outside its own scratch directory.

## Requirements

1. The repository SHALL provide a host-safety check that reports, for each file under `scripts/tests/`, `scripts/lib/` and the top-level `scripts/*.ts` entry points, every call to a destructive file operation whose target path derives from `process.env`, `process.argv`, `os.homedir()` or a `PATH` entry, and that is not preceded in the same function by a containment check.
2. The destructive file operations covered SHALL be at least the recursive-delete, copy, rename, and unlink families of the Node `fs` and `fs/promises` modules, in synchronous, callback and promise forms.
3. A target path SHALL count as derived from an untrusted source when it is, or is assigned from, an expression reading one of the sources in requirement 1, directly or through assignments to local variables, string concatenation, template literals, and `path` join or resolve calls within the same file.
4. A call SHALL count as contained when, earlier in the same function, a containment check (`assertInside` or `isInside` from `scripts/tests/lib/differential-guard.ts`, or a successor named in the allowlist header) is applied to that same path expression against a root made with `mkdtemp`.
5. A call whose target derives only from a directory the file itself made with `mkdtemp`, or from the repository checkout root, SHALL NOT be reported.
6. Each finding SHALL be one stderr line of the form `host-safety: <rule-id>: <path>:<line>: <message>`, and the message SHALL name the untrusted source and the fix ("guard with `assertInside(root, p)` against an `mkdtemp` root").
7. The check SHALL exit 0 when clean, 1 when there are findings, and 2 on a wiring fault (unreadable allowlist, missing scan root), mirroring `scripts/check-ratchet.ts`.
8. The check SHALL read only. It SHALL NOT execute, import or evaluate any file it scans, and SHALL NOT delete, move, restore or rewrite any path.
9. A finding SHALL be silenced only by an entry in a committed allowlist, `ci/host-safety-allowlist.txt`, naming the file and the call site and carrying a non-empty written justification; an entry without a justification SHALL be a finding.
10. The allowlist SHALL be shrink-only in the ratchet sense: a pull request SHALL NOT add an entry relative to the merge base, an entry that no longer matches a call site SHALL be a finding, and the file SHALL be sorted and unique.
11. The check SHALL land with zero unjustified findings on the repository as merged; the initial allowlist SHALL hold only call sites a reviewer has read and justified one by one.
12. The check SHALL run in the pull-request CI of this repository as its own named step, next to the shell and JavaScript ratchet, and SHALL have its own regression suite run in the same job.
13. The check SHALL be runnable locally as a `Taskfile.yml` entry.
14. The regression suite SHALL prove each rule against fixture trees the suite itself creates with `mkdtemp`, including canary directories and files it creates itself, and SHALL assert after every run that every canary is intact.
15. No test, fixture, script or command added by this spec SHALL delete, restore, move or rewrite a path that the same test did not create with `mkdtemp`, and no such test SHALL run an existing differential harness.
16. `docs/agent-team-protocol.md` SHALL carry one clause, introduced in the style of its _Cwd verification_ clause, that states the rule "never delete, restore, move or overwrite a path outside the scratch directory you created yourself; derive nothing destructive from environment variables, arguments, `HOME` or `PATH`", and SHALL require the orchestrator to embed that clause verbatim in every `Agent` spawn brief whose task runs, writes or changes test or harness code.
17. That clause SHALL be the single source of truth for the brief rule: no other document or agent source SHALL restate its text, and any other mention SHALL link to it.
18. The clause SHALL bind every specialist role and the orchestrating session alike, and SHALL state that a harness defect found at run time (a destructive path from the environment) is reported to the orchestrator rather than worked around.
19. The check's rule identifiers, scan roots, allowlist location and exit codes SHALL be documented in one reference page under `docs/`, linked from the clause in requirement 16.
20. The change SHALL touch no file under `artifacts/`, `.claude/`, `.gemini/` or `extensions/` unless a later amendment says otherwise; if one is touched, the build step, the regenerated outputs, the `metadata.provenance.version` bump and the `docs/cli-matrix.md` update SHALL ship in the same commit.

## Scenarios

**Scenario:** An environment-derived recursive delete is rejected

Given a test helper that reads `process.env.SHARED_DIR` and calls a recursive `fs.rmSync` on it with no containment check
When the host-safety check runs on the pull request
Then it exits 1 and prints one `host-safety:` line naming that file, that line, the environment source and the `assertInside` fix

**Scenario:** A guarded destructive call passes

Given the same helper, but `assertInside(root, dir)` runs on the same path earlier in the function, with `root` made by `createRoot`
When the check runs
Then it exits 0 and prints no finding for that file

**Scenario:** A call on the file's own scratch directory passes

Given a test that makes `tmp` with `fs.mkdtempSync` and later removes `tmp` recursively
When the check runs
Then it prints no finding for that call, so the several hundred routine cleanups in the suite stay quiet

**Scenario:** An indirect untrusted path is still caught

Given a path built as `path.join(process.env.HOME, "x")`, stored in a variable, then passed to `fs.cpSync` as the destination
When the check runs
Then it reports the `cpSync` call with `HOME` named as the source

**Scenario:** An allowlisted call site is accepted, a bare entry is not

Given one finding silenced by an allowlist entry with a justification and one silenced by an entry with an empty justification
When the check runs
Then the first produces no finding and the second produces an unjustified-entry finding

**Scenario:** The allowlist cannot grow

Given a pull request that adds a new entry to `ci/host-safety-allowlist.txt`
When the check runs against the merge base
Then it exits 1 with a list-growth finding, as the existing ratchet does for its lists

**Scenario:** The check never touches what it scans

Given a fixture tree in which the suite has created a canary directory and a file that a scanned source would delete if it ran
When the check runs over that tree
Then the canary still exists afterwards and no scanned file was executed

**Scenario:** A brief carries the rule

Given the orchestrator spawns a `developer` to rewrite a harness
When it composes the spawn brief following `docs/agent-team-protocol.md`
Then the brief contains the clause of requirement 16 verbatim and links to the protocol rather than restating the rule elsewhere

**Scenario:** A reviewer finds a brief without the clause

Given a spawn brief for test-harness work that omits the clause
When a REVIEW pass audits the session
Then it emits a `class: tech` finding citing the protocol clause

## Out of scope

- The runtime containment helper `scripts/tests/lib/differential-guard.ts` and its use in the differential libraries. It already ships and covers part (1) of the reporter's suggestion, "a harness never deletes or restores a path it did not create with `mkdtemp`": it exports `assertInside`, `isInside`, `createRoot` and `tmpEnv`, every destructive call in `scripts/tests/lib/differential-*.ts` runs behind `assertInside(root, p)` with a `root` the harness made itself, and nothing read from `process.env`, `argv`, `HOME`, a `PATH` entry or a git remote is trusted on its own. This spec changes none of that; it adds parts (2) and (3), which are not shipped. Changing the helper's behaviour or API is a separate ticket.
- A runtime sandbox, a container, a `chroot` or an OS-level permission boundary for test runs.
- Recovery tooling for a damaged host, and backing up or snapshotting paths outside a harness's own root.
- Non-TypeScript code: shell was removed from the repository by epic #1231, and Python is bound by the existing ratchet.
- Destructive operations performed by external commands (`rm -rf` in a spawned process, `git clean`, `brew`), unless an open question below is resolved in favour of including them.
- Cross-file and cross-function taint tracking; the check is deliberately intra-file and intra-function, and its false negatives are accepted and documented.
- Rewriting the several hundred existing `mkdtemp` cleanups, or refactoring existing tests to call the containment helper.
- Edits to the `developer`, `tester` or any other agent source, and the matching build and version bump (see open questions).
- Enforcement of the brief rule by tooling; it is a documented protocol rule audited in REVIEW.

## Open questions

- Parser for the check: TypeScript is pinned at 7.0.2, whose programmatic API may not expose the classic compiler API used for an AST walk. The plan needs to decide between the available TS 7 API, a small dedicated parser, or a scoped regex pass, and to state the measured false-positive rate on the current tree (464 files already contain `rmSync`, `cpSync` or `renameSync`, 67 of them outside `scripts/tests/`).
- Whether external-command destructive operations (`rm -rf` strings passed to a spawned process or `git clean`) join the first version, or follow once the in-process rules are stable.
- Whether `writeFileSync` and `appendFileSync` on an untrusted path ("rewrites", per the hard rule) belong to the covered operations, or only the delete, copy and rename families.
- Whether the brief clause should also be echoed, by reference only, in the `developer` and `tester` agent sources. That would require the build, regenerated outputs, a `metadata.provenance.version` bump and a `docs/cli-matrix.md` check; the draft keeps it out to avoid a second source of truth (requirement 17).
- The exact allowlist line format and its key (file plus enclosing function, or file plus call text) so the entry survives line-number drift; the draft requires only file, call site and justification.
- Whether the check belongs in the existing ratchet job or in a job of its own with a path filter, given that `scripts/check-test-wiring.ts` currently governs only shell test scripts and TypeScript suites are wired into `.github/workflows/build.yml` by hand.
