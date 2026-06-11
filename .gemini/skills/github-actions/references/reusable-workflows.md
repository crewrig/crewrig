# Reusable workflows reference

A reusable workflow is a workflow file that can be invoked from
another workflow as if it were a step. It is GitHub Actions's answer
to function abstraction: a contract of inputs, secrets, and outputs,
with the body executing in a clean job (or jobs) of its own.

This document covers the `workflow_call` trigger, the contract
definition syntax, calling conventions, the interaction with matrices
and concurrency, and the limitations that distinguish reusable
workflows from composite actions.

## Reusable workflow vs. composite action

A frequent question. The trade-off:

| Property | Reusable workflow | Composite action |
|----------|-------------------|------------------|
| Trigger | `workflow_call`. | Called via `uses:` in a step. |
| Granularity | One or more jobs. | A sequence of steps inside an existing job. |
| Runs on | Its own runner(s). | The caller's runner. |
| Can declare `runs-on:` | Yes. | No (inherits). |
| Can use `services:` / `container:` | Yes. | No. |
| Secrets | Explicit input, or `secrets: inherit`. | Pass as `inputs:` (visible in logs unless masked). |
| Strategy / matrix | Yes (at caller or callee). | No (loop manually). |
| Nesting | Up to 4 levels deep. | Up to 10 levels deep (no recursion). |
| Versioning | By ref (`@<sha>`). | Same. |
| Visibility | Private repo: same repo or org. Public repo: anywhere. | Same. |

Rule of thumb: reach for a **reusable workflow** when the unit of
reuse is "a whole pipeline stage" (build-and-push, deploy, release).
Reach for a **composite action** when the unit of reuse is "three
steps that always go together" (setup-toolchain-and-cache).

## Declaring a reusable workflow

The file is a regular workflow under `.github/workflows/` with
`workflow_call` as a trigger (often the only one):

```yaml
name: Reusable Build
on:
  workflow_call:
    inputs:
      version:
        description: Semver to build.
        type: string
        required: true
      environment:
        type: string
        default: staging
      publish:
        type: boolean
        default: false
    outputs:
      artifact_url:
        description: URL of the published artifact.
        value: ${{ jobs.build.outputs.url }}
    secrets:
      NPM_TOKEN:
        required: true
      GHCR_TOKEN:
        required: false

jobs:
  build:
    runs-on: ubuntu-24.04
    outputs:
      url: ${{ steps.publish.outputs.url }}
    steps:
      - uses: actions/checkout@<sha>
      - id: publish
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: |
          ./scripts/build.sh "${{ inputs.version }}"
          echo "url=https://npm.example.com/${{ inputs.version }}" >> "$GITHUB_OUTPUT"
```

### `inputs:`

Typed inputs. Supported types:

- `string` — default.
- `boolean` — real boolean in the `inputs.X` context.
- `number` — numeric.
- `choice` (only on `workflow_dispatch`, not on `workflow_call`).

Each input has `description`, `required`, `default`. **Required
inputs without a default** must be passed by the caller.

### `outputs:`

The reusable workflow's outputs are mapped from job outputs. The
`value:` expression is evaluated **after** all jobs complete.

```yaml
outputs:
  artifact_url:
    value: ${{ jobs.build.outputs.url }}
```

Outputs can come from any job in the reusable workflow, not just the
last one.

### `secrets:`

Secrets are not implicitly inherited. The reusable workflow declares
which secrets it expects:

```yaml
secrets:
  NPM_TOKEN:
    required: true
```

The caller either lists secrets explicitly or uses
`secrets: inherit` (same-org only).

## Calling a reusable workflow

The caller uses `uses:` at the **job** level (not step):

```yaml
jobs:
  release:
    uses: my-org/shared/.github/workflows/build.yml@<sha>
    with:
      version: "1.2.3"
      publish: true
    secrets:
      NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
    permissions:
      contents: read
      packages: write
```

The `uses:` value identifies the workflow file by ref. Forms:

- `owner/repo/.github/workflows/file.yml@<ref>` — cross-repo.
- `./.github/workflows/file.yml` — same-repo (no ref needed).

**Pin by SHA**, the same as any other third-party action. A tag
(`@v1`) is mutable.

### `with:`

Passes inputs. Must match the callee's `inputs:` declaration —
required inputs are mandatory, types are checked.

### `secrets:`

Two forms:

```yaml
# Explicit pass-through (most common, makes the dependency visible)
secrets:
  NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
  GHCR_TOKEN: ${{ secrets.GHCR_TOKEN }}
```

```yaml
# Inherit all caller secrets (same-org only)
secrets: inherit
```

`secrets: inherit` is convenient but breaks visibility — a reader of
the caller cannot tell which secrets the callee actually consumes.
Prefer explicit pass-through when the callee's secret list is short.

### `permissions:`

The caller's job-level `permissions:` are passed to the callee. The
callee **cannot grant itself more than the caller granted** — a
reusable workflow with internal `permissions: write-all` is silently
capped at the caller's grant. To audit, look at the **caller**'s
permissions; the callee's are advisory.

### Reading outputs

