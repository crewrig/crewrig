# ADR 0007 — Pluggable LLM-judge backends

**Status:** Accepted (issue #125)

## Context

`tests/e2e/lib/llm_judge.sh` hardcodes a single Anthropic Messages API
driver: the request body is built inline (`jq -n …`), the response is
parsed with `jq -r '.content[0].text'`, and auth resolution lives in the
public entry-point `llm_judge()`. Adding a second backend (OpenAI,
Ollama, llama.cpp, mock) requires editing the core file, and the
hard-failure on missing auth (line 268-274) regressed warn-only
semantics (#124) — strict-false runs that should emit `# WARN` and exit
0 instead exit 1 with a `# FAIL` diag.

The `[judge]` table in `tests/e2e/defaults.toml` (lines 61-68) already
carries a `backend = "anthropic"` field that is currently ignored. The
config loader (`_llm_judge_load_config`, lines 98-130) does not surface
it, and there is no `temperature` field at all.

## Decision

### 1. Driver contract (two functions per backend)

A judge backend is a sourced file at
`tests/e2e/lib/llm_judge_drivers/<backend>.sh` that defines exactly two
functions, both prefixed with `_llm_judge_driver_<backend>_`:

```text
_llm_judge_driver_<backend>_preflight
  stdin:  (none)
  stdout: a single line "AUTH_TOKEN=<value>" on success, or empty
  stderr: a TAP diagnostic block (via _e2e_assert_diag) on failure
  return: 0 = ready
          2 = auth missing / unresolvable (soft — core maps to UNCERTAIN)
          1 = hard failure (missing binary, unreachable mock, etc.)

_llm_judge_driver_<backend>_call <model> <endpoint> <auth> <max_tokens> <temperature> <prompt> <subject> <criterion> [mock]
  stdout: a single line "VERDICT=<PASS|FAIL|UNCERTAIN> CONF=<0.00-1.00>"
  return: 0 on parseable verdict; 1 on malformed output or persistent
          HTTP error (caller records the slot as UNCERTAIN).
```

The `auth` positional is opaque to the core — drivers that need no
secret (e.g. local Ollama) accept and ignore it.

Drivers MUST warn (to stderr, prefix `# WARN`) when `temperature != 0.0`
is passed but the backend does not honor it.

### 2. Driver discovery — source-or-fail

`llm_judge.sh` resolves the driver at call time:

```bash
local driver_path="${E2E_LIB_DIR}/llm_judge_drivers/${JUDGE_BACKEND}.sh"
[[ -r "$driver_path" ]] || { diag "no driver for backend=${JUDGE_BACKEND}"; return 1; }
# shellcheck source=/dev/null
source "$driver_path"
```

**Alternatives considered.**

- *Option B — keep drivers in `llm_judge.sh` behind a dispatcher.* Keeps
  the surface in one file, but every new backend touches the core and
  breaks the acceptance criterion verbatim ("A new backend can be
  added by sourcing a single driver file — no changes to
  `llm_judge.sh` core").
- *Option C — source if present, fall back to built-in.* Hybrid; reads
  fluently but doubles the test matrix and hides which driver is in
  effect. Rejected — single mechanism is cheaper than two.

**Chosen: A (source-or-fail).** Simplest contract, single source of
truth per backend, parallels how `tests/e2e/lib/{assert,structural}.sh`
are already laid out as siblings.

### 3. Auth-failure → UNCERTAIN mapping

The hard-fail at `llm_judge.sh:268-274` moves into the driver's
`preflight` function. `llm_judge()` calls preflight once before the
quorum loop:

- preflight returns 0 → capture `AUTH_TOKEN` from stdout, enter quorum.
- preflight returns 2 (soft) → skip the quorum loop entirely; synthesize
  the verdict `UNCERTAIN` with `confidence=0.00` and `slots=("auth-missing" × 3)`.
  Strict-mode rule then applies uniformly:
  - `strict=false` → emit `# WARN llm_judge UNCERTAIN reason=auth-missing` to
    stderr, print `VERDICT=UNCERTAIN confidence=0.00` to stdout, return 0.
  - `strict=true`  → emit `# FAIL` diag, return 1.
- preflight returns 1 (hard) → emit `# FAIL` diag, return 1 regardless of
  `strict`. Reserved for genuinely broken environments (missing `curl`,
  unreadable mock fixture) — distinct from "user has not configured a
  key on this machine".

The unified rule, asserted in tests:

| Verdict        | strict=false | strict=true |
|---|---|---|
| PASS           | exit 0       | exit 0      |
| FAIL           | exit 1       | exit 1      |
| UNCERTAIN      | exit 0 (WARN)| exit 1 (FAIL)|
| auth-missing   | exit 0 (WARN)| exit 1 (FAIL)|
| hard preflight | exit 1       | exit 1      |
| cap exceeded   | exit 1       | exit 1      |

### 4. Temperature field

Add to `[judge]` in `defaults.toml`:

```toml
temperature = 0.0    # Forwarded to the backend; warned if unsupported.
```

Loader gains a `JUDGE_TEMPERATURE` line (mirror of existing
`JUDGE_MAX_TOKENS`). The quorum loop forwards it as positional arg #5 of
`_llm_judge_driver_<backend>_call`. The Anthropic driver passes it
through in the request body (`"temperature": $temperature`).

### 5. Backward compatibility

- Users without a `[judge]` block in `local.toml` inherit
  `backend = "anthropic"` from `defaults.toml` — no change.
- The loader still falls back to literal `"anthropic"` if `effective.json`
  cannot be read (defensive, since the field is now load-bearing).
- Users with `ANTHROPIC_JUDGE_API_KEY` set see identical behavior to
  today (acceptance criterion #1).
- Users with NO key set today get `# FAIL` exit 1; after this change,
  with `strict=false` (the default) they get `# WARN` exit 0 — restoring
  the pre-#124 contract.

## Consequences

- **Blast radius (files):**
  - `tests/e2e/lib/llm_judge.sh` — core refactor (loader, preflight call,
    quorum loop, verdict mapping).
  - `tests/e2e/lib/llm_judge_drivers/anthropic.sh` — new file, extracts
    lines 179-230 of current `llm_judge.sh`.
  - `tests/e2e/defaults.toml` — add `temperature` field, refresh comment.
  - `tests/e2e/lib/README.md` — document driver protocol.
  - `scripts/tests/test-e2e-llm-judge-lib.sh` — add cases for the new
    UNCERTAIN-on-auth-missing path and temperature forwarding.

- **Public contract shifts:**
  - `[judge]` table gains `temperature`. Additive; defaults to 0.0.
  - `llm_judge()` exit code on auth-missing changes from 1 → 0 when
    `strict=false`. Restores the pre-#124 contract; documented in the
    PR body and the wrapper's top comment.
  - No new env vars. `E2E_JUDGE_STRICT` and `E2E_JUDGE_MOCK` retain
    today's semantics.

- **Downstream consumers:** Scenario authors who call `llm_judge` see no
  surface change for the happy path. CI gating leg (`strict=true`)
  continues to fail on UNCERTAIN.

- **Reversibility:** Awkward. The driver contract is a new public
  interface; once a third driver ships against it, contract changes
  become a multi-file migration. The `preflight`/`call` split is the
  least committal shape that supports both auth-bearing (Anthropic,
  OpenAI) and auth-less (local Ollama) backends.

- **No bundled mirrors touched.** Nothing under `community-config/` or
  the regenerated `.gemini/` / `.claude/` bundles changes; no
  `scripts/build-components.sh` run required.
