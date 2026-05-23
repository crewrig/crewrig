# ADR 0003 — e2e runner + TOML config (defaults + local merge)

## Status

Proposed — 2026-05-23. Scoped to issue #78 (child of epic #75). Builds
on ADR 0001 (Docker images) and ADR 0002 (auth flow).

## Context

ADR 0001 ships the five Docker images. ADR 0002 ships the auth flow
that populates `~/.crewrig-e2e/<cli>/`. This ADR specifies the
**orchestration layer**: a TOML-driven config, a deep-merge mechanism
to apply a gitignored local override, a runner that turns the
effective config into `docker run` invocations per scenario × CLI,
and a machine-readable report.

The configuration surface must let a developer override one knob
(e.g. swap `[cli.copilot].command` to `ollama launch copilot …` for
local Cloud routing) without forking the committed defaults. The
runner must respect the SKIP semantics already wired through
`e2e_skip` in `scripts/e2e/lib/auth-common.sh` (exit 78).

All `yq` behaviours below were verified empirically on
`crewrig/e2e-base:latest` (`yq v4.44.3`, `jq 1.6`) on 2026-05-23.
Evidence is captured inline in Decision 3.

## Decision 1 — TOML schema (`tests/e2e/defaults.toml`)

One top-level `[cli.<name>]` table per supported CLI; one optional
`[scenarios.<name>]` table per registered scenario; no other
top-level keys in v1.

```toml
# tests/e2e/defaults.toml — committed defaults.

[cli.claude]
image     = "crewrig/e2e-claude:latest"
command   = ["claude", "--print"]
mounts    = ["~/.crewrig-e2e/claude:/home/agent/.claude:ro"]
env_keys  = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]

[cli.gemini]
image     = "crewrig/e2e-gemini:latest"
command   = ["gemini", "--prompt-interactive=false"]
mounts    = ["~/.crewrig-e2e/gemini:/home/agent/.gemini:ro"]
env_keys  = ["GEMINI_API_KEY"]

[cli.copilot]
image     = "crewrig/e2e-copilot:latest"
command   = ["copilot"]
mounts    = []                                # ADR 0002 Decision 4: env-var path
env_keys  = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"]

[scenarios.smoke-version]
description = "CLI prints --version without auth."
command_args = ["--version"]
applies_to   = ["claude", "gemini", "copilot"]

[scenarios.smoke-prompt]
description = "CLI answers a trivial prompt against its SaaS backend."
command_args = ["-p", "Reply with the single word: ack."]
applies_to   = ["claude", "gemini"]
```

**Field semantics:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `cli.<n>.image` | string | yes | Docker tag, must match ADR 0001 convention. |
| `cli.<n>.command` | list-of-strings | yes | Argv prefix; `command_args` from the scenario is appended after merge. |
| `cli.<n>.mounts` | list-of-strings | yes (may be `[]`) | `host:container[:mode]` triples. `~` is expanded host-side at run time. |
| `cli.<n>.env_keys` | list-of-strings | yes (may be `[]`) | Host env-var names. Values are read from the host shell at run time and forwarded via `docker run -e <NAME>`. The runner MUST refuse any entry that does not match `^[A-Z_][A-Z0-9_]*$`. |
| `scenarios.<n>.description` | string | yes | One-line human description, echoed in the TAP report. |
| `scenarios.<n>.command_args` | list-of-strings | yes (may be `[]`) | Appended after `cli.<n>.command`. |
| `scenarios.<n>.applies_to` | list-of-strings | yes | Subset of `["claude", "gemini", "copilot"]`. The cartesian product determines test cases. |

`command` and `command_args` are lists, not shell strings, so the
runner never invokes a shell and `env_keys` cannot be substituted into
positional arguments. This closes the obvious shell-injection path.

## Decision 2 — `local.toml` override + deep-merge semantics

`tests/e2e/local.toml` is **gitignored**, **optional**, and **deep-
merged on top of defaults** before the runner reads anything.

