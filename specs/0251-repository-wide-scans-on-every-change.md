---
id: "0251"
slug: repository-wide-scans-on-every-change
status: implemented
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

Audit of every capability carrying a `paths:` filter on its `pull-request`
trigger, comparing what each check command reads with what that filter covers.
A *check command* is any command that is neither a test suite nor a dependency
install. What a check reads includes every helper library it sources, directly
or transitively: a change to a helper changes the check's verdict as surely as a
change to its data, and is the same "only its own script" defect the Intent
names. For a drift check, it also includes every committed output the check
compares against its sources.

| Capability | Check command | What it reads | Filter covers it? |
|---|---|---|---|
| `misc` | `check-no-machine-paths.sh` | every tracked file | **no** |
| `misc` | `check-gemini-overlay-enrollment.sh` | `scripts/setup-gemini-interactive.sh`, `config/gemini/settings.json` | **no** |
| `test-wiring` (`ci/ci-capabilities.yml:643`) | `check-test-wiring.sh` | `scripts/tests/test-*.sh`, `ci/test-wiring-exemptions.txt`, `.github/workflows/*.yml`, `ci/ci-capabilities.yml` (`scripts/check-test-wiring.sh:41-43`) | **no** — the two CI surfaces are missing, so removing a suite's wiring from the reference or a workflow does not run the check |
| `core-paths` (`ci/ci-capabilities.yml:421`) | `check-core-paths.sh` | every path named by `.crewrig/core-paths.txt` anywhere in the tree (forward direction), and the output of `scripts/build-components.sh --list-output-dirs` (reverse direction, `scripts/check-core-paths.sh:97-110`) | **no** — deleting a manifest-listed path elsewhere, or changing the build script's output directories, does not run the check |
| `markdown-links` (`ci/ci-capabilities.yml:1023`) | `check-markdown-links.sh` | every tracked `*.md` and the target of every relative link, which may be any tracked file (`scripts/check-markdown-links.sh:18`) | **no** — renaming or deleting a non-Markdown link target does not run the check |
| `component-drift` (`ci/ci-capabilities.yml:53`, filter :58-75) | `build-components.sh --target all --check` | the sources under `artifacts/**`, `extensions/**`, `model-mappings/**`, `scripts/lib/**`, and the committed outputs it drift-compares, i.e. every directory `--list-output-dirs` reports (`scripts/build-components.sh:93-105`): the four `*/skills/` trees, `.gemini/commands/`, and the agent trees written at `scripts/build-components.sh:896,948,984,1075` (`.gemini/agents/`, `.claude/agents/`, `.github/agents/`, `.agents/agents/`, 22 tracked files each) | **no** — none of the four `*/agents/**` trees is listed, so hand-editing or deleting `.github/agents/architect.md` skips the check; the drift then fails on a later, unrelated `artifacts/**` change |
| `extension-render` (`ci/ci-capabilities.yml:227`, filter :232-268) | `build-extension.sh --check` (and `check-extension-hook-tokens.sh`, which reads its output) | `extensions/**`, `extension-skeleton/**`, the three plugin builders, and the helpers they source: `scripts/lib/render-command.sh` (`scripts/build-extension.sh:69`, `scripts/build-claude-plugin.sh:22`, `scripts/build-copilot-plugin.sh:28`, `scripts/build-antigravity-extension.sh:28`), `extension-manifest.sh`, `extension-hooks.sh`, `render-context.sh`, `common.sh` | **no** — `scripts/lib/render-command.sh` is missing |
| `extension-render` | `check-extension-pivot.sh` | `extensions/core/**`, `extensions/library/**` (`scripts/check-extension-pivot.sh:55-58`); sources nothing | yes |
| `extension-render` | `check-extension-hook-map.sh` | `docs/extension-hook-events.md`, `scripts/lib/extension-targets.json`, `scripts/lib/extension-hooks.sh` (`scripts/check-extension-hook-map.sh:50-54`) | yes |
| `extension-provenance` (`ci/ci-capabilities.yml:327`, filter :332-336) | `check-extension-provenance.sh` | `SKILL.md`/`AGENT.md` under `extensions/core/`, `extensions/library/` (`scripts/check-extension-provenance.sh:63-78`), and `scripts/lib/provenance-carrier.sh` (`scripts/check-extension-provenance.sh:60`) | **no** — `scripts/lib/provenance-carrier.sh` is missing |
| `extension-manifest` (`ci/ci-capabilities.yml:352`, filter :357-364) | `check-extension-manifest-version.sh` | `package.json` and `extension.json` under `extensions/core/*/`, `extensions/library/*/` (`scripts/check-extension-manifest-version.sh:66-117`), and `scripts/lib/extension-manifest.sh` (`scripts/check-extension-manifest-version.sh:63`), which sources `scripts/lib/common.sh` (`scripts/lib/extension-manifest.sh:37`) and `scripts/lib/extension-hooks.sh` (`scripts/lib/extension-manifest.sh:154`) | **no** — all three helpers are missing |
| `check-model-mappings` (`ci/ci-capabilities.yml:929`, filter :934-938) | `check-model-mappings.sh` | `model-mappings/**` (`scripts/check-model-mappings.sh:97`) and `scripts/lib/model-resolve.sh` (`scripts/check-model-mappings.sh:217`) | **no** — `scripts/lib/model-resolve.sh` is missing |
| `audit` (`ci/ci-capabilities.yml:1532`, filter :1537-1542) | `npm audit --audit-level=critical` | the resolved dependency tree, i.e. the root `package-lock.json` (the only tracked lock file) | **no** — the filter lists `**/package.json` but not `package-lock.json`, so a lock-only change (a transitive bump) skips the audit |
| `test-wiring` | `check-test-strays.sh` | `scripts/tests/` (`scripts/check-test-strays.sh:36`); sources nothing | yes |
| `usage-storage` (`ci/ci-capabilities.yml:1697`) | `build-usage-validator.js --check` | `schemas/usage-record/v1.schema.json`, the committed `scripts/lib/usage-store/validator/`, and `ajv`/`ajv-formats` under `node_modules/` (`scripts/build-usage-validator.js:37-38,106-115`), pinned by `package-lock.json` | yes (`schemas/**`, `scripts/lib/usage-store/**`, `package.json`, `package-lock.json`) |
| `grep-anti-patterns` | four `scripts/` + `hooks/` scans | `scripts/`, `hooks/`, `ci/bash32-forbidden.txt` | yes |
| `docs-index` | `build-docs-index.sh --check` | `docs/**/*.md`, `docs/index.json` | yes |
| `figure-labels` | `check-figure-labels.sh` | `docs/assets/**/*.prompt.md` and sibling `*.png`, `scripts/lib/check-figure-labels.py` | yes |
| `check-metadata-keys`, `check-agent-profiles` | their checkers | `artifacts/**`; source nothing | yes |
| `check-claude-agent-layout` | its checker | `.claude/agents/**`; sources nothing | yes |

