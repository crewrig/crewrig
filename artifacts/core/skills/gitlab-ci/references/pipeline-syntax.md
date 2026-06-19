# Pipeline syntax reference

Canonical reference for the YAML grammar of a GitLab CI/CD pipeline
(`.gitlab-ci.yml`). Each top-level and job-level key is enumerated with
semantics, defaults, and a worked example. Read the section that matches
the key you are editing — do not guess from memory.

## File location and naming

The pipeline definition lives in a file named `.gitlab-ci.yml` at the
repository root. The basename and location are conventional, not free:
GitLab looks for exactly this path unless the project overrides it.

The override is the per-project **CI/CD configuration file** setting,
exposed at runtime as `CI_CONFIG_PATH`. It accepts a repository-relative
path, a path in a different project, or an external URL:

```yaml
# Project setting "CI/CD configuration file" set to:
#   ci/pipeline.yml                 → file in this repo
#   ci/pipeline.yml@group/templates → file in another project
#   https://example.com/pipeline.yml → remote URL
```

A single file is the entry point; it may pull in further fragments with
the top-level `include:` key (local files, other projects, remote URLs,
or built-in templates). Includes are merged before any job runs.

## Top-level keys

### `stages`

Declares the ordered list of pipeline stages. Jobs in the same stage run
in parallel; a stage starts only after every job in the previous stage
finishes successfully (unless `needs:` overrides the ordering — see
below).

```yaml
stages:
  - build
  - test
  - deploy
```

If `stages:` is omitted, GitLab uses the implicit default ordering:

```yaml
stages:
  - .pre      # always first, runs before any user stage
  - build
  - test
  - deploy
  - .post     # always last, runs after every user stage
```

`.pre` and `.post` are reserved virtual stages that exist whether or not
`stages:` is declared; a job assigned to `.pre` runs before everything,
`.post` after everything, regardless of where they appear in the file.

A job is placed in a stage with its `stage:` key (see job-level keys). A
job referencing a stage not listed in `stages:` is a configuration error.

### `default`

Defines values inherited by every job that does not set them explicitly.
Only a fixed set of keys may appear under `default:` — notably `image`,
`services`, `before_script`, `after_script`, `cache`, `tags`, `retry`,
`timeout`, `interruptible`, and `artifacts`.

```yaml
default:
  image: node:22-bookworm
  tags:
    - docker
  before_script:
    - corepack enable
    - pnpm install --frozen-lockfile
  retry:
    max: 2
    when: runner_system_failure
```

A job overrides a default by redeclaring the key; there is no deep merge
of `default` into the job — the job's value replaces the default wholesale
for that key. Set `inherit:` on a job to opt out of defaults or variables
selectively:

```yaml
job:
  inherit:
    default: false              # ignore all `default:` keys
    variables: [DEPLOY_ENV]     # inherit only these global variables
```

### `variables`

Global CI/CD variables, inherited by every job. Job-scoped `variables:`
override globals for that job. This section is intentionally brief —
variable precedence, masking, protected/file variables, and secret
injection are covered in the `variables-and-secrets.md` reference; consult
it for anything beyond plain key/value defaults.

```yaml
variables:
  GIT_DEPTH: "0"
  FF_USE_FASTZIP: "true"
```

Variable values are strings. Quote numeric- or boolean-looking values to
avoid the YAML coercion traps described in *Edge cases and quirks*.

### `include`

Pulls in external configuration before evaluation. Each entry is `local`,
`project` (+ `ref` + `file`), `remote`, `template`, or `component`.

```yaml
include:
  - local: ci/build.yml
  - project: group/ci-templates
    ref: v1.4.0
    file: /jobs/deploy.yml
  - template: Security/SAST.gitlab-ci.yml
  - component: gitlab.com/components/sonarqube@1.0.0
```

### `workflow`

Controls whether the **whole pipeline** is created for a given event.
Without it, branch and merge-request pipelines can both fire and cause
duplicate runs. The canonical guard:

```yaml
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
    - if: $CI_COMMIT_TAG
    - when: never           # nothing else creates a pipeline
```

`workflow:rules` accepts the same `if` / `changes` / `when` vocabulary as
job `rules:`, plus `auto_cancel` and a `name:` to label the pipeline.

## Job-level keys

A job is any top-level mapping that is not a reserved keyword. Its key is
the job name (shown in the UI and used by `needs:`/`dependencies:`). A job
must define `script:` (or be a `trigger:` / `extends:`-only bridge job).

### `script`

The shell commands the job runs, as a YAML list. Each list item is one
command line; a non-zero exit on any line fails the job. Commands run in
the runner's shell.

