#!/usr/bin/env bash
# tests/e2e/lib/assert.sh — side-effect assertion library for e2e scenarios.
#
# Contract (see docs/adr/0004-e2e-assertion-libs.md, Decisions 1, 2, 6):
#   - Functions return 0 on PASS, 1 on FAIL. No other codes.
#   - PASS is silent. FAIL emits exactly one diagnostic block to stderr,
#     prefixed with "# " so it is TAP-compatible.
#   - `set -euo pipefail` safe when sourced; env vars are only read inside
#     functions, never at source time.
#   - The private `_e2e_assert_diag` helper enforces the failure format.
#
# Sourcing pattern (from a scenario script):
#
#     set -euo pipefail
#     : "${E2E_LIB_DIR:?runner must export E2E_LIB_DIR}"
#     source "${E2E_LIB_DIR}/assert.sh"
#
# Provided assertions:
#   assert_file_exists <path>
#   assert_file_contains <path> <regex>           # POSIX ERE via `grep -E`
#   assert_file_absent <path>
#   assert_exit_code <expected> <actual>
#   assert_drawer_present <wing> <room> <regex>
#   assert_drawer_field <wing> <room> <handoff_key> <field> <expected>
#   assert_git_branch_pushed <remote> <branch>

set -o nounset

# --------------------------------------------------------------------------
# Private helpers (shared, redefined identically by structural.sh and
# llm_judge.sh — see ADR 0004 open risk #5).
# --------------------------------------------------------------------------

