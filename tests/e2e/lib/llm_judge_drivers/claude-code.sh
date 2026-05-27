#!/usr/bin/env bash
# tests/e2e/lib/llm_judge_drivers/claude-code.sh — Claude Code judge driver.
#
# Reuses the OAuth credential minted by `task e2e:auth:claude` (ADR 0002)
# to call the Anthropic Messages API as the judge, without requiring a
# separate ANTHROPIC_JUDGE_API_KEY. See ADR 0008 for the full design.
#
# Contract: same as ADR 0007 §1 (identical to anthropic.sh). Branches on
# JUDGE_AUTH_MODE — "oauth" reads the access token from
# ${CLAUDE_CREDENTIALS_PATH:-$HOME/.claude/.credentials.json}; "api_key"
# falls back to the indirect-expansion path used by anthropic.sh.
#
# E2E_JUDGE_MOCK=1 short-circuits both functions, mirroring anthropic.sh.

_llm_judge_driver_claude-code_preflight() {
  if [[ "${E2E_JUDGE_MOCK:-0}" == "1" ]]; then
    printf 'AUTH_TOKEN=mock\n'
    return 0
  fi

  local mode="${JUDGE_AUTH_MODE:-api_key}"
  case "$mode" in
    oauth)
      local cred_path="${CLAUDE_CREDENTIALS_PATH:-$HOME/.claude/.credentials.json}"
      if [[ ! -r "$cred_path" ]]; then
        # Soft auth-missing → core maps to UNCERTAIN.
        return 2
      fi
      # UNVERIFIED — Claude Code's on-disk schema is not formally
      # documented in this repository. The conventional upstream layout
      # places the access token at `.claudeAiOauth.accessToken` and the
      # expiry (in ms since epoch) at `.claudeAiOauth.expiresAt`. If the
      # observed schema differs, update both the jq selector and
      # docs/adr/0008-judge-oauth-auth-mode.md in the same PR.
      local token
      token="$(jq -r '.claudeAiOauth.accessToken // empty' "$cred_path" 2>/dev/null || true)"
      if [[ -z "$token" ]]; then
        return 2
      fi
      local expires_at now_ms
      expires_at="$(jq -r '.claudeAiOauth.expiresAt // empty' "$cred_path" 2>/dev/null || true)"
      if [[ -n "$expires_at" && "$expires_at" =~ ^[0-9]+$ ]]; then
        now_ms=$(( $(date +%s) * 1000 ))
        if (( expires_at < now_ms )); then
          printf '# WARN claude-code judge: OAuth token expired (re-run `task e2e:auth:claude`)\n' >&2
          return 2
        fi
      fi
      printf 'AUTH_TOKEN=%s\n' "$token"
      return 0
      ;;
    api_key)
      local key_env="${JUDGE_API_KEY_ENV:-ANTHROPIC_JUDGE_API_KEY}"
      local api_key="${!key_env:-}"
      if [[ -z "$api_key" ]]; then
        return 2
      fi
      printf 'AUTH_TOKEN=%s\n' "$api_key"
      return 0
      ;;
    *)
      _e2e_assert_diag \
        "claude-code preflight" \
        "JUDGE_AUTH_MODE in {oauth, api_key}" \
        "JUDGE_AUTH_MODE=${mode}"
      return 1
      ;;
  esac
}

_llm_judge_driver_claude-code_call() {
  local model="$1" endpoint="$2" api_key="$3" max_tokens="$4" temperature="$5"
  local prompt="$6" subject="$7" criterion="$8"
  local mock="${9:-}"
  local body raw text verdict
  if [[ "$mock" == "mock" ]]; then
    raw="${E2E_JUDGE_MOCK_RESPONSE:-}"
    text="$raw"
  else
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
      raw="$(curl -sS --fail-with-body -X POST "$endpoint" \
              -H "Authorization: Bearer ${api_key}" \
              -H "content-type: application/json" \
              -d "$body" 2>&1)" && break
      attempt=$(( attempt + 1 ))
      sleep 1
    done
    if (( attempt >= 2 )); then
      # HTTP failure persists; surface to caller as malformed slot.
      return 1
    fi
    _llm_judge_counter_increment
    text="$(printf '%s' "$raw" | jq -r '.content[0].text' 2>/dev/null || true)"
  fi
  # Extract canonical line.
  verdict="$(printf '%s' "$text" | grep -oE 'VERDICT=(PASS|FAIL|UNCERTAIN)[[:space:]]+CONF=[0-9]+(\.[0-9]+)?' | head -n1 || true)"
  if [[ -z "$verdict" ]]; then
    return 1
  fi
  printf '%s\n' "$verdict"
}
