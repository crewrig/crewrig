---
id: "0301"
slug: gitlab-ci-modernization
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 1940
version: 1.0.0
---

# Modernize the gitlab-ci skill to the authoring standard

## Intent

The `gitlab-ci` skill is rewritten to the skill authoring standard (`docs/skill-authoring-standard.md`), following the `pr-logbook` and `doc-writer` modernizations. Two checks whose outcome is fixed become bundled scripts on the script contract: a server-side validation of a pipeline through `glab ci lint` that reports plainly when it could not run, and a scan for the legacy `only`/`except` keys and for a missing `workflow:rules`. The existing image-pinning script is brought to the same contract. The body drops what the model already knows about GitLab CI and keeps the non-obvious rules, each with its reason; the oversized references gain tables of contents; the description separates GitLab pipeline work from the neighbouring CI platforms and review skills; and the effect is measured with the eval runner on frozen cases.

## Requirements

1. **R1 (order of work).** The work SHALL land as one implementation pull request whose commits are ordered: first `evals/` (cases and fixtures) with no change to the skill, then a baseline measurement on the unchanged skill, then the scripts, their tests and the rewrite, then the final measurement. Cases and fixtures SHALL stay byte-identical after the first commit.
2. **R2 (cases).** `artifacts/core/skills/gitlab-ci/evals/evals.json` SHALL be valid under the eval schema of `docs/skill-evals.md` and SHALL hold at least five evals covering: authoring a pipeline for a described project; reviewing a supplied pipeline that has an unpinned image, `only`/`except` and no `workflow:rules`; migrating a supplied `only`/`except` pipeline to `rules:`; a deploy job to a cloud provider that must use `id_tokens:` rather than a stored key; and diagnosing a supplied pipeline that runs twice for one commit. Every expectation SHALL be stated on observable output (files and their content), never on how the output was produced, so the same cases measure the skill before and after the scripts exist.
3. **R3 (no forge, no script check).** No eval prompt SHALL ask the agent to create, edit, comment on or close a forge artifact or to call a GitLab instance. Fixtures SHALL be plain files under `evals/files/`. No eval SHALL use an `exit_code` check on a bundled script, so the same cases run against the unchanged skill.
4. **R4 (probes).** The file SHALL carry at least eight trigger probes, at least 40 percent positive and at least 40 percent negative. The negatives SHALL be near-misses that share vocabulary: a GitHub Actions workflow, a Jenkinsfile, a generic YAML file (a Kubernetes manifest or a compose file), a security review of application code, and a request about a GitLab merge request description rather than its pipeline.
5. **R5 (measurement).** The contributor SHALL measure the unchanged skill and the rewritten skill with `task skill-evals -- gitlab-ci`, report both pass rates, the probe results, the cost and the run counts on the logbook, and commit the `evals/results.json` of a non-mock run on the final skill. At most four paid measurements SHALL be made in the whole ticket: the baseline, the final run, and at most two re-measurements. Because the content hash covers `scripts/`, every fix of a REVIEW pass that touches a script, a reference or `SKILL.md` SHALL be batched into one commit before the last measurement, not measured one by one. The rewrite SHALL be kept only when the final status is not `regression`. A probe failure SHALL be fixed by revising the description before the body; if the status is still `regression` after the allowed measurements, the figures go to the user for decision.
6. **R6 (lint-gitlab-ci script).** The skill SHALL bundle `scripts/lint-gitlab-ci.ts`, a single-file TypeScript program that follows the script contract of the standard (Node.js 24, no import, `--help`, `--json` object `{ok, data, findings}`, exit codes 0/1/2/3). Given one optional pipeline file (default `.gitlab-ci.yml`) and optionally `--repo <group/project>`, it SHALL run `glab ci lint` on that file and map the outcome as follows: (a) glab reports the configuration valid: exit 0, `data` naming the file and the verdict; (b) glab reports the configuration invalid: exit 1, one finding with rule `invalid-config` per error glab prints, each stating the error text; (c) glab is not installed, is not authenticated, cannot reach the instance within a bounded wait (30 seconds by default, `--timeout <seconds>` to change it), or prints neither verdict: exit 3 with a finding of rule `precondition` whose message names which of those causes applied and says the pipeline was NOT validated server-side. Offline is therefore never reported as valid; (d) the file is missing or unreadable: exit 3 with rule `precondition`, and glab is not called. The glab executable SHALL be replaceable through the `GLAB_BIN` environment variable, so that tests and offline runs substitute a stub. The script SHALL write nothing, SHALL pass nothing to glab other than the file and `--repo`, and SHALL NOT read a token or credential itself.
7. **R7 (check-rules script).** The skill SHALL bundle `scripts/check-rules.ts` with the same contract. Given one pipeline file or a directory (directory mode scans `<dir>/.gitlab-ci.yml` plus the YAML under `<dir>/.gitlab/`, like the sibling scripts), it SHALL perform a text scan, with no live GitLab, and report: (a) rule `only-except`: one error finding per job, hidden `.template` jobs included, that carries an `only:` or `except:` key, naming the job and the line; (b) rule `missing-workflow-rules`: an error finding when the scanned set declares at least one job and no top-level `workflow:` with `rules:`. When the scanned set declares an `include:`, the same condition is a warning instead, because the workflow may come from the included file. A scanned set with no job (an empty file, a file of `include:` lines only, variables only) SHALL yield no `missing-workflow-rules` finding. The data SHALL state how many files and jobs were scanned, so that an empty scan is visible. A target that does not exist or cannot be read SHALL exit 3.
8. **R8 (check-pinned-images conformance).** `scripts/check-pinned-images.ts` SHALL be brought to the script contract without changing what it detects: it SHALL add `--help` (usage on stdout, exit 0) and `--json`, and SHALL exit 3 instead of 1 for a target that does not exist, so that a finding is distinguishable from a bad target. For a file or directory argument its detection, its findings and its human-readable output SHALL remain byte-identical to the current script. Its data SHALL state how many files were scanned.
9. **R9 (check-secrets-exposure untouched).** `scripts/check-secrets-exposure.ts` SHALL NOT be modified by this change: the shared secrets engine belongs to sibling issue #1941. `SKILL.md` SHALL keep citing it with its current one-argument form and exit codes (0 clean, 1 finding or bad target, 2 usage). It does not follow the script contract until that work lands, and the `script-help` warning of `task check-skill-quality -- gitlab-ci` on this one file is accepted until then.
10. **R10 (script tests).** Each of the three scripts of R6, R7 and R8 SHALL have automated tests that run with no network and cover its success path, each exit code and finding named above, the usage error, the `--json` shape and `--help`, and SHALL run from a copy of the built skill directory outside the repository. The tests of `lint-gitlab-ci.ts` SHALL drive it only through a `GLAB_BIN` stub that simulates a valid verdict, an invalid verdict with two errors, a missing binary, an authentication failure, a connection failure, a hang past the timeout and unrecognized output. The tests of `check-pinned-images.ts` SHALL include fixtures proving the output for a file argument is unchanged.
11. **R11 (references).** `references/pipeline-syntax.md` SHALL open with a table of contents whose heading is `Contents` within its first 20 lines, linking each of its sections. Every other reference over 300 lines SHALL receive the same treatment, so that `task check-skill-quality -- gitlab-ci` reports no `reference-toc` warning. Every reference SHALL be linked directly from `SKILL.md`, and a reference SHALL NOT depend on another reference to be understood. The specification citation in `references/rules-and-triggers.md` SHALL be replaced by the reason it supports. No reference content other than these edits and any `.sh` script name still cited SHALL change.
12. **R12 (skill body).** `SKILL.md` SHALL be rewritten so that: (a) it drops what the model already knows (the definition of pipelines, stages and jobs, the cache-versus-artifacts basics, the `needs:` DAG) and keeps the GitLab-specific rules whose reason is not obvious: masking limits, trace options that defeat masking, cache paths outside the project directory, fork pipelines and protected runners, mutable includes and components, the `CI_JOB_TOKEN` allowlist, `resource_group` and `interruptible` on deploys; (b) each retained rule states its reason, and the body carries no more than five capitalised `MUST`, `NEVER`, `CRITICAL`, `ALWAYS` or `IMPORTANT` outside code; (c) it carries no spec, requirement, ADR or issue citation, and no path that does not ship to adopters (`ci/ci-capabilities.yml`, `docs/…`); (d) it tells the model when to run each of the five scripts, what each exit code means, and the fallback when `lint-gitlab-ci.ts` exits 3 (run the offline scripts, and tell the user the server-side validation did not happen); (e) it keeps the existing hand-offs (to `security` for new secrets, token-allowlist widening, OIDC trust and untrusted input in `script:`; to `architect` for pipeline topology) and the reference index, with every reference one level below `SKILL.md`; (f) it keeps the quick recipes that carry a non-obvious rule (the secure skeleton with `workflow:rules`, OIDC deploy, untrusted MR title) and drops the others; (g) it replaces any friction text with a pointer to `references/shared-friction-reporting.md` and does not cite `config/TOOLS.md`; (h) it stays under 500 lines and keeps `Bash` allowed so that the scripts run. Every behaviour of the current skill SHALL remain, in prose, in a reference or as a script call; a behaviour dropped on purpose SHALL be listed on the logbook with its reason.
13. **R13 (description and frontmatter).** The `description` SHALL be third person, state what the skill does, carry a `Use when` clause with trigger terms (`.gitlab-ci.yml`, `rules:`, `workflow:rules`, `glab ci lint`, CI/CD Components, `id_tokens`, runner, `include:`) and a `Not for` clause naming GitHub Actions workflows, Jenkins and other CI systems except as the source of a migration to GitLab, generic YAML, and security or threat-model reviews (the `security` skill), within 1,024 characters. `compatibility` SHALL name Node.js 24 and `glab` as optional, and the frontmatter SHALL keep `Read`, `Bash`, `Write` and `Edit` among its allowed tools.
14. **R14 (packaging).** `metadata.provenance.version` of the skill SHALL be bumped to `1.2.0` (additive scripts and rewrite; the exit code of an unreadable target in one script moves from 1 to 3 and is stated in `SKILL.md`). The built components SHALL be regenerated in the same change, every built `gitlab-ci` skill directory SHALL contain `scripts/` and `references/` and no `evals/`, and `task check-skill-quality -- gitlab-ci` SHALL report no error and no warning other than the one accepted by R9. The bundled-script citation check SHALL pass, including for the `ci-configurator` agent, which keeps citing the two existing scripts unchanged. The CLI matrix SHALL be changed only if the diff touches a CLI integration point; this change is expected not to.

