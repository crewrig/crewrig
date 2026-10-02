# CI capability reference format

<!-- crewrig-doc: section=reference nav_order=60 published=true title="CI capability reference format" -->

This document is the **normative description** of the shape of
`ci/ci-capabilities.yml` — the platform-neutral CI capability reference
mandated by [spec 0047](../specs/0047-ci-capability-reference.md) and decided
in [ADR-0012](adr/0012-ci-reference-contract.md). It is contract **C1**: a
candidate reference is judged valid or invalid against the rules below, and a
further continuous-integration engine is supported by describing only its
mapping of these capabilities — never by altering a capability definition
(spec 0047 R7).

The traceability convention (**C2**) — how a pipeline job in any engine is
attributed to exactly one capability — is pinned in *Traceability* below,
with the exact, tested `yq` extraction expressions sub-spec C relies on.

## Purpose and scope

The reference is **one** platform-neutral enumeration of every
continuous-integration capability the project relies on, at the granularity of
one job. It is a *description*, not a generator and not a drift check:

- It does **not** generate any engine's pipeline — that is sub-spec B (#372).
- It does **not** check divergence between the reference and the engines —
  that is sub-spec C (#373).
- It does **not** execute any pipeline on a live engine.

It exists so that, before any engine's pipeline is derived or checked, there
is one agreed answer to "what does this project's CI do", independent of any
engine.

## File location and ownership

- **Path:** `ci/ci-capabilities.yml` — one reference per repository.
- **Layer:** core, sync policy `strict` (upstream-owned; a local modification
  halts the upstream sync). Registered in
  [`docs/layers.md`](layers.md) and `.crewrig/core-paths.txt`.
- **Format:** YAML, chosen because `yq` (mikefarah) is already a CI dependency
  (`.github/workflows/build.yml`); no new validation toolchain is introduced.

## Capability entry schema

The reference is a YAML document with a single top-level key `capabilities:`
whose value is a **list** of capability entries. Each entry is a mapping with
these keys:

| Key | Required | Type | Constraint |
|---|---|---|---|
| `id` | always | string | The stable traceability identifier. Unique across the reference. Equals the pipeline job's YAML key (see *Traceability*). |
| `name` | always | string | Human-readable label for the capability. |
| `trigger` | always | list | One or more trigger objects (see *Neutral trigger vocabulary*). |
| `portability` | always | enum | `portable` or `specific` (see *Portability and exceptions*). |
| `exception` | iff `specific` | mapping | `{engine, evidence}` (see *Portability and exceptions*). |
| `command` | iff `portable` | list of strings | The business invocation command(s) that realize the job (see *Invocation command and execution requirements*). |
| `requires` | iff `portable` | mapping | The engine-agnostic execution requirement: `{runtime, tools, history-depth}` (see *Invocation command and execution requirements*). |
| `env` | optional | mapping | Optional dictionary of job-scoped environment variable keys and string values (spec 0131). |
| `cache` | optional | mapping | The cache key-derivation **need**: `{files, env}` (see *Cache*). |
| `cache-guard` | optional | boolean | Whether the job's `bash scripts/…` commands are wrapped in the coarse `scripts/ci-cache-guard.sh` (default `true`). Set `false` when a command manages its own fine-grained cache (see *Cache*). |
| `changeset-gated` | optional | boolean | `true` marks a capability whose `command` list is executed by the exhaustive run (`changeset-coverage`, `scheduled` and `manual`; spec 0147 delta-01 R21), regardless of what changed. It no longer feeds a pull-request-time fail-safe: path ownership is decided by `scripts/check-path-ownership.ts` (see *Path ownership and the exemption lists*). |

**Granularity — one capability is exactly one job (spec 0047 R1).** The steps
*inside* a job are an implementation detail of that one capability, **not**
separate capabilities. For example the former `check-components` job ran
roughly two dozen steps; it was one capability, not two dozen. A candidate
reference is not invalid for collapsing a job's steps into a single entry —
that is the required shape. Spec 0147 decomposes that one capability into
several focused, changeset-gated capabilities (each still exactly one job),
each with a `paths:` filter and a `changeset-gated: true` marker. Two
capabilities with no `paths:` filter complete the decomposition: the
`path-ownership` check, which runs on every change and fails when a tracked
file is owned by none of the focused capabilities and exempted by no list
(spec 0147 delta-01 R11), and the `changeset-coverage` exhaustive run, which
executes the commands of every changeset-gated capability on a schedule and on
demand, never on a pull request (spec 0147 delta-01 R21).

## Neutral trigger vocabulary

Each `trigger` entry is a mapping with an `on:` kind drawn from a **closed**
set, optionally qualified by **portable filters**.

**Trigger kinds (closed set, spec 0047 R2):**

| Kind | Meaning |
|---|---|
| `push` | A push to a branch. |
| `pull-request` | A pull-or-merge request (the neutral name; GHA `pull_request`, GitLab `merge_request_event`). |
| `tag` | A tag push. |
| `scheduled` | A time-scheduled run. |
| `manual` | A manually or out-of-band initiated run. An issue/review comment (bot mention) is modeled as `manual`. |

A trigger whose `on:` kind is **not** one of these five makes the reference
invalid (see *Validity rules*, Scenario 2).

**Portable filters (normalized trigger attributes, spec 0047 R3):**

| Filter | Applies to | Meaning |
|---|---|---|
| `branches` | `push`, `pull-request` | The branch set the trigger qualifies on. |
| `paths` | `push`, `pull-request` | The path set the trigger qualifies on. |
| `tag-pattern` | `tag` | A glob qualifying the matched tag. Absent → matches any tag. |

`trigger` is a **list** so that a capability firing on both `push` and
`pull-request` (the real `build` / `lint-markdown` jobs) is **one** capability
with two trigger objects — not two capabilities. A filter key outside the set
above is invalid.

## Portability and exceptions

`portability` marks whether a capability crosses engines (spec 0047 R4):

- **`portable`** — faithfully expressible on every supported engine. Sub-spec
  B generates it into each engine's pipeline.
- **`specific`** — tied to a single engine. Hand-authored per engine; never
  generated.

Every `specific` capability **SHALL** carry an `exception` (spec 0047 R5):

| Field | Required | Meaning |
|---|---|---|
| `engine` | yes | The engine id where the capability lives (e.g. `github-actions`). |
| `evidence` | yes | A statement that the mechanism has **no faithful equivalent** on the other supported engines. |

`evidence` accepts any of: a **quoted sentence**, a **command + its output**,
or a **URL** — mirroring the gap-acceptance evidence discipline of
[`docs/cli-matrix-maintenance.md`](cli-matrix-maintenance.md). A `specific`
capability with **no** `exception`, or with an empty `evidence`, makes the
reference invalid (see *Validity rules*, Scenario 3).

**Bot-mention rule (spec 0047 R5).** A bot-mention trigger — an issue comment
or a pull-request review comment that dispatches an assistant (e.g. the
`@claude` and `@copilot-cli` workflows) — **SHALL** be treated as
engine-specific, **never** portable, regardless of how its `trigger` is
modeled.

## Invocation command and execution requirements

A `portable` capability is not merely *described* by the reference — its
pipeline on any supported engine is **derived** from the reference alone. Two
fields carry the derivable content: `command` (the work) and `requires` (the
environment that work needs). Both are mandatory on a `portable` capability
and absent on a `specific` one.

### `command` — the business invocation (spec 0047 delta-01 R10)

`command` is the **list of business commands** that realize the job — the work
the job performs, distinct from any engine-specific setup boilerplate
(checkout, runtime install). It is a **list of strings** so that a capability
composed of several ordered steps (e.g. the former `check-components` ran
roughly two dozen `bash scripts/*.sh` invocations) stays **one** capability
with an ordered command list, never split into several — preserving the
*Granularity — one capability is exactly one job* rule above. A derivation maps
the list one-to-one onto the engine's step sequence (GitLab `script:`, a GHA
job's `run:` steps). Spec 0147 splits that one capability into focused
capabilities, each with a smaller `command:` list and a `paths:` filter.

- A `portable` capability **SHALL** declare `command` (delta-01 R10). A
  `portable` capability with no `command` makes the reference **invalid** (see
  *Validity rules*, Scenario 5).
- A `specific` capability **SHALL NOT** be required to declare `command`
  (delta-01 R11); its body stays hand-authored under its evidence-backed
  exception.

### `requires` — the engine-agnostic execution requirement (spec 0047 delta-02 R12)

`requires` declares **the need, not the mechanism**: the runtime and version,
the additional tools, and the source-history depth the `command` needs to run.
The engine-specific setup boilerplate that *satisfies* the requirement (a
Docker `image`, a `before_script` tool install, a clone-depth flag) is produced
by the derivation and is **never stored in the reference** (delta-02 R12).

The requirement is a closed-vocabulary mapping mirroring R12's own enumeration:

| Key | Type | Meaning | Example |
|---|---|---|---|
| `runtime` | string, or list of strings | The language runtime(s) and version, as `<name>@<version>`. A capability whose command genuinely needs more than one language (e.g. a job that runs both `bash`/`python3` test scripts and a `node --test` suite) declares each; the FIRST entry is the primary runtime the GitLab derivation bases the job's Docker `image:` on, and any further entry is installed alongside it via `before_script` (never replacing the image). | `node@22`, `python@3.12`, `[python@3.12, node@24]` |
| `tools` | list of strings | Additional tools the command needs on `PATH`. | `[yq]`, `[task]`, `[jq]` |
| `history-depth` | enum | `full` when the command needs the complete source history (e.g. a base-ref diff); omitted otherwise. | `full` |

All three sub-keys are optional **inside** `requires`: a capability whose
command needs only POSIX shell (e.g. `grep-anti-patterns`) may omit `requires`
entirely. What is *not* optional is consistency — a command that invokes a tool
or runtime it does not declare is rejected:

- A `portable` capability whose `command` needs a runtime or tool that the
  capability does not declare under `requires` makes the reference **invalid**
  (see *Validity rules*, Scenario 6). The execution requirement must be present
  before the capability is accepted as derivable (delta-02 Scenario 2).
- A `specific` capability gains no `requires` (R12 scopes the obligation to
  portable capabilities, consistent with delta-01 R11).

### `env` — job-scoped environment variables (spec 0131)

`env` defines an optional mapping of environment variable keys to string values.
When declared on a portable capability, `scripts/build-ci.sh` emits them into the
job's `variables:` section in `.gitlab-ci.yml`, and `scripts/check-ci-parity.sh`
verifies that the environment variables are exhibited by the attributed GitHub Actions
job and matched on GitLab.

### `cache` — the cache key-derivation need (spec 0147 R6/R7)

`cache` declares **the need, not the mechanism**: which files and which
environment variables the job's cache key is derived from. It is a mapping with
two keys:

| Key | Type | Meaning |
|---|---|---|
| `files` | list of strings | The file paths/globs whose contents the cache key is derived from. A change to any of them invalidates the cache. |
| `env` | list of strings | The environment variable names whose values the cache key is derived from. May be empty (`[]`) when no env var feeds the key. |

The engine-specific cache syntax that *satisfies* the need — GHA
`hashFiles(...)` in an `actions/cache` key, GitLab `cache:key:files` — is the
**mechanism** and is **never written into the reference** (the R12
need-vs-mechanism boundary). The portable `scripts/ci-cache-guard.sh` is the
real correctness gate: it recomputes a content-addressed key from the declared
`files` + `env` and re-executes on a miss even if the engine cache restores a
stale directory. `scripts/check-ci-parity.sh` asserts the engines' cache key
inputs agree **semantically** with the reference's `cache.files` (same declared
inputs, not string equality).

