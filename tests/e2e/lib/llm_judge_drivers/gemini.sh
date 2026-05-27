#!/usr/bin/env bash
# tests/e2e/lib/llm_judge_drivers/gemini.sh — Gemini judge driver.
#
# Reuses the OAuth refresh-token credential minted by `task e2e:auth:gemini`
# (ADR 0009) to obtain a short-lived access token against Google's OAuth2
# token endpoint, then calls the Gemini `generateContent` API as the judge.
# Falls back to an API-key path (`api_key_env` indirect expansion) for
# environments that have a static `GEMINI_API_KEY` available.
#
# Contract: same as ADR 0007 §1. Branches on JUDGE_AUTH_MODE:
#   - "oauth"   → read refresh_token + clientId + clientSecret from
#                 ${GEMINI_CREDENTIALS_PATH:-$HOME/.crewrig-e2e/gemini/oauth_creds.json},
#                 exchange them for an access_token at
#                 https://oauth2.googleapis.com/token, emit it via AUTH_TOKEN=.
#   - "api_key" → indirect expansion of JUDGE_API_KEY_ENV (default GEMINI_API_KEY).
#
# E2E_JUDGE_MOCK=1 short-circuits both functions.
#
# JUDGE_GCP_PROJECT (optional) — when non-empty, propagated to the
# `x-goog-user-project` HTTP header. Required for some GCP quota projects;
# safe to omit otherwise.

_llm_judge_driver_gemini_preflight() {
  if [[ "${E2E_JUDGE_MOCK:-0}" == "1" ]]; then
    printf 'AUTH_TOKEN=mock\n'
    return 0
  fi

  local mode="${JUDGE_AUTH_MODE:-api_key}"
  case "$mode" in
    api_key)
      local key_env="${JUDGE_API_KEY_ENV:-GEMINI_API_KEY}"
      local api_key="${!key_env:-}"
      if [[ -z "$api_key" ]]; then
        return 2
      fi
      printf 'AUTH_TOKEN=%s\n' "$api_key"
      return 0
      ;;
    oauth)
      local cred_path="${GEMINI_CREDENTIALS_PATH:-$HOME/.crewrig-e2e/gemini/oauth_creds.json}"
      if [[ ! -r "$cred_path" ]]; then
        # Soft auth-missing → core maps to UNCERTAIN.
        return 2
      fi
      # Refuse credentials files with permissions more permissive than
      # 0600 — any group/other read or write bit indicates the token is
      # exposed to other local users. Dual `stat` invocation covers GNU
      # coreutils (Linux) and BSD stat (macOS). The mask 0177 captures
      # every non-owner permission bit; `8#` forces base-8 parsing so
      # leading zeros do not silently coerce to decimal.
      local perms
      perms="$(stat -c '%a' "$cred_path" 2>/dev/null || stat -f '%OLp' "$cred_path" 2>/dev/null || true)"
      if [[ -n "$perms" && "$perms" =~ ^[0-7]+$ ]] && (( 8#$perms & 8#0177 )); then
        printf '# WARN llm_judge_driver_gemini: credentials file %s has unsafe permissions (%s) — refusing\n' \
          "$cred_path" "$perms" >&2
        return 2
      fi
      # UNVERIFIED — see ADR 0009 §3 for schema assumption. The on-disk
      # layout written by `task e2e:auth:gemini` is expected to expose
      # either camelCase (`refreshToken`, `clientId`, `clientSecret`) or
      # snake_case (`refresh_token`, `client_id`, `client_secret`)
      # fields at the top level. Both are accepted; the first non-empty
      # match wins. If the observed schema differs, update both the jq
      # selectors below and docs/adr/0009-*.md in the same PR.
      local refresh_token client_id client_secret
      refresh_token="$(jq -r '.refreshToken // .refresh_token // empty' "$cred_path" 2>/dev/null || true)"
      client_id="$(jq -r '.clientId // .client_id // empty' "$cred_path" 2>/dev/null || true)"
      client_secret="$(jq -r '.clientSecret // .client_secret // empty' "$cred_path" 2>/dev/null || true)"
      if [[ -z "$refresh_token" || -z "$client_id" || -z "$client_secret" ]]; then
        printf '# WARN gemini judge: oauth_creds.json missing refreshToken/clientId/clientSecret\n' >&2
        return 2
      fi
      # Suppress `set -x` tracing around the token exchange so neither
      # the refresh_token nor the resulting access_token leaks into a
      # script trace.
      { set +x; } 2>/dev/null
      local token_resp access_token curl_rc=0
      token_resp="$(curl -sS --fail-with-body -X POST https://oauth2.googleapis.com/token \
        --data-urlencode "grant_type=refresh_token" \
        --data-urlencode "refresh_token=${refresh_token}" \
        --data-urlencode "client_id=${client_id}" \
        --data-urlencode "client_secret=${client_secret}" 2>&1)" || curl_rc=$?
      if (( curl_rc != 0 )); then
        { set -x; } 2>/dev/null
        printf '# WARN gemini judge: OAuth token refresh failed (curl rc=%s)\n' "$curl_rc" >&2
        return 2
      fi
      access_token="$(printf '%s' "$token_resp" | jq -r '.access_token // empty' 2>/dev/null || true)"
      if [[ -z "$access_token" ]]; then
        { set -x; } 2>/dev/null
        printf '# WARN gemini judge: OAuth token refresh failed (no access_token in response)\n' >&2
        return 2
      fi
      printf 'AUTH_TOKEN=%s\n' "$access_token"
      { set -x; } 2>/dev/null
      return 0
      ;;
    *)
      _e2e_assert_diag \
        "gemini preflight" \
        "JUDGE_AUTH_MODE in {oauth, api_key}" \
        "JUDGE_AUTH_MODE=${mode}"
      return 1
      ;;
  esac
}

