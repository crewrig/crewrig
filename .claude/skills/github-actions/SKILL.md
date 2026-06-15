---
name: github-actions
description: "Deep, practitioner-grade knowledge of GitHub Actions for authoring,
reviewing, hardening, and debugging workflows. Activate when reading
or writing any file under `.github/workflows/`, when diagnosing a
failing pipeline, when reviewing a CI change in a pull request, or
when designing reusable / composite actions. Covers workflow syntax,
expressions, runners, caching, secrets, the GITHUB_TOKEN permission
model, OIDC federation, and reusable workflows — plus the security
defaults that should never be negotiated away."
license: Apache-2.0
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
    version: "1.0.2"
---


# GitHub Actions

A dense, practitioner-oriented skill for working on GitHub Actions
workflows. Read the relevant section before editing a workflow file;
defer to the `references/` documents for exhaustive syntax tables. Treat
the **Security defaults** section as non-negotiable.

## When to activate

Activate this skill the moment any of the following is true:

- A file under `.github/workflows/**` is being authored, modified, or
  reviewed.
- A composite action (`action.yml` / `action.yaml`) is being changed.
- A reusable workflow (`on: workflow_call`) is being designed or
  consumed.
- A pipeline is failing and the root cause is suspected to be in the
  workflow definition, the runner image, the cache, the permission
  model, or the secret/variable scoping.
- A pull request touches CI configuration and a reviewer-grade audit is
  required (pinning, permissions, OIDC, secret exposure).
- A migration is being planned (e.g., from GitLab CI, CircleCI, Jenkins,
  or Azure Pipelines to GitHub Actions).
- A self-hosted runner fleet is being designed, hardened, or
  diagnosed.

Defer to **security** when the change introduces a new secret, expands
`GITHUB_TOKEN` permissions, adds an OIDC trust relationship to a cloud
provider, or executes untrusted input (PR title, branch name, issue
body) inside a shell. Defer to **architect** when the change
restructures the workflow topology (e.g., splitting a monolithic
workflow into reusable workflows used across many repositories).

## Reference index

The `references/` directory holds the canonical, exhaustive
documentation for each subdomain of GitHub Actions. Read the relevant
file before producing non-trivial output.

| File | One-line description |
|------|----------------------|
| `references/workflow-syntax.md` | Full grammar of `on:`, `jobs:`, `steps:`, `strategy:`, `concurrency:`, `defaults:`, `env:`, with annotated examples for every key. |
| `references/expressions.md` | Context objects (`github`, `env`, `secrets`, `vars`, `needs`, `inputs`, `steps`, `job`, `runner`, `matrix`), built-in functions, operators, and `if:` evaluation rules. |
| `references/runners.md` | GitHub-hosted runner matrix (OS, CPU, memory, disk, pre-installed software), self-hosted runner architecture, label/group selection, composite-action constraints, ARC (Actions Runner Controller). |
| `references/caching.md` | `actions/cache` semantics — key construction, `restore-keys` fallback chain, cross-branch and cross-ref visibility, eviction, 10 GB repo limit, language-specific recipes (npm, pnpm, Yarn, Maven, Gradle, pip, Poetry, Go modules, Cargo). |
| `references/secrets-and-vars.md` | Secrets vs. variables, scope precedence (org → repo → environment), OIDC federation patterns for AWS / GCP / Azure / Vault, masking, common exfiltration anti-patterns. |
| `references/permissions.md` | `GITHUB_TOKEN` permission model, repository default policy, the `permissions:` key at workflow and job level, least-privilege recipes per use case (release, push container, comment on PR, deploy). |
| `references/reusable-workflows.md` | `workflow_call` triggers, `inputs:` / `outputs:` / `secrets:` contracts, `secrets: inherit`, calling conventions, `strategy.matrix` interaction, nesting limits, versioning strategies. |

## Core concepts