Merge rules (matching issue #78 AC verbatim):

1. **Tables merge recursively.** Missing keys inherit from defaults.
2. **Arrays append** (`*+` semantics in yq). An extra mount in
   `local.toml` preserves the defaults' mounts and adds the new one.
3. **Scalars override.** A scalar in `local.toml` replaces the scalar
   in defaults.
4. **New tables are added.** A `[cli.<new>]` or `[scenarios.<new>]`
   in `local.toml` is grafted in.

**Why append, not replace, on arrays?** Issue #78's third AC says
literally "a `local.toml` adding one extra mount preserves the
defaults' mounts." Replacement would force users to re-state every
default mount in `local.toml`, which is brittle when the defaults
evolve. Append is the more forgiving primitive and matches the
issue's stated intent.

**Escape hatch (out of scope for v1, documented for v2).** If a user
ever needs replacement semantics — e.g. to wipe `env_keys` for a
sandbox — the current path is to edit `defaults.toml` on a branch.
A future `_replace` suffix convention (`mounts_replace = [...]`)
could opt into replacement on a per-field basis; defer until a real
scenario demands it.

**Documented edge cases:**

- Empty array in `local.toml` (`mounts = []`) appends nothing — the
  defaults' array is unchanged. To wipe, see escape hatch above.
- Duplicate mount entries (defaults + local both list the same
  `host:container` pair) are NOT deduplicated. Docker tolerates
  duplicate `-v` flags by silently using the last one; the duplicate
  is a code smell, not a runtime failure.
- Missing scalar in `local.toml` inherits the default (rule 1).

## Decision 3 — Merger implementation (`tests/e2e/lib/toml_merge.sh`)

**Recommendation: small bash wrapper around `yq` (TOML → JSON →
merged JSON).** A pure-yq one-liner is not viable in v4.44.3 because
of two empirical limitations captured below.

### Empirical findings (2026-05-23, `crewrig/e2e-base:latest`)

**Limitation A — multi-file TOML input.** `yq` with `-p=toml` only
reads the FIRST file passed positionally; subsequent files are
ignored. Reproduction:

```sh
$ yq eval-all -p=toml -o=json '.' defaults.toml local.toml
# → emits ONLY defaults.toml content. local.toml is dropped.
```

**Limitation B — TOML output encoder is scalar-only.** Round-tripping
the merged document back to TOML fails:

```text
Error: only scalars (e.g. strings, numbers, booleans) are supported
for TOML output at the moment. Please use yaml output format (-oy)
until the encoder has been fully implemented
```

### Working pipeline

```sh
# tests/e2e/lib/toml_merge.sh — pseudocode.
defaults_json=$(yq -p=toml -o=json . "${DEFAULTS}")
if [[ -f "${LOCAL}" ]]; then
  local_json=$(yq -p=toml -o=json . "${LOCAL}")
  printf '%s\n%s\n' "${defaults_json}" "${local_json}" \
    | yq eval-all -p=json -o=json \
        '. as $item ireduce ({}; . *+ $item)'
else
  printf '%s\n' "${defaults_json}"
fi
```

The `*+` operator is yq's deep-merge with array-append. Verified end-
to-end against the AC fixtures: scalar override (✓), array append
(✓), new-section grafting (✓).

### Why not pure jq?

`jq` has no TOML parser and no built-in deep-merge with array
append. We would still need `yq` for the TOML → JSON step, and the
deep-merge would require a recursive jq function. `yq`'s `*+`
operator covers it natively; introducing a hand-rolled jq recurse is
needless surface area.

### Why not bash + a Python helper?

`tomllib` (stdlib since Python 3.11) parses TOML cleanly, and a
~30-line Python recursive merger would be unambiguous. Rejected for
v1 because (a) every other e2e script in this epic is bash + yq +
jq, and (b) introducing a second runtime language for one helper
violates the project's "shortest viable feedback loop" stance. If
Limitation A is fixed upstream the bash wrapper shrinks to a one-
liner; if it is not, the wrapper is still under 40 lines.

## Decision 4 — Runner shape (`tests/e2e/run.sh`)

**CLI surface (named flags only — positional args would conflict
with Taskfile's `--` forwarding).**

```text
tests/e2e/run.sh [options]
  --scenario <name>      Limit to one scenario (default: all in defaults.toml).
  --cli <claude|gemini|copilot>
                         Limit to one CLI (default: all configured).
  --report <tap|junit>   Report format (default: tap).
  --report-dir <path>    Override the report directory.
  --keep <N>             Keep at most N most-recent report dirs (default: 20).
  --dry-run              Print the resolved docker run commands; do not execute.
  -h, --help
```

**v1 report format: TAP 13.** Chosen over JUnit-XML because TAP is
line-oriented, human-readable in a terminal, trivially appendable
during streaming execution, and natively expresses SKIP via
`ok N - <desc> # SKIP <reason>` — which directly maps to ADR 0002's
exit-78 convention. JUnit-XML is a follow-up when a CI surface
demands it (filed as open risk #2 below).

**Effective config materialisation.** Once per `run.sh` invocation,
the merged config is written to `tests/e2e/reports/<run-id>/effective.json`
both for downstream `jq` consumption inside the script and as a
debugging artifact. Cache is intra-run only — every invocation re-
merges to guarantee freshness; the TOML files are small enough
(<10 KB) that the cost is negligible.

**Per-test-case execution loop (pseudo):**

```text
for scenario in selected_scenarios:
  for cli in scenario.applies_to ∩ selected_clis:
    cfg = effective.cli[cli]
    if not auth_available(cli, cfg):       # see Decision 5
      tap.skip(scenario, cli, "auth missing — run `task e2e:auth:<cli>`")
      continue
    cmd = [docker, run, --rm,
           --name, "crewrig-e2e-<scenario>-<cli>",
           *mount_flags(cfg.mounts),
           *env_flags(cfg.env_keys),
           cfg.image,
           *cfg.command,
           *scenario.command_args]
    (stdout, stderr, exit) = stream_capture(cmd, report_dir)
    if exit == 0:    tap.ok(scenario, cli)
    elif exit == 78: tap.skip(scenario, cli, "container reported skip")
    else:            tap.not_ok(scenario, cli, exit)
```

**Reports directory layout.**

```text
tests/e2e/reports/
  20260523T154433Z-<rand>/
    effective.json             # merged config used by this run
    run.tap                    # TAP 13 stream
    <scenario>-<cli>.stdout
    <scenario>-<cli>.stderr
    <scenario>-<cli>.exit
  …
  .gitkeep
```

Retention is bounded by `--keep N` (default 20). The runner deletes
old `<timestamp>-<rand>/` dirs at start of each run after sorting
descending by name (lexicographic sort matches chronological order
because of the ISO 8601 prefix). No `find -mtime` shenanigans.

`tests/e2e/reports/` is gitignored except for `.gitkeep`.

## Decision 5 — Auth integration + SKIP semantics

The runner consumes the surfaces ADR 0002 ships, with one helper
addition to `scripts/e2e/lib/auth-common.sh`:

- New helper `e2e_auth_ready <cli>` returning 0 if either (a) the
  host dir `$(e2e_cli_dir <cli>)` exists AND is non-empty, OR (b)
  at least one of the CLI's `env_keys` is set in the host shell.
  Returning non-zero triggers the runner's SKIP path.
- Mounts from `cfg.mounts` are forwarded **verbatim** to `docker run
  -v`. `~` is expanded with `eval echo` inside the runner before the
  flag is built. ADR 0002's `:ro` mode is preserved.
- Env-var values are read from the host shell and forwarded via
  `-e <NAME>` (without `=value`, so docker reads the value from the
  runner's environment). Values are NEVER logged, NEVER written to
  the report dir, NEVER materialised into the effective JSON.
- The Copilot asymmetry (ADR 0002 Decision 4 — env-var-only, no
  host dir) is handled natively: `cfg.mounts = []` for copilot means
  the host-dir leg of `e2e_auth_ready` is a no-op and only the env-
  var check applies.

**SKIP propagation (mandatory):**

| Trigger | TAP line |
|---|---|
| Host dir missing AND no env var set | `` ok N - <scenario>/<cli> # SKIP auth missing — run `task e2e:auth:<cli>` `` |
| Container exits 78 | `` ok N - <scenario>/<cli> # SKIP container reported skip `` |

Both map to a green TAP plan, in line with the established
"unconfigured ≠ failed" convention from ADR 0002.

## Decision 6 — Taskfile additions

```yaml
e2e:test:
  desc: "Run all e2e scenarios across all configured CLIs (TAP report)."
  cmd: bash {{.REPO_DIR}}/tests/e2e/run.sh {{.CLI_ARGS}}

e2e:test:scenario:
  desc: "Run one scenario across all configured CLIs. Usage: task e2e:test:scenario -- <scenario-name>"
  cmd: bash {{.REPO_DIR}}/tests/e2e/run.sh --scenario {{.CLI_ARGS}}

e2e:test:cli:
  desc: "Run all scenarios against one CLI. Usage: task e2e:test:cli -- <claude|gemini|copilot>"
  cmd: bash {{.REPO_DIR}}/tests/e2e/run.sh --cli {{.CLI_ARGS}}
```

`{{.CLI_ARGS}}` is the canonical Taskfile pattern already used by
`prune-transcripts` and `harness-curator` in this repo — invocation
becomes `task e2e:test:scenario -- smoke-version`.

## Open risks

1. **`yq` upstream evolution.** Both Limitation A (single-file TOML
   input) and Limitation B (scalar-only TOML output) are known yq
   issues. If upstream fixes Limitation A, `toml_merge.sh` simplifies
   to a one-liner; if Limitation B is fixed, we gain the option to
   emit merged TOML for debugging. Neither fix is a blocker — track
   in a future bump.
2. **JUnit-XML demand.** Some CI dashboards (Jenkins, GitLab) parse
   JUnit-XML natively, not TAP. The v1 TAP-only choice is reversible:
   a TAP → JUnit-XML post-processor is a ~50-line script. File a
   follow-up the first time a CI surface demands it.
3. **Scenario discovery without a registry.** v1 enumerates
   scenarios from `[scenarios.*]` tables in the effective config —
   a registry-in-the-defaults approach. A directory-scan model
   (`tests/e2e/scenarios/<name>/scenario.toml`) is more scalable but
   adds a discovery layer. Defer until the registry grows past
   ~20 scenarios.
4. **`env_keys` misuse / secret leakage.** A user could name a
   non-env-var-like value in `env_keys` (e.g. a path). Mitigation:
   the runner refuses entries that do not match the env-var regex
   (Decision 1). The runner also redacts `-e <NAME>` from any
   logged/echoed docker invocation under `--dry-run`, replacing the
   forwarded value display with `<NAME>=<redacted>`.
5. **Array-append duplicates.** If `local.toml` re-states a default
   mount, the effective config has both entries. Docker silently
   uses the last; the duplicate is a noise issue, not a correctness
   issue. Documented; defer dedup until it bites.
6. **Reports dir unbounded growth across runs.** `--keep 20` is the
   guard; no time-based pruning in v1. Adjust default if 20 proves
   too high or too low after a quarter of usage.

## Blast radius

New files only:

- `tests/e2e/defaults.toml`
- `tests/e2e/lib/toml_merge.sh`
- `tests/e2e/run.sh`
- `tests/e2e/reports/.gitkeep`
- New `e2e:test*` entries in `Taskfile.yml` (additive).
- New section in `tests/e2e/README.md` ("Running scenarios").

Touch points to verify but **not** change in this ticket:

- `.gitignore` — add two entries: `tests/e2e/local.toml` and
  `tests/e2e/reports/*` (with a `!tests/e2e/reports/.gitkeep`
  negation). Both confirmed absent today.
- `scripts/e2e/lib/auth-common.sh` — add `e2e_auth_ready <cli>`
  helper only. No edits to the existing helpers; their version-bump
  convention does not apply (this is a script, not a skill / agent
  source).
- `docs/cli-matrix.md` — no parity row needed. The runner is meta-
  tooling, identical across the three CLIs by design.

Anything beyond the above (touching `community-config/`, `config/`,
`scripts/build-components.sh`, CI workflows, or the existing auth
scripts) is **out of scope** and should be flagged back to the team
lead. Reversibility: fully reversible — every artifact is additive
and gated behind explicit `task e2e:test*` invocation.

## Sources

- Issue #78 acceptance criteria — <https://github.com/Sfeir/crewrig/issues/78>
- `mikefarah/yq` operators reference (`*`, `*+`, `eval-all`) —
  <https://mikefarah.gitbook.io/yq/operators/multiply-merge>
- TAP 13 specification — <https://testanything.org/tap-version-13-specification.html>
- ADR 0001 (e2e Docker images) — `docs/adr/0001-e2e-docker-images.md`
- ADR 0002 (e2e auth flow) — `docs/adr/0002-e2e-auth-flow.md`
- `scripts/e2e/lib/auth-common.sh` — exit-78 SKIP convention.
