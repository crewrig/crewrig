#!/usr/bin/env bash
# tests/e2e/lib/llm_judge_drivers/ollama-cloud.sh — Ollama Cloud judge driver.
#
# Calls Ollama Cloud's OpenAI-compatible chat-completions endpoint as the
# LLM judge. See ADR 0009 for the full design.
#
# Contract: same as ADR 0007 §1 (identical to anthropic.sh / claude-code.sh).
# Branches on JUDGE_AUTH_MODE:
#
#   - "api_key" — reads the env var named by JUDGE_API_KEY_ENV (default
#     OLLAMA_API_KEY) via indirect expansion; that value is sent as a
#     bearer token.
#
#   - "keypair" — reads the Ed25519 private key registered by
#     `task e2e:auth:ollama` (default path
#     ${CREWRIG_E2E_HOME:-$HOME/.crewrig-e2e}/ollama/id_ed25519),
#     constructs an Ed25519-signed JWT assertion, and exchanges it for
#     a short-lived bearer token at the Ollama Cloud auth endpoint.
#
# Env-var overrides:
#
#   OLLAMA_KEYPAIR_PATH         Override keypair path
#                               (default: ${CREWRIG_E2E_HOME}/ollama/id_ed25519)
#   OLLAMA_TOKEN_ENDPOINT       Override token-exchange URL
#                               (default: https://api.ollama.ai/v1/auth/token — UNVERIFIED)
#   OLLAMA_COMPLETIONS_ENDPOINT Override completions URL
#                               (default: https://api.ollama.ai/v1/chat/completions — UNVERIFIED)
#
# E2E_JUDGE_MOCK=1 short-circuits both functions, mirroring anthropic.sh.

_llm_judge_driver_ollama-cloud_preflight() {
  if [[ "${E2E_JUDGE_MOCK:-0}" == "1" ]]; then
    printf 'AUTH_TOKEN=mock\n'
    return 0
  fi

  local mode="${JUDGE_AUTH_MODE:-api_key}"
  case "$mode" in
    api_key)
      local key_env="${JUDGE_API_KEY_ENV:-OLLAMA_API_KEY}"
      local api_key="${!key_env:-}"
      if [[ -z "$api_key" ]]; then
        return 2
      fi
      # Suppress `set -x` tracing around the token emission so the
      # secret does not leak into a script trace.
      { set +x; } 2>/dev/null
      printf 'AUTH_TOKEN=%s\n' "$api_key"
      { set -x; } 2>/dev/null
      return 0
      ;;
    keypair)
      local key_path="${OLLAMA_KEYPAIR_PATH:-${CREWRIG_E2E_HOME:-${HOME}/.crewrig-e2e}/ollama/id_ed25519}"
      if [[ ! -r "$key_path" ]]; then
        return 2
      fi
      # Refuse keypair files with permissions more permissive than 0600.
      # Dual `stat` covers GNU coreutils (Linux) and BSD stat (macOS).
      # Mask 0177 captures every non-owner permission bit; `8#` forces
      # base-8 parsing so leading zeros do not silently coerce to decimal.
      local perms
      perms="$(stat -c '%a' "$key_path" 2>/dev/null || stat -f '%OLp' "$key_path" 2>/dev/null || true)"
      if [[ -n "$perms" && "$perms" =~ ^[0-7]+$ ]] && (( 8#$perms & 8#0177 )); then
        printf '# WARN llm_judge_driver_ollama-cloud: keypair file %s has unsafe permissions (%s) — refusing\n' \
          "$key_path" "$perms" >&2
        return 2
      fi
      if ! command -v openssl >/dev/null 2>&1; then
        printf '# WARN llm_judge_driver_ollama-cloud: `openssl` not on PATH — keypair mode requires OpenSSL >= 1.1.1\n' >&2
        return 2
      fi
      if ! command -v jq >/dev/null 2>&1; then
        printf '# WARN llm_judge_driver_ollama-cloud: `jq` not on PATH\n' >&2
        return 2
      fi

      # UNVERIFIED — JWT claim set (iss, aud) may differ from what Ollama
      # Cloud actually requires; refine once empirical evidence lands.
      local now exp
      now="$(date +%s)"
      exp=$(( now + 60 ))
      local header_b64 payload_b64 signing_input sig_b64 jwt
      header_b64="$(printf '%s' '{"alg":"EdDSA","typ":"JWT"}' \
                      | base64 | tr '+/' '-_' | tr -d '=' | tr -d '\n')"
      payload_b64="$(jq -cn \
                       --arg iss "crewrig-e2e" \
                       --arg aud "api.ollama.ai" \
                       --argjson iat "$now" \
                       --argjson exp "$exp" \
                       '{iss:$iss, aud:$aud, iat:$iat, exp:$exp}' \
                     | base64 | tr '+/' '-_' | tr -d '=' | tr -d '\n')"
      signing_input="${header_b64}.${payload_b64}"

      # UNVERIFIED — `openssl pkeyutl -sign -rawin` requires OpenSSL >= 1.1.1.
      # Suppress `set -x` around the signing step so intermediate bytes
      # do not leak into a script trace.
      { set +x; } 2>/dev/null
      sig_b64="$(printf '%s' "$signing_input" \
                   | openssl pkeyutl -sign -rawin -inkey "$key_path" 2>/dev/null \
                   | base64 | tr '+/' '-_' | tr -d '=' | tr -d '\n')"
      { set -x; } 2>/dev/null
      if [[ -z "$sig_b64" ]]; then
        printf '# WARN llm_judge_driver_ollama-cloud: Ed25519 signing failed\n' >&2
        return 2
      fi
      jwt="${signing_input}.${sig_b64}"

      # Exchange JWT assertion for a short-lived bearer token.
      local token_endpoint="${OLLAMA_TOKEN_ENDPOINT:-https://api.ollama.ai/v1/auth/token}"
      local token_body token_resp token
      token_body="$(jq -cn \
                      --arg gt "urn:ietf:params:oauth:grant-type:jwt-bearer" \
                      --arg assertion "$jwt" \
                      '{grant_type:$gt, assertion:$assertion}')"
      { set +x; } 2>/dev/null
      token_resp="$(curl -sS --fail-with-body -X POST "$token_endpoint" \
                      -H "content-type: application/json" \
                      -d "$token_body" 2>/dev/null || true)"
      if [[ -z "$token_resp" ]]; then
        { set -x; } 2>/dev/null
        printf '# WARN llm_judge_driver_ollama-cloud: token exchange failed at %s\n' "$token_endpoint" >&2
        return 2
      fi
      token="$(printf '%s' "$token_resp" | jq -r '.access_token // .token // empty' 2>/dev/null || true)"
      if [[ -z "$token" ]]; then
        { set -x; } 2>/dev/null
        printf '# WARN llm_judge_driver_ollama-cloud: token exchange response did not include access_token/token\n' >&2
        return 2
      fi
      printf 'AUTH_TOKEN=%s\n' "$token"
      { set -x; } 2>/dev/null
      return 0
      ;;
    *)
      _e2e_assert_diag \
        "ollama-cloud preflight" \
        "JUDGE_AUTH_MODE in {api_key, keypair}" \
        "JUDGE_AUTH_MODE=${mode}"
      return 1
      ;;
  esac
}

