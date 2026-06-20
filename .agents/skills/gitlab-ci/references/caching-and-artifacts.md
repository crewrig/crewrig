# Caching and artifacts reference

GitLab CI/CD exposes two distinct mechanisms for moving files in and out
of jobs. They look similar and are constantly confused, so the headline
distinction comes first.

- **`cache:`** is a **speed optimization** for reusable dependencies
  (an `npm` store, a Go module cache, a `.gradle` directory). The cache
  is **best-effort**: it may be absent, stale, or evicted, and a job
  MUST still succeed on a cold cache. It is keyed and shared across
  pipelines and jobs by key, NOT by stage order. Never treat it as a
  contract for passing build output forward.
- **`artifacts:`** are **job outputs** passed forward to later stages
  and made downloadable from the UI/API. Artifacts are a **contract**:
  by default every job in a later stage automatically downloads the
  artifacts of all jobs from earlier stages. If a build job declares a
  binary as an artifact, the test job in the next stage will have it.

Rule of thumb: if losing the files only costs you time, it is a cache.
If losing the files breaks a downstream job, it is an artifact.

This document covers `cache:` key/policy/fallback semantics, distributed
cache backends, the full `artifacts:` surface (including `reports` and
`dotenv` variable passing), `dependencies:`/`needs:artifacts` fetch
control, language recipes, and the recurring pitfalls.

## How the cache works

A job declares a cache by key and paths:

```yaml
build:
  stage: build
  cache:
    key:
      files:
        - package-lock.json
    paths:
      - .npm/
    policy: pull-push
  script:
    - npm ci --cache .npm --prefer-offline
```

The runner performs two operations:

1. **Pre-job pull.** Resolves `cache:key` to an archive. On hit, the
   `paths:` are extracted into the workspace before `script` runs. On
   miss, `fallback_keys` (then the global fallback) are tried; if all
   miss the job starts cold — which MUST be valid.
2. **Post-job push.** After the job, the `paths:` are re-archived and
   uploaded under `cache:key`. Whether the push happens depends on
   `cache:policy` and `cache:when` (below).

Unlike artifacts, the cache is **not** tied to stage ordering. Two jobs
in the same stage can share a cache by using the same key.

## `cache:key`

The key is the cache's identity. Same key across jobs/pipelines means
shared content.

```yaml
# Static string key.
cache:
  key: gems-ruby-3.3

# Lockfile-hashed key — invalidates automatically when deps change.
cache:
  key:
    files:
      - Gemfile.lock
    prefix: $CI_JOB_NAME

# Predefined-variable key — one cache per branch.
cache:
  key: $CI_COMMIT_REF_SLUG
```

- **`cache:key:files`** — up to two files. GitLab computes a SHA over
  their contents and uses it as (part of) the key. When neither file
  changes, the key is stable and the cache is reused; when a lockfile
  changes, the key changes and a fresh cache is built. If the listed
  files do not exist, the literal `default` is used as the SHA segment.
- **`cache:key:prefix`** — prepended to the computed SHA, letting you
  combine a discriminator (job name, branch slug, OS) with lockfile
  hashing: `prefix-<sha>`.
- **Branch-scoped key** — `key: $CI_COMMIT_REF_SLUG` gives every branch
  its own cache. Trade-off: more storage, but no cross-branch bleed.

The key MUST NOT contain `/` or be the literal `.`/`..`. Predefined
variables (`$CI_COMMIT_REF_SLUG`, `$CI_JOB_NAME`, `$CI_DEFAULT_BRANCH`)
are the usual building blocks.

## `cache:paths`

A list of paths, relative to `$CI_PROJECT_DIR`, archived into the cache.
Globs are supported.

```yaml
cache:
  paths:
    - .npm/
    - vendor/ruby/
    - "**/node_modules/"
```

**Critical GitLab gotcha:** only paths **under** the project directory
(`$CI_PROJECT_DIR`) can be cached. A tool that writes its cache to
`$HOME` (e.g. `~/.cache/go-build`, `~/.m2`, `~/.cargo`) will NOT be
cached unless you redirect it into the workspace via an environment
variable (see the language recipes). This is the single most common
reason a cache "silently does nothing."

## `cache:policy`

Controls the pull/push behavior, trading correctness for speed.

