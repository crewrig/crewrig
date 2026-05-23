#!/usr/bin/env bash
# tests/e2e/lib/structural.sh — structural assertion library for e2e scenarios.
#
# Contract: identical to tests/e2e/lib/assert.sh. See ADR 0004 Decisions 1, 3, 6.
#
# Provided assertions:
#   assert_stdout_matches <regex> [<file>]        # POSIX ERE; stdin or file
#   assert_json_shape <file> <jq_path> <expected>
#   assert_gitmoji_title <string>                 # PCRE: ^\p{Emoji}…
#
# `assert_stdout_matches` defaults to consuming stdin (the universal call
# site is `<command> | assert_stdout_matches '<re>'`). The optional second
# argument lets a scenario assert against a file already on disk without
# spawning a `cat` subshell — semantically equivalent to
# `assert_file_contains <file> <regex>` from assert.sh.

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
# Structural assertions.
# --------------------------------------------------------------------------

assert_stdout_matches() {
  local regex="${1:?assert_stdout_matches: missing <regex>}"
  local file="${2:-}"
  local input=""
  if [[ -n "$file" ]]; then
    if [[ ! -e "$file" ]]; then
      _e2e_assert_diag \
        "assert_stdout_matches ${regex} ${file}" \
        "file exists" \
        "no such file: ${file}"
      return 1
    fi
    input="$(cat -- "$file")"
  else
    # Drain stdin. Tolerate empty input — it still gets matched against the
    # regex (and an empty input that does not match the regex is a FAIL, as
    # expected for `command | assert_stdout_matches '<re>'`).
    input="$(cat)"
  fi
  if printf '%s' "$input" | grep -E -q -- "$regex"; then
    return 0
  fi
  _e2e_assert_diag \
    "assert_stdout_matches ${regex}${file:+ ${file}}" \
    "ERE match: ${regex}" \
    "no match in input: $(printf '%s' "$input" | head -c 200)"
  return 1
}

assert_json_shape() {
  local file="${1:?assert_json_shape: missing <file>}"
  local jq_path="${2:?assert_json_shape: missing <jq_path>}"
  local expected="${3:?assert_json_shape: missing <expected>}"
  if ! command -v jq >/dev/null 2>&1; then
    _e2e_assert_diag \
      "assert_json_shape ${file} ${jq_path} ${expected}" \
      "jq on PATH" \
      "jq binary not found"
    return 1
  fi
  if [[ ! -e "$file" ]]; then
    _e2e_assert_diag \
      "assert_json_shape ${file} ${jq_path} ${expected}" \
      "file exists" \
      "no such file: ${file}"
    return 1
  fi
  local actual=""
  if ! actual="$(jq -r "$jq_path" "$file" 2>&1)"; then
    _e2e_assert_diag \
      "assert_json_shape ${file} ${jq_path} ${expected}" \
      "jq -r '${jq_path}' returns successfully" \
      "jq error: ${actual}"
    return 1
  fi
  if [[ "$actual" == "$expected" ]]; then
    return 0
  fi
  _e2e_assert_diag \
    "assert_json_shape ${file} ${jq_path} ${expected}" \
    "$expected" \
    "$actual"
  return 1
}

assert_gitmoji_title() {
  # AGENTS.md naming convention: <emoji> <Short description>.
  # GNU grep 3.8 (Debian bookworm in crewrig/e2e-base:latest) ships with
  # PCRE support compiled in; \p{Emoji} works out of the box. Empirically
  # verified 2026-05-23 (ADR 0004 §Decision 3).
  local title="${1:?assert_gitmoji_title: missing <string>}"
  if printf '%s' "$title" \
       | grep -P -q '^\p{Emoji}[\p{Emoji_Modifier}\p{Emoji_Component}]*\s+\S'; then
    return 0
  fi
  _e2e_assert_diag \
    "assert_gitmoji_title ${title}" \
    "leading emoji + whitespace + non-empty text (e.g. '✨ Add foo')" \
    "$title"
  return 1
}