A workflow is a YAML file under `.github/workflows/` triggered by one
or more **events** (`on:`). Each workflow contains one or more
**jobs**, which run in parallel by default on independent **runners**.
A job is an ordered sequence of **steps**; each step is either a shell
script (`run:`) or an invocation of an **action** (`uses:`). State
between steps in a job is shared through the filesystem and through
**outputs**; state between jobs travels through `needs.<job>.outputs`
or through **artifacts**.

### Triggers (`on:`)

Common triggers and the trap that comes with each:

- **`push`** / **`pull_request`** — the workhorses. `pull_request`
  runs with the **base** repository's permissions but the **head**
  ref's code; this is the headline supply-chain risk.
- **`pull_request_target`** — runs with **base** code and **base**
  secrets. Useful for labeling, dangerous for anything that checks out
  the PR head. Never `actions/checkout` the PR head in a
  `pull_request_target` workflow without a separate, sandboxed
  evaluation step.
- **`workflow_dispatch`** — manual trigger with typed `inputs`. Always
  validate enum-style inputs.
- **`workflow_call`** — turns the workflow into a callable function;
  see `references/reusable-workflows.md`.
- **`workflow_run`** — fires when another workflow finishes. Inherits
  no secrets from the upstream workflow. Often used to expose results
  to a higher-privilege context — extreme care required.
- **`schedule`** — cron expressions, UTC. Skewed and not guaranteed
  on the dot. The default branch only.
- **`repository_dispatch`** / **`issues`** / **`issue_comment`** /
  **`release`** — event-shaped triggers; check the `event.action` to
  filter sub-events.

### Jobs and steps

A **job** declares `runs-on:` (the runner), an optional `needs:` list
(dependency edges), an optional `strategy.matrix:` (fan-out), and a
sequence of `steps:`. Each step has either `run:` or `uses:`,
optionally `with:`, `env:`, `if:`, `id:`, `continue-on-error:`, and
`timeout-minutes:`.

Steps in the same job share the workspace (`$GITHUB_WORKSPACE`) and
environment file (`$GITHUB_ENV`). Steps in different jobs do not — use
`actions/upload-artifact` and `actions/download-artifact` to move
files, and `outputs:` to move scalars.

### Expressions and contexts

The `${{ … }}` syntax evaluates expressions. The evaluator has
seven first-class context objects (`github`, `env`, `vars`,
`secrets`, `inputs`, `needs`, `steps`, `job`, `runner`, `matrix`) and
a small set of functions (`contains`, `startsWith`, `endsWith`,
`format`, `join`, `toJSON`, `fromJSON`, `hashFiles`, `success`,
`always`, `cancelled`, `failure`). See `references/expressions.md` for
the full enumeration and evaluation order.

The single most important rule: **never** interpolate user-controlled
strings (PR title, branch name, issue body, commit message) directly
into a `run:` block via `${{ }}`. Pipe them through `env:` instead and
read them as shell variables — the runner masks them properly and the
shell parser does not re-evaluate them.

### Runners

Two flavors: GitHub-hosted (ephemeral VMs maintained by GitHub) and
self-hosted (your hardware, your responsibility). GitHub-hosted runners
are pre-warmed with common toolchains; the inventory shifts — pin a
specific Ubuntu/Windows/macOS image (e.g., `ubuntu-24.04`, not
`ubuntu-latest`) for reproducibility on long-lived workflows. See
`references/runners.md` for resource limits and the pre-installed
software matrix.

### Caching

`actions/cache` reduces install time by persisting directories
identified by a **key**. Cache keys are immutable: once written under
a key, content cannot be overwritten. `restore-keys` provides a
prefix-fallback chain for partial hits. The cache scope is the
repository; entries are reachable across refs with a base-ref fallback
rule documented in `references/caching.md`. Total cache per repository
is 10 GB; LRU eviction.

### Secrets and variables

**Secrets** are encrypted at rest, masked in logs, and never exposed
via the API. **Variables** are plaintext, visible in logs, and meant
for non-sensitive configuration. Both have three scopes: organization,
repository, environment. Environment scope binds to a deployment
**environment** that can require approvals and wait timers — the
correct primitive for promotion gates.

