# ADR 0009 — `ollama-cloud` judge backend (api_key + keypair auth modes)

**Status:** Accepted (issue #127)

## Context

ADR 0007 (issue #125) made the judge driver layer pluggable, and ADR
0008 (issue #126) added an `auth_mode` switch with a Bearer-token
driver (`claude-code`) that reuses an OAuth credential file already
on disk.

Issue #127 asks for a third driver: **Ollama Cloud**. Two reasons
make this load-bearing rather than a "nice to have":

1. **No incremental cost for contributors who already provisioned
   Ollama Cloud.** `task e2e:auth:ollama` already registers an
   Ed25519 keypair at `${CREWRIG_E2E_HOME}/ollama/id_ed25519` so
   `ollama launch copilot --model …:cloud` works as the CLI under
   test (see `tests/e2e/local.toml.example` lines 26-34). The same
   identity should be usable to call Ollama Cloud as the *judge*,
   without minting a second secret.
2. **API-key parity with Anthropic.** Ollama Cloud also exposes a
   plain bearer API key for users who do not want to involve the
   keypair flow (e.g. CI). Supporting both keeps the friction model
   symmetric with `anthropic` (key in env) and `claude-code` (token
   on disk).

The Ollama Cloud HTTP surface is **OpenAI-compatible** —
`POST /v1/chat/completions` returning `{choices:[{message:{content:…}}]}`
— so response parsing is a one-line jq selector, not a new shape.

### What is NOT public

Two pieces of upstream documentation are not in this repository's
trusted set at authoring time. Both are flagged `UNVERIFIED —` in the
driver source and below; the developer MUST resolve them empirically
before the PR is merged. If the observed reality differs from the
hypothesis, the driver source AND this ADR are amended in the same
PR — same discipline as ADR 0008 §2.

- **The Ollama Cloud completions endpoint URL.** This ADR assumes
  `https://api.ollama.ai/v1/chat/completions`. The developer
  confirms by reading the official Ollama Cloud quickstart at PR
  time and updates both this ADR and `tests/e2e/defaults.toml` if
  the canonical host differs.
- **The keypair → bearer-token exchange protocol.** Ollama Cloud
  accepts Ed25519-signed JWTs minted by the client and exchanges
  them for short-lived bearer tokens; the exact endpoint path, the
  JWT header `kid` derivation, and the claim set (`iss`, `aud`,
  `exp`, possibly a `key_id` fingerprint) are not documented in
  this repository. The driver implements the **most conservative
  RFC-7519 shape** (`{alg:"EdDSA", typ:"JWT"}` header, `{iss, aud,
  iat, exp}` body, base64url segments joined by `.`, raw 64-byte
  signature) and surfaces every uncertainty as a soft-fail
  (`return 2` → UNCERTAIN under `strict=false`). The developer
  verifies the exact wire shape against a manual `curl` against
  the live endpoint before merge.

## Decision

### 1. New driver — `tests/e2e/lib/llm_judge_drivers/ollama-cloud.sh`

One file per backend, per ADR 0007 §1. Implements the same two
functions as `anthropic.sh` and `claude-code.sh`.

#### 1a. `auth_mode` matrix

| `auth_mode` | Source of credential                                                              | Soft-fail (`rc=2`) trigger                                  |
|-------------|-----------------------------------------------------------------------------------|--------------------------------------------------------------|
| `api_key`   | env var named by `JUDGE_API_KEY_ENV` (default `OLLAMA_API_KEY`)                   | env var unset or empty                                       |
| `keypair`   | `${CREWRIG_E2E_HOME}/ollama/id_ed25519` (private key registered by `e2e:auth:ollama`) | file missing, unreadable, unsafe perms, signing fails, token-exchange HTTP non-2xx |

Any other `JUDGE_AUTH_MODE` value → `rc=1` (hard) with an
`_e2e_assert_diag` line, mirroring the `claude-code` driver's
default arm.

Default: `api_key` (preserves today's behaviour for users who set
the env var; new users following the keypair path opt in via
`local.toml`).

#### 1b. `_preflight` — `api_key` arm

Identical to `anthropic.sh`:

```bash
key_env="${JUDGE_API_KEY_ENV:-OLLAMA_API_KEY}"
api_key="${!key_env:-}"
[[ -z "$api_key" ]] && return 2
printf 'AUTH_TOKEN=%s\n' "$api_key"; return 0
```

#### 1c. `_preflight` — `keypair` arm

1. **Locate the keypair.**
   `key_path="${OLLAMA_KEYPAIR_PATH:-${CREWRIG_E2E_HOME:-$HOME/.crewrig-e2e}/ollama/id_ed25519}"`.
   The env override matches the `CLAUDE_CREDENTIALS_PATH` precedent
   from ADR 0008 §2: it lets the harness or a developer point at an
   alternate keypair without symlinking.
2. **Permission check (`0177` mask).** Same `stat`-based dual-call
   pattern as `claude-code.sh:36`. Any non-owner bit set → `rc=2`
   with a `# WARN llm_judge_driver_ollama-cloud: keypair file <path>
   has unsafe permissions (<perms>) — refusing` line. SSH-style
   `0600` is the only accepted shape.
3. **Sign a JWT.** UNVERIFIED — claim set hypothesis:

   ```text
   header  = {"alg":"EdDSA","typ":"JWT"}
   body    = {"iss":"crewrig-e2e","aud":"api.ollama.ai",
              "iat":<now>,"exp":<now + 60>}
   message = base64url(header) + "." + base64url(body)
   sig     = openssl pkeyutl -sign -inkey <key_path> -rawin -in <message>
   jwt     = message + "." + base64url(sig)
   ```

   Notes on the chosen toolchain:

   - `openssl pkeyutl -rawin -sign` is the standard path for Ed25519
     in OpenSSL 1.1.1+ (PureEdDSA — Ed25519 forbids pre-hashing). The
     developer verifies the installed `openssl` is ≥ 1.1.1 in the
     base image; if the base image ships an older OpenSSL, this
     surfaces a parity gap that this ADR does NOT try to paper over
     — the driver MUST refuse with `rc=1` rather than silently
     producing a malformed signature.
   - base64url is `base64 | tr '+/' '-_' | tr -d '='`, no padding.
   - The `kid` header field is intentionally omitted in the
     hypothesis; if the token exchange rejects the JWT for a missing
     `kid`, the developer derives one from the public key
     fingerprint (`openssl pkey -in <key>.pub -pubout -outform DER |
     sha256sum`) and updates the ADR accordingly.
4. **Exchange JWT for bearer token.** UNVERIFIED endpoint —
   hypothesis: `POST https://api.ollama.ai/v1/auth/token` with
   `Authorization: Bearer <jwt>`, expecting
   `{access_token: "...", expires_in: <seconds>}` or
   `{token: "..."}` (the driver tries `.access_token // .token //
   empty`). Any HTTP non-2xx, jq-parse failure, or empty token →
   `rc=2` with a `# WARN` line naming the failure.
5. **Emit token.** `printf 'AUTH_TOKEN=%s\n' "$bearer"; return 0`.
   Wrap the `printf` in `{ set +x; } 2>/dev/null` / `{ set -x; }`
   the same way `claude-code.sh:70-72` does so script traces do
   not leak the token.

#### 1d. `_call` — completions request

Body shape (OpenAI-compatible):

```json
{
  "model": "<model>",
  "temperature": <temperature>,
  "max_tokens": <max_tokens>,
  "messages": [
    {"role": "user",
     "content": "You are an LLM judge for an end-to-end test framework. … VERDICT=<…> CONF=<…>"}
  ]
}
```

The prompt body text is copy-equivalent to `anthropic.sh:65-73` — same
PROMPT / SUBJECT / CRITERION framing, same single-line response
contract. Intentional duplication per ADR 0007 §1 (one self-contained
file per backend).

Request:

```bash
curl -sS --fail-with-body -X POST "$endpoint" \
  -H @<(printf 'Authorization: Bearer %s\n' "$api_key") \
  -H "content-type: application/json" \
  -d "$body"
```

The process-substitution header pattern is borrowed from
`claude-code.sh:131-134` so the bearer token never appears in
`curl`'s argv. Same two-attempt retry loop as the other drivers.

Response parsing:

```bash
text="$(printf '%s' "$raw" | jq -r '.choices[0].message.content' 2>/dev/null || true)"
```

Verdict extraction is unchanged — the same `grep -oE
'VERDICT=…CONF=…'` regex used by the other two drivers, in the same
caller-records-UNCERTAIN-on-malformed-output discipline (ADR 0007 §3).

### 2. Endpoint fallback

The committed default in `tests/e2e/defaults.toml` is the Anthropic
Messages endpoint
(`https://api.anthropic.com/v1/messages`). A user who switches
`backend = "ollama-cloud"` in `local.toml` without also overriding
`endpoint` would otherwise POST a chat-completions body to the
Anthropic Messages URL — guaranteed failure for a non-obvious reason.

The driver's `_call` therefore performs a one-line fallback **before**
calling curl:

```bash
case "$endpoint" in
  "" | "https://api.anthropic.com/v1/messages")
    endpoint="https://api.ollama.ai/v1/chat/completions"   # UNVERIFIED — confirm at PR time
    ;;
esac
```

This is a driver-local concern — the core loader stays generic and
does NOT branch on `backend`. The fallback is conservative: only the
two values most likely to be wrong are rewritten; any other explicit
value is honored verbatim, which preserves the escape hatch for
self-hosted Ollama Cloud mirrors.

### 3. Config surface

`tests/e2e/defaults.toml` — no field added; the existing `backend`,
`api_key_env`, `auth_mode`, `endpoint`, `model`, `temperature`,
`max_tokens`, `strict`, `max_calls` cover everything. The committed
default value for `auth_mode` (`"api_key"`) and `api_key_env`
(`"ANTHROPIC_JUDGE_API_KEY"`) stay untouched — a user switching to
`ollama-cloud` overrides `api_key_env = "OLLAMA_API_KEY"` in
`local.toml` themselves.

`tests/e2e/local.toml.example` — append two new commented stanzas
illustrating both modes:

```toml
# Ollama Cloud as judge — API key mode.
# Reads the bearer token from $OLLAMA_API_KEY by default.
# [judge]
# backend     = "ollama-cloud"
# auth_mode   = "api_key"
# api_key_env = "OLLAMA_API_KEY"
# model       = "deepseek-v4-pro:cloud"
# endpoint    = "https://api.ollama.ai/v1/chat/completions"   # UNVERIFIED — see ADR 0009
# temperature = 0.0
# strict      = false

# Ollama Cloud as judge — keypair mode.
# Reuses the Ed25519 keypair registered by `task e2e:auth:ollama` at
# ${CREWRIG_E2E_HOME}/ollama/id_ed25519. Override with
# OLLAMA_KEYPAIR_PATH for non-standard locations.
# [judge]
# backend     = "ollama-cloud"
# auth_mode   = "keypair"
# model       = "deepseek-v4-pro:cloud"
# endpoint    = "https://api.ollama.ai/v1/chat/completions"   # UNVERIFIED — see ADR 0009
# temperature = 0.0
# strict      = false
```

### 4. Loader (`tests/e2e/lib/llm_judge.sh`) — no changes required

The `JUDGE_AUTH_MODE` plumbing landed in ADR 0008. Drivers branch on
it themselves; the core stays generic. The `ollama-cloud` driver
introduces a new `auth_mode` *value* (`keypair`) but not a new
field — additive at the driver level only.

The two new env overrides (`OLLAMA_KEYPAIR_PATH` and the default
`OLLAMA_API_KEY` env-var name) are driver-internal and do not need
loader plumbing.

### 5. Threat model

#### 5a. Keypair file disclosure

Same shape as ADR 0008 §4a. The driver refuses any keypair file
whose POSIX permissions exceed `0600`. The `OLLAMA_KEYPAIR_PATH`
override is **trusted input** under the same operator-controls-shell
assumption as `CLAUDE_CREDENTIALS_PATH`: an attacker who can set
both `OLLAMA_KEYPAIR_PATH` and the judge `endpoint` can exfiltrate
any Ed25519 private key on disk by signing a captive JWT and posting
it to an attacker-controlled URL. Mitigation is environmental — a
shell-capable attacker already has more direct paths to the key.

The `0600` check closes the *local other-user* disclosure path; it
does not claim to address the *compromised operator* path.

#### 5b. UNVERIFIED endpoint risk

Until the endpoint URL is empirically confirmed, a typo in this ADR
becomes a typo in the committed default — every contributor who
adopts the keypair mode would POST a signed JWT to that URL. The
mitigation is the `UNVERIFIED —` discipline: the developer
confirms the URL against the upstream Ollama Cloud documentation
before the PR is merged, and patches both the driver and the ADR
text in the same diff if the truth differs. Same playbook as
ADR 0008 §2 for the OAuth credential schema.

#### 5c. JWT replay window

The hypothesis sets `exp = iat + 60`. A 60-second window is short
enough that a stolen JWT has limited replay value, long enough to
tolerate clock skew between the e2e host and Ollama Cloud. If the
upstream service mandates a different window, the developer
adjusts the literal in the same PR as the wire-shape verification.

#### 5d. Trace leakage

`set -x` traces are suppressed around the token emission in
`_preflight` and the curl invocation in `_call`, mirroring the
`claude-code` driver. The JWT itself is *not* a long-lived secret
(60-second `exp`), but the exchanged bearer token IS — both are
protected.

### 6. Backward compatibility

- Users without a `[judge]` block in `local.toml` continue to use
  `anthropic` — no change. The `ollama-cloud` driver is purely
  additive.
- The `auth_mode` field already exists in `defaults.toml` (ADR 0008
  §2). Adding `keypair` as a recognized value is a per-driver
  decision; other drivers continue to reject it as before.
- `OLLAMA_API_KEY` and `OLLAMA_KEYPAIR_PATH` are new env-var
  *names* but neither is set by the framework — they only matter
  when a user opts into the `ollama-cloud` backend.

### 7. ADR scope

A third driver crosses the threshold where the patterns established
by ADRs 0007 and 0008 (driver file, soft-fail-to-UNCERTAIN, on-disk
secret with permission check) become a load-bearing protocol. This
ADR documents:

- The first non-OpenAI-compat-deviating driver (response shape
  parsed with a different `jq` selector).
- The first driver whose secret material requires a **client-side
  signing operation** rather than a plain read.
- The first driver with a UNVERIFIED **endpoint** in the default
  config, requiring the same empirical-confirmation discipline that
  ADR 0008 applied to a UNVERIFIED **on-disk schema**.

## File list

| Path | Change |
|---|---|
| `tests/e2e/lib/llm_judge_drivers/ollama-cloud.sh` | **New.** Two auth-mode arms (`api_key`, `keypair`); OpenAI-compat `_call`. |
| `tests/e2e/local.toml.example` | Append two commented `[judge]` stanzas (api_key + keypair). |
| `docs/adr/0009-judge-ollama-cloud-backend.md` | This file. |
| `scripts/tests/test-e2e-llm-judge-lib.sh` | New cases: api_key happy path, keypair missing → UNCERTAIN, keypair bad perms → UNCERTAIN, signing failure → UNCERTAIN, token-exchange failure → UNCERTAIN, endpoint fallback applied. |
| `tests/e2e/lib/README.md` | One-paragraph note pointing at ADR 0009. |

## Non-goals

- **No loader change.** Core `llm_judge.sh` stays untouched; the
  `JUDGE_AUTH_MODE` plumbing from ADR 0008 is sufficient.
- **No `defaults.toml` change.** The `[judge]` defaults remain
  anthropic-centric; ollama-cloud is local-override-only until a
  separate decision elevates it.
- **No streaming responses.** OpenAI-compat `stream: true` is out of
  scope; the judge wants a single short response.
- **No token caching.** Each `_preflight` mints a fresh JWT and
  exchanges it for a bearer token. The judge runs at most
  `max_calls` times per scenario (default 30), the token-exchange
  cost is negligible, and caching would require a state file with
  its own permission discipline.
- **No multi-key fallback.** The driver tries exactly one keypair
  path. Users with multiple Ollama accounts override the env var
  per invocation.
- **No bundled-component changes.** Nothing under `community-config/`
  is touched; `scripts/build-components.sh` is not required.
- **No version bump.** No `community-config/skills/*/SKILL.md` or
  `community-config/agents/*/AGENT.md` is modified.

## Blast radius

- **Files modified on `main` today:** 2 (`local.toml.example`,
  `test-e2e-llm-judge-lib.sh`).
- **Files added:** 2 (the driver and this ADR). Optionally a
  one-paragraph note in `tests/e2e/lib/README.md`.
- **Public-contract additions:**
  - New `ollama-cloud` backend value — additive.
  - New `keypair` `auth_mode` value — additive, only recognized by
    this driver.
  - New `OLLAMA_KEYPAIR_PATH` env override — additive.
  - New default-name `OLLAMA_API_KEY` for `api_key_env` under this
    backend — additive (committed default stays
    `ANTHROPIC_JUDGE_API_KEY`).
- **Risks:**
  1. **UNVERIFIED endpoint URL** — wrong default would silently
     mis-route every keypair-mode contributor. Mitigated by the
     empirical confirmation gate before merge.
  2. **UNVERIFIED JWT shape** — wrong claim set means token
     exchange fails 100 %. Surfaces immediately on the first run;
     `rc=2` → UNCERTAIN under `strict=false` means scenarios still
     pass-through, the warning is loud.
  3. **OpenSSL version skew** — `openssl pkeyutl -rawin` requires
     ≥ 1.1.1. Driver fails closed (`rc=1`) on older versions
     rather than producing a malformed signature.
  4. **Token-exchange rate limiting** — minting one JWT per
     `_preflight` is fine at scenario-runtime cadence; pathological
     CI loops that re-source the driver per iteration would burn
     quota. Out of scope; documented in the threat-model section
     as a follow-up if it surfaces.
- **Reversibility:** Easy. Delete the driver file and the
  `local.toml.example` stanzas; defaults are untouched.

## Consequences

**Gained:**

- Contributors who already ran `task e2e:auth:ollama` can use the
  Ollama Cloud judge with zero new secrets.
- A second OpenAI-compat backend establishes the response-parsing
  pattern (`.choices[0].message.content`) that future drivers
  (OpenAI proper, Groq, Together, …) can copy.
- Third driver against the ADR 0007 contract validates the
  one-file-per-backend discipline at scale — no core changes
  required, even for a backend with non-trivial auth.

**Still unknown (must resolve before merge):**

- Exact Ollama Cloud completions endpoint URL.
- Exact JWT claim set, header (`kid` requirement?), and
  token-exchange endpoint path / response shape.
- Whether the bearer token returned by the exchange has a TTL
  worth honoring (the current driver does not parse `expires_in`;
  if upstream returns minutes-scale TTLs and the judge runs longer
  than that, a re-mint loop becomes necessary).