```yaml
test:
  stage: test
  script:
    - npm ci
    - npm run lint
    - npm test
```

### `before_script` and `after_script`

`before_script` is prepended to `script` (it shares the same shell
context). `after_script` runs in a **separate shell**, always, even when
the job failed or was cancelled — making it the right place for cleanup.
Because it is a fresh shell, environment changes from `script:` do not
carry into `after_script:`.

```yaml
deploy:
  before_script:
    - terraform init -input=false
  script:
    - terraform apply -auto-approve
  after_script:
    - terraform output -json > tf-out.json || true
```

### `stage`

Assigns the job to a stage from `stages:`. Defaults to `test` when
omitted.

```yaml
lint:
  stage: build
  script:
    - golangci-lint run
```

### `rules` and `when`

`rules:` is the modern flow-control mechanism: an ordered list evaluated
top to bottom, **first match wins**, and the matched rule's `when:`
decides the job's fate. Each rule may carry `if:`, `changes:`,
`exists:`, `when:`, `allow_failure:`, and `variables:`.

`when:` values: `on_success` (default — run if prior stages succeeded),
`on_failure`, `always`, `manual` (a play button in the UI), `delayed`
(with `start_in:`), and `never` (do not add the job).

```yaml
deploy:prod:
  stage: deploy
  script:
    - ./deploy.sh production
  rules:
    - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/
      when: manual
      allow_failure: false
    - if: $CI_COMMIT_BRANCH == "main"
      changes:
        - src/**/*
      when: on_success
    - when: never
```

If no rule matches and there is no trailing catch-all, the job is **not
added** to the pipeline. `rules:` is mutually exclusive with `only/except`
in the same job.

### `needs`

Declares a Directed Acyclic Graph (DAG): the job starts as soon as its
named dependencies finish, ignoring stage boundaries. This is how you
break out of strict stage-by-stage execution.

```yaml
integration:
  stage: test
  needs:
    - build:linux
    - build:macos
  script:
    - ./run-integration.sh
```

`needs: []` (empty list) starts the job **immediately**, at pipeline
creation, regardless of stage:

```yaml
prefetch:
  stage: test
  needs: []          # do not wait for the build stage
  script:
    - ./warm-cache.sh
```

`needs:` can also pull artifacts from a specific upstream job; use the
object form with `artifacts: true`:

```yaml
package:
  stage: deploy
  needs:
    - job: build
      artifacts: true       # download build's artifacts
    - job: changelog
      artifacts: false      # order dependency only, no download
  script:
    - ./package.sh
```

A job with `needs:` can depend only on jobs in the same stage or an
earlier stage. The DAG must be acyclic.

### `dependencies`

Controls which upstream jobs' **artifacts** are downloaded into this job.
By default a job downloads artifacts from every job in all prior stages;
`dependencies:` narrows that set. An empty list disables artifact download
entirely.

```yaml
unit:
  stage: test
  dependencies:
    - build           # only fetch build's artifacts
  script:
    - ./test.sh

quick:
  stage: test
  dependencies: []    # fetch nothing — faster start
  script:
    - ./lint.sh
```

When `needs:` is present, the `needs.*.artifacts` flags take precedence
and `dependencies:` is redundant — prefer expressing both ordering and
artifact flow through `needs:`.

### `artifacts`

Files and directories saved after the job, passed to later stages and
downloadable from the UI.

```yaml
build:
  stage: build
  script:
    - make dist
  artifacts:
    paths:
      - dist/
    exclude:
      - dist/**/*.map
    expire_in: 1 week
    when: on_success          # on_success | on_failure | always
    reports:
      junit: report.xml
      coverage_report:
        coverage_format: cobertura
        path: coverage.xml
```

`reports:` artifacts feed GitLab features (test tab, coverage diffs,
security dashboards) rather than being plain downloads.

### `cache`

Caches dependency directories between runs, keyed for reuse. Distinct from
artifacts: cache is a runner-side optimization, not a contract between
jobs.

```yaml
test:
  cache:
    key:
      files:
        - package-lock.json     # invalidate when the lockfile changes
    paths:
      - node_modules/
    policy: pull-push           # pull | push | pull-push
  script:
    - npm ci
    - npm test
```

### `allow_failure`

When `true`, a failing job does not fail the pipeline; it is shown as a
warning. Defaults to `false`, except for `when: manual` jobs, where it
defaults to `true`. A numeric form restricts which exit codes are
tolerated:

```yaml
flaky:
  script:
    - ./maybe-flaky.sh
  allow_failure:
    exit_codes:
      - 137         # OOM-kill tolerated; any other non-zero still fails
```

### `timeout`

Per-job timeout, overriding the project default. Accepts a human-readable
duration.