By default, when a capability declares `cache:`, `scripts/build-ci.sh` wraps
each hermetic `bash scripts/…` command in `scripts/ci-cache-guard.sh` so a
cache hit skips re-execution. A capability MAY set `cache-guard: false` to
opt out of that coarse wrapping — used when a command manages its own
fine-grained, content-addressed cache, so that the coarse key neither
invalidates it needlessly nor skips it. With `cache-guard: false`, the command
is emitted bare (identical to the GitHub Actions step) while the engine
`cache:` block is still emitted, so the engine cache persists the command's own
cache directory across runs. An illustrative entry (not an entry of the
reference):

```yaml
  - id: self-caching-check
    cache:
      files: ["scripts/lib/**"]
      env: []
    cache-guard: false
    command:
      - bash scripts/some-self-caching-check.sh
```

Which capabilities currently use the opt-out is read from the reference
itself (`grep -n 'cache-guard:' ci/ci-capabilities.yml`); this document does
not list them, so the list cannot go stale here.

A command that already starts with `bash scripts/` is wrapped whatever it is,
including a stray-scanned suite command; the two guards then nest, the cache
guard outside and the scan inside (see *Stray scan of registered test suites*).

### GitLab generation

The GitLab pipeline generator `scripts/build-ci.sh` (spec 0048) is the
reference's consumer: it reads `command` + `requires` for every `portable`
capability and produces `.gitlab-ci.yml` at the repo root. For each capability
it emits one job keyed by the capability `id` (the C2 primary path below), with
`requires` translated into the GitLab setup boilerplate — `runtime`'s FIRST
entry → `image:`, any further `runtime` entry AND every `tools` entry →
`before_script:` installs, `history-depth: full` →
`variables: { GIT_DEPTH: "0" }` — and `command` becoming the job's `script:`.
The boilerplate is the generator's own output; it is never written back into
the reference (the R12 need-vs-mechanism boundary). Engine-specific
capabilities are skipped with no placeholder (spec 0048 R4), and the existing
GitHub Actions workflows are **not** regenerated (spec 0048 R5) — they stay
hand-authored and are only *described* here.