Every other filtered capability runs no check command, only test suites and
dependency installs: `model-resolution`, `agent-profile-migration`,
`extension-install`, `ci-parity`, `mempalace`, `chroma-mcp`, `e2e`, `setup`,
`frontmatter`, `windows-hook-probe`, `ticket-pickup`,
`mempalace-session-check`, `derive-spec-status`, `usage-record-schema`,
`release-notes`, `usage-capture`, `usage-attribution`, `usage-pricing`,
`usage-dashboard`, `release-tests`. `pages-deploy` filters only its `push`
trigger and runs a deployment, not a check. The structural cause: `path-ownership` (spec 0147 delta-01 R11-R17) proves that every
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
7. `scripts/build-components.sh --target all --check` (capability
   `component-drift`) SHALL run whenever a change touches any file under an
   output directory that `scripts/build-components.sh --list-output-dirs`
   reports for the committed `core` tier, in addition to the paths that trigger
   it today. At `4ac29c88` this adds `.agents/agents/**`, `.claude/agents/**`,
   `.gemini/agents/**` and `.github/agents/**`; the four `*/skills/**` trees
   and `.gemini/commands/**` are already listed.
8. Each of the following checks SHALL run whenever a change touches a helper
   library it sources, directly or transitively, in addition to the paths that
   trigger it today:
   - `scripts/build-extension.sh --check` (`extension-render`):
     `scripts/lib/render-command.sh`;
   - `scripts/check-extension-provenance.sh` (`extension-provenance`):
     `scripts/lib/provenance-carrier.sh`;
   - `scripts/check-extension-manifest-version.sh` (`extension-manifest`):
     `scripts/lib/extension-manifest.sh`, `scripts/lib/common.sh` and
     `scripts/lib/extension-hooks.sh`;
   - `scripts/check-model-mappings.sh` (`check-model-mappings`):
     `scripts/lib/model-resolve.sh`.