For cloud credentials, **prefer OIDC** over long-lived secrets. OIDC
issues a short-lived token signed by GitHub's OIDC provider; the cloud
side validates the token's `sub`, `repository`, `ref`, and
`environment` claims. No rotation, no leakage window. See
`references/secrets-and-vars.md` for canonical AWS / GCP / Azure
trust-policy snippets.

### Permissions

`GITHUB_TOKEN` is an automatically minted, job-scoped token whose
scope is governed by the `permissions:` key. The org/repo default can
be **permissive** (read-write to everything) or **restricted** (only
`contents: read` and `metadata: read`). Always set
`permissions:` explicitly at the workflow level, even if only to
`contents: read`. Grant additional scopes at the job level on a
need-to-know basis.

### Reusable workflows

A workflow with `on: workflow_call` becomes invocable from another
workflow via `uses: owner/repo/.github/workflows/file.yml@ref`. The
contract is declared via `inputs:`, `outputs:`, and `secrets:`. Nesting
is limited to four levels deep; reusable workflows cannot call
themselves (no recursion); a matrix in the **caller** can fan-out a
reusable workflow but the **callee**'s matrix is independent. See
`references/reusable-workflows.md`.

## Common pitfalls

The top ten failure modes, in rough order of frequency observed across
real-world audits:

1. **Non-pinned third-party actions.** `uses: someorg/some-action@v3`
   is a moving target. Pin by full commit SHA
   (`uses: someorg/some-action@abc123def456…`) and add a comment with
   the human-readable version. Renovate / Dependabot will track
   updates.
2. **Over-scoped `GITHUB_TOKEN`.** Inheriting `write-all` because the
   repository default was never tightened. Set
   `permissions: contents: read` at the workflow level and elevate per
   job.
3. **Script injection via untrusted input.** `run: echo "${{ github.event.pull_request.title }}"`
   is remote code execution. Pipe through `env:` and use
   `"$PR_TITLE"`.
4. **`pull_request_target` checking out the PR head.** The classic
   path to leaking org-level secrets. Either drop the
   `actions/checkout` of the head, or fence the privileged steps
   behind an explicit approval (label gating + environment).
5. **Cache poisoning across branches.** A malicious PR can write a
   cache entry that the main branch later restores. Restrict cache
   restore to the same ref family, or include a security-sensitive
   discriminator in the key.
6. **`hashFiles()` over the wrong glob.** `hashFiles('**/package-lock.json')`
   in a monorepo with vendored copies returns a key that changes
   constantly. Pin to the actual lockfile path.
7. **`continue-on-error: true` masking failures.** Used to silence a
   flaky step, ends up silencing a real regression. Replace with retry
   logic and explicit failure handling.
8. **`if: always()` on cleanup steps that depend on `secrets`.**
   `always()` runs on cancellation; secrets may not be hydrated.
   Combine with `if: ${{ !cancelled() }}` if needed.
9. **`workflow_dispatch` inputs typed as `string` when they are
   booleans/enums.** No client-side validation; enforce with
   `type: choice` and `options:` or `type: boolean`.
10. **Self-hosted runners accepting jobs from public forks.** A fork
    PR can run arbitrary code on your hardware. Set
    `Require approval for all outside collaborators` on the
    repository, and never attach self-hosted runners to a public
    repository without an additional approval gate.

## Validation tools

Helper scripts live under `scripts/` and are the recommended way to
catch the pitfalls above before merge.

- **`scripts/lint-workflow.sh`** — runs the upstream `actionlint` binary
  across `.github/workflows/`. Catches YAML errors, shellcheck
  findings inside `run:` blocks, undefined contexts, unreachable
  steps. Run on every workflow change.
- **`scripts/check-pinned-actions`** — fails the build if any
  `uses:` references a tag/branch rather than a 40-character commit
  SHA. The first-line defense against supply-chain compromise.
- **`scripts/check-secrets-exposure`** — greps for
  `${{ secrets.* }}` patterns that flow into `run:` blocks without
  going through `env:`, and flags `echo $SECRET` style mistakes.