```yaml
# Default: download at start, upload at end.
cache: { key: deps, paths: [.npm/], policy: pull-push }

# Consumer-only: download but never re-upload (faster, read-only jobs).
test:
  cache: { key: deps, paths: [.npm/], policy: pull }

# Producer-only: skip the download, only upload (a dedicated warm-up).
warm-cache:
  cache: { key: deps, paths: [.npm/], policy: push }
```

A common pattern: one `prepare` job with `policy: push` builds the cache;
every downstream job uses `policy: pull` so they never waste time
re-uploading an unchanged cache.

## `cache:when`

Controls whether the cache is saved based on job result.

```yaml
cache:
  key: deps
  paths: [.npm/]
  when: on_success   # default: save only if the job succeeds
  # when: on_failure  # save only if the job fails (debugging)
  # when: always      # save regardless of result
```

Use `when: always` when even a failed job produces a useful partial
cache (e.g. a partially-populated dependency store worth reusing).

## `cache:untracked` and `cache:unprotect`

```yaml
cache:
  untracked: true     # also cache files NOT tracked by git
  unprotect: false    # if true, share cache between protected and
                      # unprotected refs (DANGEROUS — see Pitfalls)
```

- **`untracked: true`** caches every git-untracked file in the workspace
  in addition to `paths:`. Convenient but easy to bloat.
- **`unprotect: true`** lets protected and unprotected branches share one
  cache. The default `false` keeps them separate, which is a security
  boundary — do not flip it without understanding cache poisoning below.

## Multiple caches and `fallback_keys`

A job can declare **multiple caches** as a list, each with its own key:

```yaml
test:
  cache:
    - key:
        files: [package-lock.json]
      paths: [.npm/]
    - key:
        files: [Gemfile.lock]
      paths: [vendor/ruby/]
  script:
    - npm ci --cache .npm
    - bundle install --path vendor/ruby
```

**`cache:fallback_keys`** provides a restore chain analogous to GitHub
Actions' `restore-keys`: if the exact key misses, the listed keys are
tried in order for a partial/older cache.

```yaml
cache:
  key:
    files: [package-lock.json]
    prefix: $CI_COMMIT_REF_SLUG
  fallback_keys:
    - npm-$CI_COMMIT_REF_SLUG
    - npm-$CI_DEFAULT_BRANCH
  paths: [.npm/]
```

A global `cache:` defined at the top of the file applies to every job;
a per-job `cache:` overrides it entirely (the two are NOT merged).

## Distributed cache (S3 / GCS)

By default the cache is stored on the runner's local disk — useless when
jobs land on different runners. For a runner fleet, configure a
**distributed cache** in the runner's `config.toml`:

```toml
[runners.cache]
  Type = "s3"
  Shared = true
  [runners.cache.s3]
    ServerAddress = "s3.amazonaws.com"
    BucketName = "gitlab-runner-cache"
    BucketLocation = "eu-west-1"
```

`Type` may be `s3`, `gcs`, or `azure`. `Shared = true` lets all runners
read each other's caches (required for the cross-runner case). This is a
runner-administration concern — see the runners-and-executors reference
for executor and `config.toml` details. The `.gitlab-ci.yml` author only
declares `cache:`; the backend is transparent.

## How artifacts work

Artifacts are produced by a job and consumed by later jobs (and humans).

```yaml
build:
  stage: build
  script:
    - make build
  artifacts:
    paths:
      - bin/
      - dist/
    expire_in: 1 week
```

By default, every job downloads the artifacts of all jobs in **earlier**
stages. So a `test` job in the `test` stage automatically receives
`bin/` and `dist/` from `build` — no extra wiring.

## `artifacts:paths` and `artifacts:exclude`

```yaml
artifacts:
  paths:
    - target/release/
    - "*.log"
  exclude:
    - target/release/**/*.o   # drop intermediate objects from the upload
  untracked: false            # set true to also upload git-untracked files
```

`paths:` is relative to `$CI_PROJECT_DIR`. `exclude:` prunes matches from
the set selected by `paths:`/`untracked:`, useful for shedding bulky
intermediates while keeping the final output.

## `artifacts:expire_in` and `artifacts:when`

```yaml
artifacts:
  paths: [dist/]
  when: on_success    # on_success (default) | on_failure | always
  expire_in: 30 days  # "1 week", "3 mins 4 sec", "never"
```

- **`when: on_failure`** plus a logs path is the canonical way to capture
  diagnostics only when a job fails.
