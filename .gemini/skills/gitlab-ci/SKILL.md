---
name: gitlab-ci
description: "Deep, practitioner-grade knowledge of GitLab CI/CD for authoring,
reviewing, hardening, and debugging pipelines. Activate when reading
or writing a `.gitlab-ci.yml`, when reviewing a CI change in a merge
request, when designing runners/executors or reusable CI/CD
Components, or when migrating to GitLab CI from another engine.
Covers pipeline/stage/job structure, the `rules:`/`workflow:` trigger
model, runners and executors, caching vs. artifacts, the
protected/masked variable and secret model, `id_tokens:` OIDC
federation, and includes/components — plus the security defaults that
should never be negotiated away."
license: Apache-2.0
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "1.0.0"
---


# GitLab CI/CD

A dense, practitioner-oriented skill for working on GitLab CI/CD
pipelines. Read the relevant section before editing a `.gitlab-ci.yml`;
defer to the `references/` documents for exhaustive syntax tables. Treat
the **Security defaults** section as non-negotiable.

This skill is the GitLab counterpart of the `github-actions` skill and
presents a parallel activation and escalation contract. Keep your
guidance engine-neutral wherever the project's platform-neutral
capability reference (`ci/ci-capabilities.yml`, described by
`docs/ci-reference-format.md`) keeps it neutral; name GitLab-specific
syntax only where the behaviour is genuinely GitLab-specific.

## When to activate

Activate this skill the moment any of the following is true:

- A `.gitlab-ci.yml` (or an `include`d CI fragment) is being authored,
  modified, or reviewed.
- A reusable **CI/CD Component** or an `include:`-based template is
  being designed or consumed.
- A merge request touches CI configuration and a reviewer-grade audit
  is required (image pinning, protected/masked variables, OIDC, secret
  exposure, `rules:` correctness).
- A pipeline is failing and the root cause is suspected to be in the
  pipeline definition, the runner/executor selection, the cache or
  artifacts, the variable/secret scoping, or the `rules:` evaluation.
- A self-managed runner fleet is being designed, hardened, or
  diagnosed.
- A migration is being planned (e.g., from GitHub Actions, CircleCI,
  Jenkins, or Azure Pipelines to GitLab CI/CD).

Defer to **security** when the change introduces a new secret, widens
the `CI_JOB_TOKEN` access allowlist, adds an `id_tokens:` OIDC trust
relationship to a cloud provider, relaxes protected-branch/variable
gating, or executes untrusted input (MR title, branch name, commit
message) inside a `script:`. Defer to **architect** when the change
restructures the pipeline topology (e.g., splitting a monolithic
pipeline into parent-child pipelines or shared CI/CD Components used
across many projects).

## Reference index

The `references/` directory holds the canonical, exhaustive
documentation for each subdomain of GitLab CI/CD. Read the relevant
file before producing non-trivial output.

| File | One-line description |
|------|----------------------|
| `references/pipeline-syntax.md` | Full grammar of `stages:`, `jobs`, `script:`/`before_script:`/`after_script:`, `needs:`, `rules:`, `extends:`, `!reference`, `parallel:matrix`, `environment:`, `default:`, with annotated examples for every key. |
| `references/rules-and-triggers.md` | The `rules:` model (`if`/`changes`/`exists`/`when`), `workflow:rules:`, legacy `only/except`, parent-child and multi-project `trigger:` pipelines, the predefined-variable and expression-operator tables, and pipeline types. |
| `references/runners-and-executors.md` | Instance/group/project runners, `tags:` selection, the shell/docker/kubernetes executors, autoscaling, `image:`/`services:`, and `config.toml` essentials. |
| `references/caching-and-artifacts.md` | The cache-vs-artifacts distinction, `cache:key/paths/policy/when`, `artifacts:paths/reports/expire_in`, `dependencies:`, distributed cache, and language-specific recipes (npm, pnpm, Yarn, pip, Poetry, Maven, Gradle, Go, Cargo). |
| `references/variables-and-secrets.md` | Variable sources and precedence, `file`/masked/protected variables, external secrets (`secrets:` with Vault / Azure / GCP), `id_tokens:` OIDC federation for AWS / GCP / Azure, masking caveats, and exfiltration anti-patterns. |
| `references/security-and-permissions.md` | `CI_JOB_TOKEN` and its access allowlist, the member-role model, protected branches/tags, protected environments, `id_tokens:`, fork-runner trust, and least-privilege recipes per use case. |
| `references/includes-and-components.md` | `include:` (local/project/remote/template/component), CI/CD Components and the catalog, `spec:inputs:`, `extends:`, `!reference`, `trigger:include`, nesting limits, and versioning strategies. |

