# Expressions reference

The expression language used inside `${{ … }}` interpolation and in
the `if:` key. Read this before writing any non-trivial condition or
output reference. Memorising the truthiness and short-circuit rules
avoids the bulk of "the step ran when I told it not to" bugs.

## Evaluation surface

Expressions appear in three places:

1. **Interpolated** via `${{ expr }}` inside string values (most
   keys: `name`, `run`, `with`, `env`, `runs-on`, etc.).
2. **As the entire value** of certain keys: `if:`, `continue-on-error:`,
   `timeout-minutes:` — here the `${{ }}` wrapper is optional and
   omitted by convention.
3. **Inside `${{ }}` blocks that produce a YAML value**, including
   for arrays via `fromJSON('[…]')`.

Expressions are evaluated **before** the job starts (for keys
resolved at workflow load — `runs-on`, `name`, etc.) or **just before
the step runs** (for step-scoped keys). Some contexts (notably
`steps`, `needs`, `job.status`) are populated incrementally during
the job lifecycle.

## Context objects

### `github`

Metadata about the event and the run. Selected fields (full list in
GitHub docs, but these cover 95 % of usage):

| Field | Description |
|-------|-------------|
| `github.event_name` | The triggering event (`push`, `pull_request`, `workflow_dispatch`, …). |
| `github.event` | The full webhook payload. Shape varies by event. |
| `github.ref` | The fully qualified ref (`refs/heads/main`, `refs/tags/v1.2.3`). |
| `github.ref_name` | The short ref (`main`, `v1.2.3`). |
| `github.ref_type` | `branch` or `tag`. |
| `github.sha` | The commit SHA. For `pull_request`, the merge commit on the base. |
| `github.head_ref` | Source branch (only on `pull_request`). |
| `github.base_ref` | Target branch (only on `pull_request`). |
| `github.actor` | Login of the user that triggered the run. |
| `github.triggering_actor` | For re-runs: the user that pressed re-run. |
| `github.repository` | `owner/repo`. |
| `github.repository_owner` | `owner`. |
| `github.workflow` | The workflow `name:`. |
| `github.run_id` / `github.run_number` / `github.run_attempt` | Run identity. |
| `github.workspace` | Absolute path of `$GITHUB_WORKSPACE`. |
| `github.token` | Same as `secrets.GITHUB_TOKEN`. |
| `github.api_url` / `github.server_url` / `github.graphql_url` | API endpoints (different on GHES). |

### `env`

Environment variables defined via `env:` at workflow/job/step level
**plus** anything written to `$GITHUB_ENV`. Does **not** include
variables exported by `export VAR=…` in a `run:` block — those live
only in that step's shell.

### `vars`

Plaintext repository / org / environment variables. `${{ vars.X }}`.

### `secrets`

Encrypted repository / org / environment secrets. Includes
`secrets.GITHUB_TOKEN`. Values are masked in logs. Do not interpolate
into `run:` blocks directly.

### `inputs`

Populated on `workflow_dispatch:` and `workflow_call:`. Typed per the
input declaration; `boolean` inputs are real booleans, not the strings
`"true"` / `"false"`.

### `needs`

Outputs and status of dependency jobs. Shape:

```text
needs.<job-id>.result    # 'success' | 'failure' | 'cancelled' | 'skipped'
needs.<job-id>.outputs.<output-name>
```

### `steps`

Outputs and status of prior steps in the same job. Shape:

```text
steps.<step-id>.outcome     # before continue-on-error
steps.<step-id>.conclusion  # after continue-on-error
steps.<step-id>.outputs.<name>
```

`outcome` is what the step actually did; `conclusion` is what the
workflow sees. They differ only when `continue-on-error: true` turned
a failure into a success.

### `job`

Current job state. `job.status` is `'success'` / `'failure'` /
`'cancelled'`. `job.container.id` / `job.container.network` /
`job.services.<id>.id` for container metadata.

### `runner`

The runner the job is on. `runner.os` (`Linux`, `macOS`, `Windows`),
`runner.arch` (`X86`, `X64`, `ARM`, `ARM64`), `runner.name`,
`runner.temp` (writable temp dir), `runner.tool_cache` (path to the
pre-installed toolchain cache).

### `matrix`

The values for the current matrix cell. `matrix.<axis>` for each axis
defined in `strategy.matrix`.

### `strategy`

`strategy.fail-fast`, `strategy.job-index`, `strategy.job-total`,
`strategy.max-parallel`.

## Operators

In approximate precedence order (tightest first):

| Operator | Meaning |
|----------|---------|
| `( )` | Grouping. |
| `[ ]` `.` | Indexing and property access. `github['event']['pull_request']` is equivalent to `github.event.pull_request`. |
| `!` | Logical NOT. |
| `<`, `<=`, `>`, `>=` | Numeric and string comparison. |
| `==`, `!=` | Equality. Loose comparison: `'1' == 1` is `true`. |
| `&&`, `\|\|` | Short-circuit logical AND / OR. |

