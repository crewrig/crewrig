---
id: "0258"
slug: skill-extension-bundled-scripts-typescript
status: implemented
complexity: small
interaction-mode: MINIMAL
related-issue: 1611
version: 1.2.0
---

# Skill- and extension-bundled scripts in TypeScript

*Delta 02 of `specs/0258-skill-extension-bundled-scripts-typescript.md`. Source: the review
ledger of row H, issue #1611 (the deferred, non-blocking findings of the pull
requests #1603 to #1610). It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`. No behaviour of any script changes. The delta adds five
test and CI hardening requirements (36 to 40) and records two decisions on the behaviour
differences the ledger listed, neither of which adds a deviation letter. The version is a
MINOR bump. This delta opens no question.*

## ADDED

<!-- markdownlint-disable MD029 -->

36. **Frozen install of the extension-builder job.** The CI job `extension-builders-ts`
    SHALL install its dependencies with `npm ci --workspaces=false` (the lockfile frozen, the
    workspace packages not installed), not `npm install --include=dev`. The production closure
    the builders need is unchanged by the switch: the dev dependencies of the root package
    are installed, the workspace packages are not. The three carriers of the job
    (`.github/workflows/build.yml`, `ci/ci-capabilities.yml` and the regenerated
    `.gitlab-ci.yml`) and the install-line pattern of
    `scripts/tests/extension-ci-wiring.test.ts` SHALL change together, and the pattern SHALL
    reject, for this capability only, an install that resolves instead of freezing (the other
    traced capabilities keep `npm install --include=dev`, which the release jobs need).

37. **Unit tests of the scaffolder prompt.** `parseAnswer` and `promptComponents` of
    `scripts/lib/create-extension/prompt.ts` SHALL each have a unit test that does not go
    through the full scaffolder flow: numbers, names, mixed separators, duplicates, the empty
    answer, an unknown word (`null`), offered-order output, a re-ask after an unrecognised
    answer, and a closed input (no component).

38. **Windows curator proof scans something.** `assertNoCarriageReturn` of
    `scripts/tests/lib/windows-curator-proof.ts` SHALL fail when its scan reads no file in one
    of its landing zones (home, work, tmp). The dry-run entries write nothing there, so the
    fixture SHALL seed a line-feed canary file in each zone, and the guard SHALL be tested
    with an empty zone, with a clean file, with a carriage return and with `AppData` skipped.

39. **Exhaustive callers guards.** The fixed lists of
    `scripts/tests/lib/skill-scripts-callers.ts` and
    `scripts/tests/lib/harness-curator-callers.ts` SHALL be backed by a repository-wide scan
    over the tracked files: no tracked file outside a named allow-list SHALL carry a retired
    spelling of the eleven skill scripts or the three curator scripts. A retired spelling is
    `<name>.sh`, or `scripts/<name>` not followed by a word character, a dot or a hyphen, where
    `<name>` is the script's own name (so `check-secrets-exposure`, which exists under both
    `github-actions` and `gitlab-ci`, is one name matched wherever it appears). The allow-list
    names its reason per entry (specs, ADRs, the shims and the Bash oracle, the built mirrors
    that are regenerated from `artifacts/`), and the scan SHALL be tested for non-vacuity.

40. **Teardown retries on transient locks.** The teardown of the Windows install proof
    fixtures (`dispose` of `scripts/tests/lib/build-fixture-tree.ts`, and the other `rmSync`
    cleanups of `scripts/tests/lib/windows-install-proof.ts`) SHALL retry on `EPERM` and
    `EBUSY`, so that a directory held for a moment by the previous step (the "rename with a
    held handle" test) does not fail the `windows-install-entries` job and cancel the whole
    `Build & Validate` run through its `cancel-on-failure` step.

<!-- markdownlint-enable MD029 -->

**Scenario:** The extension-builder job freezes its lockfile

Given the reference `ci/ci-capabilities.yml` and the workflow `build.yml`
When the install step of `extension-builders-ts` is read
Then it is `npm ci --workspaces=false`, and the wiring test fails on
`npm install --include=dev` for that capability.

**Scenario:** A scan that walks nothing fails

Given a home, a work and a temporary directory of which one holds no file
When `assertNoCarriageReturn` runs on them
Then it throws that the scan read no file under that directory.

**Scenario:** A new caller outside the fixed list is caught

Given a tracked file outside every allow-list entry that names `lint-json.sh`
When the repository-wide callers scan runs
Then it reports that file by path.

## MODIFIED

Nothing is modified. Two decisions on the ledger's behaviour differences are recorded here,
and neither adds a letter to requirement 31:

- **NUL byte of a hook payload (ledger item i1-F4 of #1606).** The shell `read` drops a NUL
  byte, the TypeScript hook keeps it. Not recorded as deviation (s): a hook payload is JSON
  text produced by the CLI, and a raw NUL cannot occur in valid JSON (it is escaped as
  `\u0000`), so no caller can depend on the difference. The entry keeps the byte; a test
  that pins it is not worth its upkeep.
- **`lint-json` without `jq` (ledger item of delta 01).** Already deviation (r) of delta 01,
  with its scenario and its test. Nothing to add; the note that scripted callers will see
  exit 1 instead of the silent exit 0 is part of (r).

## REMOVED

Nothing is removed.
