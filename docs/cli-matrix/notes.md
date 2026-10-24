# Notes on the feature matrix

> **Cross-reference — CI-engine × capability axis (spec 0047, ADR-0012).** The
> CI-engine × CI-capability axis is a *different* axis from the CLI × feature
> matrix above and is self-documented by its own source of truth:
> [`ci/ci-capabilities.yml`](../../ci/ci-capabilities.yml), normatively described
> by [`docs/ci-reference-format.md`](../ci-reference-format.md). This row is a
> **voluntary cross-reference for discoverability**, not a triggered CLI-matrix
> obligation — `ci/` does not appear on the *CLI Matrix Maintenance* literal
> trigger list. Consult the reference, not this matrix, when adding or
> mapping a CI engine.
>
> **GitLab pipeline generator (spec 0048).** The GitLab pipeline is **derived**
> from that reference, not hand-authored: `scripts/build-ci.ts` reads
> `ci/ci-capabilities.yml` and emits one GitLab job per *portable* capability
> into [`.gitlab-ci.yml`](../../.gitlab-ci.yml) at the repo root (job key ==
> capability id; `requires:` → `image`/`before_script`/`GIT_DEPTH`; `env:` → `variables:`; `command:`
> → `script:`). Engine-specific capabilities are skipped with no placeholder
> (spec 0048 R4); the GitHub Actions workflows under `.github/workflows/` are
> **not** generated (spec 0048 R5). `scripts/build-ci.ts --check` runs in this
> repo's own CI (`.github/workflows/build.yml` job `gitlab-ci-check`, itself a
> contract-described portable capability) and fails on any drift between the
> committed `.gitlab-ci.yml` and a fresh derivation. `scripts/build-ci.ts` is a
> `scripts/build-*` entry and therefore on the *CLI Matrix Maintenance*
> trigger surface; this entry satisfies that obligation.
>
> **CI agentic surface (spec 0050).** The agentic layer over the CI machinery
> — the new `gitlab-ci` knowledge skill (`artifacts/core/skills/gitlab-ci/`,
> with a seven-file `references/` corpus and two offline check scripts), the
> `ci-configurator` agent generalised to be engine-aware (it hand-authors a
> GitHub Actions workflow but **derives** a GitLab pipeline by composing
> `scripts/build-ci.ts`), and the new `ci-parity` agent
> (`artifacts/core/agents/ci-parity/`, which operates `scripts/check-ci-parity.ts`
> and reconciles drift) — rides the **existing generic component-build
> mechanisms** with full three-CLI parity: the skill ships through the generic
> skill-build (row 3, including `propagate_skill_resources` for its
> `references/` and `scripts/`), and both agents ship through the generic
> agent-build (row 4). **No new CLI mechanism row is created** — these are
> ordinary `artifacts/core/**` components that `scripts/build-components.ts`
> compiles symmetrically to `.claude/`, `.gemini/`, and `.github/`. The agentic
> surface only **composes** the spec-0048 generator (`build-ci.ts`) and the
> spec-0049 harness (`check-ci-parity.ts`); it introduces no CLI-specific
> integration point. This paragraph discharges the `artifacts/**`
> CLI-matrix-update obligation for spec 0050.
>
> **CI execution speed (spec 0147).** The former monolithic `check-components`
> capability (one job, ~85 sequential steps) is decomposed into focused,
> parallel, changeset-gated capabilities in `ci/ci-capabilities.yml`, each with
> its own `paths:` trigger filter and a `changeset-gated: true` marker. On both
> engines a job runs only when a changed file matches its `paths:` set (GitLab
> `changes:`; GitHub Actions the `ci-job` runtime path gate, spec 0283 R6). Heavy
> groups (e.g. `e2e`) declare a `manual` trigger so they are `when: manual` /
> `workflow_dispatch` on non-`main` runs while staying enforced on push to
> `main`. Cached groups declare a `cache:` block (the key-derivation *need*:
> which files + env vars feed the key); `scripts/build-ci.ts` derives the GitLab
> `cache:key:files` mechanism and `scripts/check-ci-parity.ts` asserts semantic
> key agreement with the GitHub Actions `hashFiles(...)` inputs. A portable
> `path-ownership` capability with no `paths:` filter runs
> `scripts/check-path-ownership.ts` on every change on both engines (spec 0147
> delta-01 R11-R20): it evaluates every tracked file, reads ownership from the
> `pull-request` `paths:` sets of `ci/ci-capabilities.yml` at check time, and
> fails closed when a file is neither owned nor listed in
> `ci/path-ownership-exemptions.txt` (or the optional organization overlay
> `ci/org/path-ownership-exemptions.txt`). It needs no base ref, so it replaces
> the former run-time fail-safe (a roughly 40-minute full suite whenever a
> changed file fell outside every `paths:` set) with a seconds-long static
> check. The full suite survives as `changeset-coverage`, an exhaustive run
> declared with the neutral `scheduled` (daily, on `main`) and `manual` trigger
> kinds and never on a pull request: it executes the commands of every
> `changeset-gated` capability through `scripts/ci-changeset-coverage.ts`,
> computes no diff and resolves no base ref (so the `CI_BASE_REF` capability
> `env` is gone). The engines realise the two kinds differently: GitHub Actions
> hosts the job in the dedicated `.github/workflows/changeset-coverage.yml`
> (`on.schedule` plus `workflow_dispatch`), GitLab CI emits a
> `$CI_PIPELINE_SOURCE == "schedule"` rule followed by `when: manual`, with the
> pipeline schedule itself an operational prerequisite kept outside the
> pipeline file. Its regression test runs on every pull request through the
> separate `changeset-coverage-test` capability. This
> paragraph discharges the `ci/` CLI-matrix-update obligation for spec 0147
> and its delta-01. The same change untracks `.claude/scheduled_tasks.lock`
> (a Claude Code runtime lock, now git-ignored): no Claude Code integration
> point is added or altered, so no matrix row changes for it.
>
> **test-wiring stray scan moved to the owning jobs (spec 0170 delta-01).**
> The `test-wiring` capability no longer keeps a cache. It drops `cache:`,
> `cache-guard: false` and `requires.history-depth: full` (and, on GitHub
> Actions, `fetch-depth: 0` and the `actions/cache` step), because
> `scripts/check-test-strays.ts` formerly ran only `bash -n` over the test suites and
> executed none. The runtime stray check moved into the job that already runs
> each suite: every suite command is declared as
> `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ci-cache-guard.ts --stray-scan -- bash scripts/tests/<suite>` (the form of that period, retired with the shell suites)
> in `ci/ci-capabilities.yml`, in the hand-authored GitHub Actions steps and,
> through `scripts/build-ci.ts`, in `.gitlab-ci.yml`, so both engines run it
> identically. `scripts/check-ci-parity.ts` unwraps only the generated
> `--cache-dir` layer, so a missing scan on either engine is a parity failure,
> and `scripts/check-stray-scan-wiring.ts` (run by `path-ownership`) fails a
> suite command declared without the scan. Five cached capabilities gain
> `scripts/ci-cache-guard.ts` in their `cache.files`, so a later edit of the
> scan invalidates their markers. This paragraph discharges the `ci/`
> CLI-matrix-update obligation for spec 0170 delta-01; it replaces the
> paragraph that spec 0157 added for the former per-suite verdict cache.
>
> **Usage tracking, end to end (spec 0212).** Rows 8, 8c, 8d, 11 and 11b
> describe the usage-capture wiring and commands CLI by CLI. How those pieces
> fit together is explained in the
> [usage architecture overview](../usage-overview.md), and how a person switches
> capture on and off on each CLI, reads the dashboard, and removes the data is
> explained in the [usage guide](../usage-guide.md). This entry adds links only;
> the rows, their verdicts, and their evidence are unchanged.
>
> **Multi-runtime `requires.runtime` (spec 0242).** `requires.runtime` in
> `ci/ci-capabilities.yml` now optionally accepts a list, not only a bare
> scalar: a portable capability whose command genuinely needs more than one
> language runtime declares each entry. The `mempalace` capability is the
> first to do so (`requires.runtime: [python@3.12, node@24]`) because it
> gained a TypeScript client-reuse test (issue #1370) alongside its existing
> python3-based test scripts. The FIRST entry still becomes the GitLab
> derivation's Docker `image:` — unchanged for every other capability, which
> still declares a bare scalar — and any further entry is installed alongside
> it via `before_script` (`scripts/build-ci.ts`'s new
> `secondary_runtime_install_lines()`), mirrored on the check side by
> `scripts/check-ci-parity.ts`'s validity rule 6 and Arm 1 requirement check.
> This is an engine-neutral widening of the CI-capability-reference schema: it
> introduces no CLI-specific surface (no Claude Code, Gemini CLI, Copilot
> CLI, or Antigravity CLI integration point) and changes no existing
> capability's generated behavior. `scripts/build-ci.ts` is a
> `scripts/build-*` entry and therefore on the *CLI Matrix Maintenance*
> trigger surface; this paragraph discharges that CLI-matrix-update
> obligation for spec 0242.
>
> Spec 0262 requirement 16 made `scripts/{check-model-mappings,check-agent-profiles,check-ci-parity,check-spec-id-reserved,build-ci,ci-cache-guard,ci-changeset-coverage,reserve-spec-id}.sh` forwarding shims to their TypeScript twins (`<name>.ts`); spec 0266 (#1344, slice 6) removed those shims, and every caller runs `node scripts/<name>.ts` directly. No row above changes.
