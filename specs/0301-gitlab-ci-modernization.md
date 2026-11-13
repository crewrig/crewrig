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
4. **R4 (probes).** The file SHALL carry at least ten trigger probes, at least five positive and at least five negative. The negatives SHALL be near-misses that share vocabulary and SHALL cover each of these kinds at least once: a GitHub Actions workflow, a Jenkinsfile, a generic YAML file (a Kubernetes manifest or a compose file), a security review of application code, and a request to write a GitLab merge request description rather than touch its pipeline.
5. **R5 (measurement).** The contributor SHALL measure the unchanged skill and the rewritten skill with `task skill-evals -- gitlab-ci`, report both pass rates, the probe results, the cost and the run counts on the logbook, and commit the `evals/results.json` of a non-mock run on the final skill. `main` holds no committed `evals/results.json` for this skill, so the runner prints `base=n/a` and cannot compute a `regression` status. The baseline comparison is therefore manual: the contributor records the baseline eval pass rate and keeps the rewrite only when the final eval pass rate is at least the baseline minus the runner tolerance (0.05) and the final status is `pass`. On a final status `fail`, or a manual drop beyond the tolerance, the contributor revises the description first, then the body, and re-measures. At most four paid measurements SHALL be made in the whole ticket: the baseline, the final run, and at most two re-measurements. Because the content hash covers `scripts/`, every fix of a REVIEW pass that touches a script, a reference or `SKILL.md` SHALL be batched into one commit before the last measurement, not measured one by one. A probe failure SHALL be fixed by revising the description before the body. If the criteria still fail after the allowed measurements, the figures go to the user for decision and nothing is committed as final.
6. **R6 (lint-gitlab-ci script).** The skill SHALL bundle `scripts/lint-gitlab-ci.ts`, a single-file TypeScript program that follows the script contract of the standard (Node.js 24, no import, `--help`, `--json` object `{ok, data, findings}`, exit codes 0/1/2/3). Given one optional pipeline file (default `.gitlab-ci.yml`) and optionally `--repo <group/project>`, it SHALL run `glab ci lint` on that file and recognise the outcome from the exit code of glab together with its printed text, because glab uses no distinct exit code for an invalid configuration as against an authentication or connection failure. The recognised markers are the substrings `CI/CD YAML is valid` and `CI/CD YAML is invalid`, matched case-insensitively and ignoring any leading symbol or whitespace. The mapping is: (a) valid: the valid marker is present, the invalid marker is absent and glab exited 0; the script exits 0 with `data` naming the file and the verdict; (b) invalid: the invalid marker is present, whatever the exit code and even when the valid marker also appears, so invalid takes precedence; the script exits 1 with one finding of rule `invalid-config` per non-empty line glab prints after the invalid-marker line, each stating that line; when none follows, a single finding carries the marker line; (c) not validated: glab is not installed, glab was killed after the bounded wait (30 seconds by default, `--timeout <seconds>` to change it), or the output holds neither marker, including an exit 0 with no marker; the script exits 3 with a finding of rule `precondition` whose message names the cause (missing binary, timeout, authentication failure, connection failure or unrecognized output) and says the pipeline was NOT validated server-side. Naming an authentication or a connection failure is best effort on glab's text; any text it cannot classify is reported as unrecognized output, never as valid; (d) the file is missing or unreadable: exit 3 with rule `precondition`, and glab is not called. The order of checks is fixed: arguments first (exit 2), then the validity of the target (exit 3), and only then the availability of the tool, so that a bad target is reported the same whether or not glab is installed. On a timeout the script SHALL kill the glab child process, so that no process outlives the script. The glab executable SHALL be replaceable through the `GLAB_BIN` environment variable, so that tests and offline runs substitute a stub. The script SHALL write nothing, SHALL pass nothing to glab other than the file and `--repo`, and SHALL NOT read a token or credential itself. The markers above SHALL be checked against a real capture before the script is written (R10); a capture that disagrees with them is raised as a spec finding rather than patched around.
7. **R7 (check-rules script).** The skill SHALL bundle `scripts/check-rules.ts` with the same contract. Given one pipeline file or a directory (directory mode scans `<dir>/.gitlab-ci.yml` plus the YAML under `<dir>/.gitlab/`, like the sibling scripts), it SHALL perform a text scan, with no live GitLab. In this scan a job is a top-level key (indentation zero) whose name is not a reserved keyword (`stages`, `variables`, `default`, `workflow`, `include`, `image`, `services`, `cache`, `before_script`, `after_script`, `spec`) and whose value is a block mapping, that is, the next non-blank, non-comment line is indented deeper and is not a list item; hidden jobs whose name starts with `.` are jobs, and a key with an inline or scalar value is not. An `only:` or `except:` key belongs to a job only when it sits at the job's first child indentation, directly under the job key; the same words deeper (under `rules:`, `cache:`, `needs:`, `variables:`, in a block scalar of `script:`) are not findings. The scan follows neither YAML anchors, merge keys (`<<:`) nor `extends:`: it reports the template that carries the key, not each job that inherits it, and it says so in its `--help`. It SHALL report: (a) rule `only-except`: one error finding per job carrying an `only:` or `except:` key, naming the job and the line; (b) rule `missing-workflow-rules`: an error finding when the scanned set declares at least one job and no top-level `workflow:` with `rules:` under it; when the scanned set declares an `include:`, the same condition is a warning instead, because the workflow may come from the included file. A scanned set with no job (an empty file, a file of `include:`, `stages:` or `variables:` entries only) SHALL yield no `missing-workflow-rules` finding. The data SHALL state how many files and jobs were scanned, so that an empty scan is visible. The arguments are checked first (exit 2), then the target: one that does not exist or cannot be read exits 3 with rule `precondition`.
8. **R8 (check-pinned-images: additive flags only).** Existing skill scripts are pinned by the differential and oracle suites of spec 0258, which list their deviations closed, so `scripts/check-pinned-images.ts` SHALL only GAIN two flags and SHALL change nothing else. It SHALL add `--help` as its sole argument (usage on standard output, exit 0) and `--json` alongside its one target argument. Without `--json` and for every argument form it accepts today, its detection, findings, messages, streams and exit codes (0 all pinned or nothing to scan, 1 a finding or a missing target, 2 usage) SHALL remain byte-identical, and the existing 0258 suites SHALL pass unchanged. Under `--json` it prints the object `{ok, data, findings}` on standard output with the human text on standard error; its exit codes under `--json` are the legacy ones, so a missing target exits 1 with a finding of rule `precondition` and `ok: false`, and a usage error exits 2 with rule `usage`. This script therefore does not adopt exit 3, and its `--help` and `SKILL.md` say so. Its data under `--json` SHALL state how many files were scanned. The tests SHALL compare the output of the new flags against golden files, and the unchanged behaviour against golden files captured from the unmodified script and committed before the script is edited.
9. **R9 (check-secrets-exposure: help-only edit).** The shared secrets engine belongs to sibling issue #1941, so `scripts/check-secrets-exposure.ts` SHALL receive one additive edit and no other, under the same closed-deviation rule as R8: it answers `--help` as its only argument with its usage on standard output and exit 0, which the standard checks and which makes `task check-skill-quality -- gitlab-ci` pass once the skill ships evals. It SHALL NOT gain `--json`. For every argument form it accepts today its detection, output, streams and exit codes (0 clean, 1 finding or bad target, 2 usage) SHALL remain byte-identical, the existing 0258 suites SHALL pass unchanged, and golden files captured from the unmodified script before the edit SHALL prove it. That edit disappears when #1941 replaces the file. `SKILL.md` SHALL keep citing it with its current one-argument form and exit codes.
10. **R10 (script tests).** Each of the three scripts of R6, R7 and R8 SHALL have automated tests (for R8, covering the new flags and the golden comparisons, in addition to the existing 0258 suites, which SHALL NOT be edited) that run with no network and cover its success path, each exit code and finding named above, the usage error, the `--json` shape and `--help`, and SHALL run from a copy of the built skill directory outside the repository. The tests of `lint-gitlab-ci.ts` SHALL drive it only through a `GLAB_BIN` stub and SHALL cover: a valid verdict, an invalid verdict with two errors, output carrying both markers (invalid wins), exit 0 without a marker, a missing binary, an authentication failure, a connection failure, a hang past the timeout in which the stub's process is proved gone afterwards, and unrecognized output. Before the script is written, the contributor SHALL capture the real output of `glab ci lint` for one valid and one invalid pipeline, record the glab version, and commit both captures as fixtures that the stub replays; the other stub outputs are derived from them. The tests of `check-pinned-images.ts` and of the help-only edit of R9 SHALL include the golden-file comparisons of R8 and R9, and SHALL assert the legacy exit code (1) for a missing target. The tests of `check-rules.ts` SHALL include the nested-key and block-scalar cases of R7.
11. **R11 (references).** `references/pipeline-syntax.md` SHALL open with a table of contents whose heading is `Contents` within its first 20 lines, linking each of its sections. Every other reference over 100 lines (the threshold of the standard) SHALL receive the same treatment, so that `task check-skill-quality -- gitlab-ci` reports no `reference-toc` finding. Every reference SHALL be linked directly from `SKILL.md`, and a reference SHALL NOT depend on another reference to be understood. The specification citation in `references/rules-and-triggers.md` SHALL be replaced by the reason it supports. No reference content other than these edits and any `.sh` script name still cited SHALL change.
12. **R12 (skill body).** `SKILL.md` SHALL be rewritten so that: (a) it drops what the model already knows (the definition of pipelines, stages and jobs, the cache-versus-artifacts basics, the `needs:` DAG) and keeps the GitLab-specific rules whose reason is not obvious: masking limits, trace options that defeat masking, cache paths outside the project directory, fork pipelines and protected runners, mutable includes and components, the `CI_JOB_TOKEN` allowlist, `resource_group` and `interruptible` on deploys; (b) each retained rule states its reason, and the body carries no more than five capitalised `MUST`, `NEVER`, `CRITICAL`, `ALWAYS` or `IMPORTANT` outside code; (c) it carries no spec, requirement, ADR or issue citation, and no path that does not ship to adopters (`ci/ci-capabilities.yml`, `docs/…`); (d) it tells the model when to run each of the five scripts, what each exit code means, and the fallback when `lint-gitlab-ci.ts` exits 3 (run the offline scripts, and tell the user the server-side validation did not happen); (e) it keeps the existing hand-offs (to `security` for new secrets, token-allowlist widening, OIDC trust and untrusted input in `script:`; to `architect` for pipeline topology) and the reference index, with every reference one level below `SKILL.md`; (f) it keeps the quick recipes that carry a non-obvious rule (the secure skeleton with `workflow:rules`, OIDC deploy, untrusted MR title) and drops the others; (g) it replaces any friction text with a pointer to `references/shared-friction-reporting.md` and does not cite `config/TOOLS.md`; (h) it stays under 500 lines and keeps `Bash` allowed so that the scripts run. Every behaviour of the current skill SHALL remain, in prose, in a reference or as a script call; a behaviour dropped on purpose SHALL be listed on the logbook with its reason.
13. **R13 (description and frontmatter).** The `description` SHALL be third person, state what the skill does, carry a `Use when` clause with trigger terms (`.gitlab-ci.yml`, `rules:`, `workflow:rules`, `glab ci lint`, CI/CD Components, `id_tokens`, runner, `include:`) and a `Not for` clause naming GitHub Actions workflows, Jenkins and other CI systems except as the source of a migration to GitLab, generic YAML, security or threat-model reviews (the `security` skill), and merge request descriptions or logbook entries (the `pr-logbook` skill), within 1,024 characters. `compatibility` SHALL name Node.js 24 and `glab` as optional, and the frontmatter SHALL keep `Read`, `Bash`, `Write` and `Edit` among its allowed tools.
14. **R14 (packaging).** `metadata.provenance.version` of the skill SHALL be bumped to `1.2.0` (additive scripts, additive flags and rewrite; no exit code of an existing script changes). The existing differential and oracle suites of spec 0258 SHALL pass unchanged on the built skill. `SKILL.md` SHALL state that the two legacy scripts keep their legacy exit codes and that the two new scripts use the full 0/1/2/3 contract. The built components SHALL be regenerated in the same change, and every built `gitlab-ci` skill directory SHALL contain `scripts/` and `references/` and no `evals/`. Because a skill that ships evals is protected, so that every finding of `task check-skill-quality` is an error, `task check-skill-quality -- gitlab-ci` SHALL report no finding at all. The bundled-script citation check SHALL pass, including for the `ci-configurator` agent, which keeps citing the two existing scripts unchanged. The CLI matrix SHALL be changed only if the diff touches a CLI integration point; this change is expected not to.
15. **R15 (standard amendment).** The implementation pull request SHALL amend rule 5 of the script contract in `docs/skill-authoring-standard.md` by one sentence: a script that writes nothing to a forge MAY make a read-only query through the forge's own command-line tool, bounded by a timeout, and SHALL degrade to exit 3 when the query cannot run, never to success. That sentence is the only change to the standard. `lint-gitlab-ci.ts` documents the network call in its `--help` and `SKILL.md` says it is a read-only server-side query. The approved spec 0293 is not edited.