```yaml
jobs:
  build:
    uses: my-org/shared/.github/workflows/build.yml@<sha>
    with:
      version: "1.2.3"
  notify:
    needs: build
    runs-on: ubuntu-24.04
    steps:
      - run: echo "Artifact at ${{ needs.build.outputs.artifact_url }}"
```

## Matrix interactions

Two distinct patterns:

### Matrix in the caller, fan-out across reusable workflow

```yaml
jobs:
  build:
    strategy:
      matrix:
        target: [linux, macos, windows]
    uses: ./.github/workflows/build-target.yml
    with:
      target: ${{ matrix.target }}
```

Each matrix cell calls the reusable workflow independently. The
callee sees a single `inputs.target` value per call.

### Matrix in the callee

A reusable workflow can declare its own `strategy.matrix` inside its
jobs. The matrix is independent of the caller — there is no way to
"flatten" a callee matrix into a caller matrix.

Combining matrices is the cleanest way to express "fan out, fan in":
the caller's matrix produces N callee invocations, each with its own
internal matrix.

## Concurrency

`concurrency:` is supported at the reusable workflow level and at the
caller level. The caller's `concurrency:` applies to the calling job;
the callee's applies to its own jobs. Both fire — be careful not to
accidentally serialize more than intended.

For deploy workflows, the typical pattern is to set `concurrency:`
only at the caller, on the entire deploy job, so concurrent calls to
the reusable workflow are serialized at the call site.

## Limitations

- **Nesting depth: 4.** A reusable workflow can call another reusable
  workflow up to three more levels deep.
- **No recursion.** A workflow cannot call itself, directly or
  transitively.
- **No environment passing** from caller to callee. The callee
  declares its own `environment:` per job; the caller's
  `environment:` does not propagate.
- **`secrets: inherit` requires same-org.** Cross-org callers must
  list every secret explicitly.
- **No conditional `with:` keys.** A `with:` block is evaluated
  before the callee starts; you cannot omit a key based on a
  condition (use a default on the callee side instead).
- **The callee runs on its own runners**, billed to the **caller**'s
  account. A reusable workflow in a public template repo consumed
  from a private repo bills the private repo.
- **`workflow_call` cannot coexist with `pull_request_target` in a
  caller** if the caller is in a public repo and the callee modifies
  the repo — the fork-PR safety model breaks down. Audit the trigger
  combination explicitly.
- **Reusable workflows do not appear as separate steps in the run
  log** — they show up as a nested job. Debugging is one level
  deeper than for composite actions.

## Versioning strategy

The same considerations as for any third-party action, with one
twist: a reusable workflow is itself a workflow, so its dependencies
(actions called inside, runner labels) are part of the contract.

Recommended approach:

1. Tag releases of the reusable workflow with `v<major>.<minor>.<patch>`.
2. Maintain a `v<major>` tag that floats to the latest minor/patch.
3. Consumers pin to a specific commit SHA, with a comment indicating
   the human-readable version.
4. Use Dependabot or Renovate to track upstream releases.

Avoid the temptation to pin to a branch (`@main`). The reusable
workflow can change under you mid-day; pinning by SHA is the only way
to get reproducibility.

## Worked example: build-and-deploy

A common factoring: one reusable workflow for build, one for deploy,
a caller wiring them up.

`shared/.github/workflows/build.yml`:

```yaml
name: Build
on:
  workflow_call:
    inputs:
      ref:
        type: string
        required: true
    outputs:
      image:
        value: ${{ jobs.build.outputs.image }}
permissions:
  contents: read
  packages: write
jobs:
  build:
    runs-on: ubuntu-24.04
    outputs:
      image: ${{ steps.push.outputs.image }}
    steps:
      - uses: actions/checkout@<sha>
        with:
          ref: ${{ inputs.ref }}
      - uses: docker/login-action@<sha>
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: push
        run: |
          IMG="ghcr.io/${{ github.repository }}:${{ inputs.ref }}"
          docker build -t "$IMG" .
          docker push "$IMG"
          echo "image=$IMG" >> "$GITHUB_OUTPUT"
```

`shared/.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  workflow_call:
    inputs:
      image:
        type: string
        required: true
      environment:
        type: string
        required: true
permissions:
  id-token: write
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-24.04
    environment: ${{ inputs.environment }}
    steps:
      - uses: aws-actions/configure-aws-credentials@<sha>
        with:
          role-to-assume: ${{ vars.AWS_DEPLOY_ROLE }}
          aws-region: eu-west-3
      - run: ./deploy.sh "${{ inputs.image }}"
```

Caller `myapp/.github/workflows/release.yml`:

```yaml
name: Release
on:
  push:
    tags: ["v*.*.*"]
permissions:
  contents: read
  packages: write
  id-token: write
jobs:
  build:
    uses: my-org/shared/.github/workflows/build.yml@<sha>
    with:
      ref: ${{ github.ref_name }}
  deploy:
    needs: build
    uses: my-org/shared/.github/workflows/deploy.yml@<sha>
    with:
      image: ${{ needs.build.outputs.image }}
      environment: production
```

This factoring keeps the caller declarative and concentrates the
operational complexity in two well-tested reusable workflows.
