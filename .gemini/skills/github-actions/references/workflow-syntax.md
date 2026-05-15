# Workflow syntax reference

Canonical reference for the YAML grammar of a GitHub Actions workflow.
Each top-level and nested key is enumerated with semantics, defaults,
and a worked example. Read the section that matches the key you are
editing — do not guess from memory.

## File location and naming

Workflow files live under `.github/workflows/` and end in `.yml` or
`.yaml`. The basename has no semantic meaning beyond the workflow UI;
the `name:` key is what appears in the Actions tab and the commit
status.

A repository may contain any number of workflow files. They are
discovered on every push to the default branch (for `schedule:` and
`workflow_dispatch:`) and on every event for the matching triggers.

## Top-level keys

### `name`

Display name in the Actions UI and in commit statuses. Optional; if
omitted, the file path is shown.

```yaml
name: CI
```

### `run-name`

Dynamic display name for an individual run. Supports expression
interpolation. Useful for surfacing the actor or the input that
triggered the run.

```yaml
run-name: "Deploy ${{ inputs.environment }} by @${{ github.actor }}"
```

### `on`

The trigger specification. Accepts:

- A single event name: `on: push`.
- A list of event names: `on: [push, pull_request]`.
- A map of event names to filters:

```yaml
on:
  push:
    branches: [main, "release/**"]
    paths-ignore: ["docs/**"]
    tags: ["v*.*.*"]
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened, ready_for_review]
  schedule:
    - cron: "17 3 * * 1-5"   # 03:17 UTC, Mon–Fri
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options: [staging, production]
        default: staging
        required: true
      dry_run:
        type: boolean
        default: true
  workflow_call:
    inputs:
      version:
        type: string
        required: true
    outputs:
      artifact_url:
        value: ${{ jobs.build.outputs.url }}
    secrets:
      NPM_TOKEN:
        required: true
```

Filter semantics:

- `branches` / `branches-ignore` — glob list. Mutually exclusive.
- `tags` / `tags-ignore` — same shape, applied to tag pushes.
- `paths` / `paths-ignore` — path-glob filter on the changed files
  in the push or PR. Combined with `branches`, both must match.
- `types` — for `pull_request`, defaults to
  `[opened, synchronize, reopened]`. Add `ready_for_review` if you
  want the run to fire when a draft becomes a real PR; or skip
  drafts explicitly with `if: github.event.pull_request.draft == false`.

### `permissions`

Sets the scope of `GITHUB_TOKEN`. Either a shorthand
(`read-all` / `write-all` / `{}`) or an explicit map. See
`permissions.md` for the per-scope semantics.

```yaml
permissions:
  contents: read
  pull-requests: write
  id-token: write
```

Applied at workflow level becomes the default for all jobs; can be
overridden (further restricted or expanded within repo policy) at the
job level.

### `env`

Workflow-wide environment variables. **Never** put secrets here; the
value is inherited by every step in every job.

```yaml
env:
  NODE_OPTIONS: --max-old-space-size=4096
  CI: "true"
```

### `defaults`

Default `run:` configuration for every step in every job. The only
two keys are `run.shell` and `run.working-directory`.

```yaml
defaults:
  run:
    shell: bash
    working-directory: ./app
```

The default shell on Linux/macOS is `bash -e -o pipefail {0}`; on
Windows it is `pwsh -command ". '{0}'"`. Setting `shell: bash`
explicitly on Windows runners pulls in Git Bash.

### `concurrency`

Concurrency control group. Runs sharing a group are serialised; the
optional `cancel-in-progress` boolean cancels older runs in the same
group when a new one queues.

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

Use cases: avoid wasting compute on rapid pushes; serialise
deployments so only one ever runs to a given environment.

### `jobs`

A map of job-id → job definition. Job IDs are alphanumeric plus `_`
and `-`; the first character must be a letter or `_`. They are
referenced from `needs:` and from the `jobs.<id>.outputs` context.

## Job-level keys

### `runs-on`

The runner selector. A string (`ubuntu-24.04`) or an array of labels
(`[self-hosted, linux, x64, prod]`) — all labels must match. For
runner groups (Enterprise/Org), the object form is required:

```yaml
runs-on:
  group: ubuntu-runners
  labels: [self-hosted, large]
```

Pin the OS version. `ubuntu-latest` drifts on a rolling schedule.

### `needs`

Dependency edges, single ID or array. The job runs after all listed
jobs complete with a non-failure status (unless `if:` overrides). The
outputs of `needs` jobs are exposed under
`${{ needs.<id>.outputs.<name> }}`.

```yaml
needs: [build, lint]
```

### `if`

Conditional execution. Evaluated against the same expression syntax
as steps; see `expressions.md`. Pay attention to truthiness of empty
strings.

```yaml
if: github.event_name == 'push' && github.ref == 'refs/heads/main'
```

### `strategy`

Fan-out specification. Three keys:

- `matrix:` — Cartesian product of axes. Combined with `include:`
  (additive) and `exclude:` (subtractive).
- `fail-fast:` — default `true`. When `true`, a single failing
  matrix cell cancels the others.
- `max-parallel:` — concurrency cap across the matrix.

```yaml
strategy:
  fail-fast: false
  max-parallel: 4
  matrix:
    os: [ubuntu-24.04, macos-14, windows-2022]
    node: ["20", "22"]
    include:
      - os: ubuntu-24.04
        node: "22"
        coverage: true
    exclude:
      - os: windows-2022
        node: "20"
```

Each cell runs as an independent job; `matrix.<axis>` is available in
expressions inside the job. The default job name is
`<job-id> (<axis-values-joined>)`; override with `name:` on the job.

