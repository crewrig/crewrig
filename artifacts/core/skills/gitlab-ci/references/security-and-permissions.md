# Security and permissions reference

GitLab CI/CD has no single token whose scope map you tune the way GitHub
Actions tunes `GITHUB_TOKEN` via `permissions:`. The pipeline's
authority is spread across distinct primitives: the `CI_JOB_TOKEN` and
its accessible-projects allowlist, the project/group member role model,
protected branches and tags, protected environments, and the
masked/protected variable discipline. Getting these right is the
highest-leverage defense against supply-chain compromise — a job that
runs on an unprotected ref, with a tightly scoped job token and no
protected variables in reach, cannot deploy to production, push a
package, or exfiltrate a long-lived cloud key, no matter what a
dependency it pulls tries to do.

This file is the GitLab analog of the GitHub Actions skill's
`permissions.md`. Where GitHub concentrates authority in one token, read
this as "which primitive grants which authority, and how to grant the
minimum".

## The `CI_JOB_TOKEN`

Every job receives a `CI_JOB_TOKEN` — a short-lived credential, valid
only for the lifetime of the job, injected as the predefined variable
`CI_JOB_TOKEN`. It is the rough analog of `GITHUB_TOKEN`, but its scope
is governed by project settings rather than a per-pipeline `permissions:`
key.

The token can:

- Clone the current project (it backs the `git clone` of the pipeline
  itself).
