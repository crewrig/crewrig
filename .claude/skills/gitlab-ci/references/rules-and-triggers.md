# Rules and triggers reference

The control-flow language that decides **whether** a job runs and
**what kind of pipeline** runs at all. Read this before writing any
non-trivial `rules:` clause or `workflow:` gate. Memorising the
short-circuit and pipeline-source rules avoids the bulk of "two
pipelines fired for one push" and "the job ran when I told it not to"
bugs.

## Evaluation surface

Control flow lives at two scopes:

1. **Per-job** via the job-level `rules:` key — decides if *this* job
   is added to the pipeline, and with which `when:`, `allow_failure:`,
   and per-rule `variables:`.
2. **Per-pipeline** via the top-level `workflow:rules:` key — decides
   if *any* pipeline is created for the event, and short-circuits
   duplicate pipelines.

Both are evaluated **at pipeline-creation time**, before any job runs.
A job's `rules:` cannot see another job's result; for run-time
dependencies use `needs:` / `dependencies:`, not `rules:`. The legacy
`only:`/`except:` keys occupy the same per-job slot as `rules:` but
**cannot be combined with it** in the same job — pick one.

## The `rules:` list

`rules:` is an **ordered list**. Evaluation walks it top-to-bottom and
**stops at the first rule that matches** (short-circuit). The matched
rule's attributes (`when`, `allow_failure`, `variables`, `start_in`)
apply; later rules are ignored. If **no** rule matches, the job is
**not added** to the pipeline (implicit `when: never`).

Each rule is a mapping combining one or more **clauses** (`if`,
`changes`, `exists`) with **attributes** (`when`, `allow_failure`,
`variables`, `start_in`). Within one rule, multiple clauses are ANDed.

```yaml
job:
  script: ./run.sh
  rules:
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
      when: on_success
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
      changes:
        - src/**/*
      when: manual
      allow_failure: true
    - when: never
```

### `rules:if`

A single boolean expression over CI/CD variables (operator table
below). The most common clause. Quote the whole expression so YAML
does not choke on `:` or `$`.

```yaml
rules:
  - if: '$CI_COMMIT_TAG'                       # truthy: tag is set
  - if: '$CI_COMMIT_BRANCH =~ /^release\/.+/'  # regex match
```

### `rules:changes`

Matches when any listed path changed. A glob list, or a mapping with
`paths:` plus `compare_to:` to pin the comparison base (essential
outside merge requests, where the default base is unreliable).

```yaml
rules:
  - changes:
      paths:
        - Dockerfile
        - "src/**/*"
      compare_to: 'refs/heads/main'
```

Without `compare_to`, `changes` on a branch pipeline diffs against the
previous commit on that branch — surprising for force-pushes and the
first commit. Pin `compare_to` for deterministic behavior.

### `rules:exists`

Matches when at least one file matching the glob exists in the
repository at pipeline-creation time. Globs are relative to the repo
root; `**` recurses.

```yaml
rules:
  - exists:
      - "**/Dockerfile"
```

### `when:` attribute

Selects the job's run behavior once its rule matches:

| Value | Behavior |
|-------|----------|
| `on_success` | Run if all jobs in earlier stages succeeded (or `allow_failure`). The default. |
| `on_failure` | Run only if at least one job in an earlier stage failed. |
| `always` | Run regardless of earlier-stage status. |
| `manual` | Add the job but require a manual play action. |
| `delayed` | Schedule the job after `start_in:`. |
| `never` | Do **not** add the job. Used as a terminal "drop everything else" rule. |

`when: manual` jobs are non-blocking by default in `rules:`-driven
pipelines; pair with `allow_failure: false` to make a manual gate
block downstream stages.

### `allow_failure:` attribute

Set per matched rule. `true` lets the job fail without failing the
pipeline; `false` makes it blocking. Overrides the job-level
`allow_failure:` for that rule.

### `variables:` attribute

A matched rule may inject or override variables for the job — the
canonical way to parameterise one job by the branch or event that
selected it.

