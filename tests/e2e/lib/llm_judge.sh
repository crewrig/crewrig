#!/usr/bin/env bash
# tests/e2e/lib/llm_judge.sh — LLM-as-judge oracle for e2e scenarios.
#
# Contract (ADR 0004 Decision 4):
#
#   llm_judge <prompt-file> <subject-file> <criterion>
#
#   stdout (single line): "VERDICT=<PASS|FAIL|UNCERTAIN> confidence=<0.00-1.00>"
#   exit code:
#     0 — PASS
#     1 — FAIL  (or UNCERTAIN when strict mode is on)
#     0 — UNCERTAIN  (default mode: warn-only)
#
#   Config (read from ${E2E_REPORT_DIR}/effective.json `.judge.*` when the
#   runner has populated it; falls back to compiled defaults otherwise):
#     model        — Anthropic model id; default "claude-sonnet-4-6"
#     api_key_env  — env var holding the API key; default "ANTHROPIC_JUDGE_API_KEY"
#     strict       — false → UNCERTAIN warns; true → UNCERTAIN fails
#     max_calls    — per-run hard cap on Anthropic Messages API calls (default 30)
#
#   Env overrides:
#     E2E_JUDGE_STRICT=1     — force strict mode regardless of TOML
#
#   Quorum strategy: 3 sequential calls with PASS/PASS and FAIL/FAIL
#   early-exit. UNCERTAIN slot when (a) no 2-of-3 majority, (b) ≥2 malformed
#   outputs after one HTTP retry, or (c) persistent HTTP error.
#
#   Per-run counter: ${E2E_REPORT_DIR}/judge.count, incremented after every
#   API call. Cap is enforced before each call; refusal emits a diag and
#   returns FAIL (exit 1) — a budget exhaustion is a hard error, not a
#   warning, regardless of `strict`.
#
# ### Prompt template
#
# The judge composes a single user message with the structure below. The
# `criterion` is the assertion's free-form question; `subject` is the
# artefact to evaluate; `prompt` is reusable scaffolding (instructions,
# few-shot examples, etc.) supplied by the scenario author.
#
#   You are an LLM judge for an end-to-end test framework. Read the
#   PROMPT, SUBJECT, and CRITERION below, then respond with EXACTLY one
#   line in the form:
#
#     VERDICT=<PASS|FAIL|UNCERTAIN> CONF=<0.00-1.00>
#
#   No prose, no markdown, no trailing text. CONF reflects your confidence
#   in the verdict, not in the subject.
#
#   PROMPT:
#   <contents of <prompt-file>>
#
#   SUBJECT:
#   <contents of <subject-file>>
#
#   CRITERION:
#   <criterion>

set -o nounset

# --------------------------------------------------------------------------
# Private helpers — kept identical to assert.sh (ADR 0004 open risk #5).
# --------------------------------------------------------------------------

