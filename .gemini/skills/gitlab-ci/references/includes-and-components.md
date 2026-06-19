# Includes and components reference

GitLab CI/CD has no single "function call" primitive. Composition is
assembled from several keywords that each cover one axis of reuse:
`include:` pulls external configuration into the current pipeline,
**CI/CD Components** package a parameterised unit and publish it to a
catalog, `spec:inputs:` defines the typed contract a component or
included file exposes, and `extends:` / `!reference[…]` stitch fragments
together within the merged document.

This document covers every form of `include:`, the modern CI/CD
Component mechanism (the headline reusable unit), the `spec:inputs:`
contract and its `$[[ inputs.x ]]` interpolation, composition with
`extends:` and `!reference`, parent-child pipelines via
`trigger:include`, the versioning and supply-chain story, and the
pitfalls that bite when several includes merge into one configuration.

## Picking a composition mechanism

A frequent question. The trade-off:

| Property | `include:` (local/project/remote/template) | CI/CD Component |
|----------|--------------------------------------------|-----------------|
| Unit of reuse | A whole `.gitlab-ci.yml` fragment. | A parameterised, versioned building block. |
| Typed contract | Only if the file declares `spec:inputs:`. | `spec:inputs:` is the idiomatic contract. |
| Versioning | By `ref:` (project) or URL (remote). | By `@<version>` — tag, SHA, `~latest`. |
| Discoverability | None — you must know the path. | Listed in the CI/CD Catalog. |
| Inputs interpolation | `$[[ inputs.x ]]` when `spec:` present. | `$[[ inputs.x ]]` — first-class. |
| Best for | Sharing a stage fragment within an org. | A reusable block consumed across projects. |

Rule of thumb: reach for a **CI/CD Component** when the unit of reuse is
a published, versioned building block consumed by other projects (the
GitLab analog of a reusable workflow). Reach for plain **`include:`**
when you are factoring shared configuration inside one group and do not
need a versioned, catalog-listed contract.

## `include:` — the four classic forms

`include:` merges external YAML into the pipeline configuration **before**
jobs run. The merged result behaves as one document: later keys can
override earlier ones (see *Merge and override semantics*).

### `include:local`

Pulls a file from the **same repository and ref** as the
`.gitlab-ci.yml` being evaluated. The path is absolute from the repo
root and must start with `/`:

```yaml
include:
  - local: '/ci/build.yml'
  - local: '/ci/test.yml'
```

Globs are allowed (`local: '/ci/*.yml'`). Because the file is read at the
pipeline's own ref, `include:local` never introduces a cross-ref
supply-chain question — it is the safest form.

### `include:project`

Pulls a file from **another project on the same GitLab instance**. Pin
the `ref:` (a tag, branch, or SHA) and list one or more files:

```yaml
include:
  - project: 'my-group/ci-templates'
    ref: v1.4.0
    file:
      - '/templates/build.yml'
      - '/templates/deploy.yml'
```

Omitting `ref:` resolves against the included project's **default
branch** at pipeline-creation time — a moving target. Pin a tag or SHA
for reproducibility.

### `include:remote`

Pulls a file from an **arbitrary URL** reachable over HTTP(S):

```yaml
include:
  - remote: 'https://gitlab.example.com/-/snippets/12/raw/main/build.yml'
```

This is the highest-risk form. The URL is fetched at pipeline-creation
time with no integrity check: whoever controls that endpoint controls
part of your pipeline. Treat it like sourcing a remote shell script.

- Only include from a source you trust and control.
- Prefer a URL that resolves to an **immutable** artifact (a raw file at
  a tagged ref or SHA), never `…/raw/main/…`.
- Audit `include:remote` entries in review the same way you audit a
  third-party dependency.

Where possible, replace `include:remote` with `include:project` (same
instance, auditable `ref:`) or a CI/CD Component (versioned, catalog).

### `include:template`

Pulls a **GitLab-maintained template** shipped with the instance. No
ref or project needed — the name resolves against GitLab's bundled set:

```yaml
include:
  - template: Jobs/SAST.gitlab-ci.yml
  - template: Security/Secret-Detection.gitlab-ci.yml
```