9. `npm audit` (capability `audit`) SHALL run whenever a change touches
   `package-lock.json`, in addition to the paths that trigger it today.
10. Every test suite that runs today in `misc`, `markdown-links`, `core-paths`,
    `test-wiring`, `component-drift`, `extension-render`,
    `extension-provenance`, `extension-manifest`, `check-model-mappings` or
    `audit` SHALL keep running under at least the paths that trigger it today;
    no check performed on a change before this spec SHALL stop being performed
    on that change (spec 0147 requirement 10).
11. The GitHub Actions pipeline and the generated GitLab pipeline SHALL agree on
    the new capability and on every changed filter: `scripts/check-ci-parity.sh`
    SHALL pass and the `.gitlab-ci.yml` drift check of `scripts/build-ci.sh`
    SHALL report no drift (spec 0049, spec 0147 requirement 9).
12. `scripts/check-path-ownership.ts` SHALL pass after the change. A tracked
    file that loses its last owning filter as a consequence of this spec SHALL
    be re-owned by the filter of a check that reads it whenever such a check
    exists, and SHALL otherwise carry an exemption whose reason names
    `repository-scan` (spec 0147 delta-01 R17). In particular, a narrowing of
    the `markdown-links` filter (allowed under *Out of scope*) SHALL NOT turn
    into exemptions the generated Markdown whose only owner today is its
    `**/*.md` glob: the four `*/agents/**` trees are re-owned by
    `component-drift` under requirement 7, and the `*/skills/**` trees and
    `.gemini/commands/**` are already owned by it.
13. Every check of requirement 1 SHALL pass on the tree of the change that
    introduces `repository-scan`, so that its first run on `main` is green.
14. `docs/ci-reference-format.md` SHALL state the trigger rule this spec applies:
    a check whose input is a known, finite set of files SHALL be triggered by a
    filter covering every file of that set, where that set includes every
    helper library the check sources, directly or transitively, and every
    committed output a drift check compares; a check whose input is the whole
    repository, or a set of files that cannot be enumerated in advance, SHALL
    run in a capability with no `paths:` filter.
15. The failure output of each moved check SHALL be unchanged: it SHALL still
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

**Scenario:** A hand-edited generated agent file is caught on its own pull request

```text
Given main at the state after this spec is implemented
When  a pull request edits only .github/agents/architect.md, so that it no
      longer matches what scripts/build-components.sh generates from
      artifacts/, and touches nothing under artifacts/
Then  the `component-drift` job runs on that pull request
And   it fails, reporting `DRIFT: .github/agents/architect.md differs from source`
```

**Scenario:** A broken helper library is caught by the check that sources it

```text
Given main at the state after this spec is implemented
When  a pull request changes only scripts/lib/provenance-carrier.sh, so that
      check-extension-provenance.sh no longer recognises a valid provenance
      block in a governed extension SKILL.md
Then  the `extension-provenance` job runs on that pull request and fails
```

**Scenario:** A lock-file-only dependency change is audited

```text
Given main at the state after this spec is implemented
When  a pull request changes only package-lock.json, resolving a transitive
      dependency to a version with a critical advisory
Then  the `audit` job runs on that pull request and fails
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
  repository-wide: rejected in favour of the documented rule of requirement 14,
  because the marker depends on the same author discipline as choosing the
  right filter.
- Narrowing the filters of `markdown-links` and `core-paths` once their scans
  have moved out: allowed but not required; the implementation plan decides,
  within requirements 10 and 12. A narrowing of `markdown-links` re-owns, under
  requirement 12, the generated Markdown its `**/*.md` glob alone owns today,
  rather than exempting it.
- The `audit` capability's other limits: its `pull-request` trigger covers
  `main` only, not `release/**`, and its verdict also depends on the external
  advisory database, which no repository filter can track. Only its
  lock-file gap (requirement 9) is in scope.
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
  filter rather than a move to `repository-scan`. Added after seat pass 1
  (`specs/1508`, s1-F1), under the owner's decision to fix every gap the audit
  finds: the audit counts the helper libraries a check sources and the
  committed outputs a drift check compares as part of what it reads, which adds
  the `component-drift`, `extension-render`, `extension-provenance`,
  `extension-manifest`, `check-model-mappings` and `audit` gaps (requirements
  7-9).
