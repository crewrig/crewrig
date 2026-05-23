# CrewRig end-to-end testing framework

## Overview

This directory hosts CrewRig's end-to-end (e2e) testing harness: real CLI
agents (Claude Code, Gemini CLI, GitHub Copilot CLI) driven against scripted
pillar scenarios inside isolated Docker containers, with a shared MemPalace
sidecar for cross-tool memory checks. The framework proves that the five
CrewRig pillars — layered context, cross-tool memory, skill/agent build,
harness loop, and multi-CLI parity — hold under real CLI execution, not just
unit-tested in isolation. Output is TAP, one subtest per scenario × CLI.

## Prerequisites

- **Docker** with BuildKit support (Docker Desktop on macOS, Docker Engine
  20.10+ on Linux). The harness pulls and builds five images locally.
- **[Task](https://taskfile.dev/)** v3+ for the `task e2e:*` entry points.
- **`jq`** for JSON probing in assertions and the runner's `effective.json`
  resolution.
- **`yq`** (Go version, mikefarah's) for TOML merging in
  `tests/e2e/lib/toml_merge.sh`.
- **`gh`** (GitHub CLI) for harness-loop scenarios and PAT minting.
- **Bash 4+**. macOS ships Bash 3.2 by default — install via Homebrew
  (`brew install bash`) or rely on the containerised execution path.

**Host OS caveat — Gitmoji checks.** `assert_gitmoji_title` in
`structural.sh` uses `grep -P` (PCRE). PCRE is present in the Debian-based
e2e images (GNU grep 3.8) but **not** in BSD grep on macOS hosts. Run any
Gitmoji-related smoke inside the e2e images, not on the host.

## One-off setup

Two steps, per developer and per workstation:

```sh
# 1. Build (or rebuild) the e2e images.
task e2e:build

# 2. Authenticate the dedicated test account, once per CLI.
task e2e:auth:claude
task e2e:auth:gemini
task e2e:auth:copilot
```

`task e2e:build` produces `crewrig/e2e-base`, `crewrig/e2e-claude`,
`crewrig/e2e-gemini`, `crewrig/e2e-copilot`, and `crewrig/e2e-mempalace`
(all `:latest`). Use the per-image targets (`task e2e:build:claude`, etc.)
when iterating on a single Dockerfile.

### `~/.crewrig-e2e/` layout

The auth scripts write credentials into a dedicated host directory that the
scenario runner mounts read-only at execution time:

```text
~/.crewrig-e2e/
├── claude/
│   ├── .credentials.json   # OAuth tokens (load-bearing)
│   └── .claude.json        # session metadata (also required)
├── gemini/
│   ├── oauth_creds.json    # OAuth tokens
│   └── settings.json       # selected auth type
└── copilot/                # empty by design — token lives in $COPILOT_GITHUB_TOKEN
```

Override the root with `CREWRIG_E2E_HOME=/path/to/parent` (the auth
scripts and the runner both honour it). This matters on shared CI runners
where `$HOME` is multi-tenant.

### Per-CLI auth notes

- **Claude Code** — interactive `claude /login` inside the
  `crewrig/e2e-claude` image. Both `.credentials.json` AND `.claude.json`
  must end up under `~/.crewrig-e2e/claude/`; persisting only the former
  causes the CLI to treat the next session as a fresh install.
  Headless override: export `CLAUDE_CODE_OAUTH_TOKEN` or
  `ANTHROPIC_API_KEY` in your host shell.
- **Gemini CLI** — interactive `gemini` launch inside the
  `crewrig/e2e-gemini` image. Pick **"Login with Google"** and `/quit`
  once you reach the welcome prompt. Both `oauth_creds.json` and
  `settings.json` must land under `~/.crewrig-e2e/gemini/`. Headless
  override: `GEMINI_API_KEY` (or `GOOGLE_API_KEY` for Vertex).
- **GitHub Copilot CLI** — env-var PAT path (no on-disk file). The
  script prints the PAT-creation URL, the recommended fine-grained
  scopes (resource owner = test account; Copilot = Read & write), the
  `export COPILOT_GITHUB_TOKEN=…` line for your shell rc, and a
  **90-day** expiry reminder. If the token is already exported, the
  script runs a 5-second container sanity check.

See [ADR 0002](../../docs/adr/0002-e2e-auth-flow.md) for the auth flow
contract and `scripts/e2e/auth-{claude,gemini,copilot}.sh` for the
scripts themselves.

## Running tests

```sh
# Run every scenario × every configured CLI.
task e2e:test

# Run one scenario across all CLIs.
task e2e:test:scenario -- 01-layered-context

# Run all scenarios against a single CLI.
task e2e:test:cli -- claude
```

Useful flags passed through `--` to the runner
(`tests/e2e/run.sh`):

| Flag | Meaning |
|---|---|
| `--dry-run` | Resolve config + write `effective.json`; do not spawn containers. |
| `--keep <N>` | Keep at most N most-recent report dirs (default: 20). |
| `--report-dir <path>` | Override the report directory. |
| `--scenario <name>` | Limit to one scenario. |
| `--cli <name>` | Limit to one CLI (`claude` \| `gemini` \| `copilot` \| `all`). |

Exit code is `0` on success (or when no scenarios are defined) and
non-zero when at least one scenario fails (TAP `not ok`). Per-run output
lands in `tests/e2e/reports/<run-id>/`, with one subdirectory per
`<cli>/<scenario>/` carrying `scenario.tap`, captured stdout/stderr,
and (when invoked) `judge.count`.

## Override file

`tests/e2e/local.toml` is the gitignored override file deep-merged over
`defaults.toml` at run time. The merge rules (see
[ADR 0003](../../docs/adr/0003-e2e-runner-toml.md) Decision 2):

- **Arrays APPEND.**
- **Scalars REPLACE.**
- **New tables graft in.**

Copy `tests/e2e/local.toml.example` to `tests/e2e/local.toml` to start.
The example routes Copilot through Ollama Cloud so local validation
does not burn real Copilot quota:

```toml
[cli.copilot]
command  = ["ollama", "launch", "copilot", "--model", "deepseek-v4-pro:cloud", "--"]
env_keys = ["COPILOT_GITHUB_TOKEN", "OLLAMA_HOST"]
```

The runner writes the merged result to `effective.json` at the top of
each run; inspect it under the run's report directory when debugging
config resolution.

## Adding a new scenario

Each scenario is a host-side orchestrator that drives Docker itself.
See [`scenarios/README.md`](scenarios/README.md) for the full contract;
the short version:

1. Create `tests/e2e/scenarios/<name>/` with an executable `run.sh`
   (copy any existing scenario as a starting template) plus any
   supporting fixtures.
2. Source the assertion helpers via the runner-exported `E2E_LIB_DIR`:

   ```bash
   set -euo pipefail
   : "${E2E_LIB_DIR:?runner must export E2E_LIB_DIR}"
   source "${E2E_LIB_DIR}/assert.sh"
   source "${E2E_LIB_DIR}/structural.sh"
   source "${E2E_LIB_DIR}/llm_judge.sh"
   ```

3. Emit a TAP subtest plan to `${E2E_REPORT_DIR}/scenario.tap`. Exit
   codes follow the runner convention: `0` → ok, `78` → skip (with a
   diagnostic line on stdout), anything else → not ok.
4. Add a `[scenarios.<name>]` table to `tests/e2e/defaults.toml` with
   `description` and `applies_to`.
5. Add one row per CLI × scenario to `docs/cli-matrix.md`.

No runner change is needed — scenario discovery is by file presence
plus the TOML table.

The full env-var contract (`E2E_LIB_DIR`, `E2E_REPORT_DIR`, `E2E_CLI`,
`E2E_IMAGE`, `E2E_EFFECTIVE_JSON`, `E2E_CREWRIG_E2E_HOME`,
`E2E_SCENARIO_DIR`, `E2E_RUN_ID`) is documented in
[`scenarios/README.md`](scenarios/README.md). The assertion API
reference lives in [`lib/README.md`](lib/README.md).

## Authentication strategy

The harness is built around a **dedicated test account** per CLI provider
(GitHub, Google, Anthropic). Three properties follow from that choice:

- **Isolation from your personal CLI state.** Credentials are written
  under `~/.crewrig-e2e/<cli>/`, never into `~/.claude`, `~/.gemini`, or
  `~/.copilot`. Personal transcript history and quota stay clean.
- **Read-only volume mounts at scenario time.** Once authenticated, the
  scenario runner bind-mounts each per-CLI dir with `:ro`. A deliberate
  write attempt from inside the container must fail with "Read-only
  file system" — one of the assertions the runner ships with.
- **No API keys on disk.** `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
  `GH_TOKEN`, `COPILOT_GITHUB_TOKEN`, `ANTHROPIC_JUDGE_API_KEY`, and the
  Ollama Cloud token are read from your host shell and passed via
  `docker run -e <NAME>`. They MUST NEVER be written under
  `~/.crewrig-e2e/`. The auth scripts refuse to proceed if they detect
  key material in a credential file.

**PAT rotation.** Fine-grained GitHub PATs default to **90 days**.
Without a calendar reminder the Copilot leg silently starts failing.
Rotate quarterly: mint a fresh PAT at
<https://github.com/settings/personal-access-tokens/new> with the same
scopes, update the export in your shell rc, then re-run
`task e2e:auth:copilot` to confirm.

**OAuth refresh under `:ro`.** Both Claude and Gemini refresh access
tokens by overwriting their credential file. Under the read-only mount,
that write fails silently; scenarios that outlive the access-token TTL
(~1 hour) will error mid-run. Keep scenarios short, or use the headless
env-var overrides for long ones. Tracked as open risk #1 in ADR 0002.

Foundations: [ADR 0001 — Docker images](../../docs/adr/0001-e2e-docker-images.md)
and [ADR 0002 — Auth flow](../../docs/adr/0002-e2e-auth-flow.md).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `image 'crewrig/e2e-<cli>:latest' is not present locally` | You skipped `task e2e:build`. | Run `task e2e:build` (or the per-CLI target). |
| Claude prompts for login on every run | `.claude.json` is missing alongside `.credentials.json`. | Re-run `task e2e:auth:claude` and complete the login fully. |
| `Permission denied` on first `/login` (macOS) | One-shot chown bootstrap was skipped — only happens if you hand-rolled `docker run`. | Re-run `task e2e:auth:<cli>` — the bootstrap is always-on inside the script. |
| `copilot` complains about a malformed token | PAT expired, was revoked, or was pasted with surrounding whitespace. | Mint a fresh PAT, re-export, re-run `task e2e:auth:copilot`. |
| Scenario fails mid-run with auth error after ~1 h | OAuth access token expired and the RO mount blocked the refresh write. | Set `CLAUDE_CODE_OAUTH_TOKEN` / `GEMINI_API_KEY` in your shell for long scenarios. |
| `llm_judge` returns `MISSING_KEY` | `ANTHROPIC_JUDGE_API_KEY` is unset on the host. | Export it (may share its value with `ANTHROPIC_API_KEY`; the split is for accounting, not secrecy). |
| Ollama Cloud override hangs or 401s | `OLLAMA_HOST` or the Ollama Cloud token is not exported on the host. | Export both before invoking `task e2e:test`. |
| `--dry-run` reports success but no containers ran | Expected behaviour. | `--dry-run` resolves config + writes `effective.json` only; drop the flag to execute. |
| `assert_gitmoji_title` fails only on macOS | BSD grep lacks PCRE. | Run the assertion inside the e2e image, not on the host. |

For deeper debugging, every run writes `effective.json`, per-case
`scenario.tap`, and captured stdout/stderr under
`tests/e2e/reports/<run-id>/<cli>/<scenario>/`.

## CI integration

Nightly CI execution is a deliberate follow-up. The current scope is
**local developer runs**: the harness is wired for fast iteration on a
workstation, not yet for unattended scheduled execution. The TAP output
and the `--keep` retention flag are designed with a future CI runner in
mind, but no GitHub Actions workflow ships in this round.

## References

- Design ADRs:
  [0001 — Docker images](../../docs/adr/0001-e2e-docker-images.md),
  [0002 — Auth flow](../../docs/adr/0002-e2e-auth-flow.md),
  [0003 — Runner & TOML](../../docs/adr/0003-e2e-runner-toml.md),
  [0004 — Assertion libs](../../docs/adr/0004-e2e-assertion-libs.md),
  [0005 — Pillar scenarios](../../docs/adr/0005-e2e-pillar-scenarios.md)
- Assertion API reference — [`lib/README.md`](lib/README.md)
- Scenario contract — [`scenarios/README.md`](scenarios/README.md)
- Image definitions — [`../../docker/e2e/README.md`](../../docker/e2e/README.md)
- Auth scripts — [`../../scripts/e2e/`](../../scripts/e2e/)
- Epic and child issues — #75, #76, #77, #78, #79, #80, #81