These are first-party and version-locked to your GitLab version, so
they are a safe default for security and language scaffolding. They are,
however, opinionated — read what they inject before relying on them.

## `include:` with `rules:` and `inputs:`

An `include:` entry can be made conditional with `rules:` and can pass
typed inputs to a file that declares `spec:inputs:`.

```yaml
include:
  - local: '/ci/deploy.yml'
    rules:
      - if: '$CI_COMMIT_BRANCH == "main"'
  - component: $CI_SERVER_FQDN/my-group/ci/build@1.0.0
    inputs:
      runner_tag: saas-linux-large
    rules:
      - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
```

`include:` `rules:` support `if:`, `exists:`, and variable expressions,
but **not** the job-only `changes:` with `compare_to` in every context —
they are evaluated at pipeline-creation time, before any job. When the
rule does not match, the file is simply not included.

## CI/CD Components — the modern reusable unit

A **CI/CD Component** is a reusable, versioned unit of pipeline
configuration published from a **component project** and consumed via
`include:component`. It is the closest GitLab analog of a GitHub Actions
reusable workflow: a typed contract (`spec:inputs:`) wrapping one or
more jobs, addressed by version, optionally discoverable in the **CI/CD
Catalog**.

### Component address form

```yaml
include:
  - component: $CI_SERVER_FQDN/my-group/my-project/my-component@1.2.0
    inputs:
      stage: build
      image: golang:1.23
```

The path decomposes as
`<fqdn>/<group>/<project>/<component>@<version>`:

- `$CI_SERVER_FQDN` — predefined variable for the current instance host.
  Using it (rather than a hard-coded domain) keeps the component
  portable across self-managed and SaaS instances.
- `<group>/<project>` — the component project that hosts the component.
- `<component>` — the component **name**, matching a file under the
  project's `templates/` directory (see layout below).
- `@<version>` — the version selector (see *Versioning a component*).

### Component project layout

A single project can publish several components. Each component is a
file or directory under `templates/`:

```text
my-project/
├── templates/
│   ├── build.yml            # component "build"
│   └── deploy/
│       └── template.yml     # component "deploy"
├── README.md                # required for catalog publication
└── .gitlab-ci.yml           # the component's own CI (test it!)
```

Resolution rule:

- `templates/<name>.yml` resolves the component `<name>`.
- `templates/<name>/template.yml` resolves the component `<name>` (the
  directory form, useful when the component ships companion files).

### Defining a component with `spec:inputs:`

A component file begins with a `spec:` header in its **first YAML
document**, separated from the configuration by a `---` document marker:

```yaml
spec:
  inputs:
    stage:
      default: test
    image:
      default: golang:1.23
    coverage_threshold:
      type: number
      default: 80
    deploy_env:
      type: string
      options:
        - staging
        - production
    semver:
      type: string
      regex: '^\d+\.\d+\.\d+$'
---
test-job:
  stage: $[[ inputs.stage ]]
  image: $[[ inputs.image ]]
  script:
    - go test -coverprofile=cover.out ./...
    - ./scripts/check-coverage.sh $[[ inputs.coverage_threshold ]]
```

`spec:inputs:` entries support:

- `default:` — value used when the caller omits the input. An input with
  **no `default:`** is **required** — the pipeline fails to create if
  the caller does not supply it.
- `type:` — `string` (default), `number`, `boolean`, or `array`. The
  value is validated and coerced to the declared type.
- `options:` — an allow-list; the supplied value must be one of them.
- `regex:` — a pattern (`string` inputs only) the value must match.

These four constraints are validated **at pipeline creation**, before
any job starts — a contract violation fails fast, not mid-run.

### `$[[ inputs.x ]]` interpolation vs. `variables:`

Input interpolation uses the **double-bracket** form `$[[ inputs.x ]]`
and is resolved **once, at include time**, before the configuration is
merged. This is distinct from `$VARIABLE` / `${VARIABLE}` CI/CD
variables, which are resolved **later**, in the job's runtime shell.

```yaml
spec:
  inputs:
    image:
      default: alpine:3.20
---
job:
  image: $[[ inputs.image ]]        # resolved at include time
  script:
    - echo "$CI_COMMIT_SHA"         # resolved at job runtime
```

Consequences:

- Inputs can parameterise keys that variables cannot reach — `stage:`,
  `image:`, `rules:` conditions, even job names — because they are
  substituted into the YAML before parsing finishes.
- An input is fixed for the lifetime of the include; a variable can
  differ per job run and can be overridden by the runner environment.

Reach for `spec:inputs:` to define the **interface** of a reusable
fragment; reach for `variables:` for values that vary at runtime or that
a downstream job overrides.

### Versioning a component

The `@<version>` selector accepts several forms, in increasing order of
stability:

| Selector | Resolves to | Stability |
|----------|-------------|-----------|
| `@~latest` | Latest **released** version in the catalog. | Moves under you. |
| `@<branch>` (e.g. `@main`) | Tip of that branch. | Moves under you. |
| `@<tag>` (e.g. `@1.2.0`) | That tag. | Stable unless re-tagged. |
| `@<sha>` | That exact commit. | Immutable. |

`~latest` and a branch ref are convenient in development but make the
pipeline non-reproducible — the component can change between two runs of
the same commit. For anything that ships, pin a **tag** (and ideally a
SHA), and bump deliberately.

### Publishing to the CI/CD Catalog

To make a component discoverable and releasable:

1. Add a `README.md` at the component project root (required) and mark
   the project as a catalog resource in its settings.
2. Tag a release commit and create a **release** for that tag (the
   catalog lists released versions; `~latest` resolves to the newest
   release, not the newest tag).
3. The project's own `.gitlab-ci.yml` should test each component (lint
   the YAML, run the component against a fixture) before tagging — a
   published component is a dependency for every consumer.

Releasing is what populates `~latest`; an untagged, unreleased component
is only reachable by branch or SHA.

## `extends:` and `!reference[…]` across includes

Both keywords compose fragments **inside the merged document** — they
operate after all `include:` and component resolution, so they can reach
templates that arrived via an include.

### `extends:`

`extends:` performs a reverse-deep-merge of one or more hidden jobs
(`.name`) into the current job. A hidden template defined in an included
file is fully usable by a job in the root configuration:

```yaml
# in an included file: /ci/base.yml
.docker-build:
  image: docker:27
  services:
    - docker:27-dind
  before_script:
    - docker login -u "$CI_REGISTRY_USER" -p "$CI_REGISTRY_PASSWORD" "$CI_REGISTRY"
```

```yaml
# in the root .gitlab-ci.yml
include:
  - local: '/ci/base.yml'

build:
  extends: .docker-build       # merged from the included template
  script:
    - docker build -t "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA" .
```

The base treatment of `extends:` (merge order, multi-level chains)
belongs to the pipeline-syntax reference; here the point is only that
the merge spans include boundaries.

### `!reference[…]`

`!reference` inserts a specific key from another job — including a job
that came in via an include — without merging the whole job. It is the
surgical alternative to `extends:`:

```yaml
include:
  - local: '/ci/base.yml'

deploy:
  before_script:
    - !reference [.docker-build, before_script]   # reuse just one key
    - echo "extra deploy prep"
  script:
    - ./deploy.sh
```

`!reference` can target arbitrary nesting and is the cleanest way to
reuse a single fragment (a `script` block, a `rules` entry) across
includes without dragging unrelated keys along.

## `trigger:include` — composition by reference

A parent-child pipeline composes by **reference** rather than by merge:
the parent spawns a downstream child pipeline whose configuration is
supplied inline via `trigger:include`. Unlike `include:`, the child runs
as its **own pipeline**, not as merged jobs in the parent.

```yaml
trigger-child:
  trigger:
    include:
      - local: '/ci/child-pipeline.yml'
    strategy: depend
```

- The child sees its own merged configuration; the parent's jobs and
  variables do **not** leak in (only explicitly forwarded variables do).
- `strategy: depend` makes the parent job mirror the child pipeline's
  status, so a child failure fails the parent.
- `trigger:include` accepts the same source forms as `include:`
  (`local`, `project`, `component`, `artifact` for dynamic child
  pipelines).

This is composition for **isolation**: use it when a fragment should run
as an independent pipeline (a monorepo sub-project, a generated dynamic
pipeline) rather than as extra jobs in the current one. The trigger
mechanics, `forward:`, and dynamic child pipelines are covered in the
rules-and-triggers reference; here the framing is that
`trigger:include` is composition-by-reference, the complement to
`include:`'s composition-by-merge.

