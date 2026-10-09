---
id: "0251"
slug: repository-wide-scans-on-every-change
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1508
version: 1.0.0
---

# Run repository-wide scans on every change, not only when their own script changes

## Intent

A continuous-integration check whose verdict depends on files anywhere in the
repository runs on every pull request and every push to a protected branch, so
the change that introduces a violation is the change that turns red. A check
whose verdict depends on a known, finite set of files runs whenever any file of
that set changes, not only when the check's own script changes. A contributor
never again sees a green pull request that carries a violation, followed by a
red run on an unrelated later change that is then blamed for it.

## Requirements

### Grounding: the observed defect and the audit

All references are to `crewrig/main` at `4ac29c88`.

The `misc` capability (`ci/ci-capabilities.yml:838-885`; GitHub job
`.github/workflows/build.yml:913-965`; generated GitLab job
`.gitlab-ci.yml:776`) is `changeset-gated: true` and filtered, on both
`pull-request` and `push`, to the files of its own checks
(`ci/ci-capabilities.yml:843-856`). Two of its commands read files outside that
filter:

- `scripts/check-no-machine-paths.sh` (spec 0081 requirements 5-6) runs
  `git grep` over every tracked file (`scripts/check-no-machine-paths.sh:62`).
  Row C3 of epic #1231 (#1329) added 14 `/home/<user>/` tokens in
  `scripts/tests/fixtures/mempalace-transcript/recognition-corpus.json` and
  `specs/0247-mempalace-transcript-hook-typescript.md`; its pull requests #1476
  and #1486 were green because `misc` was skipped. The check first ran on a
  later push to `release/1231-ts-migration` (run 37898770837) and failed; the
  `cancel-on-failure` step cancelled the whole run, and #1497, #1504, #1506 and
  #1507 merged on the red branch. Fixed by #1503 and #1505.