_e2e_truncate() {
  local s="${1-}"
  s="${s//$'\n'/ }"
  if (( ${#s} > 200 )); then
    printf '%s…' "${s:0:200}"
  else
    printf '%s' "$s"
  fi
}

_e2e_assert_diag() {
  local name="${1-}" expected="${2-}" actual="${3-}" artefact="${4-}"
  local report_line=""
  if [[ -n "${E2E_REPORT_DIR:-}" ]]; then
    report_line="${E2E_REPORT_DIR}${artefact:+/${artefact}}"
  elif [[ -n "$artefact" ]]; then
    report_line="<unset>/${artefact}"
  fi
  {
    printf '# FAIL %s\n' "$name"
    printf '#   expected: %s\n' "$(_e2e_truncate "$expected")"
    printf '#   actual:   %s\n' "$(_e2e_truncate "$actual")"
    if [[ -n "$report_line" ]]; then
      printf '#   report:   %s\n' "$report_line"
    fi
  } >&2
}

# --------------------------------------------------------------------------
# Config loader. Reads ${E2E_REPORT_DIR}/effective.json via jq if present;
# otherwise returns compiled defaults. Echoes one shell `local`-style
# `KEY=value` per line; caller `eval`s the result.
# --------------------------------------------------------------------------

_llm_judge_load_config() {
  local model="claude-sonnet-4-6"
  local api_key_env="ANTHROPIC_JUDGE_API_KEY"
  local strict="false"
  local max_calls="30"
  local endpoint="https://api.anthropic.com/v1/messages"
  local max_tokens="256"
  local cfg=""
  if [[ -n "${E2E_REPORT_DIR:-}" ]] \
       && [[ -f "${E2E_REPORT_DIR}/effective.json" ]] \
       && command -v jq >/dev/null 2>&1; then
    cfg="${E2E_REPORT_DIR}/effective.json"
    model="$(jq -r '.judge.model // "claude-sonnet-4-6"' "$cfg" 2>/dev/null \
              || printf 'claude-sonnet-4-6')"
    api_key_env="$(jq -r '.judge.api_key_env // "ANTHROPIC_JUDGE_API_KEY"' "$cfg" 2>/dev/null \
              || printf 'ANTHROPIC_JUDGE_API_KEY')"
    strict="$(jq -r '.judge.strict // false' "$cfg" 2>/dev/null || printf 'false')"
    max_calls="$(jq -r '.judge.max_calls // 30' "$cfg" 2>/dev/null || printf '30')"
    endpoint="$(jq -r '.judge.endpoint // "https://api.anthropic.com/v1/messages"' "$cfg" 2>/dev/null \
              || printf 'https://api.anthropic.com/v1/messages')"
    max_tokens="$(jq -r '.judge.max_tokens // 256' "$cfg" 2>/dev/null || printf '256')"
  fi
  # E2E_JUDGE_STRICT overrides TOML.
  if [[ "${E2E_JUDGE_STRICT:-0}" == "1" ]]; then
    strict="true"
  fi
  printf 'JUDGE_MODEL=%q\n' "$model"
  printf 'JUDGE_API_KEY_ENV=%q\n' "$api_key_env"
  printf 'JUDGE_STRICT=%q\n' "$strict"
  printf 'JUDGE_MAX_CALLS=%q\n' "$max_calls"
  printf 'JUDGE_ENDPOINT=%q\n' "$endpoint"
  printf 'JUDGE_MAX_TOKENS=%q\n' "$max_tokens"
}

# --------------------------------------------------------------------------
# Counter management. No-op when E2E_REPORT_DIR is unset (standalone use).
# --------------------------------------------------------------------------

_llm_judge_counter_path() {
  if [[ -z "${E2E_REPORT_DIR:-}" ]]; then
    return 1
  fi
  printf '%s/judge.count' "$E2E_REPORT_DIR"
}

_llm_judge_counter_read() {
  local path
  if ! path="$(_llm_judge_counter_path)"; then
    printf '0'
    return 0
  fi
  if [[ -s "$path" ]]; then
    cat -- "$path"
  else
    printf '0'
  fi
}

_llm_judge_counter_increment() {
  local path
  if ! path="$(_llm_judge_counter_path)"; then
    return 0
  fi
  local cur
  cur="$(_llm_judge_counter_read)"
  printf '%s\n' "$(( cur + 1 ))" > "$path"
}

# --------------------------------------------------------------------------
# Single Anthropic Messages API call. Returns 0 on a parseable verdict line
# echoed to stdout in the canonical `VERDICT=… CONF=…` form. Returns 1 on
# malformed output (after one retry on HTTP error) — the caller treats this
# as an UNCERTAIN slot.
#
# Inputs (positional): model, endpoint, api_key, max_tokens, prompt, subject, criterion
# Optional 8th arg: "mock"  — when set, the implementation skips the curl
#                              call and reads the verdict line from
#                              ${E2E_JUDGE_MOCK_RESPONSE} instead. Used by
#                              the library smoke test, never by scenarios.
# --------------------------------------------------------------------------

_llm_judge_one_call() {
  local model="$1" endpoint="$2" api_key="$3" max_tokens="$4"
  local prompt="$5" subject="$6" criterion="$7"
  local mock="${8:-}"
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
              --argjson maxtok "$max_tokens" '
        { model: $model,
          max_tokens: $maxtok,
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

# --------------------------------------------------------------------------
# Public entry-point.
# --------------------------------------------------------------------------

llm_judge() {
  local prompt_file="${1:?llm_judge: missing <prompt-file>}"
  local subject_file="${2:?llm_judge: missing <subject-file>}"
  local criterion="${3:?llm_judge: missing <criterion>}"

  # Preflight: required tools.
  local missing=()
  command -v jq >/dev/null 2>&1 || missing+=("jq")
  command -v curl >/dev/null 2>&1 || missing+=("curl")
  if (( ${#missing[@]} > 0 )); then
    _e2e_assert_diag \
      "llm_judge ${prompt_file} ${subject_file} ${criterion}" \
      "jq + curl on PATH" \
      "missing tools: ${missing[*]}"
    return 1
  fi

  [[ -e "$prompt_file" ]] || { _e2e_assert_diag \
      "llm_judge ${prompt_file} ${subject_file} ${criterion}" \
      "<prompt-file> readable" \
      "no such file: ${prompt_file}"; return 1; }
  [[ -e "$subject_file" ]] || { _e2e_assert_diag \
      "llm_judge ${prompt_file} ${subject_file} ${criterion}" \
      "<subject-file> readable" \
      "no such file: ${subject_file}"; return 1; }

  # Config.
  local JUDGE_MODEL JUDGE_API_KEY_ENV JUDGE_STRICT JUDGE_MAX_CALLS JUDGE_ENDPOINT JUDGE_MAX_TOKENS
  eval "$(_llm_judge_load_config)"

  # API key resolution via indirect expansion.
  local api_key="${!JUDGE_API_KEY_ENV:-}"
  if [[ -z "$api_key" && "${E2E_JUDGE_MOCK:-0}" != "1" ]]; then
    _e2e_assert_diag \
      "llm_judge ${prompt_file} ${subject_file} ${criterion}" \
      "env var ${JUDGE_API_KEY_ENV} set to an Anthropic API key" \
      "${JUDGE_API_KEY_ENV} is unset or empty"
    return 1
  fi

  # Per-run cap.
  local cur_count
  cur_count="$(_llm_judge_counter_read)"
  if (( cur_count >= JUDGE_MAX_CALLS )); then
    _e2e_assert_diag \
      "llm_judge ${prompt_file} ${subject_file} ${criterion}" \
      "judge call count < ${JUDGE_MAX_CALLS}" \
      "per-run cap exceeded (count=${cur_count}); see ${E2E_REPORT_DIR:-<unset>}/judge.count" \
      "judge.count"
    return 1
  fi

  local prompt subject
  prompt="$(cat -- "$prompt_file")"
  subject="$(cat -- "$subject_file")"

  # 2-of-3 sequential quorum.
  local mock_arg=""
  [[ "${E2E_JUDGE_MOCK:-0}" == "1" ]] && mock_arg="mock"
  local slots=() pass_count=0 fail_count=0 unc_count=0
  local confs=()
  local i raw v c
  for i in 1 2 3; do
    raw=""
    if raw="$(_llm_judge_one_call \
                "$JUDGE_MODEL" "$JUDGE_ENDPOINT" "$api_key" \
                "$JUDGE_MAX_TOKENS" "$prompt" "$subject" "$criterion" \
                "$mock_arg")"; then
      v="$(printf '%s' "$raw" | sed -nE 's/.*VERDICT=([A-Z]+).*/\1/p')"
      c="$(printf '%s' "$raw" | sed -nE 's/.*CONF=([0-9]+(\.[0-9]+)?).*/\1/p')"
      slots+=("$v")
      confs+=("$c")
      case "$v" in
        PASS) pass_count=$(( pass_count + 1 )) ;;
        FAIL) fail_count=$(( fail_count + 1 )) ;;
        *)    unc_count=$(( unc_count + 1 )) ;;
      esac
    else
      slots+=("UNCERTAIN")
      confs+=("0.0")
      unc_count=$(( unc_count + 1 ))
    fi
    # Early exit: 2 same verdicts in a row.
    if (( pass_count >= 2 )); then break; fi
    if (( fail_count >= 2 )); then break; fi
  done

  # Determine verdict.
  local verdict confidence
  if (( pass_count >= 2 )); then
    verdict="PASS"
  elif (( fail_count >= 2 )); then
    verdict="FAIL"
  else
    verdict="UNCERTAIN"
  fi

  # Mean confidence over the slots that ran.
  if (( ${#confs[@]} > 0 )); then
    confidence="$(awk -v IFS=' ' 'BEGIN{s=0;n=0} {for (i=1;i<=NF;i++) {s+=$i; n++}} END{ if (n==0) print "0.00"; else printf "%.2f", s/n }' <<<"${confs[*]}")"
  else
    confidence="0.00"
  fi

  printf 'VERDICT=%s confidence=%s\n' "$verdict" "$confidence"

  case "$verdict" in
    PASS) return 0 ;;
    FAIL)
      _e2e_assert_diag \
        "llm_judge ${prompt_file} ${subject_file} ${criterion}" \
        "VERDICT=PASS" \
        "VERDICT=FAIL confidence=${confidence}"
      return 1
      ;;
    UNCERTAIN)
      if [[ "$JUDGE_STRICT" == "true" ]]; then
        _e2e_assert_diag \
          "llm_judge ${prompt_file} ${subject_file} ${criterion}" \
          "VERDICT=PASS (strict mode upgrades UNCERTAIN to FAIL)" \
          "VERDICT=UNCERTAIN confidence=${confidence} (slots: ${slots[*]})"
        return 1
      fi
      printf '# WARN llm_judge UNCERTAIN confidence=%s slots=%s\n' \
        "$confidence" "${slots[*]}" >&2
      return 0
      ;;
  esac
}
