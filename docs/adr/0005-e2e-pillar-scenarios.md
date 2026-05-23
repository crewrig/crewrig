# ADR 0005 — E2E pillar scenarios

- **Status:** Accepted
- **Date:** 2026-05-23
- **Issue:** [#80](../../../../issues/80) (epic [#75](../../../../issues/75))
- **Builds on:** ADR 0001 (Docker images), 0002 (auth flow), 0003 (runner +
  TOML), 0004 (assertion libs)

## Context

Epic #75 has landed the e2e plumbing — Docker base + per-CLI images, the
auth flow, the TOML-driven runner, and the three assertion libraries.
What remains is the *content*: the four pillar scenarios that exercise
the framework's load-bearing surfaces end-to-end.

The four pillars from issue #80 are:

| # | Pillar | Verifies |
|---|---|---|
| 01 | Layered context | 00–60 rule files deployed to a CLI actually steer behaviour |
| 02 | Cross-tool memory | A drawer written by CLI A is read by CLI B via shared MemPalace |
| 03 | Skill build | `build-components.sh` emits artefacts a CLI can invoke |
| 04 | Harness loop | `harness-report` → MemPalace → `harness-curator` round-trip |

Two structural questions had to be settled before any scenario can be
written:

1. **Where does scenario logic live — inside the container, or on the
   host orchestrating containers?** The runner today (`tests/e2e/run.sh`)
   builds a single `docker run … <cli> <args>` invocation per
   `<scenario,cli>` pair, captures stdout/stderr/exit, and emits one TAP
   line. It does **not** source any per-scenario script, and it does
   **not** export `E2E_LIB_DIR` / `E2E_REPORT_DIR` despite the assertion
   lib README announcing them as the public contract.

2. **How does scenario 02 spin up a shared MemPalace process?** No
   `docker-compose.yml` exists. The `crewrig/e2e-mempalace:latest`
   image exists (`docker/e2e/mempalace.Dockerfile`) but no orchestration
   wraps it.

This ADR settles both.

## Decision

### D1. Scenario = host-side orchestration script

Each scenario is a directory under `tests/e2e/scenarios/<name>/`
containing at minimum a host-executable `run.sh`. The runner discovers
the script and delegates orchestration to it. The script is responsible
for:

- Composing and launching the CLI container(s) it needs.
- Spinning up any sidecar (MemPalace, fixture servers) and tearing it
  down on exit.
- Running assertions via the sourced `lib/*.sh` helpers, on the host,
  against artefacts written to the mounted case directory.
- Emitting a TAP subtest block to stdout and exiting `0` / `1` / `78`
  (the runner's existing skip convention).

Rejected alternative — **in-container scenarios** (CLI receives a probe
prompt as args, writes artefacts to a mounted volume, runner
post-asserts on the host). It breaks down for scenario 02 (needs two
sequential containers sharing state) and scenario 04 (needs the
out-of-container `harness-curator` step). Host orchestration covers
every pillar; in-container does not. The cost — slightly heavier
scenario scripts — is paid once per pillar.

### D2. Scenario contract (env-var interface)

The runner exports the following before invoking
`scenarios/<name>/run.sh`:

| Var | Value |
|---|---|
| `E2E_LIB_DIR` | absolute path to `tests/e2e/lib/` |
| `E2E_REPORT_DIR` | the per-case directory (`<run>/<cli>/<scenario>/`) |
| `E2E_CLI` | `claude` \| `gemini` \| `copilot` |
| `E2E_IMAGE` | resolved `cli.<name>.image` from `effective.json` |
| `E2E_EFFECTIVE_JSON` | absolute path to `effective.json` |
| `E2E_CREWRIG_E2E_HOME` | resolved `$CREWRIG_E2E_HOME` (already expanded) |
| `E2E_SCENARIO_DIR` | absolute path to `scenarios/<name>/` |

The scenario's exit code maps to TAP exactly as today: `0` → `ok`,
`78` → `skip` with diagnostic, anything else → `not ok`.

The scenario MUST write its own TAP subtest plan to
`${E2E_REPORT_DIR}/scenario.tap` for drill-down. The top-level
`run.tap` keeps the one-line-per-pair grain (no nested plan
explosion); operators inspecting a failure follow the path printed in
the runner's diagnostic.

### D3. Runner change — minimal delegation branch

`tests/e2e/run.sh` gains one branch inside the main loop, gated on the
presence of `scenarios/<name>/run.sh`:

```bash
scenario_script="${SCRIPT_DIR}/scenarios/${scenario}/run.sh"
if [[ -x "$scenario_script" ]]; then
  env E2E_LIB_DIR="${SCRIPT_DIR}/lib" \
      E2E_REPORT_DIR="$case_dir" \
      E2E_CLI="$cli" \
      E2E_IMAGE="$image" \
      E2E_EFFECTIVE_JSON="$EFFECTIVE_JSON" \
      E2E_CREWRIG_E2E_HOME="$(e2e_e2e_home)" \
      E2E_SCENARIO_DIR="${SCRIPT_DIR}/scenarios/${scenario}" \
      "$scenario_script" \
      >"${case_dir}/stdout" 2>"${case_dir}/stderr"
  exit_code=$?
else
  # Existing legacy path — direct docker run.
  …
fi
```

The legacy path is preserved so the existing smoke-version-style entries
in `defaults.toml` (none today, but the schema allows them) keep
working. The two paths are mutually exclusive per scenario, decided by
file presence — no new TOML field needed.

### D4. Sidecar lifecycle — per-scenario, not project-wide

Scenario 02 owns its MemPalace sidecar. The script:

1. Creates a unique docker volume (`crewrig-e2e-mp-${RUN_ID}`).
2. Starts `crewrig/e2e-mempalace:latest` detached with that volume
   mounted at `/data` and a unique container name.
3. Runs container A (writer), waits, runs container B (reader), both
   mounting the same volume read-write.
4. Asserts on the host via `assert_drawer_present` (which shells into a
   throwaway `crewrig/e2e-mempalace` container with the same volume).
5. Tears down container + volume in an `EXIT` trap, even on failure.

No project-wide `docker-compose.yml` is introduced. Compose adds a
declarative surface and a parallel orchestration model we do not yet
need; reaching for it now would lock in a topology before we know
which scenarios share what. Per-scenario `docker run` keeps each
pillar's blast radius confined to its own directory and matches how
the auth-flow scripts already operate.

### D5. File layout per scenario

```text
tests/e2e/scenarios/
├── 01-layered-context/
│   ├── run.sh                  # host orchestrator
│   ├── probe.prompt            # prompt fed to the CLI
│   └── expected.regex          # structural assertion input
├── 02-cross-tool-memory/
│   ├── run.sh
│   ├── writer.prompt
│   └── reader.prompt
├── 03-skill-build/
│   ├── run.sh
│   └── sample-skill.prompt
└── 04-harness-loop/
    ├── run.sh
    ├── friction.prompt
    └── judge-criterion.txt
```

Each `run.sh` opens with the canonical preamble from
`tests/e2e/lib/README.md`:

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${E2E_LIB_DIR:?runner must export E2E_LIB_DIR}"
: "${E2E_REPORT_DIR:?runner must export E2E_REPORT_DIR}"
source "${E2E_LIB_DIR}/assert.sh"
source "${E2E_LIB_DIR}/structural.sh"
source "${E2E_LIB_DIR}/llm_judge.sh"
```

### D6. TOML changes — metadata only

Each scenario gets a `[scenarios.<name>]` table in `defaults.toml`
limited to discovery metadata:

```toml
[scenarios.01-layered-context]
description = "00-60 rule files steer the CLI's profile-aware answer."
applies_to  = ["claude", "gemini", "copilot"]

[scenarios.02-cross-tool-memory]
description = "Drawer written by CLI A is readable by CLI B via shared MemPalace."
applies_to  = ["claude", "gemini"]   # Copilot path tracked as a parity gap.

[scenarios.03-skill-build]
description = "build-components.sh emits CLI-specific artefacts; sample skill invokes."
applies_to  = ["claude", "gemini", "copilot"]

[scenarios.04-harness-loop]
description = "harness-report → MemPalace → harness-curator round-trip."
applies_to  = ["claude", "gemini", "copilot"]
```

`command_args` is intentionally omitted — the scenario script owns
container invocation, including any per-CLI argv differences.

## Blast radius

| Surface | Change | Risk |
|---|---|---|
| `tests/e2e/run.sh` | One added branch (D3) gated on file presence. Legacy path unchanged. | Low — single conditional, exit-code mapping reused. |
| `tests/e2e/defaults.toml` | Four `[scenarios.*]` entries with metadata only. | Low — additive; today's `1..0` short-circuit replaced by 4 × N(applies_to) cases. |
| `tests/e2e/lib/*` | None. The contract advertised in `lib/README.md` is finally met by the runner. | None. |
| `tests/e2e/scenarios/**` | New tree. | Confined. |
| `docker/e2e/*` | None — image set is sufficient. | None. |
| CI | First wall-clock impact: each scenario adds 1–3 container starts per CLI per run. Scenario 02 also pulls/runs the MemPalace image. | Medium — gated behind auth readiness (`e2e_auth_ready`), so unconfigured CI legs continue to SKIP cleanly. |
| `docs/cli-matrix.md` | Add a row per scenario × CLI; record scenario 02's Copilot deferral with evidence (Copilot has no MemPalace MCP wiring yet — see `community-config/skills/*` parity check). | Required per AGENTS.md *CLI Matrix Maintenance*. |

## Consequences

**Positive.**

- The lib README's `E2E_LIB_DIR` / `E2E_REPORT_DIR` contract becomes
  real instead of aspirational.
- Scenarios can compose multi-container choreography (02, 04) without
  inventing a new runner concept.
- The TOML stays narrow: discovery metadata, not orchestration script.
- Adding a fifth scenario is a one-directory drop-in, no runner change.

**Negative.**

- Scenarios duplicate the docker-argv assembly that the legacy runner
  path centralises. Mitigation: extract a `lib/docker_invoke.sh` helper
  in a follow-up if duplication exceeds three scenarios. Not blocking
  for #80 — four scenarios is on the boundary.
- Per-scenario MemPalace lifecycle means scenario 02 cannot run truly
  in parallel with itself across CLIs without volume-name
  disambiguation. The unique-volume-per-`RUN_ID` convention (D4)
  handles the cross-CLI case; intra-scenario parallelism is out of
  scope.
- The judge call budget (`max_calls = 30` from ADR 0004) is shared by
  all scenarios. Scenarios 01 and 04 are the only LLM-judge users;
  budget per run remains comfortable.

## Open questions deferred to the developer

- Exact prompt wording for each pillar — the developer iterates against
  the live CLIs.
- Whether scenario 02's Copilot leg can be salvaged via a CLI-agnostic
  MemPalace drawer probe rather than an MCP path. If yes, drop the
  parity gap; if no, file the evidence per AGENTS.md *Gap-acceptance
  evidence rule*.
- Whether `lib/docker_invoke.sh` should land in #80 or wait for the
  duplication signal in a later PR.