- `scripts/check-gemini-overlay-enrollment.sh` reads
  `scripts/setup-gemini-interactive.sh` and `config/gemini/settings.json`
  (`scripts/check-gemini-overlay-enrollment.sh:51-52`), neither of which is in
  the filter. (Issue #1508 says it reads `artifacts/`; it does not.)

Issue #1508 also lists `scripts/check-pipefail-grep.sh`. Only its *test* runs in
`misc` (`.github/workflows/build.yml:954-956`); the scan itself runs in
`grep-anti-patterns` (`ci/ci-capabilities.yml:1493`, GitHub job in
`.github/workflows/scripting-conventions.yml:21`), whose filter `scripts/**`,
`hooks/**` matches the `scripts/` and `hooks/` directories it scans
(`scripts/check-pipefail-grep.sh:26`). It is not affected.

Audit of every capability carrying a `paths:` filter, comparing what each
check command reads with what its filter covers:

| Capability | Check command | What it reads | Filter covers it? |
|---|---|---|---|
| `misc` | `check-no-machine-paths.sh` | every tracked file | **no** |
| `misc` | `check-gemini-overlay-enrollment.sh` | `scripts/setup-gemini-interactive.sh`, `config/gemini/settings.json` | **no** |
| `test-wiring` (`ci/ci-capabilities.yml:643`) | `check-test-wiring.sh` | `scripts/tests/test-*.sh`, `ci/test-wiring-exemptions.txt`, `.github/workflows/*.yml`, `ci/ci-capabilities.yml` (`scripts/check-test-wiring.sh:41-43`) | **no** — the two CI surfaces are missing, so removing a suite's wiring from the reference or a workflow does not run the check |
| `core-paths` (`ci/ci-capabilities.yml:421`) | `check-core-paths.sh` | every path named by `.crewrig/core-paths.txt` anywhere in the tree (forward direction), and the output of `scripts/build-components.sh --list-output-dirs` (reverse direction, `scripts/check-core-paths.sh:97-110`) | **no** — deleting a manifest-listed path elsewhere, or changing the build script's output directories, does not run the check |
| `markdown-links` (`ci/ci-capabilities.yml:1023`) | `check-markdown-links.sh` | every tracked `*.md` and the target of every relative link, which may be any tracked file (`scripts/check-markdown-links.sh:18`) | **no** — renaming or deleting a non-Markdown link target does not run the check |
| `grep-anti-patterns` | four `scripts/` + `hooks/` scans | `scripts/`, `hooks/`, `ci/bash32-forbidden.txt` | yes |
| `docs-index` | `build-docs-index.sh --check` | `docs/**/*.md` | yes |
| `figure-labels` | `check-figure-labels.sh` | `docs/assets/**` | yes |
| `check-metadata-keys`, `check-agent-profiles` | their checkers | `artifacts/**` | yes |
| `check-model-mappings` | its checker | `model-mappings/**` | yes |
| `check-claude-agent-layout` | its checker | `.claude/agents/**` | yes |

The remaining filtered capabilities run test suites or generators whose input
set their filter already lists; they carry no repository-wide scan. The
structural cause: `path-ownership` (spec 0147 delta-01 R11-R17) proves that every
tracked file is owned by *some* filter, never that a check reacts to a change of
the files it reads. The daily exhaustive run (`changeset-coverage`,
`ci/ci-capabilities.yml:1063`) is a backstop on `main` only; it never runs on a
`release/**` branch, where the incident happened.

### Normative requirements

1. Each of the following checks SHALL run on every pull request targeting
   `main` or `release/**` and on every push to those branches, whatever files the
   change touches: `scripts/check-no-machine-paths.sh`,
   `scripts/check-markdown-links.sh` (its whole-repository mode), and
   `scripts/check-core-paths.sh`.
2. The checks of requirement 1 SHALL run in one new portable capability, id
   `repository-scan`, declared in `ci/ci-capabilities.yml` with `pull-request`
   and `push` triggers on `main` and `release/**` and no `paths:` filter, and
   SHALL no longer run in `misc`, `markdown-links` or `core-paths`.
3. The `repository-scan` capability SHALL carry only whole-repository checks; it
   SHALL NOT run test suites, so that the cost added to every change is that of
   the scans alone.
4. The `repository-scan` capability SHALL NOT be `changeset-gated`, and SHALL NOT
   be filtered with a catch-all glob such as `**`: a catch-all glob would make
   `path-ownership` count every tracked file as owned and turn the check vacuous.
5. `scripts/check-gemini-overlay-enrollment.sh` SHALL run whenever a change
   touches `scripts/setup-gemini-interactive.sh` or
   `config/gemini/settings.json`, in addition to the paths that trigger it
   today.
6. `scripts/check-test-wiring.sh` SHALL run whenever a change touches any
   `.github/workflows/*.yml` file or `ci/ci-capabilities.yml`, in addition to the
   paths that trigger it today.
7. Every test suite that runs today in `misc`, `markdown-links`, `core-paths` or
   `test-wiring` SHALL keep running under at least the paths that trigger it
   today; no check performed on a change before this spec SHALL stop being
   performed on that change (spec 0147 requirement 10).
8. The GitHub Actions pipeline and the generated GitLab pipeline SHALL agree on
   the new capability and on every changed filter: `scripts/check-ci-parity.sh`
   SHALL pass and the `.gitlab-ci.yml` drift check of `scripts/build-ci.sh`
   SHALL report no drift (spec 0049, spec 0147 requirement 9).
9. `scripts/check-path-ownership.ts` SHALL pass after the change. A tracked
   file that loses its last owning filter as a consequence of this spec SHALL
   either be re-owned by a filter or carry an exemption whose reason names
   `repository-scan` (spec 0147 delta-01 R17).
10. Every check of requirement 1 SHALL pass on the tree of the change that
    introduces `repository-scan`, so that its first run on `main` is green.
11. `docs/ci-reference-format.md` SHALL state the trigger rule this spec applies:
    a check whose input is a known, finite set of files SHALL be triggered by a
    filter covering every file of that set; a check whose input is the whole
    repository, or a set of files that cannot be enumerated in advance, SHALL run
    in a capability with no `paths:` filter.
12. The failure output of each moved check SHALL be unchanged: it SHALL still
    name the offending file and line, now under the `repository-scan` job.

## Scenarios

**Scenario:** A machine path introduced anywhere is rejected on its own pull request

```text
Given main at the state after this spec is implemented
When  a pull request adds a `/home/<user>/` token (a real login, not a placeholder)
      to a JSON fixture under scripts/tests/fixtures/ and touches no script
Then  the `repository-scan` job runs on that pull request
And   it fails, naming the fixture file and line
```

**Scenario:** A documentation-only change still runs the repository-wide scans

```text
Given main at the state after this spec is implemented
When  a pull request edits only a paragraph of docs/ci-reference-format.md
Then  the `repository-scan` job runs and passes
And   the test suites of `misc` do not run
```

**Scenario:** Renaming a script that a document links to is caught

```text
Given a tracked document that links to scripts/foo.sh by a relative link
When  a pull request renames scripts/foo.sh and touches no Markdown file
Then  the `repository-scan` job fails, naming the document and the broken link
```

**Scenario:** Deleting a core-listed path is caught where it happens

```text
Given .crewrig/core-paths.txt lists a directory with tracked content
When  a pull request deletes every tracked file of that directory
      and touches neither the manifest nor docs/layers.md
Then  the `repository-scan` job fails, naming the unresolved manifest entry
```

**Scenario:** Un-wiring a test suite from the reference is caught

```text
Given a test suite under scripts/tests/ with no test-wiring exemption
When  a pull request removes that suite's command from ci/ci-capabilities.yml
      and from .github/workflows/build.yml, and touches nothing under
      scripts/tests/
Then  the `test-wiring` job runs and fails, naming the orphaned suite
```

**Scenario:** A Gemini overlay deployed but not enrolled is caught

```text
Given main at the state after this spec is implemented
When  a pull request makes scripts/setup-gemini-interactive.sh deploy a new
      overlay file without enrolling it in config/gemini/settings.json
Then  the `misc` job runs and its enrollment check fails, naming the overlay
```

**Scenario:** A catch-all filter on the new capability is refused

```text
Given a candidate change that gives `repository-scan` a `paths: ["**"]` filter
When  the change is reviewed against this spec
Then  it is rejected under requirement 4, because every tracked file would then
      count as owned and `path-ownership` could no longer find an unowned file
```

**Scenario:** Engine parity holds after the split

```text
Given the change that implements this spec
When  scripts/check-ci-parity.sh and the build-ci.sh drift check run
Then  both pass, and .gitlab-ci.yml carries a `repository-scan` job with
      merge-request and push rules and no `changes:` list
```

## Out of scope

- Making `repository-scan`, `misc`, `path-ownership` or any other job a
  required status check of the `main-protected` or `release-protected`
  rulesets (today only `ratchet` and `lint-typescript` are). That is a separate
  governance decision, taken by a repository admin outside the repository's
  files, as `docs/ci-reference-format.md` already records for `path-ownership`.
- Changing the `cancel-on-failure` action, which cancelled the whole run in the
  incident and made the failure look like a spurious cancellation.
- Diff-based scanning (examining only the files a change touches): rejected,
  because it needs a second, full mode as a backstop and that backstop arrives
  after the merge, as the incident shows.
- Running the scans unconditionally while keeping one `misc` job and filtering
  only its tests: not expressible without extending the reference format,
  since a capability is exactly one job and its GitHub in-job filter must be a
  single filter named after the capability (`docs/ci-reference-format.md`,
  *GitHub path filters are compared*).
- A machine-checked marker in `ci/ci-capabilities.yml` declaring a command
  repository-wide: rejected in favour of the documented rule of requirement 11,
  because the marker depends on the same author discipline as choosing the
  right filter.
- Narrowing the filters of `markdown-links` and `core-paths` once their scans
  have moved out: allowed but not required; the implementation plan decides,
  within requirements 7 and 9.
- Rewriting any check script or changing what it detects.
- Propagating the change to `release/**` branches: it reaches them through the
  regular sync of `main` into each release branch.
- Executing the generated GitLab pipeline on a live GitLab instance; it is
  generated and drift-checked only, as for every other capability.

## Open questions

- None. Decisions taken with the owner during the INTERMEDIATE interview: split
  `misc` with a new capability that has no `paths:` filter (over a single job,
  diff-based scanning, or grafting the scans onto `path-ownership`); fix every
  gap the audit found, not only `misc`; record the trigger rule in
  `docs/ci-reference-format.md` rather than add a machine-checked marker; tier
  `small`; required status checks out of scope. Decided by the spec author
  without changing the WHAT: the capability id `repository-scan` (the wording of
  issue #1508), and the rule that a check with a finite input set gets a wider
  filter rather than a move to `repository-scan`.