```yaml
e2e:
  timeout: 30 minutes
  script:
    - ./e2e.sh
```

### `retry`

Automatically re-runs a failed job. `max:` is 0–2 (default 0). `when:`
restricts retries to specific failure classes, so transient
infrastructure failures retry while genuine test failures do not.

```yaml
deploy:
  retry:
    max: 2
    when:
      - runner_system_failure
      - stuck_or_timeout_failure
      - api_failure
  script:
    - ./deploy.sh
```

### `interruptible`

Marks the job as safe to cancel when a newer pipeline supersedes it on the
same ref. Combined with the project's auto-cancel setting, this stops
wasting runners on outdated commits. Set `false` on jobs that must not be
interrupted (irreversible deploys).

```yaml
build:
  interruptible: true
  script:
    - make
```

### `resource_group`

Serializes jobs that share a named resource so that at most one runs at a
time across all pipelines — the standard guard against concurrent deploys
to the same environment.

```yaml
deploy:prod:
  resource_group: production
  environment:
    name: production
  script:
    - ./deploy.sh
```

### `environment`

Binds the job to a GitLab deployment environment, surfacing it in the
Environments and Deployments views.

```yaml
deploy:review:
  environment:
    name: review/$CI_COMMIT_REF_SLUG
    url: https://$CI_COMMIT_REF_SLUG.review.example.com
    deployment_tier: development      # production|staging|testing|development|other
    on_stop: stop:review              # job that tears this environment down
  script:
    - ./deploy-review.sh

stop:review:
  stage: deploy
  environment:
    name: review/$CI_COMMIT_REF_SLUG
    action: stop
  rules:
    - if: $CI_MERGE_REQUEST_ID
      when: manual
  script:
    - ./teardown-review.sh
```

The `on_stop` job must target the same `environment.name` with
`action: stop`, and is typically `manual`.

### `parallel`

Runs N identical copies of the job. Each copy gets `CI_NODE_INDEX`
(1-based) and `CI_NODE_TOTAL`, which the script uses to shard work.

```yaml
test:
  parallel: 4
  script:
    - ./run-tests.sh --shard "$CI_NODE_INDEX/$CI_NODE_TOTAL"
```

### `parallel:matrix`

Fans out one job per combination of the listed variable axes (Cartesian
product). Each generated job sees its axis variables in the environment;
`CI_NODE_INDEX`/`CI_NODE_TOTAL` cover the whole matrix.

```yaml
test:
  stage: test
  parallel:
    matrix:
      - RUBY: ["3.2", "3.3"]
        DB: [postgres, mysql]
  image: ruby:$RUBY
  script:
    - ./test.sh --db "$DB"
```

The example above generates four jobs:
`test: [3.2, postgres]`, `test: [3.2, mysql]`, `test: [3.3, postgres]`,
`test: [3.3, mysql]`. A list value with multiple keys multiplies; multiple
list entries under `matrix:` are unioned (each entry is its own product).

### `tags`

Selects runners by their tag set. Every listed tag must be present on the
runner.

```yaml
gpu-job:
  tags:
    - gpu
    - linux
  script:
    - ./train.sh
```

### `variables` (job scope)

Per-job variables, overriding globals. Brief here by design; see
`variables-and-secrets.md` for precedence and masking.

```yaml
deploy:staging:
  variables:
    DEPLOY_ENV: staging
  script:
    - ./deploy.sh "$DEPLOY_ENV"
```

## Reuse mechanisms

### Hidden jobs (template jobs)

A job whose name begins with a dot (`.`) is **hidden**: GitLab parses it
but never adds it to a pipeline. Hidden jobs exist purely to be reused via
`extends:` or `!reference`.

```yaml
.deploy-template:
  image: alpine:3.20
  before_script:
    - apk add --no-cache curl
  script:
    - ./deploy.sh
```

### `extends`

Inherits one or more jobs' configuration. Multi-level inheritance is
supported, and keys are **deep-merged**: maps merge key-by-key, while
arrays and scalars are replaced wholesale by the most-derived value. When
`extends:` lists several parents, later parents win on conflict.

```yaml
.base:
  image: node:22
  variables:
    LOG_LEVEL: info
  before_script:
    - npm ci

.with-cache:
  cache:
    paths:
      - node_modules/

test:
  extends:
    - .base
    - .with-cache
  variables:
    LOG_LEVEL: debug        # overrides .base's value via deep merge
  script:
    - npm test
```

`extends:` resolves up to 11 levels deep and is preferred over YAML
anchors because it merges across `include:` boundaries (anchors do not —
an anchor is only visible within the file that defines it).

### YAML anchors vs `extends`

