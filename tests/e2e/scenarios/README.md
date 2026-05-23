# E2E pillar scenarios

Four host-orchestrated scenarios that exercise CrewRig's load-bearing
surfaces end-to-end. Governed by
[ADR 0005](../../../docs/adr/0005-e2e-pillar-scenarios.md); discovery
metadata lives in `tests/e2e/defaults.toml`.

| # | Scenario | What it proves |
|---|---|---|
| 01 | `01-layered-context` | 00–60 rule files deployed to the CLI actually steer a profile-aware answer. |
| 02 | `02-cross-tool-memory` | A drawer written by CLI A is read by CLI B via a shared MemPalace sidecar. |
| 03 | `03-skill-build` | `scripts/build-components.sh` emits the per-CLI artefacts (skills, agents, commands). |
| 04 | `04-harness-loop` | `harness-report` → MemPalace → `harness-curator` round-trip. |

## Scenario contract

Each `scenarios/<name>/run.sh` runs **on the host** and drives Docker
itself. The runner (`tests/e2e/run.sh`) exports the following before
delegating:

| Env var | Meaning |
|---|---|
| `E2E_LIB_DIR` | Absolute path to `tests/e2e/lib/`. |
| `E2E_REPORT_DIR` | Per-case directory (`<run-id>/<cli>/<scenario>/`). The scenario writes its subtap to `${E2E_REPORT_DIR}/scenario.tap`. |
| `E2E_CLI` | `claude` \| `gemini` \| `copilot`. |
| `E2E_IMAGE` | Resolved docker image for that CLI. |
| `E2E_EFFECTIVE_JSON` | Path to the merged `effective.json`. |
| `E2E_CREWRIG_E2E_HOME` | Host path to `~/.crewrig-e2e` (or its override). Per-CLI auth lives at `${E2E_CREWRIG_E2E_HOME}/<cli>/`. |
| `E2E_SCENARIO_DIR` | Absolute path to this scenario's own directory. |
| `E2E_RUN_ID` | Stable identifier for the run, used to scope sidecar volumes. |

Exit codes follow the runner's convention: `0` → ok, `78` → skip
(diagnostic line on stdout), anything else → not ok.

Every scenario sources the assertion libs and writes a TAP subtest plan
to `${E2E_REPORT_DIR}/scenario.tap` for drill-down. The runner captures
the scenario's stdout/stderr alongside.

## Adding a fifth scenario

1. Drop a new directory under `tests/e2e/scenarios/<name>/` with an
   executable `run.sh` (start from any existing scenario as template).
2. Add a `[scenarios.<name>]` table to `tests/e2e/defaults.toml` with
   `description` and `applies_to`.
3. Update `docs/cli-matrix.md` with one row per CLI × scenario.
4. No runner change needed — discovery is by file presence.