## Scenarios

### Happy path — valid pipeline

- **Given** a `GLAB_BIN` stub that prints the valid verdict,
- **When** `lint-gitlab-ci.ts .gitlab-ci.yml` runs,
- **Then** it exits 0 and, under `--json`, prints `ok: true` with no finding.

### Failure path — invalid pipeline

- **Given** a stub that reports the configuration invalid with two errors,
- **When** `lint-gitlab-ci.ts` runs,
- **Then** it exits 1 with two `invalid-config` findings, each carrying one error text.

### Failure path — both markers

- **Given** a stub whose output carries the valid marker and the invalid marker, and exits 0,
- **When** `lint-gitlab-ci.ts` runs,
- **Then** invalid takes precedence: it exits 1 with an `invalid-config` finding.

### Failure path — hang past the timeout

- **Given** a stub that never returns and `--timeout 1`,
- **When** `lint-gitlab-ci.ts` runs,
- **Then** it kills the stub process, exits 3 with a `precondition` finding naming the timeout, and no stub process remains.

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

### Edge — nested keys are not job keys

- **Given** a job whose `rules:` entry, `variables:` block (a variable named `only`) and `script:` block scalar contain the words `only:` and `except:` deeper than the job's own keys, with a top-level `workflow:` present,
- **When** `check-rules.ts` runs,
- **Then** it reports no `only-except` finding and exits 0.