- **`scripts/simulate-job`** / **`scripts/simulate-workflow`** —
  thin wrappers around `act` that run a job or the whole workflow
  locally in Docker. Useful for fast iteration on `run:` logic, but
  remember that `act` does not faithfully reproduce the full
  GitHub-hosted runner image; treat green local runs as necessary,
  not sufficient.

Invoke them as:

```sh
scripts/lint-workflow.sh .github/workflows/
scripts/check-pinned-actions .github/workflows/
scripts/check-secrets-exposure .github/workflows/
scripts/simulate-job .github/workflows/ci.yml build
scripts/simulate-workflow .github/workflows/ci.yml
```

CI should fail closed on any of these. If a script does not exist in
the current fork, add it as part of the same PR that introduces a new
workflow.

## Security defaults

These defaults are not stylistic preferences. Treat every deviation as
requiring an ADR.

1. **Pin every third-party action by 40-character commit SHA.** No
   `@v3`, no `@main`. First-party (`actions/*`) may be pinned by SHA or
   by major-version tag — prefer SHA. Document the pin with a comment
   carrying the human-readable version.
2. **Set `permissions:` at the workflow level**, defaulting to
   `contents: read`. Elevate per job. Never leave the workflow with
   the implicit org/repo default.
3. **Prefer OIDC over long-lived cloud credentials.** A long-lived AWS
   access key in `secrets.AWS_SECRET_ACCESS_KEY` is acceptable only
   when the cloud provider does not yet support OIDC for the target
   resource. Document the exception.
4. **Never define secrets in `env:` at the top level of a workflow.**
   Top-level `env` is inherited by every job; secrets should be
   bound to the smallest scope that needs them — the specific step,
   or at most the specific job.
5. **Never interpolate untrusted input into `run:` via `${{ }}`.**
   Use `env:` to bind the value to a shell variable; reference it as
   `"$VAR"` with quotes.
6. **`pull_request_target` workflows must not check out the PR head**
   unless behind an explicit human approval gate and never with access
   to secrets.
7. **Set `concurrency:` on long-running jobs** to prevent runaway cost
   from rapid pushes — typically
   `group: ${{ github.workflow }}-${{ github.ref }}` with
   `cancel-in-progress: true` for non-deployment workflows.
8. **Set `timeout-minutes:` on every job.** The default is six hours.
   A reasonable upper bound is the 95th percentile of historical
   runtime times two.
9. **Use environments for deployment gates.** Production deployments
   should target a GitHub Environment with required reviewers and a
   wait timer. The environment is also the correct scope for
   production secrets.
10. **Enable required status checks** on protected branches for the
    workflows that enforce these defaults. A skill rule that is not
    mechanically enforced will drift.

## Quick recipes

A handful of patterns worth memorising.

### Minimum-viable secure CI skeleton

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
jobs:
  test:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@<sha>  # v4.2.x
      - uses: actions/setup-node@<sha>  # v4.x
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm test
```

### Deploy to AWS via OIDC (no long-lived secrets)

```yaml
permissions:
  id-token: write   # required for OIDC token issuance
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-24.04
    environment: production
    steps:
      - uses: actions/checkout@<sha>
      - uses: aws-actions/configure-aws-credentials@<sha>  # v4.x
        with:
          role-to-assume: arn:aws:iam::123456789012:role/gha-deploy
          aws-region: eu-west-3
      - run: ./scripts/deploy.sh
```

### Safe handling of untrusted PR title

```yaml
- name: Comment on PR
  env:
    PR_TITLE: ${{ github.event.pull_request.title }}
  run: |
    # Quoted, no re-evaluation, masked if it happens to match a secret
    printf 'Title: %s\n' "$PR_TITLE"
```

### Cache key with safe fallback

```yaml
- uses: actions/cache@<sha>  # v4.x
  with:
    path: ~/.npm
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      npm-${{ runner.os }}-
```

***

When in doubt, consult the relevant `references/` file before writing
YAML. The references are exhaustive on purpose; this top-level skill is
the working surface.