## Scenarios

### Happy path — valid pipeline

- **Given** a `GLAB_BIN` stub that prints the valid verdict,
- **When** `lint-gitlab-ci.ts .gitlab-ci.yml` runs,
- **Then** it exits 0 and, under `--json`, prints `ok: true` with no finding.

### Failure path — invalid pipeline

- **Given** a stub that reports the configuration invalid with two errors,
- **When** `lint-gitlab-ci.ts` runs,
- **Then** it exits 1 with two `invalid-config` findings, each carrying one error text.

### Failure path — offline degrades without a false pass

- **Given** a stub (or an absent binary) that fails to authenticate, fails to connect, hangs past the timeout or prints an unrecognized answer,
- **When** `lint-gitlab-ci.ts` runs,
- **Then** it exits 3 with a `precondition` finding naming the cause and stating the pipeline was not validated server-side, and `ok` is false.

### Failure path — unreadable pipeline file

- **Given** a path that does not exist,
- **When** `lint-gitlab-ci.ts` runs,
- **Then** it exits 3 with a `precondition` finding and the stub records no call.

### Happy path — clean rules

- **Given** a pipeline with a top-level `workflow:` carrying `rules:` and jobs that use only `rules:`,
- **When** `check-rules.ts` runs on it,
- **Then** it reports no finding and exits 0.

