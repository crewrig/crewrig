# CrewRig end-to-end testing harness

This directory hosts the end-to-end (e2e) testing framework for CrewRig:
real CLI agents (Claude Code, Gemini CLI, GitHub Copilot CLI) driven
against scripted scenarios inside isolated Docker containers.

The harness is being built incrementally across the epic
[#75](https://github.com/Sfeir/crewrig/issues/75):

- **#76 — Foundation Docker images** (merged). Base + per-CLI images +
  MemPalace sidecar. See [`docker/e2e/README.md`](../../docker/e2e/README.md).
- **#77 — Dedicated-account auth flow** (this PR). One-off interactive
  scripts that populate `~/.crewrig-e2e/<cli>/` with the test account's
  credentials, mounted read-only at scenario time.
- **#78 — Scenario runner**. Container orchestration, fixture mounts,
  log capture.
- **#79 / #80 / #81 — Scenario fixtures and assertions**. Per-CLI test
  cases that exercise real agent behaviour.

The two design contracts that govern this directory are
[ADR 0001](../../docs/adr/0001-e2e-docker-images.md) (images) and
[ADR 0002](../../docs/adr/0002-e2e-auth-flow.md) (auth flow).

## One-off setup

Two steps, both per developer and per workstation:

```sh
# 1. Build (or rebuild) the e2e images.
task e2e:build

# 2. Authenticate the dedicated test account, once per CLI.
task e2e:auth:claude
task e2e:auth:gemini
task e2e:auth:copilot
```

Auth is interactive: you complete the OAuth browser flow (claude /
gemini) or paste a PAT export line (copilot) on your host. Credentials
are written to `~/.crewrig-e2e/<cli>/` and never leak into your personal
`~/.claude`, `~/.gemini`, or `~/.copilot`.

### Why a dedicated test account?

Scenarios send real prompts to real agents. Mixing them with your
personal session would pollute your transcript history, count against
your usage quota, and risk cross-contamination of state. The harness
assumes you have provisioned a separate GitHub / Google / Anthropic
account scoped to e2e use. You are responsible for creating and gating
that account; the framework only persists what it authorises.

## Per-CLI auth walkthrough

All three flows are idempotent — re-running them on an
already-authenticated dir is safe.

### Claude Code

```sh
task e2e:auth:claude
```

What happens:

1. `mkdir -p ~/.crewrig-e2e/claude`.
2. One-shot `docker run --user root … chown -R 1000:1000` on the dir.
   Required on macOS (VirtioFS bind mounts land root-owned); idempotent
   on Linux — the chown itself is a filesystem no-op but the helper
   still spawns a one-shot privileged container (~1–2 s spin-up).
   Accepted trade-off vs OS-branching. See ADR 0002 Decision 6 for the
   empirical trace.
3. Interactive `docker run -it … crewrig/e2e-claude:latest claude /login`
   with the dir bind-mounted RW at `/home/agent/.claude`. You complete
   the OAuth flow in your browser on the host.
4. Post-flight check: `.credentials.json` AND `.claude.json` must be
   present in `~/.crewrig-e2e/claude/`. Both are required — persisting
   only `.credentials.json` causes the CLI to treat the next session as
   a fresh install (upstream
   [tfvchow/field-notes-public#10](https://github.com/tfvchow/field-notes-public/issues/10)).

Headless override (long scenarios): set
`CLAUDE_CODE_OAUTH_TOKEN` (minted via `claude setup-token`) or
`ANTHROPIC_API_KEY` in your host shell. The scenario runner will pass
them through with `docker run -e …`; they MUST NOT be written under
`~/.crewrig-e2e/`.

### Gemini CLI

```sh
task e2e:auth:gemini
```

What happens:

1. Same mkdir + chown bootstrap as claude.
2. Interactive `docker run -it … crewrig/e2e-gemini:latest gemini`
   with the dir bind-mounted RW at `/home/agent/.gemini`. In the menu,
   pick **"Login with Google"** and complete the browser flow.
   Type `/quit` (or Ctrl-D) when the welcome prompt appears.
3. Post-flight check: `oauth_creds.json` AND `settings.json` must be
   present in `~/.crewrig-e2e/gemini/`.

Headless override: set `GEMINI_API_KEY` (or `GOOGLE_API_KEY` for Vertex)
in your host shell.

### GitHub Copilot CLI

```sh
task e2e:auth:copilot
```

This one is **not** an interactive container run. The v1 path uses an
env-var token (PAT); no file is written under
`~/.crewrig-e2e/copilot/`. See ADR 0002 Decision 4 for why we deferred
the device-flow path.

What happens:

1. The script prints the PAT-creation URL, the recommended fine-grained
   scopes (resource owner = test account; Copilot = Read & write), the
   `export COPILOT_GITHUB_TOKEN=…` line to add to your shell rc, and a
   90-day expiry reminder.
2. If `COPILOT_GITHUB_TOKEN` is already set in the calling shell, the
   script runs a 5-second sanity test: `docker run -e
   COPILOT_GITHUB_TOKEN crewrig/e2e-copilot:latest copilot --version`.
   A clean exit means the image launches and accepts the env var.

#### PAT rotation cadence

Fine-grained PATs default to **90 days**. Without a calendar reminder,
CI will silently start failing. Rotate quarterly:

1. Mint a new PAT at
   <https://github.com/settings/personal-access-tokens/new> with the
   same scopes.
2. Update the export line in your shell rc.
3. `source` it, then re-run `task e2e:auth:copilot` to confirm.

## Directory layout

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

You can override the root with `CREWRIG_E2E_HOME=/path/to/parent` (the
scripts will write to `${CREWRIG_E2E_HOME}/.crewrig-e2e/<cli>/`). This
matters on shared CI runners where `$HOME` is multi-tenant.

## Security posture

- **Read-only at scenario time.** Once authenticated, the scenario
  runner (#78) bind-mounts each dir with `:ro`. A deliberate write
  attempt from inside the container must fail with "Read-only file
  system" — that is one of the assertions the runner ships with.
- **No API keys on disk.** `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
  `GH_TOKEN`, `COPILOT_GITHUB_TOKEN`, and the Ollama Cloud token are
  read from your host shell at run time and passed via `docker run -e
  <NAME>`. They MUST NEVER be written under `~/.crewrig-e2e/`. The
  auth scripts refuse to proceed if they detect key material in a
  credential file.
- **Full reset.** Delete `~/.crewrig-e2e/<cli>/` and re-run
  `task e2e:auth:<cli>`. PATs are rotated upstream on GitHub.
- **OAuth refresh limitation.** Both Claude and Gemini refresh access
  tokens by overwriting their credential file. Under `:ro` that write
  fails silently; scenarios that outlive the access-token TTL
  (~1 hour) will error mid-run. Workaround: keep scenarios short, or
  use the env-var headless overrides for long ones. Tracked as
  open risk #1 in ADR 0002.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Permission denied` on first `/login` (macOS) | chown bootstrap was skipped — only happens if you ran a hand-rolled `docker run`, not via the script. | Re-run `task e2e:auth:<cli>`; the bootstrap is mandatory and always-on. |
| Claude prompts for login on every run | `.claude.json` is missing alongside `.credentials.json`. | Re-run `task e2e:auth:claude` and complete the login fully. |
| `copilot` complains about a malformed token | PAT expired, was revoked, or was pasted with surrounding whitespace. | Mint a fresh PAT, re-export, re-run `task e2e:auth:copilot`. |
| Scenario fails mid-run with auth error after ~1 h | OAuth access token expired and the RO mount blocked the refresh write. | For long scenarios, set `CLAUDE_CODE_OAUTH_TOKEN` / `GEMINI_API_KEY` in your shell instead. |
| `image 'crewrig/e2e-<cli>:latest' is not present locally` | You skipped `task e2e:build`. | Run `task e2e:build` (or `task e2e:build:<cli>`). |

## Pointers

- Design — [`docs/adr/0001-e2e-docker-images.md`](../../docs/adr/0001-e2e-docker-images.md),
  [`docs/adr/0002-e2e-auth-flow.md`](../../docs/adr/0002-e2e-auth-flow.md)
- Images — [`docker/e2e/README.md`](../../docker/e2e/README.md)
- Auth scripts — [`scripts/e2e/`](../../scripts/e2e/)
- Epic and child issues — #75, #76, #77, #78, #79, #80, #81
