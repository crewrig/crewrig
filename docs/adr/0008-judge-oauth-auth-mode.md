# ADR 0008 — Judge `auth_mode` and `claude-code` OAuth driver

**Status:** Proposed (issue #126)

## Context

ADR 0007 (issue #125) introduced a pluggable driver layer for
`tests/e2e/lib/llm_judge.sh`, but every driver still assumes
**API-key-in-env** authentication: the core loader exports
`JUDGE_API_KEY_ENV`, drivers dereference it via indirect expansion, and
the `preflight` contract returns `AUTH_TOKEN=<api-key>` or rc=2.

The Claude Code CLI's primary auth surface is OAuth, not an API key.
Credentials minted by `task e2e:auth:claude` (ADR 0002, Decision 2)
land in `~/.crewrig-e2e/claude/.credentials.json` (and at
`~/.claude/.credentials.json` for a developer's day-to-day session).
Re-using that on-disk token to call the Anthropic Messages API as the
judge would let contributors run the e2e oracle without minting a
separate `ANTHROPIC_JUDGE_API_KEY` — a real friction surfaced by
issue #126.

The Messages API accepts the OAuth access token via the standard
`Authorization: Bearer <token>` header in place of `x-api-key`, so the
delta is small: a second driver and a config switch.

## Decision

### 1. Add an `auth_mode` field to `[judge]`

```toml
[judge]
auth_mode = "api_key"   # default — preserves today's behaviour
# or
auth_mode = "oauth"     # driver reads CLI credential store from disk
```

Loader changes (`_llm_judge_load_config` in `tests/e2e/lib/llm_judge.sh`):

- Default literal: `auth_mode="api_key"`.
- Parsed via `jq -r '.judge.auth_mode // "api_key"' effective.json`.
- Emitted as `JUDGE_AUTH_MODE=%q` alongside the existing `JUDGE_*` lines.
- Declared `local` and `export`ed in `llm_judge()` next to
  `JUDGE_API_KEY_ENV` so drivers can read it via plain expansion.

**Forwarding model: env, not positional.** `auth_mode` is a
driver-internal concern — the core never branches on it. Exporting it
keeps the `_call` positional signature (ADR 0007 §1) intact and avoids
a breaking change to the existing `anthropic` driver. Drivers that
care branch in their own `_preflight`; drivers that do not (e.g.
`anthropic`) ignore the variable.

### 2. New driver: `tests/e2e/lib/llm_judge_drivers/claude-code.sh`

Implements the ADR 0007 §1 contract. `_preflight`:

1. If `E2E_JUDGE_MOCK=1` → `printf 'AUTH_TOKEN=mock\n'; return 0`
   (mirrors `anthropic.sh`).
2. Read `JUDGE_AUTH_MODE`. The driver supports `oauth` (primary) and
   `api_key` (fallback for users who set `ANTHROPIC_JUDGE_API_KEY`
   alongside `backend = "claude-code"`); any other value → rc=1 hard
   failure with an `_e2e_assert_diag` line.
3. When `auth_mode = "oauth"`:
   - Credential path: `${CLAUDE_CREDENTIALS_PATH:-$HOME/.claude/.credentials.json}`.
     The env override is added so the e2e harness can point the driver
     at `${CREWRIG_E2E_HOME}/claude/.credentials.json` without
     symlinking into `$HOME`.
   - Missing or unreadable file → rc=2 (soft auth-missing; core maps
     to UNCERTAIN per ADR 0007 §3).
   - Read access token via:

     ```bash
     token="$(jq -r '.claudeAiOauth.accessToken // empty' "$path")"
     ```

     **UNVERIFIED — verify before merge.** The Claude Code CLI's
     on-disk schema is not documented in this repository. The
     conventional upstream layout is
     `{"claudeAiOauth": {"accessToken": "sk-ant-oat01-…",
     "refreshToken": "…", "expiresAt": <ms>, "scopes": […],
     "subscriptionType": "…"}}`. The developer MUST run
     `jq 'keys, .claudeAiOauth | keys?' \
       ~/.crewrig-e2e/claude/.credentials.json` (or the developer's
     own `~/.claude/.credentials.json`) against a freshly-minted file
     and confirm the key path before landing the driver. If the
     observed schema differs, update the `jq` selector here and amend
     this ADR in the same PR — do not guess.
   - Empty/null token → rc=2 (treat as auth-missing, not hard failure;
     consistent with ADR 0007 §3 — "user has not configured a key on
     this machine").
   - `expiresAt` check: if the field is present AND parseable AND
     `expiresAt < now_ms`, return rc=2 with a `# WARN` message on
     stderr (e.g. `# WARN claude-code judge: OAuth token expired —
     re-run task e2e:auth:claude`). Missing/unparseable `expiresAt`
     → proceed and let the API surface the 401 on `_call`.
   - On success: `printf 'AUTH_TOKEN=%s\n' "$token"; return 0`.
4. When `auth_mode = "api_key"`: identical body to
   `_llm_judge_driver_anthropic_preflight` (read `JUDGE_API_KEY_ENV`
   via indirect expansion). This is intentional duplication, not a
   shared helper — ADR 0007 §1 keeps drivers self-contained.

`_call`:

- Same body as `anthropic.sh` except the curl header line swaps
  `-H "x-api-key: ${api_key}"` for
  `-H "Authorization: Bearer ${api_key}"`. The positional is named
  `api_key` for parity with the contract; semantically it is the
  Bearer token under `oauth`.
- `anthropic-version: 2023-06-01` header retained.
- Request body, retry loop, counter increment, and verdict regex are
  copy-equivalent to the Anthropic driver. The duplication is
  deliberate — ADR 0007 §1 commits to one file per backend.

### 3. Backward compatibility

- `auth_mode` defaults to `"api_key"`. Users who do not edit
  `local.toml` see zero behavior change.
- The `anthropic` driver is **not** modified. It continues to read
  `JUDGE_API_KEY_ENV` and ignores `JUDGE_AUTH_MODE`.
- New `local.toml.example` stanza (commented) documents the
  claude-code oauth path:

  ```toml
  # Re-use the OAuth token minted by `task e2e:auth:claude` instead of
  # `ANTHROPIC_JUDGE_API_KEY`. Reads ${CLAUDE_CREDENTIALS_PATH:-~/.claude/.credentials.json}.
  # [judge]
  # backend     = "claude-code"
  # auth_mode   = "oauth"
  # model       = "claude-sonnet-4-6"
  # temperature = 0.0
  # strict      = false
  ```

### 4. ADR scope

ADR 0007 covers the driver-contract surface. This ADR adds a single
field (`auth_mode`) and a single driver — small enough that a new ADR
is borderline. Recorded as ADR 0008 because:

- It introduces a public TOML field that becomes load-bearing the
  moment a third driver wants OAuth (e.g. a future `gemini-cli`
  backend that reuses `~/.gemini/oauth_creds.json`).
- The "credential file on disk" auth mode is a new threat surface
  (file permissions, expiry, stale tokens) that deserves a written
  decision the security agent can audit against.

### 4a. Threat model — `CLAUDE_CREDENTIALS_PATH` trust assumption

`CLAUDE_CREDENTIALS_PATH` is treated as **trusted input**: it must be
controlled by the same operator who configures `JUDGE_ENDPOINT`. An
attacker who can set both variables can exfiltrate any JSON file on
disk that contains a `.claudeAiOauth.accessToken` field, by pointing
the driver at the target file and at an attacker-controlled endpoint
that captures the bearer token.

This is an accepted threat. The mitigation is environmental: setting
either variable already requires shell-level access equivalent to
running arbitrary commands as the operator, so a successful attacker
has strictly more direct paths to credential disclosure (e.g.
reading `$HOME/.claude/.credentials.json` directly). The driver does
not attempt to sandbox the path; it only refuses to read credential
files whose POSIX permissions are more permissive than `0600` (any
group/other bit set), which closes the *local other-user*
disclosure path without claiming to address the *compromised
operator* path.

## File list

| Path | Change |
|---|---|
| `tests/e2e/lib/llm_judge.sh` | Loader: parse + export `JUDGE_AUTH_MODE`. No quorum or verdict changes. |
| `tests/e2e/lib/llm_judge_drivers/claude-code.sh` | **New.** Bearer-auth driver with oauth/api_key preflight branches. |
| `tests/e2e/defaults.toml` | Add `auth_mode = "api_key"` under `[judge]` with a one-line comment. |
| `tests/e2e/local.toml.example` | Add commented `[judge]` stanza demoing `backend = "claude-code"` + `auth_mode = "oauth"`. |
| `docs/adr/0008-judge-oauth-auth-mode.md` | This file. |
| `scripts/tests/test-e2e-llm-judge-lib.sh` | New cases: oauth happy-path (stubbed credentials.json), missing file → UNCERTAIN, empty token → UNCERTAIN, expired → UNCERTAIN, api_key parity unchanged. |
| `tests/e2e/lib/README.md` | One-paragraph note pointing at ADR 0008. |
| `docs/cli-matrix.md` | Touch only if a row references the judge backend. Spot-check during implementation. |

## Non-goals

- **No change to the `anthropic` driver.** Bearer auth on the
  anthropic backend is out of scope; users who want OAuth pick the
  `claude-code` backend.
- **No new env vars beyond `CLAUDE_CREDENTIALS_PATH`.** No
  `CLAUDE_OAUTH_TOKEN` shortcut — the file is the source of truth.
- **No token refresh.** ADR 0002 already documents that refresh fails
  under the RO mount. The driver surfaces expiry as UNCERTAIN; it does
  not attempt a refresh write. Users re-run `task e2e:auth:claude`.
- **No Copilot / Gemini OAuth drivers.** Symmetric implementation is
  out of scope for this PR; ADR 0008 only adds the mechanism.
- **No bundled-component changes.** Nothing under `community-config/`,
  `.gemini/`, or `.claude/` is touched. `scripts/build-components.sh`
  is not required.
- **No version bump.** No `community-config/skills/*/SKILL.md` or
  `community-config/agents/*/AGENT.md` is modified.

## Blast radius

- **Files modified on `main` today:** 4 (`llm_judge.sh`,
  `defaults.toml`, `local.toml.example`, `test-e2e-llm-judge-lib.sh`).
- **Files added:** 2 (the driver and this ADR).
- **Public-contract additions:**
  - New `[judge].auth_mode` field — additive, default preserves behavior.
  - New `claude-code` backend value — additive.
  - New `CLAUDE_CREDENTIALS_PATH` env override — additive.
- **Risks:**
  1. OAuth token schema drift if the Claude Code CLI changes the
     `claudeAiOauth.accessToken` path. Mitigated by the UNVERIFIED
     flag above — the developer confirms the path empirically before
     merge.
  2. Token expiry surfacing as 401 inside `_call` rather than `_preflight`
     when `expiresAt` is missing. Caller maps to UNCERTAIN via the
     existing malformed-output path (ADR 0007 §3) — acceptable, not
     catastrophic.
  3. File-permission leak (world-readable `.credentials.json`). Out of
     scope for this PR but worth a security-skill check during review.
- **Reversibility:** Easy. The driver file can be deleted and the
  `auth_mode` field removed; default behavior is untouched.