_llm_judge_driver_gemini_call() {
  local model="$1" endpoint="$2" auth="$3" max_tokens="$4" temperature="$5"
  local prompt="$6" subject="$7" criterion="$8"
  local mock="${9:-}"
  local body raw text verdict url
  if [[ "$mock" == "mock" ]]; then
    raw="${E2E_JUDGE_MOCK_RESPONSE:-}"
    text="$raw"
  else
    body="$(jq -n \
              --arg prompt "$prompt" \
              --arg subject "$subject" \
              --arg criterion "$criterion" \
              --argjson maxtok "$max_tokens" \
              --argjson temp "$temperature" '
        { contents: [
            { parts: [
                { text: ("You are an LLM judge for an end-to-end test framework. "
                          + "Read the PROMPT, SUBJECT, and CRITERION below, then "
                          + "respond with EXACTLY one line in the form:\n\n"
                          + "  VERDICT=<PASS|FAIL|UNCERTAIN> CONF=<0.00-1.00>\n\n"
                          + "No prose, no markdown, no trailing text.\n\n"
                          + "PROMPT:\n" + $prompt
                          + "\n\nSUBJECT:\n" + $subject
                          + "\n\nCRITERION:\n" + $criterion) }
              ] }
          ],
          generationConfig: { temperature: $temp, maxOutputTokens: $maxtok } }')"
    # Build URL: api_key path appends ?key=...; oauth path uses the bare
    # endpoint and carries the bearer token via Authorization header.
    if [[ "${JUDGE_AUTH_MODE:-api_key}" == "api_key" ]]; then
      url="${endpoint}?key=${auth}"
    else
      url="${endpoint}"
    fi
    # Optional x-goog-user-project header.
    local proj_header=()
    if [[ -n "${JUDGE_GCP_PROJECT:-}" ]]; then
      proj_header=(-H "x-goog-user-project: ${JUDGE_GCP_PROJECT}")
    fi
    local attempt=0
    while (( attempt < 2 )); do
      if [[ "${JUDGE_AUTH_MODE:-api_key}" == "oauth" ]]; then
        # Suppress `set -x` tracing around the curl invocation so the
        # bearer token does not leak into a script trace. The Authorization
        # header is passed via a process substitution so the token never
        # appears in curl's argv (visible via `ps`).
        { set +x; } 2>/dev/null
        raw="$(curl -sS --fail-with-body -X POST "$url" \
                -H @<(printf 'Authorization: Bearer %s\n' "$auth") \
                -H "content-type: application/json" \
                "${proj_header[@]}" \
                -d "$body" 2>&1)" && { { set -x; } 2>/dev/null; break; }
        { set -x; } 2>/dev/null
      else
        raw="$(curl -sS --fail-with-body -X POST "$url" \
                -H "content-type: application/json" \
                "${proj_header[@]}" \
                -d "$body" 2>&1)" && break
      fi
      attempt=$(( attempt + 1 ))
      sleep 1
    done
    if (( attempt >= 2 )); then
      # HTTP failure persists; surface to caller as malformed slot.
      return 1
    fi
    _llm_judge_counter_increment
    text="$(printf '%s' "$raw" | jq -r '.candidates[0].content.parts[0].text' 2>/dev/null || true)"
  fi
  # Extract canonical line.
  verdict="$(printf '%s' "$text" | grep -oE 'VERDICT=(PASS|FAIL|UNCERTAIN)[[:space:]]+CONF=[0-9]+(\.[0-9]+)?' | head -n1 || true)"
  if [[ -z "$verdict" ]]; then
    return 1
  fi
  printf '%s\n' "$verdict"
}