- Authenticate to the project's container registry and package registry
  (pull, and push where the job's user role allows).
- Call a curated subset of the GitLab API on behalf of the job
  (`CI_JOB_TOKEN`-accepting endpoints — a deliberately narrower surface
  than a personal access token).
- Reach **other projects** — but only those on the current project's
  **job-token allowlist** (see below).

It is bound to the identity and role of the **user who triggered the
pipeline**: a job triggered by a Reporter cannot push to the registry
even though the token mechanically exists. Role gates the token; the
token does not elevate the role.

### The job-token accessible-projects allowlist

Under **Settings → CI/CD → Job token permissions** (historically labelled
"Token Access" / "Limit access to this project"), each project maintains
an **allowlist of projects whose CI jobs may use their `CI_JOB_TOKEN`
to access this project**.

- **Historical over-broad default.** On older GitLab versions the token
  was usable across *any* project the triggering user could see — an
  implicit, organization-wide allowlist. That default is the classic
  GitLab CI lateral-movement vector: a compromised job in a low-value
  project could clone or push to a high-value sibling.
- **The hardened posture.** Enable "Limit access to this project" (the
  inbound allowlist), then add only the specific projects whose
  pipelines legitimately need to reach this one. Newer GitLab versions
  default to the restricted allowlist for new projects; audit existing
  projects, which may still carry the legacy open setting.
- **Direction matters.** The allowlist is **inbound**: project A's
  allowlist names the projects *allowed to reach A*. To let project B's
  pipeline clone A, add B to A's allowlist — not the reverse.

An over-permissive allowlist (or the legacy open default) is a `high`
finding: it converts any single pipeline compromise into a blast radius
spanning every reachable project.

## Member roles — who can run and edit pipelines

GitLab gates pipeline authority through the project/group **member role**
of the actor, not through a per-job permission map. The roles, in
increasing authority:

| Role | Relevant CI/CD authority |
|------|--------------------------|
| **Guest** | Cannot run pipelines on private projects; view-only on most CI surfaces. |
| **Reporter** | View pipelines and job logs; cannot run or edit. |
| **Developer** | Run pipelines, push to **unprotected** branches, run manual jobs on unprotected refs. Cannot push to protected branches or manage protected variables by default. |
| **Maintainer** | Manage protected branches/tags, CI/CD variables (including protected/masked), runners, the job-token allowlist, and protected environments. |
| **Owner** | All Maintainer authority plus project/group deletion and transfer. |

The practical security lever: **what is gated behind Maintainer**.
Protected variables, the job-token allowlist, runner registration, and
protected-environment approver lists all sit at Maintainer. Keep the
Maintainer/Owner set small; most contributors operate fine at Developer.

## Protected branches and protected tags

This is the central protection primitive — the GitLab equivalent of
"this credential is only available on the trusted ref". A branch or tag
is **protected** when it appears under **Settings → Repository →
Protected branches / Protected tags**, with an "allowed to push" and
"allowed to merge" role list.

What protection unlocks for CI/CD:

- **Protected variables** are exposed **only** to pipelines running on a
  protected ref. On any other ref the variable is simply absent.
- **Protected runners** accept jobs **only** from pipelines on a
  protected ref.
- It gates who may *create* a pipeline that runs on the protected ref at
  all (the "allowed to push/merge" lists).

Use `$CI_COMMIT_REF_PROTECTED` to gate sensitive jobs on the protection
status of the running ref:

```yaml
deploy_prod:
  stage: deploy
  script:
    - ./deploy.sh
  rules:
    - if: '$CI_COMMIT_REF_PROTECTED == "true" && $CI_COMMIT_BRANCH == "main"'
```

The job above runs only when the pipeline is on a protected `main` — so
the protected deploy variables it relies on are actually present, and an
attacker pushing to a feature branch never reaches the deploy path.

## Protected environments

Protected branches gate *where the secret lives*; **protected
environments** gate *who may promote to a tier and with what approval* —
the correct primitive for a production promotion gate, and the GitLab
analog of GitHub Environments.

Configured under **Settings → CI/CD → Protected environments**, an
environment gains:

- An **allowed-to-deploy** list (roles or specific users/groups) — only
  these identities can run a job targeting the environment.
- **Required approvals** — a deployment to the environment blocks until
  N approvers from the allowed list sign off, independent of who
  triggered the pipeline.
- **Deployment-tier** semantics (`production`, `staging`, …) via the
  `environment.deployment_tier` keyword, so the platform can reason about
  tier ordering.

```yaml
deploy_prod:
  stage: deploy
  script:
    - ./deploy.sh
  environment:
    name: production
    deployment_tier: production
  rules:
    - if: '$CI_COMMIT_REF_PROTECTED == "true"'
```

With `production` registered as a protected environment requiring two
approvals, the job halts pending sign-off even when it sits on a
protected ref. Layer protected environments on top of protected branches
for production — neither alone is sufficient for a high-tier gate.

## OIDC and `id_tokens:`

The least-privilege default for cloud authentication is **federated
OIDC**, not a long-lived access key stored in a variable. GitLab mints a
short-lived JWT per job via the `id_tokens:` keyword; the cloud provider
exchanges it for a temporary, narrowly-scoped credential against a trust
policy keyed on claims like `project_path`, `ref`, and `ref_protected`.

State the principle here; the full trust-policy snippets and per-cloud
audience configuration live in the `variables-and-secrets` reference.

```yaml
deploy:
  id_tokens:
    AWS_ID_TOKEN:
      aud: https://gitlab.example.com
  script:
    - ./assume-role-with-web-identity.sh
```

Reach for OIDC whenever the target cloud supports it. A long-lived key in
a CI/CD variable is acceptable only when the provider has no OIDC path
for the resource — and that exception belongs in an ADR. Scope the
cloud-side trust policy to `ref_protected:true` and the specific
`project_path` so a fork or feature branch cannot assume the role.

## Masked and protected variables

The full treatment lives in the `variables-and-secrets` reference; the
rule, stated once:

- **Mask** every secret variable so its value is redacted from job logs.
- **Protect** every secret variable so it is exposed only on protected
  refs (see *Protected branches* above).
- A secret that is masked but **not** protected leaks to any feature
  branch pipeline; a secret that is protected but **not** masked leaks
  into logs. Production secrets need both.

## Fork and untrusted-contributor trust

Merge requests from forks are the GitLab equivalent of GitHub's
`pull_request` from a fork — the point where untrusted code meets your
CI. GitLab's defense rests on the protection primitives above:

- **Protected variables are NOT exposed** to pipelines triggered by an
  external contributor's fork MR, because the fork branch is not a
  protected ref of your project. The fork pipeline sees only unprotected
  variables.
- **Protected runners do NOT accept** fork-MR jobs for the same reason —
  so a fork cannot land on a runner that has access to a privileged
  network segment or a protected deploy credential.
- **The danger of relaxing this.** Enabling "Run untrusted code" style
  settings, marking fork-fed variables as available, or registering a
  shared runner without protection so it picks up fork jobs, all collapse
  this boundary. Treat any such relaxation as a `high` finding requiring
  explicit justification.

Gate fork-sensitive logic with the `CI_MERGE_REQUEST_*` predefined
variables, which are populated only in merge-request pipelines:

```yaml
fork_safe_tests:
  script: ./run-tests.sh
  rules:
    - if: '$CI_MERGE_REQUEST_SOURCE_PROJECT_ID != $CI_MERGE_REQUEST_PROJECT_ID'
      # MR originates from a fork — run only the sandboxed, secret-free job set
    - if: '$CI_MERGE_REQUEST_ID'
```

Never run a deploy, a registry push, or a job that reads a protected
variable on a fork MR pipeline. Keep untrusted-MR jobs on unprotected,
non-`privileged` runners, restricted to read-only test and lint work.

## Least-privilege recipes

The minimum permission/protection configuration for each common job
shape. These mirror the per-use-case recipes in the GitHub Actions
`permissions.md`.

### (a) Read-only test / lint job

```yaml
unit_tests:
  stage: test
  image: node:22@sha256:<digest>
  script:
    - npm ci
    - npm test
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH'
```

No protected variables, no protected runner, no environment. The default
`CI_JOB_TOKEN` (current-project clone only) is all it needs. The vast
majority of CI jobs are this shape. Safe to run on fork MRs.

### (b) Push to the container / package registry

```yaml
build_image:
  stage: build
  image: docker:27@sha256:<digest>
  services:
    - docker:27-dind
  script:
    - docker login -u "$CI_REGISTRY_USER" -p "$CI_JOB_TOKEN" "$CI_REGISTRY"
    - docker build -t "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA" .
    - docker push "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA"
  rules:
    - if: '$CI_COMMIT_REF_PROTECTED == "true"'
```

`CI_JOB_TOKEN` authenticates to `$CI_REGISTRY` for the current project's
namespace; no separate credential is required. Gate the push on a
protected ref so a fork or feature branch cannot publish an image under
your namespace. The triggering user must hold at least Developer to push.

### (c) Deploy to a cloud via OIDC

```yaml
deploy_cloud:
  stage: deploy
  id_tokens:
    GCP_ID_TOKEN:
      aud: https://gitlab.example.com
  script:
    - ./federated-login.sh   # exchanges $GCP_ID_TOKEN for a short-lived token
    - ./deploy.sh
  environment:
    name: production
    deployment_tier: production
  rules:
    - if: '$CI_COMMIT_REF_PROTECTED == "true"'
```

No long-lived key in any variable. The cloud trust policy is scoped to
`ref_protected:true` and this `project_path`. Layer the protected
`production` environment on top for an approval gate. This is the
preferred deploy shape.

### (d) Create a Release / tag

```yaml
release:
  stage: release
  image: registry.gitlab.com/gitlab-org/release-cli:latest
  script:
    - echo "Publishing release $CI_COMMIT_TAG"
  release:
    tag_name: '$CI_COMMIT_TAG'
    description: 'Release $CI_COMMIT_TAG'
  rules:
    - if: '$CI_COMMIT_TAG && $CI_COMMIT_REF_PROTECTED == "true"'
```

Releases are cut from tags; protect the release tags (under Protected
tags) and gate the job on `$CI_COMMIT_TAG` plus
`$CI_COMMIT_REF_PROTECTED`. The triggering user must be allowed to
create the protected tag. The `release` keyword uses `CI_JOB_TOKEN`
against the current project — no broader scope needed.

### (e) Clone a sibling private repo (job-token allowlist)

```yaml
build_with_dep:
  stage: build
  script:
    - git clone "https://gitlab-ci-token:${CI_JOB_TOKEN}@gitlab.example.com/group/private-dep.git"
    - ./build.sh
```

The clone of `group/private-dep` succeeds **only** if `private-dep`'s
**inbound job-token allowlist** names *this* project. Add this project to
`private-dep`'s allowlist (Settings → CI/CD → Job token permissions);
do not disable the allowlist wholesale. Grant the narrowest entry — the
single consuming project — never a group-wide or open allowlist.

## Security defaults

These defaults are non-negotiable and consistent with the parent
`gitlab-ci` SKILL.md. Treat every deviation as requiring an ADR.

1. **Mask and protect every secret variable.** Masked redacts logs;
   protected restricts exposure to protected refs. Production secrets
   need both (see `variables-and-secrets`).
2. **Prefer OIDC `id_tokens:` over long-lived cloud keys.** A long-lived
   key in a CI/CD variable is acceptable only when the provider has no
   OIDC path for the resource — document the exception.
3. **Pin `image:` and `services:` by digest, not tag.** `node:22@sha256:…`,
   not `node:22`. A mutable tag is a silent supply-chain entry point.
4. **Gate every deploy, Pages, and Release job behind a protected ref**
   (`$CI_COMMIT_REF_PROTECTED == "true"`) and, for production, a
   protected environment with required approvals.
5. **Scope the `CI_JOB_TOKEN` accessible-projects allowlist.** Enable
   the inbound allowlist on every project and name only the specific
   consuming projects; never rely on the legacy open default.
6. **No `privileged` runners for untrusted code.** Never let a fork-MR
   pipeline land on a privileged runner, a `docker:dind` privileged
   executor, or a runner with access to a protected network segment.
   Keep untrusted-MR jobs on unprotected, unprivileged runners doing
   read-only work.
7. **Never expose protected variables or protected runners to fork
   MRs.** This boundary is the default — keep it. Branch fork-sensitive
   logic on `CI_MERGE_REQUEST_SOURCE_PROJECT_ID` vs
   `CI_MERGE_REQUEST_PROJECT_ID`.

## Auditing

Mechanical audit steps:

- Review each project's **Job token permissions** page: confirm the
  inbound allowlist is enabled and lists only legitimate consumers.
  Flag any project still on the legacy open default as `high`.
- Confirm `production` (and equivalent high-tier environments) are
  registered as **protected environments** with an allowed-to-deploy
  list and required approvals.
- Grep pipeline definitions for deploy/registry/release jobs lacking a
  `$CI_COMMIT_REF_PROTECTED` (or protected-tag) guard in their `rules:`.
- Confirm every secret CI/CD variable is both **masked** and
  **protected**; flag any production secret missing either flag.
- Verify OIDC trust policies on the cloud side are scoped to
  `ref_protected:true` and the specific `project_path`, not a wildcard.
- Confirm no shared/protected runner is configured to pick up fork-MR
  jobs, and that no runner used by untrusted code runs `privileged`.
