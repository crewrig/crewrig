# Generation rules

How to produce a new GitHub Actions workflow: what to ask, then the rules every
workflow satisfies and the reason behind each. The scripts of the skill check
the rules that have a fixed outcome; the others are judgements the author owns.
When a rule cannot be met, say so in the output and give the reason.

## Contents

- Interview
- Rules checked by a script
- Rules that are judgements
- Minimal secure workflow
- OIDC deployment job

## Interview

Ask once, in one numbered list, then build. A second round of questions costs the
reader more than a documented assumption does.

Before asking, read the repository and answer from it. Skip every question a file
already answers:

- `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`,
  `build.gradle`, `Gemfile`, `mix.exs`: language, runtime, package manager.
- `Dockerfile`, `compose.yaml`: runtime image, build target.
- A pipeline of another platform (`.gitlab-ci.yml`, `.circleci/config.yml`,
  `Jenkinsfile`): test commands, deploy targets, environment names.
- The README deployment section: cloud provider, region hints.

Ask at most seven questions, only about what remains unknown. Needing more means
the repository was not read closely enough: read more files before asking.

1. Runtime version (the latest LTS when the user has no preference).
2. Test command.
3. Lint or format command, and whether to scaffold one when none exists.
4. Build artifact (image, package, binary, static site) and where it is published.
5. Deployment target: none, staging only, staging and production; which cloud.
6. Secrets the pipeline needs, and whether each already exists in the repository.
7. Branches that trigger the pipeline (default: the main branch and pull
   requests) and which deployments need a manual approval.

When an answer is ambiguous, ask one follow-up for that item and do not open a
new round.

## Rules checked by a script

These have a fixed outcome, so the scripts decide them and `validate-pipeline.ts`
runs them together. The reason is here so the first draft already complies.

- **Pin every third-party action by its full 40-character commit SHA**, followed
  by a comment with the readable version (`# v4.1.1`). A tag can be re-pointed by
  the maintainer after the fact; a SHA cannot. The comment is documentation, so
  keep it accurate. When the SHA cannot be resolved in the session, write
  `# TODO: resolve to commit SHA` and report the gap. Checked by
  `check-pinned-actions.ts`.
- **Set a top-level `permissions:` block with `contents: read`**, written as a
  block (the key `permissions:` with `contents: read` indented under it), not as `permissions: {}`: an
  empty mapping also removes read access, so `actions/checkout` fails on a
  private repository. Raise a scope only on the job that needs it
  (`contents: write` to tag a release, `id-token: write` for OIDC). Never use
  `write-all`, and never leave it unset: the repository default may grant the
  token write access to everything. Checked by `check-permissions.ts`.
- **Never check out the pull request head under `pull_request_target`.** That
  trigger runs with the base repository secrets, so the head's code would run
  with them. Check out the base, or build the untrusted code in a
  `pull_request` workflow and hand the result to a `workflow_run` workflow.
  Checked by `check-pull-request-target.ts`.
- **Never paste event data into a `run:` step.** Titles, bodies, branch names and
  commit messages are attacker-controlled, and the expression is substituted
  before the shell parses the line. Bind the value under `env:` and read it as a
  quoted shell variable. Checked by `check-expression-injection.ts`.

## Rules that are judgements

No script can decide these: they depend on the project.

- **OIDC over long-lived cloud credentials.** For any deployment to AWS, GCP,
  Azure or Vault, federate with OIDC: a short-lived token nothing has to rotate
  and nothing can leak after the job. Use `role-to-assume` and `aws-region` for
  AWS, `workload_identity_provider` and `service_account` for GCP, `client-id`,
  `tenant-id` and `subscription-id` for Azure, and no static key or client
  secret. When the cloud side has no OIDC trust yet, still write the OIDC
  workflow and add an "OIDC bootstrap" note listing the prerequisites; a silent
  fallback to static credentials ships the weaker design without anyone deciding
  it.
- **Secrets bound to the smallest scope.** Put a secret under `env:` of the step
  that needs it, or at most the job. A workflow-level `env:` is inherited by every
  job and every action, which widens who can read the secret.
- **Separate jobs for lint, test, build and deploy**, linked by `needs:`. Jobs run
  in parallel by default, and a failure in a bundled job cannot be attributed.
  Gate deployment on the branch: `if: github.ref == 'refs/heads/main'`.
- **`timeout-minutes:` on every job.** The default is six hours, which turns a
  hung step into a billing incident. Starting values: lint 5, test 15, build 20,
  deploy 30; tune them to about twice the 95th percentile of the real runtime.
- **`concurrency:` on branch workflows** so a newer push cancels the older run:
  `group: ${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress:
  true`. A deployment that must serialise uses a group that does not include the
  ref and `cancel-in-progress: false`, because cancelling a deployment halfway
  leaves the target in an unknown state.
- **Environments for deployment gates.** Point a production job at a GitHub
  environment with required reviewers and a wait timer, and keep the production
  secrets in that environment: it is the only scope an approval protects.
- **Required status checks** on the protected branch for the jobs that enforce
  these rules. A rule that nothing blocks on drifts. This is a repository
  setting: list it in the follow-up checklist.
- **Reproducible installs.** A Node pipeline installs with `npm ci`, which
  fails when the lockfile and `package.json` disagree, where `npm install`
  silently rewrites the tree. When the repository has no lockfile, tell the user
  to commit one; do not fall back to `npm install`. The same holds for the
  other ecosystems (`pip` with pinned requirements, `go mod download`, a locked
  `cargo` build).
- **Caching.** Use the caching of the setup action first (`cache: npm` on
  `actions/setup-node`, `cache: pip` on `actions/setup-python`). When
  `actions/cache` is needed, key it on the hash of the lockfile plus a numeric
  epoch you can bump to force a refresh.
- **Runner image.** Name a specific image such as `ubuntu-24.04` on long-lived
  workflows: `ubuntu-latest` moves under the workflow and changes its toolchain
  without a commit.
- **Exceptions.** Record a deliberate exception next to the rule it breaks, in
  the decision table of the delivery and in the project's decision records, so
  the next reviewer sees that it was chosen.

## Minimal secure workflow

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
      - uses: actions/checkout@<40-character sha>  # v4.2.2
      - uses: actions/setup-node@<40-character sha>  # v4.1.0
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm test
```

## OIDC deployment job

```yaml
permissions:
  contents: read
jobs:
  deploy:
    permissions:
      id-token: write   # lets this job, and only this job, request the OIDC token
      contents: read
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    environment: production
    steps:
      - uses: actions/checkout@<40-character sha>  # v4.2.2
      - uses: aws-actions/configure-aws-credentials@<40-character sha>  # v4.0.2
        with:
          role-to-assume: arn:aws:iam::123456789012:role/gha-deploy
          aws-region: eu-west-3
      - run: ./scripts/deploy.sh
```