## Merge and override semantics

When `include:` brings in a job key that the root configuration also
defines, the configurations **merge**, and the later definition wins on
a per-key basis:

- The **root `.gitlab-ci.yml` is processed last**, so a job redefined in
  the root overrides the same job from an included file, key by key
  (not wholesale replacement — unspecified keys survive from the
  include).
- Among multiple `include:` entries, **later entries override earlier
  ones** for the same key.
- Scalar and array keys are **replaced**, not concatenated. Redefining
  `script:` in the root replaces the included `script:` entirely.
- Map keys (e.g. `variables:`) are **deep-merged** — individual keys
  override, siblings survive.

```yaml
include:
  - local: '/ci/base.yml'        # defines test.script + test.image

test:
  image: node:22                 # overrides only the image
  # script: inherited from /ci/base.yml unless redefined here
```

To override deliberately, redefine the exact key. To extend rather than
replace, prefer `extends:` or `!reference[…]` so the original fragment
stays visible.

## Versioning strategy and supply-chain hardening

Every `include:` and component is a dependency. Treat it like one.

1. **Pin every cross-project and remote reference.** Use a `ref:` (tag
   or SHA) on `include:project`, an immutable URL on `include:remote`,
   and a `@<tag>` or `@<sha>` on `include:component`. An unpinned
   reference (`include:project` with no `ref:`, `@main`, `@~latest`) can
   change between two runs of the same commit.
2. **Prefer first-party over third-party.** `include:template` and
   components from a trusted internal group are auditable and version-
   locked. An arbitrary `include:remote` URL is not.
3. **Audit `include:remote`.** It fetches code with no integrity check.
   If you cannot replace it with `include:project` or a component,
   ensure the source is one you control and the URL is immutable.
4. **Version components like a library.** Tag releases
   `<major>.<minor>.<patch>`, populate the catalog with a release per
   tag, and let consumers pin a SHA with a comment naming the version.
5. **Beware moving selectors.** `@~latest` and `@main` are conveniences
   for the component's own development, not for production consumers —
   the same risk as pinning a GitHub Action to `@main`.

The failure mode to avoid is the same across all forms: an unpinned
include changes upstream, and a pipeline that passed yesterday fails (or
worse, silently does the wrong thing) today, on an unchanged commit.

## Common pitfalls

- **Override order surprises.** Because the root config and later
  includes win, a job you thought an included template defined may be
  silently overridden by a same-named key elsewhere. Search the merged
  config (the pipeline editor's *Full configuration* / *View merged
  YAML* tab) when a key is not what you expect.
- **Array keys replace, not append.** Redefining `script:` or
  `before_script:` in the root **discards** the included version
  entirely. Use `!reference` to keep the original and add to it.
- **Variable scope across includes.** `variables:` are deep-merged, so a
  root-level variable silently overrides an included one of the same
  name. Globals defined in one include are visible to jobs from another
  — name them defensively to avoid collisions.
- **Inputs resolve at include time, variables at runtime.** Reaching for
  `$VARIABLE` inside a key that needs an include-time value (a `stage:`
  or job name) will not work — use `$[[ inputs.x ]]`. Conversely,
  `$[[ inputs.x ]]` cannot pick up a value that only exists at job
  runtime.
- **Duplicate job keys across includes.** Two includes defining the same
  job name silently merge; the later include wins per key. There is no
  "job already defined" error — only the merged result. Keep job names
  unique or namespace them per fragment.
- **Unpinned remote includes.** `include:remote` to a `…/raw/main/…` URL
  pulls whatever is at that branch tip right now. Pin to a tagged or
  SHA-addressed raw URL, or move to `include:project`.
- **`~latest` is the newest release, not the newest commit.** A
  component fix pushed to a branch is invisible to `@~latest` consumers
  until a release is created. Conversely, consumers on `@~latest` jump
  to a new major the moment it is released — pin a tag to opt out.
- **Catalog requires a README and a release.** A component project with
  no `README.md` or no GitLab release will not appear in the catalog and
  `@~latest` will not resolve, even though branch/SHA includes still
  work.