### `outputs`

Job-level outputs, surfaced to dependents via `needs.<id>.outputs`.
Values come from step outputs.

```yaml
outputs:
  version: ${{ steps.bump.outputs.version }}
```

### `env`, `defaults`, `permissions`, `concurrency`

Same shape as the workflow-level equivalents, scoped to the job.

### `timeout-minutes`

Per-job timeout. Default 360 (six hours). **Always set this.** A
reasonable upper bound is the 95th percentile of historical runtime
times two.

### `continue-on-error`

When `true`, a failure in this job does not fail the workflow. Useful
for opt-in matrix cells (experimental Node version, beta OS) — combine
with `strategy.fail-fast: false`.

### `container` and `services`

Run the job inside a container image (`container:`) and/or alongside
sidecar service containers (`services:`). Both reference Docker
images.

```yaml
container:
  image: node:22-bookworm
  options: --user 1001
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_PASSWORD: postgres
    ports: ["5432:5432"]
    options: >-
      --health-cmd "pg_isready"
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

Service containers share a Docker network with the job container; the
service hostname is the service key (`postgres` above).

### `environment`

Binds the job to a GitHub deployment **environment**. The environment
can require manual approval, a wait timer, or restrict to specific
branches. Secrets/variables scoped to the environment become available
to the job.

```yaml
environment:
  name: production
  url: https://app.example.com
```

## Step-level keys

A step has either `run:` or `uses:`, never both.

### `id`

Step identifier. Required to reference step outputs from later steps
(`steps.<id>.outputs.<name>`).

### `name`

Display name. Optional; falls back to the `run:` first line or the
`uses:` reference.

### `if`

Step-level conditional. Skipping a step does not skip the rest of the
job. Combine with `steps.<earlier>.outcome` to chain.

### `uses`

Action reference. Forms:

- `actions/checkout@v4` — versioned tag (mutable; **do not use** for
  third-party actions).
- `actions/checkout@<40-char-sha>` — pinned by commit SHA
  (immutable; **always prefer** this).
- `./.github/actions/my-local-action` — local action in the same
  repo.
- `docker://alpine:3.20` — Docker action (the image is the action).

### `with`

Action input map. Inputs are declared by the action's `action.yml`;
the value is a string (numbers and booleans are coerced).

```yaml
- uses: actions/setup-node@<sha>  # v4.x
  with:
    node-version-file: .nvmrc
    cache: npm
    cache-dependency-path: package-lock.json
```

### `run`

Shell script. Multiline via YAML block scalar (`|` or `>`). Shell is
the workflow / job default unless overridden with `shell:` on the
step.

```yaml
- name: Build
  shell: bash
  working-directory: app
  run: |
    set -euo pipefail
    npm ci
    npm run build
```

### `env`

Per-step environment. The recommended channel for moving secrets and
untrusted input into `run:`.

```yaml
- env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    PR_TITLE: ${{ github.event.pull_request.title }}
  run: |
    gh pr comment "$PR_NUMBER" --body "Title: $PR_TITLE"
```

### `continue-on-error`

Same semantics as the job-level key, applied to a single step.

### `timeout-minutes`

Step-level timeout. Default: no limit beyond the job timeout.

### Step outputs

A step writes to `$GITHUB_OUTPUT` to expose values to later steps and
to job outputs.

```yaml
- id: bump
  run: |
    echo "version=1.2.3" >> "$GITHUB_OUTPUT"
- run: echo "${{ steps.bump.outputs.version }}"
```

`$GITHUB_ENV` writes an environment variable visible to all
subsequent steps in the job:

```yaml
- run: echo "BUILD_ID=$(date +%s)" >> "$GITHUB_ENV"
```

`$GITHUB_STEP_SUMMARY` writes Markdown to the run summary page; useful
for surfacing test results without digging through logs.

## Composite action syntax

A composite action lives in its own repo (or under
`.github/actions/<name>/`) with an `action.yml`:

```yaml
name: My composite action
description: …
inputs:
  region:
    description: AWS region
    required: true
    default: eu-west-3
outputs:
  cluster:
    description: EKS cluster name
    value: ${{ steps.lookup.outputs.cluster }}
runs:
  using: composite
  steps:
    - id: lookup
      shell: bash
      run: echo "cluster=prod" >> "$GITHUB_OUTPUT"
```

Composite actions have notable constraints:

- `shell:` is mandatory on every `run:` step (no inheritance from
  workflow defaults).
- `continue-on-error:` is not supported on steps.
- Conditional `if:` is supported.
- No `services:` or `container:`.
- Cannot use `secrets` directly; pass them as `inputs:`.

## Edge cases and quirks

- **YAML booleans.** `on: pull_request` parses cleanly, but a key
  named `on` at the top level of a YAML 1.1 parser can be coerced to
  the boolean `true`. GitHub's parser handles this, but external
  linters may complain — quote with `"on":` if needed.
- **`uses:` and `run:` mutually exclusive** in the same step.
- **`env:` precedence**: step > job > workflow. The deepest binding
  wins.
- **`if:` and `${{ }}`**: the `if:` key accepts an expression
  without the `${{ }}` wrapper; adding it is allowed but redundant.
- **`needs:` semantics**: a job with `needs:` runs only if all
  upstream jobs **succeed**. To run on failure, use
  `if: ${{ always() }}` or `if: ${{ failure() }}`.
- **`strategy.matrix` empty include**: a matrix containing only
  `include:` (no axes) generates one job per `include:` entry — useful
  for hand-curated combinations.