## Core concepts

A pipeline is a YAML file (`.gitlab-ci.yml` at the repository root,
overridable via `CI_CONFIG_PATH`) triggered by one or more events —
a push, a merge request, a tag, a schedule, or a manual run. A
pipeline contains **jobs**; each job belongs to a **stage**, and
stages run in declared order while jobs in the same stage run in
parallel. A job is a list of shell commands (`script:`) executed by a
**runner** using a chosen **executor**. State between jobs travels
through **artifacts** (a forward-passed contract) and, opportunistically,
through **cache** (a best-effort speed optimization).

### Stages, jobs, and the DAG

Stages give a coarse ordering; `needs:` gives a fine one. A job with
`needs:` starts as soon as its named dependencies finish, forming a
**directed acyclic graph** that ignores stage boundaries — the way to
shorten a pipeline's critical path. `needs: []` starts a job
immediately, before any stage. See `references/pipeline-syntax.md`.

### Triggers and `rules:`

`rules:` is the modern control-flow primitive: an ordered list whose
first matching entry decides whether (and how) the job runs. Rules key
on `if:` expressions over predefined variables (`$CI_PIPELINE_SOURCE`,
`$CI_COMMIT_BRANCH`, `$CI_COMMIT_TAG`, `$CI_MERGE_REQUEST_*`),
`changes:` (path filters), and `exists:` (file presence).
`workflow:rules:` gates the whole pipeline — most importantly to avoid
running a duplicate detached and branch pipeline for the same commit.
Legacy `only/except` still works but `rules:` supersedes it. See
`references/rules-and-triggers.md`.

### Runners and executors

A runner is the agent that executes a job; the **executor** is how it
does so. The **docker** executor (each job in a fresh container from
`image:`) is the default for reproducibility; **shell** runs directly
on the host; **kubernetes** schedules a pod per job. A job selects a
runner by `tags:`; a job whose tags match no runner stays queued.
Pin `image:` by digest, never a moving tag. See
`references/runners-and-executors.md`.

### Caching vs. artifacts

These are different mechanisms. **Cache** persists reusable
dependencies (e.g. `node_modules/`) across runs to save time; it may be
absent and must never be relied on as a contract. **Artifacts** are a
job's declared outputs, passed forward to later stages and downloadable
from the UI. Use `cache:` for speed and `artifacts:` for correctness.
See `references/caching-and-artifacts.md`.

### Variables and secrets

CI/CD variables come from many sources (instance, group, project,
trigger, `.gitlab-ci.yml`, `dotenv` artifacts) with a defined
precedence. A credential MUST be a **masked** variable (hidden in job
logs) and, when it gates a real environment, a **protected** variable
(exposed only to pipelines on protected branches/tags). The `file`
variable type writes the value to a temp file and exports its path —
the correct channel for certificates and kubeconfigs. For cloud
credentials, **prefer `id_tokens:` OIDC** over long-lived keys. See
`references/variables-and-secrets.md`.

### Permissions and protection

GitLab has no single token scope map; the surface spans the
`CI_JOB_TOKEN` (and its project access allowlist), the project/group
member role model, protected branches/tags, and protected
environments. Production promotion belongs behind a protected
environment with required approvals. See
`references/security-and-permissions.md`.

### Includes and components

