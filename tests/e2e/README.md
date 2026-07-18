# CrewRig end-to-end testing framework

## Overview

Real CLI agents (Claude Code, Gemini CLI, GitHub Copilot CLI) driven against scripted pillar scenarios
in isolated Docker containers, with a shared MemPalace sidecar for cross-tool memory checks. The harness
proves the five CrewRig pillars — layered context, cross-tool memory, skill/agent build, harness loop,
multi-CLI parity — hold under real CLI execution. Output is TAP, one subtest per scenario × CLI.

## Prerequisites

- **Docker** with BuildKit (Docker Desktop on macOS, Engine 20.10+ on Linux); builds five images.
- **[Task](https://taskfile.dev/)** v3+ for the `task e2e:*` entry points.
- **`jq`** for JSON probing in assertions and `effective.json` resolution.
- **`yq`** (mikefarah's Go version) for TOML merging in `lib/toml_merge.sh`.
- **`gh`** (GitHub CLI) for harness-loop scenarios and PAT minting.
- **Bash 4+**. macOS ships 3.2 — `brew install bash` or use the container path.

**Host OS caveat — Gitmoji checks.** `assert_gitmoji_title` in `structural.sh` uses `grep -P`
(PCRE), present in the Debian-based e2e images (GNU grep 3.8) but **not** in BSD grep on macOS.
Run Gitmoji smokes inside the e2e images.

## One-off setup

Two steps, per developer and per workstation:

```sh
task e2e:build              # 1. Build (or rebuild) the e2e images.
task e2e:auth:claude        # 2. Authenticate the dedicated test account,
task e2e:auth:gemini        #    once per CLI.
task e2e:auth:copilot
```

`task e2e:build` produces `crewrig/e2e-{base,claude,gemini,copilot,mempalace}` (all `:latest`).
Use per-image targets (`task e2e:build:claude`, etc.) when iterating on a single Dockerfile.

### `~/.crewrig-e2e/` layout

The auth scripts write credentials into a dedicated host directory the runner mounts read-only
at scenario time:

```text
~/.crewrig-e2e/
├── claude/     # .credentials.json (OAuth tokens) + .claude.json (session
│               #   metadata) — BOTH load-bearing.
├── gemini/     # mode 0700; full ~/.gemini bundle minus antigravity*, tmp/,
│               #   *.bak|*.ori|*.orig. oauth_creds.json + settings.json are
│               #   load-bearing; bundle holds a long-lived OAuth refresh token.
└── copilot/    # empty by design — token lives in $COPILOT_GITHUB_TOKEN.
```

> ⚠️ **Treat `~/.crewrig-e2e/gemini/` like `~/.ssh/`.** Not encrypted at rest: `oauth_creds.json`
> carries a long-lived Google refresh token. `auth-gemini.sh` sets `chmod 0700`, but it lives in
> plaintext — never sync it to cloud storage, ship it in an image, or copy it to a shared
> filesystem. It is a developer-machine artifact; for CI, use a fresh dedicated-account login per
> runner.

Override the root with `CREWRIG_E2E_HOME=/path/to/parent` (auth scripts and runner both honor it) on
multi-tenant CI. At run time the bundle mounts **read-only** at `/run/gemini-creds`; a wrapper in
`defaults.toml [cli.gemini].command` copies it to `/home/agent/.gemini` before `exec gemini`, so the
CLI's atomic writes (`projects.json`, etc.) never mutate the host bundle (issue #147 §5, #148 note).

### Per-CLI auth notes

- **Claude Code** — interactive `claude /login` inside `crewrig/e2e-claude`. Both `.credentials.json`
  AND `.claude.json` must land under `~/.crewrig-e2e/claude/` (only the former makes the CLI treat the
  next session as a fresh install). Headless override: `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`.
- **Gemini CLI** — interactive `gemini` inside `crewrig/e2e-gemini`. Pick **"Login with Google"**
  and `/quit` at the welcome prompt. Both `oauth_creds.json` and `settings.json` must land under
  `~/.crewrig-e2e/gemini/`. Headless override: `GEMINI_API_KEY` (or `GOOGLE_API_KEY` for Vertex).
- **GitHub Copilot CLI** — env-var PAT path (no on-disk file). The script prints the PAT-creation URL,
  recommended fine-grained scopes (resource owner = test account; Copilot = Read & write), the
  `export COPILOT_GITHUB_TOKEN=…` line, and a **90-day** expiry reminder, then sanity-checks the token.

See [ADR 0002](../../docs/adr/0002-e2e-auth-flow.md) and `scripts/e2e/auth-{claude,gemini,copilot}.sh`.

## Running tests

```sh
task e2e:test                                 # every scenario × every CLI
task e2e:test:scenario -- 01-layered-context  # one scenario, all CLIs
task e2e:test:cli -- claude                   # all scenarios, one CLI
```

Useful flags passed through `--` to the runner (`tests/e2e/run.sh`):

| Flag | Meaning |
|---|---|
| `--dry-run` | Resolve config + write `effective.json`; do not spawn containers. |
| `--keep <N>` | Keep at most N most-recent report dirs (default: 20). |
| `--report-dir <path>` | Override the report directory. |
| `--scenario <name>` | Limit to one scenario. |
| `--cli <name>` | Limit to one CLI (`claude` \| `gemini` \| `copilot` \| `all`). |

Exit code is `0` on success (or when no scenarios are defined), non-zero when at least one scenario
fails (TAP `not ok`). Output lands in `reports/<run-id>/`, one `<cli>/<scenario>/` subdir per case
with `scenario.tap`, captured stdout/stderr, and (when invoked) `judge.count`.

## Override file

`tests/e2e/local.toml` is the gitignored override deep-merged over `defaults.toml` at run time.
Merge rules (see [ADR 0003](../../docs/adr/0003-e2e-runner-toml.md) Decision 2): **arrays APPEND,
scalars REPLACE, new tables graft in.** Copy `local.toml.example` to `local.toml` to start. The
example routes Copilot through Ollama Cloud so local validation does not burn real Copilot quota:

```toml
[cli.copilot]
command  = ["ollama", "launch", "copilot", "--model", "deepseek-v4-pro:cloud", "--"]
env_keys = ["COPILOT_GITHUB_TOKEN", "OLLAMA_HOST"]
```

With that override active, run `task e2e:auth:ollama` once first: it registers the test account's
Ed25519 keypair under `~/.crewrig-e2e/ollama/` and bind-mounts it read-only into the copilot container
— without it, `ollama launch` fails with an auth error. The runner writes the merged `effective.json`
at the top of each run; inspect it under the report directory when debugging config resolution.

## Adding a new scenario

Each scenario is a host-side orchestrator that drives Docker itself. See
[`scenarios/README.md`](scenarios/README.md) for the full contract; the short version:

1. Create `scenarios/<name>/` with an executable `run.sh` (copy an existing scenario as a
   template) plus any fixtures.
2. Source the assertion helpers via the runner-exported `E2E_LIB_DIR`:

   ```bash
   set -euo pipefail
   : "${E2E_LIB_DIR:?runner must export E2E_LIB_DIR}"
   source "${E2E_LIB_DIR}/assert.sh"
   source "${E2E_LIB_DIR}/structural.sh"
   source "${E2E_LIB_DIR}/llm_judge.sh"
   ```

3. Emit a TAP subtest plan to `${E2E_REPORT_DIR}/scenario.tap`. Exit codes: `0` → ok, `78` → skip
   (with a stdout diagnostic), anything else → not ok.
4. Add a `[scenarios.<name>]` table to `defaults.toml` (`description`, `applies_to`).
5. Add one row per CLI × scenario to `docs/cli-matrix.md`.

Discovery is by file presence plus the TOML table — no runner change needed. The full env-var contract
(`E2E_LIB_DIR`, `E2E_REPORT_DIR`, `E2E_CLI`, `E2E_IMAGE`, `E2E_EFFECTIVE_JSON`, `E2E_CREWRIG_E2E_HOME`,
`E2E_SCENARIO_DIR`, `E2E_RUN_ID`) is documented in [`scenarios/README.md`](scenarios/README.md); the
assertion API reference lives in [`lib/README.md`](lib/README.md).

## Authentication strategy

The harness uses a **dedicated test account** per provider (GitHub, Google, Anthropic). Three
properties follow:

- **Isolation from personal CLI state.** Credentials live under `~/.crewrig-e2e/<cli>/`, never in
  `~/.claude`, `~/.gemini`, or `~/.copilot`; personal transcript history and quota stay clean.
- **Read-only volume mounts at scenario time.** Once authenticated, the runner bind-mounts each per-CLI
  dir with `:ro`; a deliberate write inside the container must fail with "Read-only file system" — one
  of the shipped assertions.
- **No API keys on disk.** `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GH_TOKEN`, `COPILOT_GITHUB_TOKEN`,
  `ANTHROPIC_JUDGE_API_KEY`, and the Ollama Cloud token are read from the host shell and passed via
  `docker run -e <NAME>` — NEVER written under `~/.crewrig-e2e/` (the auth scripts refuse key material).

**PAT rotation.** Fine-grained GitHub PATs default to **90 days**; without a calendar reminder the Copilot
leg silently starts failing. Rotate quarterly at <https://github.com/settings/personal-access-tokens/new>
with the same scopes, update the shell-rc export, then re-run `task e2e:auth:copilot`.

**OAuth refresh under `:ro`.** Claude and Gemini refresh access tokens by overwriting their credential
file; under the read-only mount that write fails silently, so scenarios outliving the access-token TTL
(~1 h) error mid-run. Keep scenarios short, or use headless overrides. Open risk #1 in ADR 0002.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `image 'crewrig/e2e-<cli>:latest' is not present locally` | Skipped `task e2e:build`. | Run `task e2e:build` (or the per-CLI target). |
| Claude prompts for login on every run | `.claude.json` missing alongside `.credentials.json`. | Re-run `task e2e:auth:claude` and complete the login fully. |
| `Permission denied` on first `/login` (macOS) | chown bootstrap skipped — only if you hand-rolled `docker run`. | Re-run `task e2e:auth:<cli>`; the bootstrap is always-on. |
| `copilot` complains about a malformed token | PAT expired, revoked, or pasted with whitespace. | Mint a fresh PAT, re-export, re-run `task e2e:auth:copilot`. |
| Scenario fails mid-run with auth error after ~1 h | OAuth token expired; the RO mount blocked the refresh write. | Set `CLAUDE_CODE_OAUTH_TOKEN` / `GEMINI_API_KEY` for long scenarios. |
| `llm_judge` returns `MISSING_KEY` | `ANTHROPIC_JUDGE_API_KEY` unset on the host. | Export it (may share its value with `ANTHROPIC_API_KEY`; split is for accounting). |
| Ollama Cloud override hangs or 401s | Ed25519 keypair missing, or `OLLAMA_HOST` / `COPILOT_GITHUB_TOKEN` not exported. | Run `task e2e:auth:ollama` once; verify both vars are exported. |
| `--dry-run` reports success but no containers ran | Expected — resolves config + writes `effective.json` only. | Drop the flag to execute. |
| `assert_gitmoji_title` fails only on macOS | BSD grep lacks PCRE. | Run the assertion inside the e2e image. |

## CI integration

Nightly scenario execution is a deliberate follow-up. Current scope is **local developer runs** — wired
for fast workstation iteration, not unattended scheduled execution. The TAP output and `--keep` retention
flag anticipate a future CI runner, but no scenario-running workflow ships in this round.

## References

- Design ADRs: [0001 — Docker images](../../docs/adr/0001-e2e-docker-images.md),
  [0002 — Auth flow](../../docs/adr/0002-e2e-auth-flow.md),
  [0003 — Runner & TOML](../../docs/adr/0003-e2e-runner-toml.md),
  [0004 — Assertion libs](../../docs/adr/0004-e2e-assertion-libs.md),
  [0005 — Pillar scenarios](../../docs/adr/0005-e2e-pillar-scenarios.md)
- Assertion API reference — [`lib/README.md`](lib/README.md)
- Scenario contract — [`scenarios/README.md`](scenarios/README.md)
- Image definitions — [`../../docker/e2e/README.md`](../../docker/e2e/README.md)
- Auth scripts — [`../../scripts/e2e/`](../../scripts/e2e/)
- Epic and child issues — #75, #76, #77, #78, #79, #80, #81
