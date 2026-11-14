---
name: github-actions
description: "Writes, reviews and hardens GitHub Actions workflows and composite actions, and bundles scripts that check permissions, pinned actions, pull_request_target checkouts and expression injection. Use when working on a file under .github/workflows or an action.yml, when a workflow needs a GITHUB_TOKEN permissions block, OIDC instead of long-lived cloud keys, pinned actions, caching, a reusable workflow or a composite action, when a pull request changes CI, or when a failing pipeline may be caused by the workflow definition. Trigger terms: workflow, GitHub Actions, CI pipeline, permissions, pull_request_target, OIDC, pinned actions, reusable workflow, composite action, failing pipeline. Not for GitLab CI pipelines (gitlab-ci), security review of application code (security) or pull request descriptions (pr-logbook)."
license: Apache-2.0
compatibility: "Requires Node.js 24 (scripts run as node scripts/<name>.ts). actionlint and act are optional: the checks that need them are skipped, and reported as skipped, when they are missing."
allowed-tools:
  - Read
  - Bash
  - Write
  - Edit
user-invocable: true
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "1.3.0"
---


# GitHub Actions

Practitioner rules for the workflows under `.github/workflows/` and for composite
actions. The model already knows the syntax; this skill holds what it gets wrong,
the checks that settle the fixed questions, and the judgements a script cannot make.

Hand a change to the **security** skill when it adds a secret, widens `GITHUB_TOKEN`
permissions, adds a cloud trust relationship or runs untrusted input in a shell, and
to the **architect** skill when it restructures workflows across repositories.

## Scripts

Run them from this skill's directory with `node scripts/<name>.ts <path>`, where
`<path>` is a workflow file or a directory. They need only Node.js and write nothing.
Run `validate-pipeline.ts` on every workflow you write or change: it runs the other
checks and states which ones ran.

| Script | When | Exit codes |
|---|---|---|
| `node scripts/validate-pipeline.ts <file-or-dir>` | After writing or changing a workflow, before presenting it. One input only. | `0` every check ran clean or was skipped, `1` a check that ran found a problem, `2` usage error or no workflow file, `3` unreadable input or a check that could not run. |
| `node scripts/check-permissions.ts <path>` | A workflow without `permissions:`, or with `write-all`. | `0` clean, `1` a finding, `2` usage error or empty directory, `3` unreadable path. |
| `node scripts/check-pull-request-target.ts <path>` | A workflow triggered by `pull_request_target`. | Same as above. |
| `node scripts/check-expression-injection.ts <path>` | A `${{ }}` expression inside `run:` or an `actions/github-script` script. | Same as above. |
| `node scripts/check-pinned-actions.ts <path>` | Any `uses:` that is not a 40-character SHA. | `0` all pinned, `1` unpinned reference or unreadable path, `2` usage error. |
| `node scripts/lint-workflow.ts <path>` | Syntax, contexts and shell errors; needs `actionlint`. | `0` clean or skipped, `1` errors or unreadable path, `2` usage error. |
| `node scripts/check-secrets-exposure.ts <path>` | A secret that may reach a log or an over-wide scope. | `0` nothing found, `1` a finding, `2` usage error. |
| `node scripts/simulate-job.ts <file> <job> [event]` and `node scripts/simulate-workflow.ts <file> [event]` | A local dry run with `act` while iterating on `run:` logic. | `0` ok or skipped, otherwise the status of `act`, `2` usage error. |

Without `actionlint`, `lint-workflow.ts` exits `0` before it looks at the path, so a
missing file also passes on such a machine.

Add `--json` to get one `{ok, data, findings}` object on standard output (every script
except `check-secrets-exposure.ts`, which rejects it). A warning
never changes an exit code. A check that exits `0` with a `[SKIP]` line did not look
at your file: report it as skipped, never as passed. Exit `2` or `3` means the call
or the environment is wrong, not the workflow. A green `act` run is necessary, not
sufficient: it does not reproduce the hosted runner image.