`include:` composes a pipeline from local files, other projects,
remote URLs, GitLab templates, or versioned **CI/CD Components**.
Components (`include:component:`) are the modern reusable unit, with a
typed `spec:inputs:` contract and catalog versioning. `extends:` and
`!reference` compose fragments within and across includes. See
`references/includes-and-components.md`.

## Common pitfalls

The top failure modes, in rough order of frequency observed across
real-world audits:

1. **Non-pinned container images.** `image: node:22` (or `:latest`) is
   a moving target — the registry can re-point the tag. Pin by digest
   (`image: node@sha256:…`) and let Renovate track updates.
2. **Plaintext or un-masked secrets.** A credential hardcoded in
   `variables:`, or a masked variable that fails GitLab's masking
   requirements (too short, contains whitespace) and silently logs in
   the clear.
3. **Over-broad `rules:` / missing `workflow:rules:`.** Without a
   `workflow:` guard, a single push to a branch with an open MR runs
   two pipelines. Rules that omit `$CI_PIPELINE_SOURCE` checks fire on
   unintended events.
4. **`CI_DEBUG_TRACE` or `set -x` left enabled.** Both print every
   expanded variable to the job log, including masked ones — masking
   does not survive a shell trace.
5. **Treating cache as artifacts.** Relying on `cache:` to carry build
   output to a later stage. Cache can be cold; only `artifacts:` (or
   `needs:[].artifacts`) is a forward contract.
6. **Cache key on the manifest, not the lockfile.** A cache keyed on
   `package.json` instead of `package-lock.json` goes stale silently;
   one keyed on nothing poisons across branches.
7. **`cache:`/dependency dir outside `$CI_PROJECT_DIR`.** GitLab can
   only cache paths under the project directory; a `GOPATH` or pip
   cache in `$HOME` is silently not cached.
8. **`interruptible` / `resource_group` misuse.** A deploy job left
   `interruptible: true` can be cancelled mid-rollout; production
   deploys need a `resource_group` to serialize.
9. **Untrusted-fork runner exposure.** A shared or `privileged` runner
   that accepts fork MR pipelines can run arbitrary code on your
   infrastructure. Protected variables and protected runners are not
   exposed to fork MRs by default — do not relax that.
10. **Unpinned `include:remote` / `~latest` components.** A remote
    include or a component pinned to `~latest` can change under you.
    Pin to a tag or commit SHA and prefer first-party sources.

## Validation tools

Helper scripts live under `scripts/` and are the recommended way to
catch the pitfalls above before merge. Both are **offline** text scans —
no live GitLab, no `glab`, no Docker, no registry or token access.

- **`scripts/check-pinned-images.sh`** — fails closed if any `image:`
  or `services:` reference is not pinned to an immutable `@sha256:`
  digest. The first-line defense against a re-pointed base image. The
  GitLab counterpart of the `github-actions` skill's
  `check-pinned-actions.sh`.
- **`scripts/check-secrets-exposure.sh`** — flags hardcoded credential
  literals in `variables:`/`script:`, recognizable token shapes
  (`glpat-…`, `ghp_…`, AWS keys, PEM private keys), `echo`/`printf` of a
  credential-named variable, `set -x`, and `CI_DEBUG_TRACE`. The GitLab
  counterpart of the `github-actions` skill's `check-secrets-exposure.sh`.

Invoke them as:

```sh
scripts/check-pinned-images.sh .gitlab-ci.yml
scripts/check-secrets-exposure.sh .gitlab-ci.yml
```

Each accepts exactly one argument — a pipeline file or a directory
(directory mode scans `<dir>/.gitlab-ci.yml` plus YAML under
`<dir>/.gitlab/`). Both exit non-zero on a finding, so CI can fail
closed.

This skill ships **no** offline structural linter and **no** pipeline
simulator, by design. GitLab's `glab ci lint` is a server-side CI-Lint
API call (it requires authentication and a reachable instance — there
is no offline structural validation equivalent to `actionlint`), and
`gitlab-ci-local` *executes* the pipeline in Docker. Both are out of
scope here: executing a pipeline on a live GitLab is not this skill's
job. The two scripts above are the validations with genuine offline
parity to their GitHub Actions siblings; nothing else is shipped as
façade tooling.