## Path ownership and the exemption lists

Spec 0147 delta-01 replaces the former pull-request-time fail-safe (a
roughly 40-minute full suite whenever a changed file fell outside every
focused `paths:` set) with a static check that costs seconds, and keeps the
full suite as an exhaustive run. This section is the normative description of
that mechanism.

### The rules

- **Ownership.** A tracked file is *owned* when it matches a glob in the
  `paths:` of any `pull-request` trigger of any capability in
  `ci/ci-capabilities.yml`. A `push`-only `paths:` confers no ownership, and a
  capability with no `paths:` filter confers none either (it runs on every
  change, so it owns nothing in particular).
- **Evaluation.** `scripts/check-path-ownership.ts` evaluates **every** tracked
  file (one `git ls-files -z`), reads the `paths:` from the reference at check
  time (no embedded copy), and depends on no base ref, merge-base or
  CI-provided revision variable (R12, R13).
- **Exemption.** A file that no check exercises is declared in
  `ci/path-ownership-exemptions.txt`, one `<glob><TAB><reason>` entry per line;
  blank lines and `#` lines are ignored (R14). An exemption is used only for a
  file that no check exercises, or that a capability with **no** `paths:`
  filter exercises on every change (the reason then names that capability);
  it is never used to silence a file that a `paths:`-filtered capability
  exercises, which belongs in that capability's `paths:` (R17).
