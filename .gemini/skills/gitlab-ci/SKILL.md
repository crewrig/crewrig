---
name: gitlab-ci
description: "Authors, reviews, hardens and debugs GitLab CI/CD pipelines, and checks them with bundled scripts for server-side validation, image pinning, secret exposure and legacy only/except keys. Use when reading or writing `.gitlab-ci.yml`, `rules:` or `workflow:rules`, `include:` or CI/CD Components, `id_tokens`, a runner or `glab ci lint`, when a pipeline runs twice or a job stays pending, or when migrating a pipeline from GitHub Actions, Jenkins or CircleCI to GitLab. Not for GitHub Actions workflows, Jenkins or other CI systems except as the source of a migration to GitLab, generic YAML such as Kubernetes manifests or compose files, security or threat-model reviews (security), or merge request descriptions and logbook entries (pr-logbook)."
license: Apache-2.0
compatibility: "Requires Node.js 24 (scripts run as node scripts/<name>.ts). glab is optional: only lint-gitlab-ci.ts needs it, and it reports exit 3 without it."
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "1.2.0"
---


# GitLab CI/CD

Work on a `.gitlab-ci.yml` the way a reviewer who has seen the usual failures would: run the checks below before presenting a pipeline, and give each retained rule its reason when you explain a change. Syntax tables live in the references; this file holds what is easy to get wrong.

## Scripts

Run `node scripts/<name>.ts` from the skill directory, or give its full path from elsewhere. The three offline scripts read only the target you give them, a file or a directory (a directory means `<dir>/.gitlab-ci.yml` plus the YAML under `<dir>/.gitlab/`). `lint-gitlab-ci.ts` takes one file and queries GitLab.

| When | Command | Exit `1` means |
|---|---|---|
| After writing or changing a pipeline, to ask GitLab itself whether it is valid | `node scripts/lint-gitlab-ci.ts .gitlab-ci.yml` (add `--repo <group/project>` when the working copy is not a GitLab checkout, `--timeout <seconds>` to change the 30 s bound) | GitLab reports the configuration invalid; each finding is one error line. |
| Reviewing, authoring or migrating any pipeline | `node scripts/check-rules.ts <file-or-dir>` | A job still carries `only:` or `except:`, or jobs exist with no top-level `workflow:rules`. |
| Reviewing or authoring any pipeline | `node scripts/check-pinned-images.ts <file-or-dir>` (add `--json` for a structured result) | An `image:` or `services:` reference is not pinned to an `@sha256:` digest, or the target does not exist. |
| Reviewing or authoring any pipeline | `node scripts/check-secrets-exposure.ts <file-or-dir>` | A credential literal, a printed secret, `set -x` or `CI_DEBUG_TRACE`; also a target that does not exist. |

Two exit-code contracts coexist. `lint-gitlab-ci.ts` and `check-rules.ts` follow the full one, with `--json` giving `{ok, data, findings}`: `0` ok, `1` finding, `2` usage error, `3` the check could not run. The two older scripts keep their legacy codes, which existing callers rely on: `0` clean or nothing to scan, `1` a finding or a missing target, `2` usage error. They have no exit `3`, and only `check-pinned-images.ts` has `--json`.

`lint-gitlab-ci.ts` is a read-only server-side query: it runs `glab ci lint` against GitLab, with a timeout, and writes nothing. Without `--repo`, glab fails before linting when the directory is not a GitLab checkout, and the script then exits `3` and says so, so pass `--repo` whenever you work outside a checkout. When it exits `3` the pipeline was not validated server-side, whatever the reason (no glab, no login, no network, a timeout). Run the three offline scripts instead, and tell the user plainly that the server-side validation did not happen. Never describe a pipeline as valid on the strength of an exit `3`.

No script simulates or executes a pipeline; `glab ci lint` checks configuration only.

## Rules whose reason is not obvious