_llm_judge_driver_ollama-cloud_call() {
  local model="$1" endpoint="$2" api_key="$3" max_tokens="$4" temperature="$5"
  local prompt="$6" subject="$7" criterion="$8"
  local mock="${9:-}"
  local body raw text verdict

  # If endpoint is empty OR still pointing at the Anthropic default
  # (committed in defaults.toml), override to the Ollama Cloud URL.
  if [[ -z "$endpoint" || "$endpoint" == "https://api.anthropic.com/v1/messages" ]]; then
    endpoint="${OLLAMA_COMPLETIONS_ENDPOINT:-https://api.ollama.ai/v1/chat/completions}"
  fi

  if [[ "$mock" == "mock" ]]; then
    raw="${E2E_JUDGE_MOCK_RESPONSE:-}"
    text="$raw"
  else
    # OpenAI-compatible chat-completions payload.
    body="$(jq -n \
              --arg model "$model" \
              --arg prompt "$prompt" \
              --arg subject "$subject" \
              --arg criterion "$criterion" \
              --argjson maxtok "$max_tokens" \
              --argjson temp "$temperature" '
        { model: $model,
          max_tokens: $maxtok,
          temperature: $temp,
          messages: [
            { role: "user",
              content: ("You are an LLM judge for an end-to-end test framework. "
                        + "Read the PROMPT, SUBJECT, and CRITERION below, then "
                        + "respond with EXACTLY one line in the form:\n\n"
                        + "  VERDICT=<PASS|FAIL|UNCERTAIN> CONF=<0.00-1.00>\n\n"
                        + "No prose, no markdown, no trailing text.\n\n"
                        + "PROMPT:\n" + $prompt
                        + "\n\nSUBJECT:\n" + $subject
                        + "\n\nCRITERION:\n" + $criterion) }
          ] }')"
    local attempt=0
    while (( attempt < 2 )); do
      # Suppress `set -x` tracing around the curl invocation so the
      # bearer token does not leak into a script trace. The Authorization
      # header is passed via a process substitution so the token never
      # appears in curl's argv (visible via `ps`).
      { set +x; } 2>/dev/null
      raw="$(curl -sS --fail-with-body -X POST "$endpoint" \
              -H @<(printf 'Authorization: Bearer %s\n' "$api_key") \
              -H "content-type: application/json" \
              -d "$body" 2>/dev/null)" && { { set -x; } 2>/dev/null; break; }
      { set -x; } 2>/dev/null
      attempt=$(( attempt + 1 ))
      sleep 1
    done
    if (( attempt >= 2 )); then
      # HTTP failure persists; surface to caller as malformed slot.
      return 1
    fi
    _llm_judge_counter_increment
    text="$(printf '%s' "$raw" | jq -r '.choices[0].message.content // empty' 2>/dev/null || true)"
  fi
  # Extract canonical line.
  verdict="$(printf '%s' "$text" | grep -oE 'VERDICT=(PASS|FAIL|UNCERTAIN)[[:space:]]+CONF=[0-9]+(\.[0-9]+)?' | head -n1 || true)"
  if [[ -z "$verdict" ]]; then
    return 1
  fi
  printf '%s\n' "$verdict"
}