### Failure path — legacy keys and no workflow

- **Given** a pipeline with two jobs using `only:` and `except:` and no `workflow:`,
- **When** `check-rules.ts` runs,
- **Then** it reports two `only-except` findings and one `missing-workflow-rules` error and exits 1.

### Edge — fragment that includes its workflow

- **Given** a file that has a job and an `include:` but no `workflow:`,
- **When** `check-rules.ts` runs,
- **Then** `missing-workflow-rules` is a warning and the exit code is 0.

### Edge — nothing to scan

- **Given** an empty directory or a file with no job,
- **When** `check-rules.ts` runs,
- **Then** it reports no `missing-workflow-rules` finding, the data states zero jobs scanned, and it exits 0.

### Failure path — missing check target

- **Given** a path that does not exist,
- **When** `check-rules.ts` or `check-pinned-images.ts` runs,
- **Then** it exits 3 with a `precondition` finding under `--json`.

### Regression guard — existing image scan

- **Given** the fixtures of the current `check-pinned-images.ts` behaviour,
- **When** the conformant script runs on them without `--json`,
- **Then** its output and its exit code for pinned and unpinned references are the same as before.

### Failure path — rewrite regresses

- **Given** the final measurement is below the baseline by more than the tolerance,
- **When** the contributor revises the description, then the body, within the measurement cap,
- **Then** the cases stay unchanged and, if the run still regresses, the figures go to the user for decision.

## Out of scope

- The shared secrets engine and any edit of `check-secrets-exposure.ts` (issue #1941).
- The `github-actions` skill (issue #1939), the `security` skill (#1941) and the CI agents, `ci-configurator` included (issue #1942).
- Any runner, executor or `config.toml` change, and any pipeline simulator or local pipeline execution.
- Making `lint-gitlab-ci.ts` authenticate, install or configure `glab`, or call the GitLab API other than through `glab ci lint`.
- Changing the eval runner, its settings or the spec linter.
- A new CI gate over repository pipelines: the scripts are authoring tools.

## Open questions

- Decided (AUTO): contract rule 5 is not amended; `lint-gitlab-ci.ts` carries a documented exception in its `--help` and in `SKILL.md` (a read-only query through the forge's own CLI), which avoids editing a shared standard while sibling waves run.
- Decided (AUTO): the residual `script-help` warning on `check-secrets-exposure.ts` is accepted until sibling #1941 replaces that copy with the shared engine.