The three checks `check-permissions.ts`, `check-pull-request-target.ts`
and `check-expression-injection.ts` do not read composite actions: a file with no `jobs:` key passes
with no finding and the summary says it was not checked, so review the `run:` steps of
an `action.yml` by hand, above all any `${{ inputs.* }}` in them. They also read a small
subset of YAML. A construct they cannot read
(anchor, alias, merge key, multi-line flow mapping) is reported as an `unparsed`
warning: review that line by hand, because the file was not verified there.

## Pitfalls

A script catches the first four; the rest need your judgement.

1. Unpinned third-party actions: pin by commit SHA (`check-pinned-actions.ts`).
2. A `GITHUB_TOKEN` with inherited write access: set a top-level `permissions:` block
   with `contents: read` (not `{}`, which also blocks checkout of a private
   repository) and raise it per job (`check-permissions.ts`).
3. Event data pasted into a shell step: bind it under `env:` (`check-expression-injection.ts`).
4. A `pull_request_target` workflow that checks out the pull request head: a label or an
   environment gate does not make the head's code trusted (`check-pull-request-target.ts`).
5. Cache poisoning through a privileged event: a job triggered by `pull_request_target`,
   `workflow_run` or `issue_comment` saves into the default branch's cache scope, so
   untrusted code it runs can plant an entry that the main branch restores. A plain
   pull request cannot: restore never reads a child or sibling ref. Do not run pull
   request code in those events, and do not save a cache from them.
6. `hashFiles()` over a glob that also matches vendored copies yields a key that
   changes whenever any of those files does, often after an install. Name the real
   lockfile path.
7. `continue-on-error: true` on a flaky step ends up hiding a real regression. Retry
   explicitly and handle the failure instead.
8. `if: always()` on a cleanup or upload step: `always()` also runs after a
   cancellation, so a step that can hang keeps the run alive until it times out.
   Use `if: ${{ !cancelled() }}`.
9. A boolean or an enum declared as a `string` input of `workflow_dispatch` is not
   validated. Declare `type: boolean`, or `type: choice` with `options:`.
10. A self-hosted runner attached to a public repository runs any fork's code on your
    hardware. Require approval for outside contributors and keep such runners off
    public repositories.

## Judgement rules

These are decisions; the detail and examples are in `references/generation-rules.md`.

- Use OIDC for cloud access, because a short-lived token has nothing to rotate or leak.
- Install Node dependencies with `npm ci`, because it fails on a lockfile mismatch;
  when there is no lockfile, report it to the user to commit instead of using
  `npm install`.
- Bind a secret to the step that needs it, at most the job, because workflow-level
  `env:` reaches every job and action.
- Set `timeout-minutes:` on every job and `concurrency:` on branch workflows, because the
  default timeout is six hours and superseded runs keep spending.
- Send production deployments through an environment with required reviewers, because
  an approval protects only the secrets stored in that environment.
- Make the checks that enforce these rules required on the protected branch, because
  a rule nothing blocks on drifts.

Record a deliberate exception next to the rule it breaks and in the project's decision
records, so a reviewer sees that it was chosen.

## What a script cannot know

`check-expression-injection.ts` warns on every `inputs.*` expression inside a `run:`
value, because one file cannot know who calls a reusable workflow or a
`workflow_dispatch`. The risk stays real after you silence the warning, since a caller
may pass untrusted text. Bind the input under `env:` and quote it:

```yaml
- env:
    PR_TITLE: ${{ inputs.title }}
  run: printf 'Title: %s\n' "$PR_TITLE"
```

## References

Read one only when its subject is the task.

- `references/generation-rules.md`: the interview and the rules for a new workflow,
  with a secure skeleton and an OIDC job.
- `references/workflow-syntax.md`: keys of `on:`, `jobs:`, `steps:`, `strategy:`.
- `references/expressions.md`: contexts, functions and `if:` evaluation.
- `references/permissions.md`: the `GITHUB_TOKEN` model and per-use-case grants.
- `references/secrets-and-vars.md`: scopes, OIDC trust policies, masking.
- `references/reusable-workflows.md`: `workflow_call` contracts and limits.
- `references/caching.md`: key and `restore-keys` semantics, per-language recipes.
- `references/runners.md`: hosted and self-hosted runners, labels, limits.

## Friction

See `references/shared-friction-reporting.md`.