## Security defaults

These defaults are not stylistic preferences. Treat every deviation as
requiring an ADR.

1. **Pin every container image by `@sha256:` digest.** No bare tags,
   no `:latest`. Pin `image:` and every `services:` entry; document the
   pin with a comment carrying the human-readable tag.
2. **Every credential is a masked variable.** Never hardcode a secret
   in `variables:` or a `script:`. Confirm the value meets GitLab's
   masking requirements, or it logs in the clear despite the flag.
3. **Protect the variables that gate real environments.** A deploy or
   release credential is **protected** as well as masked, so it is
   exposed only to pipelines on protected branches/tags.
4. **Prefer `id_tokens:` OIDC over long-lived cloud credentials.** A
   long-lived cloud key is acceptable only when the provider does not
   support OIDC for the target resource. Document the exception.
5. **Never echo or trace a secret.** No `echo "$TOKEN"`, no `set -x`
   over secret-bearing commands, no `CI_DEBUG_TRACE: "true"` in a job
   that sees a credential. Masking is best-effort and a transformed
   value bypasses it.
6. **Bind secrets to the smallest scope.** A secret in a global
   `variables:` block is inherited by every job. Bind it to the job —
   or the protected environment — that needs it.
7. **Gate deploy / Pages / Release jobs behind protected refs and
   environments.** Production promotion targets a protected
   environment with required approvals; the environment is also the
   correct scope for production secrets.
8. **Serialize deployments with `resource_group:`** so two pipelines
   never deploy to the same target concurrently, and leave production
   deploys `interruptible: false`.
9. **Scope the `CI_JOB_TOKEN` access allowlist.** Limit which projects
   a job token may reach; the historical "allow all" default is a
   lateral-movement risk.
10. **Never run untrusted code on a `privileged` or shared runner.**
    Fork MR pipelines must not receive protected variables or
    protected runners. Keep that default; if a fork must run privileged
    work, gate it behind a maintainer-approved, protected-environment
    job.

## Quick recipes

A handful of patterns worth memorising.

### Minimum-viable secure pipeline skeleton

```yaml
default:
  image: node@sha256:<digest>  # node:22

stages: [test]

workflow:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS'
      when: never
    - if: '$CI_COMMIT_BRANCH'

unit-test:
  stage: test
  interruptible: true
  cache:
    key:
      files: [package-lock.json]
    paths: [.npm/]
  script:
    - npm ci --cache .npm --prefer-offline
    - npm test
```

### Deploy to AWS via OIDC (no long-lived secrets)

```yaml
deploy:
  stage: deploy
  image: registry.example.com/aws-cli@sha256:<digest>
  environment:
    name: production
  resource_group: production
  interruptible: false
  id_tokens:
    AWS_ID_TOKEN:
      aud: https://gitlab.example.com
  rules:
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
  script:
    - >
      aws sts assume-role-with-web-identity
      --role-arn "$AWS_ROLE_ARN"
      --role-session-name "ci-$CI_PIPELINE_ID"
      --web-identity-token "$AWS_ID_TOKEN"
    - ./scripts/deploy.sh
```

### Safe handling of an untrusted MR title

```yaml
comment:
  variables:
    MR_TITLE: $CI_MERGE_REQUEST_TITLE   # bound to a variable, not interpolated
  script:
    # Quoted; the shell does not re-evaluate the value.
    - printf 'Title: %s\n' "$MR_TITLE"
```

### Pass a build artifact forward (not via cache)

```yaml
build:
  stage: build
  script: [make dist]
  artifacts:
    paths: [dist/]
    expire_in: 1 day

publish:
  stage: deploy
  needs: [build]   # pulls build's artifacts
  script: [./publish.sh dist/]
```

***

When in doubt, consult the relevant `references/` file before writing
YAML. The references are exhaustive on purpose; this top-level skill is
the working surface.
