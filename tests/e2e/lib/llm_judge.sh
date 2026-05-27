#!/usr/bin/env bash
# tests/e2e/lib/llm_judge.sh — LLM-as-judge oracle for e2e scenarios.
#
# Contract (ADR 0004 Decision 4, ADR 0007):
#
#   llm_judge <prompt-file> <subject-file> <criterion>
#
#   stdout (single line): "VERDICT=<PASS|FAIL|UNCERTAIN> confidence=<0.00-1.00>"
#   exit code:
#     0 — PASS
#     1 — FAIL  (or UNCERTAIN when strict mode is on)
#     0 — UNCERTAIN  (default mode: warn-only)
#     0 — auth-missing (default mode: warn-only; strict mode upgrades to 1)
#
#   Config (read from ${E2E_REPORT_DIR}/effective.json `.judge.*` when the
#   runner has populated it; falls back to compiled defaults otherwise):
#     backend      — driver file selector under llm_judge_drivers/; default "anthropic"
#     model        — backend-specific model id; default "claude-sonnet-4-6"
#     api_key_env  — env var holding the API key; default "ANTHROPIC_JUDGE_API_KEY"
#     strict       — false → UNCERTAIN warns; true → UNCERTAIN fails
#     max_calls    — per-run hard cap on backend API calls (default 30)
#     temperature  — forwarded to the backend driver (default 0.0; deterministic)
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
  local backend="anthropic"
  local model="claude-sonnet-4-6"
  local api_key_env="ANTHROPIC_JUDGE_API_KEY"
  local strict="false"
  local max_calls="30"
  local endpoint="https://api.anthropic.com/v1/messages"
  local max_tokens="256"
  local temperature="0.0"
  local cfg=""
  if [[ -n "${E2E_REPORT_DIR:-}" ]] \
       && [[ -f "${E2E_REPORT_DIR}/effective.json" ]] \
       && command -v jq >/dev/null 2>&1; then
    cfg="${E2E_REPORT_DIR}/effective.json"
    backend="$(jq -r '.judge.backend // "anthropic"' "$cfg" 2>/dev/null \
              || printf 'anthropic')"
    model="$(jq -r '.judge.model // "claude-sonnet-4-6"' "$cfg" 2>/dev/null \
              || printf 'claude-sonnet-4-6')"
    api_key_env="$(jq -r '.judge.api_key_env // "ANTHROPIC_JUDGE_API_KEY"' "$cfg" 2>/dev/null \
              || printf 'ANTHROPIC_JUDGE_API_KEY')"
    strict="$(jq -r '.judge.strict // false' "$cfg" 2>/dev/null || printf 'false')"
    max_calls="$(jq -r '.judge.max_calls // 30' "$cfg" 2>/dev/null || printf '30')"
    endpoint="$(jq -r '.judge.endpoint // "https://api.anthropic.com/v1/messages"' "$cfg" 2>/dev/null \
              || printf 'https://api.anthropic.com/v1/messages')"
    max_tokens="$(jq -r '.judge.max_tokens // 256' "$cfg" 2>/dev/null || printf '256')"
    temperature="$(jq -r '.judge.temperature // 0.0' "$cfg" 2>/dev/null || printf '0.0')"
  fi
  # E2E_JUDGE_STRICT overrides TOML.
  if [[ "${E2E_JUDGE_STRICT:-0}" == "1" ]]; then
    strict="true"
  fi
  printf 'JUDGE_BACKEND=%q\n' "$backend"
  printf 'JUDGE_MODEL=%q\n' "$model"
  printf 'JUDGE_API_KEY_ENV=%q\n' "$api_key_env"
  printf 'JUDGE_STRICT=%q\n' "$strict"
  printf 'JUDGE_MAX_CALLS=%q\n' "$max_calls"
  printf 'JUDGE_ENDPOINT=%q\n' "$endpoint"
  printf 'JUDGE_MAX_TOKENS=%q\n' "$max_tokens"
  printf 'JUDGE_TEMPERATURE=%q\n' "$temperature"
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
  local JUDGE_BACKEND JUDGE_MODEL JUDGE_API_KEY_ENV JUDGE_STRICT JUDGE_MAX_CALLS
  local JUDGE_ENDPOINT JUDGE_MAX_TOKENS JUDGE_TEMPERATURE
  eval "$(_llm_judge_load_config)"
  # The driver reads JUDGE_API_KEY_ENV via indirect expansion.
  export JUDGE_API_KEY_ENV

  # Compute E2E_LIB_DIR fallback for standalone invocations.
  local lib_dir="${E2E_LIB_DIR:-${BASH_SOURCE[0]%/*}}"

  # Load driver.
  local driver_path="${lib_dir}/llm_judge_drivers/${JUDGE_BACKEND}.sh"
  if [[ ! -r "$driver_path" ]]; then
    _e2e_assert_diag \
      "llm_judge ${prompt_file} ${subject_file} ${criterion}" \
      "driver for backend=${JUDGE_BACKEND} at ${driver_path}" \
      "file not found"
    return 1
  fi
  # shellcheck source=/dev/null
  source "$driver_path"

  # Preflight (auth resolution / tool availability).
  local mock_arg=""
  [[ "${E2E_JUDGE_MOCK:-0}" == "1" ]] && mock_arg="mock"
  local auth_token_line="" auth_token=""
  local pf_rc=0
  auth_token_line="$("_llm_judge_driver_${JUDGE_BACKEND}_preflight")" || pf_rc=$?
  if (( pf_rc == 0 )); then
    auth_token="${auth_token_line#AUTH_TOKEN=}"
  elif (( pf_rc == 2 )); then
    # Soft auth-missing → synthesize UNCERTAIN, apply strict rule uniformly.
    local verdict_am="UNCERTAIN" confidence_am="0.00"
    printf 'VERDICT=%s confidence=%s\n' "$verdict_am" "$confidence_am"
    if [[ "$JUDGE_STRICT" == "true" ]]; then
      _e2e_assert_diag \
        "llm_judge ${prompt_file} ${subject_file} ${criterion}" \
        "judge credentials present (strict mode)" \
        "backend=${JUDGE_BACKEND} auth-missing"
      return 1
    fi
    printf '# WARN llm_judge UNCERTAIN reason=auth-missing backend=%s\n' \
      "$JUDGE_BACKEND" >&2
    return 0
  else
    # Hard preflight failure — always exit 1 regardless of strict.
    _e2e_assert_diag \
      "llm_judge ${prompt_file} ${subject_file} ${criterion}" \
      "preflight success for backend=${JUDGE_BACKEND}" \
      "preflight returned hard failure (rc=${pf_rc})"
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
  local slots=() pass_count=0 fail_count=0 unc_count=0
  local confs=()
  local i raw v c
  for i in 1 2 3; do
    raw=""
    if raw="$("_llm_judge_driver_${JUDGE_BACKEND}_call" \
                "$JUDGE_MODEL" "$JUDGE_ENDPOINT" "$auth_token" \
                "$JUDGE_MAX_TOKENS" "$JUDGE_TEMPERATURE" \
                "$prompt" "$subject" "$criterion" \
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
