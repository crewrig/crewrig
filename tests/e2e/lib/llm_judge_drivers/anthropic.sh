#!/usr/bin/env bash
# tests/e2e/lib/llm_judge_drivers/anthropic.sh — Anthropic Messages API driver
# for the llm_judge oracle.
#
# Contract (ADR 0007 Decision 1):
#
#   _llm_judge_driver_anthropic_preflight
#     stdin:  (none)
#     stdout: single line "AUTH_TOKEN=<value>" on success, empty on failure
#     stderr: (none — diagnostic surfacing belongs to the core)
#     return: 0 = ready
#             2 = auth missing / unresolvable (soft — core maps to UNCERTAIN)
#             1 = hard failure (unused for Anthropic today)
#
#   _llm_judge_driver_anthropic_call \
#       <model> <endpoint> <auth> <max_tokens> <temperature> \
#       <prompt> <subject> <criterion> [mock]
#     stdout: single line "VERDICT=<PASS|FAIL|UNCERTAIN> CONF=<0.00-1.00>"
#     return: 0 on parseable verdict; 1 on malformed output or persistent
#             HTTP error (caller records the slot as UNCERTAIN).
#
# The driver reads JUDGE_API_KEY_ENV (a name) from the calling shell and
# resolves it via indirect expansion. JUDGE_API_KEY_ENV is exported by the
# core's config loader before this driver is sourced.
#
# E2E_JUDGE_MOCK=1 short-circuits both functions: preflight emits
# AUTH_TOKEN=mock; call reads the verdict line from E2E_JUDGE_MOCK_RESPONSE
# instead of issuing curl. Used by the library smoke test, never by
# scenarios.

_llm_judge_driver_anthropic_preflight() {
  if [[ "${E2E_JUDGE_MOCK:-0}" == "1" ]]; then
    printf 'AUTH_TOKEN=mock\n'
    return 0
  fi
  local key_env="${JUDGE_API_KEY_ENV:-ANTHROPIC_JUDGE_API_KEY}"
  local api_key="${!key_env:-}"
  if [[ -z "$api_key" ]]; then
    return 2
  fi
  printf 'AUTH_TOKEN=%s\n' "$api_key"
  return 0
}

_llm_judge_driver_anthropic_call() {
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
              -H "x-api-key: ${api_key}" \
              -H "anthropic-version: 2023-06-01" \
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
