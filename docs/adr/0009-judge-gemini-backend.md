# ADR 0009 — Judge `gemini` backend (api_key + OAuth)

**Status:** Accepted (issue #128)

## Context

ADR 0007 (issue #125) defined the pluggable driver layer for
`tests/e2e/lib/llm_judge.sh`: one file per backend at
`tests/e2e/lib/llm_judge_drivers/<backend>.sh`, exposing
`_llm_judge_driver_<backend>_preflight` and
`_llm_judge_driver_<backend>_call`. ADR 0008 (issue #126) extended that
contract with an `auth_mode` field and shipped `claude-code.sh` as the
template for an OAuth-capable driver — credentials read from a CLI
credential store on disk, fed to the upstream Messages API via
`Authorization: Bearer`.

Issue #128 closes the symmetry: the Gemini CLI is a first-class CrewRig
target, contributors already run `task e2e:auth:gemini` to mint Gemini
credentials, and there is no reason the LLM-judge oracle should require
a separate Google API key to use Gemini as the judge model. A `gemini`
backend that mirrors `claude-code` — `api_key` and `oauth` auth modes,
on-disk credential store override, soft-fail to UNCERTAIN when strict
is off — keeps the driver matrix consistent and unblocks contributors
who prefer Gemini for evaluation.

Two surfaces differ from the Anthropic path and shape the decision:

1. Google's OAuth tokens are short-lived (~1h). The on-disk credentials
   file carries a `refresh_token`, not a long-lived access token, so
   the driver MUST exchange refresh-for-access at preflight time
   against the Google token endpoint. There is no `expiresAt` check
   to lean on — assume every cached access token is stale.
2. Google APIs accept a per-request `x-goog-user-project` header that
   bills quota to a named GCP project. The judge config therefore
   needs an optional `gcp_project` field so contributors with a paid
   project can route quota correctly.

## Decision

### 1. Driver: `tests/e2e/lib/llm_judge_drivers/gemini.sh`

Implements the ADR 0007 §1 contract.

**`_preflight`**

1. If `E2E_JUDGE_MOCK=1` → `printf 'AUTH_TOKEN=mock\n'; return 0`
   (mirrors `anthropic.sh` and `claude-code.sh`).
2. Read `JUDGE_AUTH_MODE`. Supported values: `oauth` (primary),
   `api_key` (fallback for users with `GEMINI_JUDGE_API_KEY` or
   equivalent). Any other value → rc=1 with `_e2e_assert_diag`.
3. **`auth_mode = "api_key"`**: identical pattern to
   `_llm_judge_driver_anthropic_preflight` — read `JUDGE_API_KEY_ENV`
   via indirect expansion, empty → rc=2, otherwise emit
   `AUTH_TOKEN=<key>` and return 0. The token is the raw API key; the
   `_call` step appends it as `?key=<token>` on the URL (Google's
   API-key transport, not a header).
4. **`auth_mode = "oauth"`**:
   - Credential path:
     `${GEMINI_CREDENTIALS_PATH:-$HOME/.crewrig-e2e/gemini/oauth_creds.json}`.
     The env override lets the harness point at an alternate location
     without symlinking. Default matches the path written by
     `task e2e:auth:gemini`.
   - Missing or unreadable file → rc=2 (soft auth-missing; core maps
     to UNCERTAIN per ADR 0007 §3).
   - Refuse to read credential files whose POSIX mode is more
     permissive than `0600` — same guard as ADR 0008 §4a.
   - Read `refresh_token`, `client_id`, `client_secret` via:

     ```bash
     refresh="$(jq -r '.refreshToken // empty' "$path")"
     cid="$(jq -r '.clientId // empty' "$path")"
     csec="$(jq -r '.clientSecret // empty' "$path")"
     ```

     See §3 — schema is UNVERIFIED.
   - Any missing field → rc=2 (auth-missing, not hard failure).
   - Exchange refresh → access via Google's token endpoint:

     ```bash
     resp="$(curl -fsS --max-time 10 \
       -X POST https://oauth2.googleapis.com/token \
       -d "client_id=${cid}" \
       -d "client_secret=${csec}" \
       -d "refresh_token=${refresh}" \
       -d "grant_type=refresh_token")"
     ```

     - `curl` non-zero or non-2xx → rc=2 with a `# WARN gemini judge:
       OAuth refresh failed — re-run task e2e:auth:gemini` line on
       stderr. Soft fail; mapped to UNCERTAIN when `strict=false`.
     - `access_token` empty/null in response → rc=2, same warning
       shape.
   - On success: `printf 'AUTH_TOKEN=%s\n' "$access_token"; return 0`.

**`_call`**

Single positional `api_key` (semantically: the bearer token under
`oauth`, the raw API key under `api_key`). Branches on
`JUDGE_AUTH_MODE`:

- **`api_key`**: POST to
  `https://generativelanguage.googleapis.com/v1beta/models/${JUDGE_MODEL}:generateContent?key=${api_key}`
  with the prompt body. No Authorization header.
- **`oauth`**: POST to the same URL **without** the `?key=` query
  parameter, with `-H "Authorization: Bearer ${api_key}"`. When
  `JUDGE_GCP_PROJECT` is non-empty, additionally forward
  `-H "x-goog-user-project: ${JUDGE_GCP_PROJECT}"`.

Request body uses the Gemini `generateContent` shape:

```json
{
  "contents": [{"parts": [{"text": "<rendered prompt>"}]}],
  "generationConfig": {"temperature": <JUDGE_TEMPERATURE>}
}
```

Retry loop, counter increment, and verdict-extraction regex are
copy-equivalent to `anthropic.sh` — the duplication is deliberate per
ADR 0007 §1.

### 2. New optional field: `[judge].gcp_project`

```toml
[judge]
backend     = "gemini"
auth_mode   = "oauth"
model       = "gemini-2.0-flash"
# Optional: bill quota to a specific GCP project.
# gcp_project = "my-eval-project"
```

Loader changes in `_llm_judge_load_config` (`tests/e2e/lib/llm_judge.sh`):

- Default literal: `gcp_project=""`.
- Parsed via `jq -r '.judge.gcp_project // ""' effective.json`.
- Emitted as `JUDGE_GCP_PROJECT=%q` alongside the existing `JUDGE_*`
  lines.
- Declared `local` and `export`ed in `llm_judge()` so the driver reads
  it via plain expansion.

The core never branches on `JUDGE_GCP_PROJECT`; the driver is solely
responsible for translating it into the `x-goog-user-project` header.
Empty string → header omitted entirely (do not emit
`-H "x-goog-user-project: "`, which some curl/libcurl combos forward
as a literal empty value and confuses the API).

### 3. `oauth_creds.json` schema — UNVERIFIED

**UNVERIFIED — verify before merge.** The Gemini CLI's on-disk
credential schema is not documented in this repository. The driver's
best guess matches the
[google-auth-library `authorized_user` format](https://google-auth.readthedocs.io/en/latest/reference/google.oauth2.credentials.html)
that the gcloud SDK and most Google Node/Python libraries serialise to
disk, with camelCase keys:

```json
{
  "refreshToken": "1//0g…",
  "clientId":     "…apps.googleusercontent.com",
  "clientSecret": "GOCSPX-…",
  "type":         "authorized_user"
}
```

The developer MUST run the following against a freshly-minted
`~/.crewrig-e2e/gemini/oauth_creds.json` (or the developer's own
`~/.config/gemini/…` path) before landing the driver:

```bash
jq 'keys' ~/.crewrig-e2e/gemini/oauth_creds.json
```

If the observed schema differs (snake_case keys, nested under a
`credentials` object, alternate field names like `refresh_token`),
update the `jq` selectors in `_preflight` and amend this ADR in the
same PR. Do not guess. Two common variants the developer should be
ready for:

- **snake_case top-level** (`refresh_token`, `client_id`,
  `client_secret`) — gcloud's `application_default_credentials.json`
  convention.
- **nested under `installed`** — the raw OAuth client JSON downloaded
  from Google Cloud Console.

Whichever form the Gemini CLI writes, the driver must select against
it directly with `jq`; no auto-detection across shapes.

### 4. Backward compatibility

- `gcp_project` defaults to `""`. Existing configs see zero behaviour
  change.
- No existing driver (`anthropic`, `claude-code`) is modified.
- New `local.toml.example` stanza (commented) documents both auth
  modes for the gemini backend:

  ```toml
  # Use Gemini as the LLM judge.
  #
  # OAuth mode — reuses the credentials minted by `task e2e:auth:gemini`:
  # [judge]
  # backend     = "gemini"
  # auth_mode   = "oauth"
  # model       = "gemini-2.0-flash"
  # temperature = 0.0
  # strict      = false
  # gcp_project = "my-eval-project"   # optional, forwards x-goog-user-project
  #
  # API-key mode — requires GEMINI_JUDGE_API_KEY in env:
  # [judge]
  # backend       = "gemini"
  # auth_mode     = "api_key"
  # api_key_env   = "GEMINI_JUDGE_API_KEY"
  # model         = "gemini-2.0-flash"
  ```

## File list

| Path | Change |
|---|---|
| `tests/e2e/lib/llm_judge.sh` | Loader: parse + export `JUDGE_GCP_PROJECT`. No quorum or verdict changes. |
| `tests/e2e/lib/llm_judge_drivers/gemini.sh` | **New.** api_key + oauth preflight (with refresh exchange), generateContent call with optional `x-goog-user-project`. |
| `tests/e2e/defaults.toml` | Add `gcp_project = ""` under `[judge]` with a one-line comment. |
| `tests/e2e/local.toml.example` | Add commented `[judge]` stanzas demoing `backend = "gemini"` for both modes. |
| `docs/adr/0009-judge-gemini-backend.md` | This file. |
| `scripts/tests/test-e2e-llm-judge-lib.sh` | New cases: api_key happy-path, oauth happy-path (stubbed creds + stubbed token endpoint via `JUDGE_ENDPOINT` indirection), missing file → UNCERTAIN, missing refresh field → UNCERTAIN, token endpoint 4xx → UNCERTAIN, `gcp_project` header forwarded, empty `gcp_project` header omitted. |
| `tests/e2e/lib/README.md` | One-paragraph note pointing at ADR 0009. |
| `docs/cli-matrix.md` | Update row covering judge backends to show Gemini parity. |

## Non-goals

- **No change to `anthropic` or `claude-code` drivers.** This ADR adds
  a third file; existing drivers are untouched.
- **No access-token caching.** The driver exchanges refresh-for-access
  on every preflight. A 1-hour cache would reduce token-endpoint
  traffic but adds a write surface (cache file, lock, expiry) that
  this ADR explicitly defers. The cost is one extra HTTPS round-trip
  per `llm_judge` invocation, which the existing retry budget
  absorbs.
- **No Vertex AI backend.** `generativelanguage.googleapis.com` only.
  A Vertex variant (regional endpoint, different auth scope, ADC
  pickup) is a separate driver if and when needed.
- **No `gcloud auth print-access-token` fallback.** The on-disk
  credentials file is the single source of truth; shelling out to
  `gcloud` would couple the e2e harness to an unrelated CLI.
- **No bundled-component changes.** Nothing under `community-config/`,
  `.gemini/`, or `.claude/` is touched.
- **No version bump.** No `community-config/skills/*/SKILL.md` or
  `community-config/agents/*/AGENT.md` is modified.

## Blast radius

- **Files modified on `main` today:** 5 (`llm_judge.sh`,
  `defaults.toml`, `local.toml.example`, `test-e2e-llm-judge-lib.sh`,
  `cli-matrix.md`).
- **Files added:** 2 (the driver and this ADR). `tests/e2e/lib/README.md`
  may be created if it does not yet exist.
- **Public-contract additions:**
  - New `[judge].gcp_project` field — additive, default `""`.
  - New `gemini` backend value — additive.
  - New `GEMINI_CREDENTIALS_PATH` env override — additive.
  - New outbound dependency: `oauth2.googleapis.com/token` (refresh
    exchange) and `generativelanguage.googleapis.com` (judge call).
    The latter is already a peer of `api.anthropic.com` from a network
    egress standpoint; the token endpoint is new.
- **Risks:**
  1. **Schema drift** on `oauth_creds.json`. Mitigated by the
     UNVERIFIED flag in §3 — the developer confirms the path
     empirically before merge.
  2. **Refresh failure surface.** Google's token endpoint can return
     `invalid_grant` for revoked refresh tokens; the driver maps this
     to UNCERTAIN via rc=2, which is correct under `strict=false` but
     could mask a chronically broken setup. The `# WARN` stderr line
     is the operator's signal.
  3. **Refresh-token exfiltration** via `GEMINI_CREDENTIALS_PATH` +
     attacker-controlled `JUDGE_ENDPOINT`. Same threat model as ADR
     0008 §4a — accepted, mitigated only by the `0600` permission
     check.
  4. **Quota routing.** Forwarding `x-goog-user-project` against a
     project the calling identity does not have access to surfaces a
     403 inside `_call`. Caller maps to UNCERTAIN via the existing
     malformed-output path — acceptable.
- **Reversibility:** Easy. The driver file can be deleted and the
  `gcp_project` field removed; default behaviour is untouched.