- **`expire_in`** governs storage cost. Leaving it at the instance
  default (often "never" expiry on self-managed, or a long window) is the
  number-one source of runaway artifact storage. Set an explicit TTL on
  every artifact unless it is a release deliverable. The latest artifacts
  of the most recent successful pipeline on a ref are kept regardless
  (`keep_latest_artifact`), so expiry does not strand your newest build.

## `artifacts:name` and `artifacts:expose_as`

```yaml
artifacts:
  name: "$CI_JOB_NAME-$CI_COMMIT_REF_SLUG"   # archive filename on download
  expose_as: "Coverage report"               # named link in the MR UI
  paths:
    - coverage/index.html
```

`name:` controls the downloaded archive's filename. `expose_as:` surfaces
the artifact as a clickable link directly in the merge request widget
(limited to a small number of paths).

## `artifacts:reports`

`reports:` ingests structured artifacts that GitLab parses and renders,
rather than just storing. Key report types:

```yaml
test:
  script:
    - pytest --junitxml=report.xml --cov --cov-report xml:coverage.xml
  artifacts:
    reports:
      junit: report.xml
      coverage_report:
        coverage_format: cobertura
        path: coverage.xml
```

- **`junit:`** — test results rendered in the MR "Test summary" widget;
  failures are shown inline on the MR.
- **`coverage_report:` (`cobertura`)** — line-coverage overlay on the MR
  diff. `coverage_format` is currently `cobertura` (or `jacoco` on newer
  versions).
- **`sast:`, `dependency_scanning:`, `secret_detection:`** — security
  scanner outputs that populate the MR security widget and the
  vulnerability report. Usually produced by GitLab's bundled scanner
  templates rather than hand-authored.

### `dotenv` — passing variables downstream

The `dotenv` report is special: it does not render a widget, it
**injects variables** from a `.env`-format file into later jobs. This is
the supported way to pass a computed value (a version string, an image
tag, a deploy URL) from one job to the next.

```yaml
build:
  stage: build
  script:
    - echo "VERSION=$(git describe --tags)" >> build.env
    - echo "IMAGE_TAG=registry.example.com/app:$CI_COMMIT_SHORT_SHA" >> build.env
  artifacts:
    reports:
      dotenv: build.env

deploy:
  stage: deploy
  needs:
    - job: build
      artifacts: true      # required to receive the dotenv variables
  script:
    - echo "Deploying $VERSION as $IMAGE_TAG"
```

The downstream job sees `$VERSION` and `$IMAGE_TAG` as ordinary
variables. The variables propagate only to jobs that have the producing
job in `needs:` (or, without `needs:`, to all later-stage jobs).

## Controlling which artifacts are fetched

By default a job downloads ALL upstream artifacts — wasteful when a job
needs none or only some.

### `dependencies:`

```yaml
deploy:
  stage: deploy
  dependencies:
    - build           # fetch ONLY build's artifacts
  script: [./deploy.sh]

lint:
  stage: test
  dependencies: []    # fetch NO artifacts — faster, no download
  script: [./lint.sh]
```

`dependencies:` is an allowlist of job names whose artifacts to fetch.
The empty list `dependencies: []` fetches nothing — the single most
effective speedup for jobs that only need the source checkout.

### `needs: [...].artifacts`

When using `needs:` (the DAG mechanism that lets jobs start out of stage
order), control artifact transfer per-need:

```yaml
deploy:
  needs:
    - job: build
      artifacts: true     # download build's artifacts (default true)
    - job: lint
      artifacts: false    # depend on lint's completion, skip its artifacts
```

`needs:` and `dependencies:` interact: when both are present, `needs:`
governs ordering and `dependencies:` (if also set) further narrows the
fetch set. For DAG pipelines, prefer expressing artifact transfer through
`needs:[].artifacts`.

## Language recipes

Each recipe shows the `cache:` block plus the in-workspace redirection
required by the `$CI_PROJECT_DIR` gotcha.

### npm

```yaml
variables:
  npm_config_cache: "$CI_PROJECT_DIR/.npm"   # move cache into workspace
build:
  cache:
    key:
      files: [package-lock.json]
    paths: [.npm/]
  script:
    - npm ci --prefer-offline
```

### pnpm

```yaml
variables:
  PNPM_HOME: "$CI_PROJECT_DIR/.pnpm-store"
build:
  before_script:
    - corepack enable
    - pnpm config set store-dir "$CI_PROJECT_DIR/.pnpm-store"
  cache:
    key:
      files: [pnpm-lock.yaml]
    paths: [.pnpm-store/]
  script:
    - pnpm install --frozen-lockfile
```

### Yarn