YAML anchors (`&name` / `*name`) and the merge key (`<<:`) are a raw-YAML
feature, resolved by the YAML parser before GitLab sees the document. They
work, but only within a single file and with shallow merge semantics.

```yaml
.defaults: &defaults
  image: node:22
  tags: [docker]

test:
  <<: *defaults
  script:
    - npm test
```

Prefer `extends:` for cross-file reuse and deep merge; reach for anchors
only for small, in-file fragments.

### `!reference`

The `!reference[...]` custom tag injects a value from another job's
specific key — including reaching into a hidden job's `script:` or
`before_script:` and composing fragments. Unlike `extends:`, it copies a
**single addressed value**, so you can interleave reused steps with local
ones.

```yaml
.setup:
  before_script:
    - apk add --no-cache curl jq

.deploy-fragment:
  script:
    - ./deploy.sh

test:
  before_script:
    - !reference [.setup, before_script]
    - echo "local step after the shared setup"
  script:
    - !reference [.deploy-fragment, script]
    - ./verify.sh
```

`!reference` may nest (a referenced value can itself contain a
`!reference`), but circular references are an error.

## Full worked example

```yaml
stages:
  - build
  - test
  - deploy

default:
  image: node:22-bookworm
  tags: [docker]
  retry:
    max: 1
    when: runner_system_failure

variables:
  GIT_DEPTH: "0"

workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

.node-cache:
  cache:
    key:
      files: [package-lock.json]
    paths: [node_modules/]

build:
  stage: build
  extends: .node-cache
  script:
    - npm ci
    - npm run build
  artifacts:
    paths: [dist/]
    expire_in: 1 day

test:
  stage: test
  needs: [build]
  parallel:
    matrix:
      - SUITE: [unit, integration]
  script:
    - npm run test:$SUITE
  artifacts:
    reports:
      junit: junit-$SUITE.xml

deploy:prod:
  stage: deploy
  needs:
    - job: build
      artifacts: true
  resource_group: production
  interruptible: false
  environment:
    name: production
    url: https://app.example.com
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual
  script:
    - ./deploy.sh dist/
```

## Edge cases and quirks

- **GENERATED pipeline.** In this repository, `.gitlab-ci.yml` is
  **derived** by `scripts/build-ci.sh` from `ci/ci-capabilities.yml` — it
  is not hand-authored. Editing the generated `.gitlab-ci.yml` directly is
  pointless; the next build overwrites it. Change the capability reference
  and regenerate. See `docs/ci-reference-format.md` for the source-of-truth
  contract.
- **YAML boolean / `on` traps.** A YAML 1.1 parser coerces bare `yes`,
  `no`, `on`, `off`, `true`, `false` to booleans. A variable value of
  `on` or `no` therefore becomes a boolean and breaks string comparisons.
  Always quote such values: `FEATURE_FLAG: "on"`, `DEBUG: "false"`.
- **`script:` list vs block scalar.** `script:` expects a **list** of
  command strings, not a single block scalar. Writing `script: | …` puts
  one multiline string as the sole list item, which works but defeats
  per-line failure semantics and is harder to read — prefer one list item
  per command.
- **`needs:` vs `stage:` interaction.** `stage:` defines logical ordering
  and the UI grouping; `needs:` overrides the *execution* ordering into a
  DAG. A job can still belong to a later stage yet start early via
  `needs:`. `needs:` can only reference jobs in the same or an earlier
  stage.
- **`rules:` replaced `only/except`.** `only/except` is legacy and must
  not be mixed with `rules:` in the same job. New jobs use `rules:`
  exclusively; it is strictly more expressive (per-rule `variables:`,
  `when:`, `allow_failure:`, `changes:`, `exists:`).
- **First-match-wins in `rules:`.** Evaluation stops at the first matching
  rule. Order matters: put the most specific conditions first and a
  trailing `when: never` (or a catch-all) to make the default explicit.
- **`when: manual` flips `allow_failure`.** A manual job defaults to
  `allow_failure: true`; set it to `false` explicitly when a manual gate
  must block the pipeline on failure.
- **`after_script` is a fresh shell.** It runs unconditionally (even on
  failure or cancellation) but does not inherit shell state or exit codes
  from `script:`. Guard cleanup commands with `|| true` if a non-zero exit
  there would matter.
- **`default:` is replace, not merge.** A job that redeclares a `default:`
  key replaces it wholesale for that job; there is no deep merge of
  `default:` into the job. Deep merge applies only to `extends:`.
- **Anchors do not cross `include:`.** YAML anchors are file-local. To
  reuse configuration defined in an included file, use `extends:` or
  `!reference`, never an anchor.