```yaml
deploy:
  script: ./deploy.sh "$TARGET_ENV"
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
      variables:
        TARGET_ENV: production
    - if: '$CI_COMMIT_BRANCH == "staging"'
      variables:
        TARGET_ENV: staging
```

### `start_in:` and `when: delayed`

`start_in:` is required by `when: delayed` and gives a human-readable
duration (`30 seconds`, `1 hour`, `2 days`, capped at one week).

```yaml
rollout:
  script: ./rollout.sh
  rules:
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
      when: delayed
      start_in: '15 minutes'
```

## `workflow:rules:` — whole-pipeline gating

`workflow:` sits at the top level and decides whether *any* pipeline
is created. Same clause/attribute grammar as job `rules:`, but only
`when: always` and `when: never` are meaningful (a pipeline either
exists or it does not). Use it to prevent **duplicate pipelines** —
the single most common GitLab CI footgun.

### The duplicate-pipeline idiom

When merge-request pipelines are enabled, a push to a branch that has
an open MR fires **two** events: a branch pipeline *and* a detached
merge-request pipeline. The canonical guard runs MR pipelines when an
MR is open, branch pipelines only when none is, and tag pipelines
always:

```yaml
workflow:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_TAG'
    - if: '$CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS'
      when: never
    - if: '$CI_COMMIT_BRANCH'
```

`$CI_OPEN_MERGE_REQUESTS` is non-empty on a branch pipeline whose
commit has at least one open MR; the third rule drops that redundant
branch pipeline, leaving only the detached MR pipeline. GitLab ships
this exact pattern as the `Branch-Pipelines` / `MergeRequest-Pipelines`
templates.

### `workflow:name:`

Sets a human-readable name for the whole pipeline, supporting
variable interpolation evaluated at creation time.

```yaml
workflow:
  name: 'Pipeline for $CI_COMMIT_REF_NAME'
```

## Predefined CI/CD variables used in rules

The variables that actually drive `rules:if`. Each is a string; an
unset variable is the empty string (falsy).

| Variable | Value |
|----------|-------|
| `CI_PIPELINE_SOURCE` | What triggered the pipeline (value enumeration below). |
| `CI_COMMIT_BRANCH` | Branch name. **Empty** on tag pipelines and MR (detached) pipelines. |
| `CI_COMMIT_TAG` | Tag name. Set **only** on tag pipelines. |
| `CI_DEFAULT_BRANCH` | The project's default branch (e.g. `main`). |
| `CI_COMMIT_REF_NAME` | Branch **or** tag name — set on both branch and tag pipelines. |
| `CI_MERGE_REQUEST_TARGET_BRANCH_NAME` | Target branch of the MR. Set only on MR pipelines. |
| `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME` | Source branch of the MR. MR pipelines only. |
| `CI_OPEN_MERGE_REQUESTS` | Comma-separated `path!iid` of MRs whose source/target is the current branch. Empty when none. |
| `CI_COMMIT_REF_PROTECTED` | `"true"` if the ref is protected. |
| `CI_PROJECT_PATH` | `group/project`. |

### `CI_PIPELINE_SOURCE` values

| Value | Triggered by |
|-------|--------------|
| `push` | A `git push` to a branch or tag. |
| `merge_request_event` | An MR was opened/updated (detached, merged-results, or merge-train pipeline). |
| `schedule` | A pipeline schedule fired. |
| `web` | The "Run pipeline" button in the UI. |
| `api` | A pipeline created via the REST API. |
| `trigger` | A trigger token (`POST /trigger/pipeline`). |
| `pipeline` | Created by another pipeline's `trigger:` (multi-project, upstream). |
| `parent_pipeline` | Created by a parent via `trigger:include` (child pipeline). |

Mapping the neutral trigger vocabulary onto these is the job of
`scripts/build-ci.sh` — see the cross-reference at the end.

## Expression operators in `rules:if`

`rules:if` evaluates a **single boolean expression**. Operators, in
approximate precedence order (tightest first):