Strings are single-quoted; double quotes are not valid in expressions
(they belong to YAML's quoting layer). Numbers and booleans are
literal.

## Functions

### `contains(haystack, needle)`

`true` if `haystack` contains `needle`. Works on strings (substring),
arrays (element membership), and objects (key membership).

```yaml
if: contains(github.event.pull_request.labels.*.name, 'ship-it')
```

The `*` is an **object filter** — it collects the named property from
each element of an array.

### `startsWith(string, prefix)` / `endsWith(string, suffix)`

Self-explanatory. Case-sensitive.

### `format(template, arg0, arg1, …)`

Positional formatting with `{N}` placeholders.

```yaml
name: ${{ format('Deploy {0} ({1})', inputs.environment, github.actor) }}
```

### `join(array, separator)`

Concatenates an array. Default separator is `,`. Useful for matrix
labels.

### `toJSON(value)` / `fromJSON(string)`

Serialize / deserialize. `fromJSON` is the canonical way to inject a
typed value (number, boolean, array) into a key that would otherwise
receive a string.

```yaml
strategy:
  matrix:
    target: ${{ fromJSON(needs.plan.outputs.targets) }}
```

### `hashFiles(pattern, …)`

SHA-256 of the concatenated contents of files matching the glob
pattern(s). The cornerstone of cache keys.

```yaml
key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json', 'packages/*/package-lock.json') }}
```

Returns an empty string if no files match — beware of accidentally
sharing a cache between unrelated branches because the lockfile path
moved.

### Status check functions

The four functions that drive `if:` chains:

| Function | Returns `true` when… |
|----------|----------------------|
| `success()` | All previous steps in the job (and all `needs:` for jobs) succeeded. |
| `failure()` | Any previous step failed (and the failure was not handled). |
| `cancelled()` | The workflow was canceled. |
| `always()` | Always — even on cancellation. |

The default `if:` is implicit `success()`. To run a cleanup step on
failure but not on cancellation:

```yaml
if: ${{ failure() && !cancelled() }}
```

To run an artifact-upload step regardless of outcome:

```yaml
if: ${{ !cancelled() }}
```

`always()` is hazardous — secrets and the runner network may be in
the process of being torn down on cancellation.

## Truthiness

| Value | Truthy? |
|-------|---------|
| `true` (boolean) | yes |
| Non-empty string | yes |
| Non-zero number | yes |
| Non-empty array | yes |
| Object with at least one key | yes |
| `false` / `''` / `0` / `null` / `[]` / `{}` | no |

The empty-string trap: `if: env.FOO` evaluates `''` to `false`. If
you want "the variable exists at all", you have to check explicitly
(`if: env.FOO != ''`).

## Common patterns

### Run only on the default branch push

```yaml
if: github.event_name == 'push' && github.ref == 'refs/heads/main'
```

### Skip drafts

```yaml
if: github.event.pull_request.draft == false
```

### Run when a specific label is present

```yaml
if: contains(github.event.pull_request.labels.*.name, 'deploy-preview')
```

### Run a cleanup regardless of upstream success

```yaml
if: ${{ !cancelled() }}
```

### Use a matrix value as a conditional

```yaml
if: matrix.coverage
```

(works because `matrix.coverage: true` is the boolean `true` when set
via `include:`.)

### Dynamic matrix from a previous job

```yaml
jobs:
  plan:
    runs-on: ubuntu-24.04
    outputs:
      targets: ${{ steps.set.outputs.targets }}
    steps:
      - id: set
        run: echo "targets=[\"a\",\"b\",\"c\"]" >> "$GITHUB_OUTPUT"
  fan-out:
    needs: plan
    runs-on: ubuntu-24.04
    strategy:
      matrix:
        target: ${{ fromJSON(needs.plan.outputs.targets) }}
    steps:
      - run: ./deploy.sh ${{ matrix.target }}
```

## Pitfalls

- **`secrets.X` inside `run:` directly.** Use `env:` to bind, then
  reference `"$X"`. Direct interpolation is a script-injection
  channel.
- **Comparing a boolean input to a string.** `if: inputs.dry_run ==
  'true'` works only because GitHub's evaluator loosely-compares; the
  correct form is `if: inputs.dry_run`.
- **`hashFiles` matching nothing.** Returns `''`, which silently
  changes the cache key. Verify the glob path before relying on it.
- **`steps.<id>.outputs.<name>` returns empty for a skipped step.**
  Chain conditions with `&&` rather than relying on a value that may
  not have been produced.
- **`always()` on a cleanup step that uses secrets.** The job may be
  canceling; the secret may already be unbound. Use
  `if: ${{ !cancelled() }}` if you really mean "any outcome except
  cancellation".