- **A pipeline without `workflow:rules` runs twice** when a branch has an open merge request: once as a branch pipeline, once as a merge request pipeline. Add the guard from the skeleton below.
- **`only:`/`except:` cannot share a job with `rules:`**, and GitLab rejects the job. Migrate each job fully, not partly. `check-rules.ts` finds the legacy keys.
- **Pin images by digest.** A tag can be re-pointed in the registry under an unchanged pipeline. Keep the readable tag in a comment next to the digest.
- **Masking is narrow.** A masked variable must be at least 8 characters on one line from a restricted character set, or it logs in the clear. It is a substring replacement in the job log only, so a split, decoded or re-encoded value escapes it, and it does nothing against a job that sends the value elsewhere.
- **Trace options defeat masking.** `CI_DEBUG_TRACE` and `set -x` print every expanded variable, masked ones included, so keep them out of any job that sees a credential.
- **Protect deploy credentials as well as masking them.** A protected variable reaches only pipelines on protected branches and tags, so a feature branch cannot read it.
- **Bind a secret to the job or environment that needs it.** A global `variables:` entry is inherited by every job, including ones that run untrusted code.
- **Prefer `id_tokens:` to a stored cloud key.** The token is short-lived and scoped by claims, so there is nothing to rotate or leak. Keep a long-lived key only when the provider has no OIDC for that resource, and state why.
- **A cache path must sit under `$CI_PROJECT_DIR`.** GitLab archives nothing outside it, so a `GOPATH` or pip cache in `$HOME` is silently never cached. Key the cache on the lockfile, not the manifest.
- **A job whose `tags:` match no runner stays pending** with no error, which is the usual cause of a stuck job.
- **Certificates and kubeconfigs go in `file`-type variables.** Echoing a plain variable into a file defeats masking.
- **Fork merge request pipelines must not reach protected variables or protected runners.** A fork branch is not a protected ref. Relaxing that, or registering an unprotected shared or privileged runner, lets fork code run on your infrastructure. If a fork must run privileged work, gate it behind a maintainer-approved job in a protected environment.
- **Pin remote includes and components.** `include:remote`, a branch ref and `~latest` can change under an unchanged pipeline. Pin a tag or commit SHA and prefer first-party sources.
- **Scope the `CI_JOB_TOKEN` allowlist.** Older projects may still carry the open default, which lets a compromised job in a low-value project reach a high-value one. List only the projects that need access.
- **Serialize deploys with `resource_group:` and set `interruptible: false` on them.** Otherwise two pipelines can deploy to one target at once, and a newer pipeline can cancel a rollout half done. Put production behind a protected environment with required approvals.
- **State the reason of any deviation** from these rules in the change, so the next reviewer can judge it.

## Recipes

The secure skeleton, with the guard against double pipelines:

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

Deploy to AWS through OIDC, with no stored key:

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

An untrusted merge request title, bound to a variable so the shell never re-evaluates it:

```yaml
comment:
  variables:
    MR_TITLE: $CI_MERGE_REQUEST_TITLE
  script:
    - printf 'Title: %s\n' "$MR_TITLE"
```

## Hand-offs

Hand over to the `security` skill when a change introduces a new secret, widens the `CI_JOB_TOKEN` allowlist, adds an `id_tokens:` trust relationship to a cloud provider, relaxes protected-branch or protected-variable gating, or runs untrusted input (a merge request title, branch name or commit message) inside `script:`. Hand over to the `architect` skill when the change restructures pipeline topology, such as parent-child pipelines or shared CI/CD Components used across many projects.

## References

Read the one that matches the task before producing non-trivial output.

| File | Covers |
|---|---|
| [pipeline-syntax.md](references/pipeline-syntax.md) | The grammar of `stages:`, jobs, `script:`, `needs:`, `rules:`, `extends:`, `!reference`, `parallel:matrix`, `environment:`, `default:`, with an example per key. |
| [rules-and-triggers.md](references/rules-and-triggers.md) | The `rules:` model, `workflow:rules:`, legacy `only/except`, parent-child and multi-project `trigger:`, the predefined-variable and operator tables, and pipeline types. |
| [runners-and-executors.md](references/runners-and-executors.md) | Instance, group and project runners, `tags:` selection, the shell, docker and kubernetes executors, autoscaling, `image:`/`services:` and `config.toml`. |
| [caching-and-artifacts.md](references/caching-and-artifacts.md) | `cache:key/paths/policy/when`, `artifacts:paths/reports/expire_in`, `dependencies:`, the distributed cache and language recipes. |
| [variables-and-secrets.md](references/variables-and-secrets.md) | Variable sources and precedence, `file`, masked and protected variables, `secrets:` with Vault, Azure and GCP, `id_tokens:` for AWS, GCP and Azure, and exfiltration anti-patterns. |
| [security-and-permissions.md](references/security-and-permissions.md) | `CI_JOB_TOKEN` and its allowlist, member roles, protected branches, tags and environments, fork trust and least-privilege recipes. |
| [includes-and-components.md](references/includes-and-components.md) | `include:` forms, CI/CD Components and the catalog, `spec:inputs:`, `extends:`, `!reference`, `trigger:include`, nesting limits and versioning. |

## Friction

See `references/shared-friction-reporting.md`.