| Operator | Meaning |
|----------|---------|
| `( )` | Grouping. |
| `=~` / `!~` | Regex match / non-match. RHS is a `/pattern/flags` literal. |
| `==` / `!=` | String equality / inequality. |
| `&&` | Logical AND. |
| `\|\|` | Logical OR. |

Notes that bite:

- **No `<`/`>` comparison, no arithmetic.** Values are compared as
  strings. There is no numeric coercion; `'10' == '10'` is a string
  match, not a number one.
- **Quoting.** A literal string in the expression is double-quoted
  inside the single-quoted YAML scalar: `if: '$X == "main"'`. A bare
  `$VAR` (no quotes) tests truthiness.
- **Regex literals** use `/.../` delimiters with optional flags:
  `=~ /^v\d+\.\d+/i`. The pattern is RE2 (GitLab uses the Go regexp
  engine on the server side); no backreferences, no lookahead.
- **`null`.** Compare against `null` (unquoted) to test "variable is
  undefined" vs `""` (defined-but-empty). They differ:
  `$X == null` is true only when `X` was never set.

### Truthiness

| Expression form | True when… |
|-----------------|------------|
| `$VAR` (bare) | `VAR` is set **and** non-empty. |
| `$VAR == "x"` | `VAR` equals the string `x`. |
| `$VAR != null` | `VAR` is defined (even if empty). |
| `$VAR =~ /p/` | `VAR` is set and matches the pattern. |

The empty-string trap mirrors GitHub Actions: a bare `$VAR` is false
both when unset and when set to `""`. To distinguish, test against
`null`.

## Pipeline types and trigger mechanisms

| Pipeline type | Fires when | `CI_PIPELINE_SOURCE` |
|---------------|------------|----------------------|
| Branch | Push to a branch | `push` |
| Tag | Push of a tag | `push` (with `$CI_COMMIT_TAG` set) |
| Merge request (detached) | MR opened/updated, MR pipelines enabled | `merge_request_event` |
| Merged-results | Like detached, but run against the *result* of merging into target | `merge_request_event` |
| Merge-train | Sequential merged-results pipelines guarding the queue | `merge_request_event` |
| Scheduled | A pipeline schedule fires | `schedule` |
| Parent-child | A job's `trigger:include` in the same project | `parent_pipeline` |
| Multi-project | A job's `trigger:` with `project:` | `pipeline` |

Merged-results and merge-train pipelines are detected the same way in
`rules:` — all three carry `CI_PIPELINE_SOURCE == "merge_request_event"`.
Distinguish merge-train runs by the predefined `$CI_MERGE_REQUEST_EVENT_TYPE`
(`detached`, `merged_result`, `merge_train`) when behavior must differ.

### `trigger:` — parent-child pipelines

A job whose body is `trigger:` does no work itself; it spawns a
downstream pipeline. `trigger:include` runs a child pipeline from
config in the same project. `strategy: depend` makes the trigger job
mirror the child's status (otherwise it succeeds immediately on
dispatch).

```yaml
run-child:
  stage: test
  trigger:
    include:
      - local: ci/child-pipeline.yml
    strategy: depend
```

### `trigger:` — multi-project pipelines

`trigger:project` (plus optional `branch`) dispatches a pipeline in a
**different** project. `forward:` controls which variables and
yaml-defined pipeline variables propagate downstream.

```yaml
deploy-downstream:
  stage: deploy
  trigger:
    project: my-group/deployment-config
    branch: main
    strategy: depend
    forward:
      pipeline_variables: true
      yaml_variables: true
```

`forward.pipeline_variables` forwards variables passed into the
*current* pipeline (e.g. from a manual run); `forward.yaml_variables`
forwards the `variables:` block defined in this job. Both default such
that yaml variables forward and pipeline variables do not — set
explicitly when in doubt.

## Legacy `only:` / `except:` (superseded by `rules:`)

`only:` / `except:` predate `rules:` and remain supported but are
**not recommended** for new pipelines. They cannot appear in the same
job as `rules:`. Each takes `refs`, `changes`, or `variables`.

