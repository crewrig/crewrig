# CI failure taxonomy

Every diagnosis of a failing GitHub Actions run maps to one of the categories below.
Name the category verbatim before naming the specific cause: categorising first stops
you from pattern-matching to the last failure you saw, and the name stays searchable in
logbook issues. Where a fix is written down in another reference of this skill, the
category points to that file by name instead of repeating it.

## Contents

- Runner capacity
- Cache miss / corruption
- Secret scope
- Permission denial
- Action version mismatch
- Network flake
- Syntax / schema error
- Concurrency conflict

## Runner capacity

Symptoms: a job stays in `queued` for minutes, or a self-hosted job never starts.

A job waiting for a self-hosted runner is cancelled automatically after 24 hours in
the queue. Standard GitHub-hosted runners have a concurrent-job limit per plan (20 on
Free, 40 on Pro, 60 on Team, 500 on Enterprise at the time of writing), and a queue
that is long only when many workflows start together points at that limit.

Typical fixes:

- Switch the affected job from a custom self-hosted label to a GitHub-hosted image
  when it has no host-specific dependency.
- For self-hosted fleets: open the runner list under the repository, organization or
  enterprise settings and look for `Offline` runners; check the runner service and
  the `_diag` logs on the machine; add runners or restart stuck ones. Also check
  that the labels in `runs-on:` match a registered runner, because a job whose labels
  match no runner waits instead of failing.
- For the hosted concurrency limit: stagger workflows, use larger runners (a higher
  limit applies) or ask GitHub Support to raise the limit.

The runner reference of this skill (`runners.md`) holds labels and groups.

## Cache miss / corruption

Symptoms: the restore step reports a miss and `steps.<id>.outputs.cache-hit` is not
`'true'`, a restored cache is inconsistent with the lockfile, restores are slow, or
the repository sits at its cache size limit (10 GB by default; GitHub evicts the least
recently accessed entries once it is exceeded, and any entry not accessed in over 7
days).

Typical fixes: the key construction, the numeric epoch that invalidates a poisoned
cache, the `restore-keys:` trade-off and the size and eviction limits are in
`caching.md`. In short, key on the hash of the **lockfile**, not the manifest. For an
oversized cache, split it per workspace and cache the package manager's download cache
rather than `node_modules`.

## Secret scope

Symptoms: `${{ secrets.X }}` is empty in a job, or a deploy step receives an empty
string. An unset secret evaluates to an empty string without an error.

Typical fixes:

- Confirm the secret exists at the scope the job reads: repository, environment or
  organization. An environment secret is only available to a job that declares
  `environment: <name>`.
- For forks: secrets are not passed to a workflow triggered from a forked repository,
  except `GITHUB_TOKEN`. Do not reach for `pull_request_target` to get them; move
  the work that needs a secret to a workflow a maintainer triggers.
- Never print a secret to "verify" it: GitHub redacts known values from the log but
  does not redact a derived or transformed value, such as a secret written to a file
  and printed, or a substring.

Scopes and masking are detailed in `secrets-and-vars.md`.

## Permission denial

Symptoms: a `403` on a `GITHUB_TOKEN` API call, `Resource not accessible by
integration`, or an OIDC `AssumeRoleWithWebIdentity` failure.

Typical fixes:

- A missing `GITHUB_TOKEN` scope: add it to the **job's** `permissions:` block, not the
  workflow's. The scope table and the replace-not-merge rule are in `permissions.md`.
- An OIDC trust failure: the cloud trust policy must match the `sub` claim the run
  actually presented, and the job needs `id-token: write`. Compare the claim of the
  failed run with the policy rather than assuming its format: a job that references an
  environment presents an `environment:<name>` subject in place of a branch one, and
  the subject format can be customised. A wildcard such as `release/*` needs a
  pattern-matching condition (`StringLike` on AWS), not an exact-match one. The trust
  policy snippets are in `secrets-and-vars.md`.
- A branch-protection violation: do not bypass it. Re-route the work through a pull
  request or a release process.

## Action version mismatch

Symptoms: a previously green workflow fails with an input the action no longer
supports, a deprecated input, or a runtime error from an action.

Typical fixes:

- Read the action's release notes for breaking changes, and pin to the last known-good
  commit SHA while you migrate.
- Follow the action's repository releases so the next bump is intentional, not a
  surprise.

The pinning rule, and why a SHA rather than a tag, are written in `generation-rules.md`;
`check-pinned-actions.ts` is its checker.

## Network flake

Symptoms: intermittent timeouts to `registry.npmjs.org`, `pypi.org` or `docker.io`,
DNS resolution failures, or a GitHub API rate limit.

Typical fixes:

- Add a retry around the network step (`nick-fields/retry@<sha>`, pinned like any
  third-party action, or a shell loop with `curl --retry`). Retries are **bounded**:
  at most 3 attempts with exponential backoff.
- For a rate limit on `GITHUB_TOKEN` (1,000 requests per hour per repository, 15,000
  for resources of a GitHub Enterprise Cloud account): make fewer calls, or use
  another credential whose limit you have checked. Do not loop in a tight retry.
- A flake that recurs more than twice a week is no longer a flake: reclassify it and
  fix the underlying instability.

## Syntax / schema error

Symptoms: the workflow fails to start, `Invalid workflow file`, an `actionlint`
complaint, or a YAML parse error.

Typical fixes:

- Run `actionlint` on the file; `lint-workflow.ts` of this skill wraps it.
- Watch for the classic YAML traps: a tab used as indentation, a multi-line scalar
  with unintended indentation, and an unquoted version such as `3.10` read as the
  float `3.1`.

## Concurrency conflict

Symptoms: a deploy job is cancelled mid-flight, two pull requests race on the same
environment, or an in-flight release is aborted by a newer commit.

A concurrency group holds at most one running and one pending run. By default a
newer run that arrives while one is pending cancels the pending one, even with
`cancel-in-progress: false`, so that setting alone does not queue every commit.

Typical fixes:

- Preview deploys and branch workflows: branch-scoped group with `cancel-in-progress:
  true`; the group patterns are in `generation-rules.md`.
- Production deploys: an environment-scoped group with `cancel-in-progress: false`.
  When every commit must deploy, a third arrival must not replace the pending run:
  use the `queue: max` option of `concurrency:` (it cannot be combined with
  `cancel-in-progress`) or serialise the releases in another way.
- For pull-request jobs that should not race their own follow-up commits, put the
  head reference in the group key. `github.head_ref` is defined only on
  `pull_request` events, so write `${{ github.head_ref || github.run_id }}` (or
  `github.ref`) to avoid an empty group on other events.