```yaml
build:
  before_script:
    - yarn config set cache-folder "$CI_PROJECT_DIR/.yarn-cache"
  cache:
    key:
      files: [yarn.lock]
    paths: [.yarn-cache/]
  script:
    - yarn install --frozen-lockfile
```

For Yarn Berry zero-installs, `.yarn/cache` is committed to the repo and
no `cache:` block is needed.

### pip / Poetry

```yaml
variables:
  PIP_CACHE_DIR: "$CI_PROJECT_DIR/.pip-cache"        # pip
  POETRY_CACHE_DIR: "$CI_PROJECT_DIR/.poetry-cache"  # poetry
build:
  cache:
    key:
      files:
        - poetry.lock        # or requirements.txt for plain pip
    paths:
      - .pip-cache/
      - .poetry-cache/
      - .venv/
  script:
    - poetry config virtualenvs.in-project true
    - poetry install --no-interaction
```

`virtualenvs.in-project true` puts `.venv/` under `$CI_PROJECT_DIR` so it
can be cached.

### Maven / Gradle

```yaml
variables:
  MAVEN_OPTS: "-Dmaven.repo.local=$CI_PROJECT_DIR/.m2/repository"
  GRADLE_USER_HOME: "$CI_PROJECT_DIR/.gradle"
build-maven:
  cache:
    key:
      files: [pom.xml]
    paths: [.m2/repository/]
  script: [mvn -B verify]

build-gradle:
  cache:
    key:
      files: [gradle/wrapper/gradle-wrapper.properties, build.gradle.kts]
    paths:
      - .gradle/caches/
      - .gradle/wrapper/
  script: [./gradlew build]
```

Both default to `$HOME`; the variables relocate them into the workspace.

### Go modules

```yaml
variables:
  GOPATH: "$CI_PROJECT_DIR/.go"          # module + build cache into workspace
build:
  cache:
    key:
      files: [go.sum]
    paths:
      - .go/pkg/mod/
  script:
    - go build ./...
```

`GOPATH` defaults to `$HOME/go`, which is uncacheable — relocating it is
mandatory for the Go module cache to persist.

### Cargo (Rust)

```yaml
variables:
  CARGO_HOME: "$CI_PROJECT_DIR/.cargo"
build:
  cache:
    key:
      files: [Cargo.lock]
    paths:
      - .cargo/registry/index/
      - .cargo/registry/cache/
      - .cargo/git/db/
      - target/
  script:
    - cargo build --release
```

`CARGO_HOME` defaults to `$HOME/.cargo`; relocate it and cache the
registry plus `target/`.

## Pitfalls

### Cache poisoning across branches and forks

A cache shared between protected and unprotected refs is an injection
vector: a contributor pushing to an unprotected feature branch can write
a poisoned cache that a protected branch (or a fork's MR pipeline) later
restores. Mitigations:

- Keep `cache:unprotect` at its default `false` so protected and
  unprotected refs use separate caches.
- Discriminate the key by ref where trust matters:
  `key: "$CI_COMMIT_REF_PROTECTED-$CI_COMMIT_REF_SLUG"` so protected and
  unprotected content never collide.
- Treat restored binaries as untrusted for security-sensitive
  toolchains; re-verify checksums after the pull.

### Treating cache as artifacts

The cache is best-effort and unordered. Relying on it to pass a build
output to a later stage will work until the day the cache is evicted, a
job lands on a fresh runner, or two pipelines race — then the downstream
job mysteriously fails. Pass build output with `artifacts:`, always.

### Oversized caches

`untracked: true` plus a sprawling `paths:` can produce multi-gigabyte
caches whose upload/download time exceeds the install time they were
meant to save. Cache the dependency store, not the whole workspace, and
measure: if `Restoring cache` takes longer than a cold install, drop it.

### Default `expire_in`

Artifacts without an explicit `expire_in` inherit the instance default,
which on many installs is effectively unbounded. Across thousands of
pipelines this silently consumes object storage. Set a deliberate TTL on
every artifact; reserve long or `never` expiry for genuine release
deliverables.

### The `$CI_PROJECT_DIR` trap, restated

The most frequent "my cache does nothing" cause: caching a tool's default
`$HOME` directory, which lives outside `$CI_PROJECT_DIR` and is therefore
silently un-cacheable. Every language recipe above redirects the tool's
cache into the workspace for exactly this reason — verify the cached path
is under `$CI_PROJECT_DIR` before blaming the key.