```yaml
# Legacy form
job:
  script: ./run.sh
  only:
    refs:
      - main
      - /^release\/.*$/
    changes:
      - src/**/*
  except:
    variables:
      - $SKIP_CI
```

### Migration to `rules:`

The equivalent `rules:` form makes the implicit OR/AND explicit and
short-circuits cleanly:

```yaml
# Modern form
job:
  script: ./run.sh
  rules:
    - if: '$SKIP_CI'
      when: never
    - if: '$CI_COMMIT_BRANCH == "main"'
      changes:
        - src/**/*
    - if: '$CI_COMMIT_BRANCH =~ /^release\/.*$/'
      changes:
        - src/**/*
```

Migration notes:

- `only:refs` keywords like `merge_requests`, `tags`, `branches` map to
  `if:` expressions on `$CI_PIPELINE_SOURCE`, `$CI_COMMIT_TAG`, and
  `$CI_COMMIT_BRANCH` respectively.
- `except:` becomes a leading `when: never` rule (short-circuit).
- `only:` without `refs` (just `changes`/`variables`) had an implicit
  `branches`+`tags` ref scope; replicate it with an explicit `if:` or
  the job will widen its trigger surface silently.

## Common patterns

### Run only on the default branch

```yaml
rules:
  - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
```

### Run only in merge-request pipelines

```yaml
rules:
  - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
```

### Run on tags matching a version pattern

```yaml
rules:
  - if: '$CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/'
```

### Manual gate that blocks downstream stages

```yaml
deploy:
  script: ./deploy.sh
  rules:
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
      when: manual
      allow_failure: false
```

### Skip the pipeline entirely on doc-only pushes

```yaml
workflow:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "push"'
      changes:
        paths:
          - "docs/**/*"
        compare_to: 'refs/heads/main'
      when: never
    - when: always
```

## Pitfalls

- **No `workflow:rules:` guard.** Without the duplicate-pipeline idiom
  above, every push to a branch with an open MR runs the pipeline
  twice. This is the default failure mode, not an edge case.
- **`$CI_COMMIT_BRANCH` is empty on MR pipelines.** A rule written as
  `if: '$CI_COMMIT_BRANCH == "main"'` never matches inside a detached
  MR pipeline — use `$CI_MERGE_REQUEST_TARGET_BRANCH_NAME` there.
- **`changes` without `compare_to` outside an MR.** The comparison base
  is the previous pipeline's commit, which is unstable on force-push
  and the branch's first commit. Always pin `compare_to`.
- **`rules:` short-circuit forgotten.** Listing two matching `if:`
  rules does not OR their attributes — only the **first** match's
  attributes apply. Order matters; put the most specific rule first.
- **`when: manual` non-blocking by default.** In `rules:`-driven
  pipelines a manual job does not block downstream stages unless
  `allow_failure: false` is set explicitly.
- **`trigger:` without `strategy: depend`.** The trigger job goes green
  the instant it dispatches the downstream pipeline, regardless of
  whether that pipeline later fails. Add `strategy: depend` to mirror
  the child's status.
- **Mixing `rules:` with `only:`/`except:`.** GitLab rejects a job that
  declares both. Migrate fully; do not interleave.

## Cross-reference — this repository

The generated `.gitlab-ci.yml` at the repo root is **derived**, not
hand-authored: `scripts/build-ci.sh` (spec 0048) reads the neutral
capability reference `ci/ci-capabilities.yml` and maps its
engine-neutral trigger vocabulary — `push` / `pull-request` / `tag` /
`scheduled` / `manual`, qualified by `branches` / `paths` /
`tag-pattern` filters — onto the GitLab `rules:` constructs documented
above (e.g. `pull-request` → `$CI_PIPELINE_SOURCE == "merge_request_event"`,
`tag` → `$CI_COMMIT_TAG`, a `tag-pattern` filter → a `=~ /pattern/`
clause). That neutral vocabulary and the mapping contract are defined
in [`docs/ci-reference-format.md`](../../../../../docs/ci-reference-format.md)
— do not redefine it here. This reference documents the GitLab target
syntax the generator emits; the format doc owns the neutral source
contract.