- **Failure.** The check exits `1` when a tracked file is neither owned nor
  exempt, listing each file and naming the two remedies: extend the `paths:`
  of the capability whose checks exercise the file (and mirror the glob in that
  job's GitHub path filter), or add a reasoned entry to the exemption list
  (R15). It also exits `1` on an entry with an empty reason or a line without a
  TAB, and on a *stale* entry, i.e. a glob that matches no tracked file (R16).
  An entry whose every match is also owned is *redundant*: it is reported
  with a `note:` line and never changes the exit code. Exit `2` is a wiring
  fault (unreadable or malformed reference, an unsupported glob, no `git`).
- **Success.** The check prints `path-ownership: OK: evaluated <N> tracked
  files, owned <O>, exempt <E>` and exits `0` (R18). A file both owned and
  exempt counts as owned, so `O + E = N`.

### What the matcher implements

The check ships its own small matcher (`scripts/lib/glob-engine.ts`) rather
than bash `[[ == ]]`, whose `*` crosses `/` and whose `**/` requires a slash
(R13). It implements exactly:

| Form | Meaning |
|---|---|
| `*` | Zero or more characters other than `/`. |
| `**/` | Zero or more directory levels, including none. |
| trailing `**` | Everything below the preceding directory, at any depth. |

Dotfiles are matched like any other name. Every other syntax fails closed
with exit `2`: any of `{ } [ ] ( ) ? +`, a leading `!`, `/` or `./`, and a
`**` that is not a whole path segment (for example `a**b`). A future `{a,b}`
or `[x]` in a `paths:` is therefore a loud failure and never a wrong answer.

`?` and `+` are rejected because the engines do not agree on them:
`picomatch` (the engine behind the `dorny/paths-filter` jobs) reads `?` as one
character, whereas GitHub's native workflow-level `on.pull_request.paths`
matcher is recalled to give `?` (zero or one of the preceding character) and
`+` (one or more) regex-like meaning. That recollection is an **assumption to
verify** against GitHub's filter documentation; it has not been re-fetched.
No `paths:` or `cache.files` glob in the reference uses either character today,
so the rejection costs nothing and the question stays moot: the path-filter
comparison (see *GitHub path filters are compared*) never interprets a glob, it
compares spellings.

**What is verified and what is assumed.** The matcher was cross-checked
against `picomatch@4` with `dot: true` (the engine behind the GitHub path
filter) on every (glob, tracked file) pair formed by the distinct `paths:` and
`cache.files` globs of the reference and the tracked files: no difference
(measured at implementation on 245 globs and 1,518 tracked files, i.e. 371,910
pairs; the counts are a point-in-time record, not maintained). Its
equivalence with GitLab `changes:` matching is an **assumption to verify**,
not a claim: GitLab may treat a `**` that is not followed by `/` like `*`,
which would make `dir/**` own one level only on GitLab. The trailing-`**` form goes beyond the two rules R13 states and rests
on the `picomatch` cross-check alone.

### The exemption lists

- **Core list** `ci/path-ownership-exemptions.txt`: a core-layer path,
  registered in `docs/layers.md` and, as `strict`, in
  `.crewrig/core-paths.txt` (R24). Because it is `strict`, an adopter edit
  halts the upstream sync.
- **Organization overlay** `ci/org/path-ownership-exemptions.txt`: read in
  addition to the core list with the same format and hygiene rules (R14 to
  R17); absent is not an error. `ci/org/` is `excluded` from sync, so the
  overlay never flows back upstream. The check evaluates the overlay like any
  tracked file, so an adopter MUST list the overlay in itself (first line of
  the file): `ci/org/path-ownership-exemptions.txt<TAB><reason>`. An implicit
  exemption of the two list files was rejected because the spec does not state
  it.
- **Stale core entries, present remedy.** An adopter that removed a file the
  core list exempts gets a red `path-ownership` (R16 fails an entry that
  matches no tracked file, and the core list is `strict`, so the adopter
  cannot edit it). Seven exempted files are in no `core-paths.txt` entry, so
  adopters are free to delete them: `.oxfmtrc.json`, `.oxlintrc.json`,
  `tsconfig.json`, `crewrig.config.toml.template`, `config/*.md.template`,
  `config/claude/settings.json.template`, `.agents/settings.local.json.example`.
  Until the spec grows a better answer, **the remedy is to restore the file,
  even as an empty placeholder.** The gap in the requirements (the overlay
  cannot neutralise a core entry) is routed to the deferred-findings ledger
  ([#961](https://github.com/crewrig/crewrig/issues/961), see
  `docs/retroactive-loop.md`) for a later spec delta.

### The exhaustive run

`changeset-coverage` is a portable capability with `scheduled` and `manual`
triggers and no `pull-request` trigger. It runs
`scripts/ci-changeset-coverage.sh`, which executes the `command` list of every
`changeset-gated: true` capability unconditionally. It computes no diff and
resolves no base ref. It exits `1` when any command failed and `2` when `yq`
or the reference is missing. Its regression test,
`scripts/tests/ci-changeset-coverage.test.ts`, stays on the pull-request path
through the separate `changeset-coverage-test` capability (no `paths:`
filter).

The exhaustive run scans strays too. It executes each reference command with
`eval`, and every registered suite command is declared in the scanned form
(see *Stray scan of registered test suites*), so the daily run checks every
suite for strays through the commands it already runs, with no extra code.
`check-test-strays.sh` is not diff-scoped any more: it executes no suite and
only runs `bash -n` over the suites (spec 0170 delta-01 R9), so the exhaustive
run adds nothing for that command and needs nothing from it.

| Engine | `scheduled` | `manual` |
|---|---|---|
| GitHub Actions | Dedicated workflow `.github/workflows/changeset-coverage.yml`, `on.schedule` (daily, `17 3 * * *` UTC). A scheduled run uses the default branch `main` (GitHub behaviour, assumption to verify on the first run). | `workflow_dispatch` on the same workflow. |
| GitLab CI | The generated job carries `rules: - if: '$CI_PIPELINE_SOURCE == "schedule"'`; the schedule itself is a CI/CD pipeline schedule created outside the pipeline file. | The generated job ends with `- when: manual`. |

A dedicated workflow file is used on GitHub because a `schedule:` trigger on
`build.yml` would start every one of its jobs on the cron. A failure is a
red workflow run or pipeline on the ref it ran against; it is never reported
only in a log (R22).

### Operational prerequisites

These four items live outside the repository's files; they are recorded here
and in the body of the pull request that introduced the check.

1. **GitHub schedule.** Nothing to configure: the cron is in the workflow
   file. The file must be on `main` for `workflow_dispatch` to be offered; a
   manual run on a `release/**` branch needs the file on that branch too (merge
   `main` into it). Both are GitHub behaviours to verify in the first run.
2. **GitLab pipeline schedule.** The maintainer of an adopting GitLab project
   creates a CI/CD schedule with **target ref `main`**: a GitLab schedule runs
   on the ref in its definition, and the neutral `scheduled` kind has no branch
   attribute. In this repository the generated `.gitlab-ci.yml` is produced and
   drift-checked but not executed on a live GitLab, so this item is
   documentation here, not an action.
3. **Required status check on `main-protected`.** A repository admin adds
   `path-ownership` to the ruleset `main-protected` **after** the change
   merges to `main` (adding the context before the job exists would block every
   PR). A check that can never be skipped but is not required can still be
   ignored at merge. Pull requests into `main` that were opened before the
   context was added must be brought up to date (`gh pr update-branch`, or a
   rebase on `main`) so that the job runs on them; until then the context
   waits for a job that the old branch does not have.
4. **Required status check on `release-protected`, deferred.** The admin adds
   `path-ownership` to ruleset `release-protected` **only once `main` (with
   this change) has been merged into every live `release/**` branch** and the
   job is confirmed to exist there (the branch's `build.yml` shows
   `path-ownership:`, or the sync pull request shows a green `path-ownership`
   run). Before that, the release branch has no such job, so a required context
   would never report and every pull request into that branch would wait
   forever. Cost of deferring it indefinitely: unowned files can accumulate on
   the release branch unchecked and surface only at the release-to-`main`
   merge, where the check finally runs on the combined tree.

### GitHub path filters are compared

The check reads ownership from the reference, but the GitHub trigger of each
job is hand-written. `scripts/check-ci-parity.sh` therefore compares, for every
portable capability that has an attributed GitHub job, the reference `paths` of
its `pull-request` and `push` triggers with the path filter GitHub applies to
that job (spec 0049 delta-01, R12 to R24). A glob added to the reference and
forgotten in the workflow, or the reverse, is a failure of the harness, not a
silent gap.

**What is compared.** Two GitHub-side shapes are recognised:

- **In-job filter.** The list of the job's `dorny/paths-filter` step, which must
  define exactly one filter, named after the capability id. It cannot tell a
  pull request from a push, so it is compared with the `paths` of every
  comparable trigger the capability declares; a capability whose `pull-request`
  and `push` triggers list different paths therefore cannot match it. A
  comparable event the capability does not declare is left out for an in-job
  filter (whether an event is declared at all is trigger-set
  conformance, not a path comparison).
- **Dedicated-workflow filter.** `on.pull_request.paths` and `on.push.paths` of
  the workflow file that holds the job, each compared separately with the
  `paths` of the matching reference trigger.

**How.** The comparison is a set equality on the decoded textual entries: order,
repetition and YAML quoting do not matter, but no glob is normalised, so
`dir/**` and `dir/**/*` are a divergence. An absent event, an event declared
without a filter, and a reference trigger without `paths` all carry the empty
set, so a filtered event facing an unfiltered one is a divergence and two
unfiltered sides agree. Only `paths` is compared; `branches`, `tag-pattern` and
the cache-key lists keep their own treatment.

**What is reported.** One block per mismatch, naming the capability, the
platform, the event (or `in-job filter`) and the reference trigger compared,
then two labelled lists, either of which may read `(none)`:

```text
  DRIFT: capability '<id>' (github-actions): path filters diverge on event 'push', reference trigger 'push' (R14)
    only in the reference:
      - <entry>
    only on the GitHub side:
      (none)
```

**What fails closed.** A GitHub-side entry with a leading `!`, and a
`paths-ignore` under a comparable event, cannot be expressed in the reference:
each is reported with its entries (R16) and the remaining entries are still
compared. A filter that cannot be read unambiguously is reported with its cause
and the capability is compared no further (R17): several `dorny/paths-filter` steps in the job; several
named filters, or one that is not named after the capability id; a `filters:`
text that is not a mapping of named lists, is not valid YAML, or whose list
holds a non-string entry; an in-job filter in a workflow that also declares
`paths` under a comparable event (the effective filter would be the conjunction
of two lists); a workflow file with several YAML documents. A reference `paths`
that is not a list of strings fails the same way.

**What is out of scope.** `branches`, `tag-pattern`, the wiring that consumes an
in-job filter's output, and glob semantics (the engines' matchers can differ on
the same spelling). The `hashFiles(...)` lists of an `actions/cache` key and the
`--key-files` lists remain mirrored by hand: whoever extends a cache-guarded
capability's `cache.files` mirrors them there.

## Stray scan of registered test suites

A *stray* is a command line of a test suite that does not exist and whose
failure nothing consumed: the shell prints `<cmd>: command not found` and, unless
`set -e` is active, the suite carries on and may exit 0. Spec 0170 delta-01
detects strays **once per suite, in the job that already runs it**, instead of
running every changed suite a second time in `test-wiring`.

**The scanned command form.** Every registered suite command is declared, in
the reference and in the matching hand-authored GitHub Actions step, as:

```text
bash scripts/ci-cache-guard.sh --stray-scan -- bash scripts/tests/<suite>
```

GitLab gets the same line from `scripts/build-ci.sh`; in a capability that
declares `cache:` the generator adds its cache layer around it
(`bash scripts/ci-cache-guard.sh --cache-dir … -- bash scripts/ci-cache-guard.sh --stray-scan -- bash …`),
so the scan runs inside the cache guard and a stray leaves no pass marker.
`scripts/check-ci-parity.sh` fails, naming the capability and the platform, when
a GitHub step does not match the declared command.

**The two modes of the guard.** `scripts/ci-cache-guard.sh` has two mutually
exclusive modes; combining `--stray-scan` with `--cache-dir`, `--key-files` or
`--key-env` is a usage error (exit 2).

| Mode | Invocation | Effect |
|---|---|---|
| Cache (spec 0147) | `--cache-dir … --key-files … --key-env … -- <command>` | Skips the command on a cache hit, runs it on a miss and writes a marker only on success. |
| Stray scan (spec 0170 delta-01) | `--stray-scan -- <command>` | Runs the command exactly once with its output passed through unchanged, and fails when the command's output contains `command not found`. The verdict window is that one command. |

The exit codes (70 stray, 71 detector inactive, the command's own status
otherwise) and the classes of stray the scan cannot see are documented in the
header of `scripts/ci-cache-guard.sh` and pinned by its regression tests; read
them there rather than here. A job whose path filter is false, or whose command
is served from the cache, runs no scan and pays nothing for it.

**The wiring check (R17).** `scripts/check-stray-scan-wiring.ts` runs in the
`path-ownership` capability, which has no `paths:` filter. It fails the build
when (a) a capability `command` or a workflow `run:` line executes a registered
suite without the scan, or (b) a suite that has an owning capability is matched
by the pull-request `paths:` of none of its owners (an owner with no `paths:`
filter always matches). A suite with no owner is left to
`scripts/check-test-wiring.sh` and `ci/test-wiring-exemptions.txt`.

**When a suite prints the phrase.** A suite that prints `command not found` on
purpose (an echo, an assertion on it) fails the scan with exit 70, because the
scan matches the text and cannot tell a message from a quotation. The remedy is
to **reword the suite** so its output no longer contains the phrase; there is no
exemption switch. This is why the preflight messages of the `test-usage-*` suites
are worded around it.

## Traceability (contract C2)

**The capability `id` IS the pipeline job's YAML key, on every engine.** A
pipeline job named `lint-markdown` in any engine is, by that fact, attributed
to the capability whose `id` is `lint-markdown`. There is no separate
annotation to keep in sync — the id is the job's name in the structured
document, so it is directly addressable in `yq`'s data model. Renaming a job
and renaming its capability become the same act; they cannot silently
disagree.

**Uniqueness (spec 0047 R6).** Each `id` is unique across the reference, so a
job key attributes to **exactly one** capability. A missing or duplicated `id`
makes the reference invalid (see *Validity rules*, Scenario 4).

**Untraceable jobs.** A pipeline job whose key is **not** an `id` in the
reference (and which carries no fallback annotation, below) is *untraceable*.
Sub-spec C's drift harness fails closed on it.

### Tested extraction expressions

Sub-spec C relies on these exact `yq` (mikefarah v4.x) access paths. Each is
shown with a passing sample.

**GitHub Actions — list every job's capability id (primary path):**

```console
$ yq '.jobs | keys' .github/workflows/build.yml
- build
- component-drift
- extension-render
- extension-provenance
- extension-manifest
- extension-install
- core-paths
- ci-parity
- docs-index
- figure-labels
- mempalace
- test-wiring
- chroma-mcp
- e2e
- setup
- misc
- frontmatter
- markdown-links
- changeset-coverage
- lint-markdown
- lint-specs
- test-harness-curate
- check-skill-versions
- check-extension-version-bump
- check-spec-id-reserved
- check-agents-size
- check-feedback-routing
- gitlab-ci-check
- check-ci-parity
```

The GHA job keys are already valid id syntax and unique by the schema's own
rule, so the ids fall straight out of the data model.

**GitLab CI — list job ids (top-level keys minus the reserved keyword set):**

GitLab pipelines place jobs at the top level, alongside reserved keywords
(`stages`, `workflow`, `default`, `include`, `variables`, `image`,
`before_script`, `after_script`, `cache`, `services`, `pages`). The
extraction **MUST bind the key before testing membership** — binding it with
`as $k` first, so the reserved-set membership test runs against the key and
not against a pipe-rebound `.`:

```console
$ yq '[ keys[] as $k | $k
        | select(["stages","workflow","default","include","variables",
                  "image","before_script","after_script","cache","services",
                  "pages"] | contains([$k]) | not) ]' .gitlab-ci.yml
- lint-markdown
- check-skill-versions
```

> **Do not** use the form `select([reserved] | contains([.]) | not)`. Inside
> `select(...)` the pipe in `[reserved] | contains([.])` rebinds `.` to the
> reserved **array**, so `[.]` wraps the array rather than the current key;
> the predicate never matches, `not` is always true, and **every reserved key
> leaks through unfiltered**. The `keys[] as $k | $k | … contains([$k])` form
> above binds the key before the pipe and filters correctly.

### Reserved-name fallback annotation

Where an engine **forces** a job key that cannot equal the capability id —
GitLab reserves `pages`, and a descriptive id like `pages-deploy` deliberately
differs from the GHA job key `deploy` — the job carries a **trailing
key-comment** binding it to its capability:

```yaml
# GitLab CI (.gitlab-ci.yml, authored by sub-spec B)
pages: # ci-capability: pages-deploy
  stage: deploy
  script: [...]
```

retrieved with (passing sample):

```console
$ yq '.pages | key | line_comment' .gitlab-ci.yml
ci-capability: pages-deploy
```

This trailing key-comment placement **is** addressable in yq's data model
(`key | line_comment`), unlike an own-line comment placed as the first child
of the job map, for which `line_comment` / `head_comment` / `foot_comment`
all return empty on the job node. The fallback is used only for
reserved-or-forced job names; the primary contract remains id == job key.

### The complete harvest

To attribute every job, sub-spec C harvests the set of capability ids as:

> **(top-level job keys − reserved keywords) ∪ (reserved-named jobs bearing a
> `# ci-capability: <id>` trailing key-comment, mapped to their `<id>`).**

The second clause is what keeps a reserved-named deploy job (e.g. GitLab
`pages`) from being silently dropped as untraceable. The combined harvest,
proven against a realistic GitLab document containing the reserved keywords,
two portable job keys, and a `pages: # ci-capability: pages-deploy` job:

```console
$ yq '
  [ keys[] as $k | $k
      | select(["stages","workflow","default","include","variables","image",
                "before_script","after_script","cache","services","pages"]
               | contains([$k]) | not) ]
  + [ .[] | select(key | line_comment | test("^ci-capability: "))
          | (key | line_comment | sub("^ci-capability: ", "")) ]
' .gitlab-ci.yml
- lint-markdown
- check-skill-versions
- pages-deploy
```

On GitHub Actions the harvest is the same primary ∪ fallback union, scoped
under `.jobs`. Most job keys already equal their capability `id`, so the
primary clause (`yq '.jobs | keys'`) attributes them directly. But where a
descriptive `id` deliberately differs from the job key — the `pages-deploy`
capability versus the `deploy` job in `.github/workflows/pages.yml` (see
*Reserved-name fallback annotation* above) — that job carries a
`# ci-capability: pages-deploy` trailing key-comment, and the fallback clause
resolves it:

```console
$ yq '.jobs | (.[]
        | select(key | line_comment | test("^ci-capability: "))
        | key | line_comment | sub("^ci-capability: ", ""))' \
    .github/workflows/pages.yml
pages-deploy
```

The fallback clause is therefore exercised on GitHub Actions **today**, not
only where a future engine forces a reserved job name: sub-spec C's harness
applies the same primary ∪ fallback harvest to both engines. (Use the
`select(key | line_comment | …)` form above, which binds the job **key**; the
form `select(.value | key | line_comment …)` binds the job *body* and silently
matches nothing.)

## Validity rules (judgeability)

A candidate reference is **valid** iff every entry satisfies the schema above.
The conditions below map one-to-one onto the spec 0047 scenarios; sub-spec C's
checker implements against them.

1. **Portable capability resolves (Scenario 1, valid).** An entry with a
   unique `id` and a `trigger` whose every `on:` kind is in the neutral
   vocabulary is **accepted**; its `id` and trigger resolve, and any pipeline
   job whose key (or fallback annotation) equals that `id` attributes to
   exactly that capability.
2. **Unknown trigger (Scenario 2, invalid).** Any `trigger` whose `on:` kind
   is not one of `push`, `pull-request`, `tag`, `scheduled`, `manual` (or any
   filter outside `branches`, `paths`, `tag-pattern`) makes the reference
   **invalid**, naming the unrecognized trigger.
3. **Engine-specific without evidence (Scenario 3, invalid).** A capability
   marked `portability: specific` that carries no `exception`, or whose
   `exception.evidence` is empty, makes the reference **invalid** — the
   evidence is required before the capability is accepted as a known
   exception.
4. **Missing or duplicate id (Scenario 4, invalid).** If two capabilities
   share one `id`, or any capability has none, the reference is **invalid** —
   the traceability id must be present and unique.
5. **Portable without command (delta-01 Scenario 2, invalid).** A capability
   marked `portability: portable` that declares no `command` makes the
   reference **invalid** — the invocation command is required before the
   capability is accepted as portable (delta-01 R10).
6. **Portable with an unmet execution requirement (delta-02 Scenario 2,
   invalid).** A capability marked `portability: portable` whose `command`
   needs a runtime or tool it does not declare under `requires` makes the
   reference **invalid** — the execution requirement must be present before the
   capability is accepted as derivable (delta-02 R12). In practice the
   derivation enforces this: `scripts/build-ci.sh` has exactly one
   GitLab install recipe per declarable tool, so a command invoking an
   undeclared tool produces no `before_script` line for it, and the generator
   fails closed when asked to translate a requirement it has no mapping for.

## Adding a further engine

A new continuous-integration engine is supported by describing **only** its
mapping of the existing neutral vocabulary (spec 0047 R7, R9):

- It names each portable job by the capability's existing `id` (the C2
  contract), or carries the `# ci-capability: <id>` trailing key-comment where
  the engine forces a reserved job name.
- It maps each neutral trigger kind to the engine's own trigger syntax (e.g.
  `pull-request` → GHA `on: pull_request`, GitLab `rules:` on
  `$CI_PIPELINE_SOURCE == "merge_request_event"`).
- It hand-authors the `specific` capabilities whose `exception` names that
  engine, and skips those whose exception names another engine.

It **never** edits a capability definition. The capability set and the neutral
vocabulary are the stable contract; each engine is one mapping over them.