_e2e_truncate() {
  # Collapse newlines to spaces, truncate to 200 chars + "…".
  local s="${1-}"
  s="${s//$'\n'/ }"
  if (( ${#s} > 200 )); then
    printf '%s…' "${s:0:200}"
  else
    printf '%s' "$s"
  fi
}

_e2e_assert_diag() {
  # Usage: _e2e_assert_diag <name+argv> <expected> <actual> [<artefact>]
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
# Side-effect assertions.
# --------------------------------------------------------------------------

assert_file_exists() {
  local path="${1:?assert_file_exists: missing <path>}"
  if [[ -e "$path" ]]; then
    return 0
  fi
  _e2e_assert_diag \
    "assert_file_exists ${path}" \
    "path exists" \
    "no such file or directory: ${path}"
  return 1
}

assert_file_absent() {
  local path="${1:?assert_file_absent: missing <path>}"
  if [[ ! -e "$path" ]]; then
    return 0
  fi
  _e2e_assert_diag \
    "assert_file_absent ${path}" \
    "path does not exist" \
    "path exists: ${path}"
  return 1
}

assert_file_contains() {
  local path="${1:?assert_file_contains: missing <path>}"
  local regex="${2:?assert_file_contains: missing <regex>}"
  if [[ ! -e "$path" ]]; then
    _e2e_assert_diag \
      "assert_file_contains ${path} ${regex}" \
      "file readable + ERE match" \
      "no such file: ${path}"
    return 1
  fi
  if grep -E -q -- "$regex" "$path"; then
    return 0
  fi
  local sample=""
  sample="$(head -c 400 "$path" 2>/dev/null || true)"
  _e2e_assert_diag \
    "assert_file_contains ${path} ${regex}" \
    "ERE match: ${regex}" \
    "no match in file (first 400 B: ${sample})"
  return 1
}

assert_exit_code() {
  local expected="${1:?assert_exit_code: missing <expected>}"
  local actual="${2:?assert_exit_code: missing <actual>}"
  if [[ "$expected" == "$actual" ]]; then
    return 0
  fi
  _e2e_assert_diag \
    "assert_exit_code ${expected} ${actual}" \
    "$expected" \
    "$actual"
  return 1
}

# --------------------------------------------------------------------------
# MemPalace probes (ADR 0004 Decision 2, Path P2 — sidecar-less).
#
# Both probes shell out to the `mempalace` binary already in the scenario
# container's PATH (image: crewrig/e2e-mempalace:latest, pipx-installed).
# A future scenario harness (#80) decides whether to pre-spin the sidecar
# (P1) or `docker run --rm` per probe (P2). The library is agnostic to
# that choice — it only requires `mempalace` resolvable on PATH.
# --------------------------------------------------------------------------

_e2e_require_mempalace() {
  # Common preflight for the two MemPalace probes. Returns 0 if `mempalace`
  # is on PATH, non-zero (and emits a diag) otherwise. Caller is expected
  # to propagate the non-zero return as its own FAIL.
  local caller="$1"
  if ! command -v mempalace >/dev/null 2>&1; then
    _e2e_assert_diag \
      "$caller" \
      "mempalace on PATH" \
      "mempalace binary not found — needs crewrig/e2e-mempalace image or pipx install"
    return 1
  fi
  return 0
}

assert_drawer_present() {
  local wing="${1:?assert_drawer_present: missing <wing>}"
  local room="${2:?assert_drawer_present: missing <room>}"
  local regex="${3:?assert_drawer_present: missing <regex>}"
  _e2e_require_mempalace \
    "assert_drawer_present ${wing} ${room} ${regex}" || return 1
  local out=""
  if ! out="$(mempalace search "$regex" --wing "$wing" --room "$room" --results 5 2>&1)"; then
    _e2e_assert_diag \
      "assert_drawer_present ${wing} ${room} ${regex}" \
      "mempalace search exits 0" \
      "mempalace search failed: ${out}"
    return 1
  fi
  if printf '%s\n' "$out" | grep -E -q -- "$regex"; then
    return 0
  fi
  _e2e_assert_diag \
    "assert_drawer_present ${wing} ${room} ${regex}" \
    "drawer matching ERE: ${regex}" \
    "no match in search output: $(printf '%s' "$out" | head -c 200)"
  return 1
}

assert_drawer_field() {
  local wing="${1:?assert_drawer_field: missing <wing>}"
  local room="${2:?assert_drawer_field: missing <room>}"
  local handoff_key="${3:?assert_drawer_field: missing <handoff_key>}"
  local field="${4:?assert_drawer_field: missing <field>}"
  local expected="${5:?assert_drawer_field: missing <expected>}"
  _e2e_require_mempalace \
    "assert_drawer_field ${wing} ${room} ${handoff_key} ${field} ${expected}" \
    || return 1
  local out=""
  if ! out="$(mempalace search "$handoff_key" --wing "$wing" --room "$room" --results 1 2>&1)"; then
    _e2e_assert_diag \
      "assert_drawer_field ${wing} ${room} ${handoff_key} ${field} ${expected}" \
      "mempalace search exits 0" \
      "mempalace search failed: ${out}"
    return 1
  fi
  # Drawer content layout (60-tools.md → Long-Running Task Convention):
  # one `field: value` per line. Match exactly per ADR Decision 2.
  if printf '%s\n' "$out" \
       | grep -E -q -- "^${field}:[[:space:]]+${expected}[[:space:]]*$"; then
    return 0
  fi
  _e2e_assert_diag \
    "assert_drawer_field ${wing} ${room} ${handoff_key} ${field} ${expected}" \
    "${field}: ${expected}" \
    "no matching line in search output: $(printf '%s' "$out" | head -c 200)"
  return 1
}

assert_git_branch_pushed() {
  local remote="${1:?assert_git_branch_pushed: missing <remote>}"
  local branch="${2:?assert_git_branch_pushed: missing <branch>}"
  if ! command -v git >/dev/null 2>&1; then
    _e2e_assert_diag \
      "assert_git_branch_pushed ${remote} ${branch}" \
      "git on PATH" \
      "git binary not found"
    return 1
  fi
  if git ls-remote --exit-code --heads "$remote" "$branch" >/dev/null 2>&1; then
    return 0
  fi
  _e2e_assert_diag \
    "assert_git_branch_pushed ${remote} ${branch}" \
    "remote ref refs/heads/${branch} present on ${remote}" \
    "git ls-remote returned non-zero (branch absent or remote unreachable)"
  return 1
}