### Edge — nothing to scan

- **Given** an empty directory, an empty file, or a file holding only `stages:`, `variables:` and `include:` entries (no top-level key with a block-mapping value outside the reserved keywords),
- **When** `check-rules.ts` runs,
- **Then** it reports no `missing-workflow-rules` finding, the data states zero jobs scanned, and it exits 0.

### Failure path — missing check target

- **Given** a path that does not exist,
- **When** `check-rules.ts` runs,
- **Then** it exits 3 with a `precondition` finding under `--json`.

### Failure path — missing target, legacy script

- **Given** a path that does not exist,
- **When** `check-pinned-images.ts` runs, with or without `--json`,
- **Then** it exits 1 as before, with the unchanged message without `--json`, and under `--json` a `precondition` finding with `ok: false`.

### Edge — bad target is reported before tool availability

- **Given** a path that does not exist and a `GLAB_BIN` that names no executable,
- **When** `lint-gitlab-ci.ts` runs,
- **Then** it exits 3 for the missing file, and the finding names the file rather than the missing tool.

### Regression guard — existing scripts

- **Given** golden files captured from the unmodified `check-pinned-images.ts` and `check-secrets-exposure.ts`,
- **When** the edited scripts run on the same file and directory arguments without `--json`,
- **Then** output, stream and exit code are byte-identical, the missing-target exit code stays 1, and the existing 0258 suites pass unchanged.

### Happy path — help on the untouched engine

- **Given** the single argument `--help`,
- **When** `check-secrets-exposure.ts` runs,
- **Then** it prints its usage on standard output and exits 0.

### Failure path — rewrite does not hold the baseline

- **Given** the final status is `fail`, or the final eval pass rate is below the recorded baseline by more than 0.05,
- **When** the contributor revises the description, then the body, within the measurement cap,
- **Then** the cases stay unchanged and, if the criteria still fail, the figures go to the user for decision.

## Out of scope

- The shared secrets engine and any edit of `check-secrets-exposure.ts` other than the help-only edit of R9 (issue #1941).
- The `github-actions` skill (issue #1939), the `security` skill (#1941) and the CI agents, `ci-configurator` included (issue #1942).
- Any runner, executor or `config.toml` change, and any pipeline simulator or local pipeline execution.
- Making `lint-gitlab-ci.ts` authenticate, install or configure `glab`, or call the GitLab API other than through `glab ci lint`.
- Changing the eval runner, its settings or the spec linter.
- A new CI gate over repository pipelines: the scripts are authoring tools.

## Open questions

None.
