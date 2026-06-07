# Permissions reference

The `permissions:` key controls the scope of `GITHUB_TOKEN`, the
automatically minted token that GitHub injects into every job. Getting
this right is the single highest-leverage defence against supply-chain
compromise — a workflow with `contents: read` and nothing else cannot
push code, cannot publish a package, cannot open a PR, cannot tag a
release, no matter what an action it calls tries to do.

## The `GITHUB_TOKEN`

A short-lived (max 24 h, but the job's lifetime in practice) installation
token for the GitHub App `github-actions[bot]`. It is:

- Minted at job start, exposed as `secrets.GITHUB_TOKEN`,
  `github.token`, and the environment variable `GITHUB_TOKEN` (if
  set).
- Scoped to the **repository** running the workflow. It cannot reach
  other repositories in the org by default.
- Subject to the `permissions:` key for granular per-scope control.
- Revoked at job end.

The token can:

- Read and write repo content (per the `permissions:` map).
- Authenticate to `ghcr.io` (the GitHub Container Registry) for the
  same repo's namespace.
- Make API calls against the repo and its issues/PRs.

It **cannot**:

- Push to a different repository.
- Trigger workflows by pushing to the repo (cycle prevention) — the
  workflow that pushes does not cause its own next run.
- Approve a PR it opened.

## Default policy

The org / repo setting `Workflow permissions` controls the default
scope when `permissions:` is omitted. Two values:

- **`read-write` (legacy default).** All scopes set to `write`. The
  reason a 2021-vintage workflow can `git push` without any explicit
  permission grant.
- **`read-only` (recommended default).** `contents: read` and
  `metadata: read`. All other scopes are `none`.

Set the org to `read-only` and grant additional scopes in each
workflow that needs them. Audit which repos still default to
`read-write` — those are the highest-risk surface.

The same settings page controls **"Allow GitHub Actions to create
and approve pull requests"**. Leave it off unless a specific bot
workflow needs it; even then, scope the approval mechanism (e.g.,
require a separate identity, not `GITHUB_TOKEN`).

## The `permissions:` key

A map from scope name to access level (`read`, `write`, `none`):

```yaml
permissions:
  contents: read
  pull-requests: write
  id-token: write
```

Shorthands:

- `permissions: read-all` — every scope `read`.
- `permissions: write-all` — every scope `write`.
- `permissions: {}` — every scope `none` (no API access at all).

Set at workflow level for the default; override at job level for
exceptions. Job-level `permissions:` **replaces** the workflow-level
map — it does not merge. A job that needs an extra scope must
re-declare the ones it still wants.

## Scope inventory

The full list of scopes, with the common operations they unlock:

| Scope | `read` enables | `write` enables |
|-------|---------------|-----------------|
| `actions` | List workflow runs, download artifacts. | Cancel runs, delete artifacts. |
| `attestations` | Read provenance attestations. | Create attestations (sigstore). |
| `checks` | Read check runs. | Create / update check runs (custom CI integration). |
| `contents` | Clone code, read tags/releases. | Push commits, create tags, create releases. |
| `deployments` | Read deployment statuses. | Create deployments and statuses (powers the Environments UI). |
| `discussions` | Read discussions. | Comment on / create discussions. |
| `id-token` | Mint OIDC token (for cloud federation). | (`write` is required to request a token.) |
| `issues` | Read issues. | Create / comment / close / label issues. |
| `models` | Use GitHub Models API (read). | — |
| `packages` | Read GitHub Packages (pull container, npm, …). | Publish packages. |
| `pages` | Read Pages config. | Deploy to Pages. |
| `pull-requests` | Read PRs and their reviews. | Create / comment / close / label / merge PRs. |
| `repository-projects` | Read classic Projects. | Modify classic Projects. |
| `security-events` | Read code scanning alerts. | Upload SARIF, dismiss alerts. |
| `statuses` | Read commit statuses. | Create / update commit statuses. |

Two scopes deserve special mention:

- **`id-token: write`** — required to request the OIDC token used
  for cloud federation. Has no read counterpart; the token itself is
  always generated on demand.
- **`contents: write`** — broad. Allows pushing to any branch,
  creating tags, creating releases, modifying the wiki. If the only
  thing you actually need is "create a release", consider using a
  dedicated PAT or App token with a tighter scope instead.

## Least-privilege recipes

The minimum `permissions:` for each common workflow shape.

### Read-only CI

```yaml
permissions:
  contents: read
```

Lints, tests, type-checks. The vast majority of CI workflows.

### CI that comments on PRs

```yaml
permissions:
  contents: read
  pull-requests: write
```

For test-report comments, coverage diffs, screenshot bots.

### Pushing a container to GHCR

```yaml
permissions:
  contents: read
  packages: write
```

`packages: write` is required to push to the
`ghcr.io/<owner>/<repo>` namespace authenticated as
`GITHUB_TOKEN`.

### Creating a GitHub Release

```yaml
permissions:
  contents: write
```

`softprops/action-gh-release` and friends need `contents: write` to
create the release and upload assets.

### Deploying to GitHub Pages

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

The modern Pages deployment flow uses an artifact + OIDC handshake;
`id-token: write` is mandatory.

### OIDC deployment to a cloud provider

```yaml
permissions:
  contents: read
  id-token: write
```

`id-token: write` to mint the JWT; `contents: read` to checkout.
No other scope is needed unless a follow-up step calls the GitHub
API.

### Uploading SARIF for code scanning

```yaml
permissions:
  contents: read
  security-events: write
```

For `github/codeql-action/upload-sarif` and any third-party scanner
publishing alerts.

### Approving / merging a Dependabot PR

```yaml
permissions:
  contents: write
  pull-requests: write
```

Combined with the org setting "Allow GitHub Actions to approve PRs"
enabled. Note that `GITHUB_TOKEN` cannot approve a PR opened by the
same `GITHUB_TOKEN` (Dependabot is a separate identity, so this
works).

### Posting a check run from a custom CI

```yaml
permissions:
  contents: read
  checks: write
```

For non-Actions CI integrations posting back to GitHub.

## Workflow- vs. job-level `permissions:`

The workflow-level block is the **default for all jobs**. A job-level
block **replaces** (does not merge with) the workflow default.

Common pattern: keep the workflow at the read-only floor, elevate
specific jobs:

```yaml
permissions:
  contents: read     # default for all jobs
jobs:
  test:
    runs-on: ubuntu-24.04
    # inherits contents: read
    steps: [...]
  release:
    runs-on: ubuntu-24.04
    permissions:
      contents: write   # this job alone can write
      packages: write
    needs: test
    steps: [...]
```

The release job above gets exactly `contents: write` and
`packages: write` — everything else (including `pull-requests`)
is `none`.

## Org-level restrictions

The org admin can constrain the allowable maximum across all repos
via `Actions → General → Workflow permissions` at org level. If the
org sets the cap to `read-only`, no workflow in the org can grant
write to itself — only a PAT or App token can bypass.

## Auditing

Mechanical audit steps:

- Grep for `write-all` and `read-all` across all `.github/workflows/`
  in the org.
- Grep for workflows missing a workflow-level `permissions:` block
  entirely.
- Cross-reference each `permissions:` entry against the actual API
  calls the workflow makes. Drop unused scopes.
- For workflows using `id-token: write`, verify the OIDC trust
  policy on the cloud side is scoped to the specific
  `repo:<owner>/<repo>:environment:<env>` subject.

The `scripts/actionlint` validator (with the `--shellcheck` flag)
catches the obvious cases. A hand-written check that fails the build
on `write-all` is worth adding to the same pre-merge gate.
