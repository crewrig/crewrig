# shellcheck disable=SC2317  # functions are sourced, not executed here
# bash32-array-guard.sh — shared detector for the empty-array guard rule.
#
# Sourced by BOTH the enforcement script (`scripts/check-bash32-portability.sh`)
# and the test suite (`scripts/tests/test-check-bash32-portability.sh`). It must
# therefore be safe to run under `set -euo pipefail` (the enforcement's regime)
# as well as under the suite's `set -uo pipefail` (no -e). Every `grep` lookup
# here that can legitimately return exit 1 on "no match" carries `|| true`, so a
# missing match cannot abort the caller under `set -e`.
#
# This file is itself inside scripts/, so it is governed by the rule it enforces.
# It contains no unguarded `${name[@]}` / `${name[*]}` expansion: the detector's
# own `grep -oF` literals build subscripts from a scalar (`${_bx_nm}[${_bx_sub}]`)
# at runtime, which the scan's `\[[@*]` anchor does not match, and every mention
# of the closed forms in prose sits in a comment that `strip_comments` removes.

# strip_comments <line> — echo <line> with any trailing comment removed. A `#`
# that begins a word (start of line, or preceded by a space or tab) outside a
# quoted string opens a comment; everything from there to end of line is dropped.
# Quote-aware so a `#` inside a single- or double-quoted string is literal (it
# does not open a comment), and a backslash-escaped `\"` inside double quotes is
# a literal quote that does not toggle the quote state. Purely substring
# arithmetic — no external commands — so it is identical on Bash 3.2 and 5.x.
strip_comments() {
  _sc_line="$1"
  _sc_out=''
  _sc_in_single=0
  _sc_in_double=0
  _sc_len=${#_sc_line}
  _sc_i=0
  while [ "$_sc_i" -lt "$_sc_len" ]; do
    _sc_ch="${_sc_line:$_sc_i:1}"
    case "$_sc_ch" in
      "'")
        if [ "$_sc_in_double" -eq 0 ]; then
          if [ "$_sc_in_single" -eq 1 ]; then _sc_in_single=0; else _sc_in_single=1; fi
        fi
        _sc_out="${_sc_out}'"
        ;;
      '"')
        if [ "$_sc_in_single" -eq 0 ]; then
          # A backslash-escaped quote inside double quotes is a literal quote
          # and does not toggle state; any other quote toggles it.
          _sc_prev=''
          [ "$_sc_i" -gt 0 ] && _sc_prev="${_sc_line:$_sc_i-1:1}"
          if [ "$_sc_prev" = '\' ]; then
            :
          else
            if [ "$_sc_in_double" -eq 1 ]; then _sc_in_double=0; else _sc_in_double=1; fi
          fi
        fi
        _sc_out="${_sc_out}\""
        ;;
      '#')
        if [ "$_sc_in_single" -eq 0 ] && [ "$_sc_in_double" -eq 0 ]; then
          _sc_prev=''
          [ "$_sc_i" -gt 0 ] && _sc_prev="${_sc_line:$_sc_i-1:1}"
          if [ "$_sc_i" -eq 0 ] || [ "$_sc_prev" = ' ' ] || [ "$_sc_prev" = "$(printf '\t')" ]; then
            break
          fi
        fi
        _sc_out="${_sc_out}#"
        ;;
      *)
        _sc_out="${_sc_out}${_sc_ch}"
        ;;
    esac
    _sc_i=$((_sc_i + 1))
  done
  printf '%s' "$_sc_out"
}

# bare_expansions_in <line> — echo the `name[subscript]` of every array expansion
# on the line that would abort under `set -u` when the array is empty, or nothing
# when the line is safe. Used by the enforcement scan and probed by the suite.
#
# It works by CONSUMPTION, not by tallying, and that distinction is the whole
# history of this function. Three successive tally designs each left a hole:
#
#   1. Per line, guarded-vs-bare counts: a guard anywhere on the line hid a bare
#      expansion elsewhere on it.
#   2. Per line with comment lines dropped: fixed a false positive, not the tally.
#   3. Per array name: narrowed *who* could spend the slack without removing it.
#
# The slack is a property of the guard SPELLING. `${A[@]+"${A[@]}"}` contains one
# closed `${A[@]}` and is worth one; `${A[*]:-}` contains no closed form and is
# worth zero — so on `"${A[*]:-} ${A[@]}"` any tally balances while `A` is bare.
# That shape reproduces the very false green this ticket exists to remove:
# `A=(); s="${A[*]:-}"; out=$(printf '%s' "${A[@]}")` prints
# `A[@]: unbound variable` to stderr and still exits 0.
#
# So: count the closed forms `${name[@]}` / `${name[*]}`, then subtract only the
# ones a complete canonical guard `${name[@]+"${name[@]}"}` accounts for. Anything
# left is genuinely bare. `${name[*]:-…}` contributes no closed form, so it needs
# no special case. Matching is done with `grep -oF` on literals built per name, so
# there is no regex to escape and no BSD-versus-GNU divergence to reason about.
#
# Deliberately not matched, all verified safe on an empty array under `set -u` on
# 3.2.57: `${#name[@]}` (length), `${name[@]:1}` (slice), `${!name[@]}` (keys).
bare_expansions_in() {
  _bx_line="$1"
  _bx_out=''
  # Array names on the line, deduplicated. `tr -d` rather than a sed capture:
  # BSD sed reads `\{` as an interval and errors "braces not balanced".
  _bx_names=$(printf '%s\n' "$_bx_line" \
    | grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*\[' | tr -d '${[' | sort -u) || true
  for _bx_nm in $_bx_names; do
    for _bx_sub in '@' '*'; do
      # Braced interpolation (`${var}[`) rather than `$var[`: the latter is a
      # literal string being built for `grep -oF`, but shellcheck reads it as an
      # array expansion and raises SC1087 at error level.
      _bx_closed=$(printf '%s\n' "$_bx_line" \
        | grep -oF "\${${_bx_nm}[${_bx_sub}]}" | wc -l | tr -d ' ') || true
      _bx_wrapped=$(printf '%s\n' "$_bx_line" \
        | grep -oF "\${${_bx_nm}[${_bx_sub}]+\"\${${_bx_nm}[${_bx_sub}]}\"}" \
        | wc -l | tr -d ' ') || true
      if [ "$_bx_closed" -gt "$_bx_wrapped" ]; then
        _bx_out="${_bx_out}${_bx_nm}[${_bx_sub}] "
      fi
    done
  done
  # Trailing space trimmed without a bashism, so the caller can test -n cleanly.
  printf '%s' "$_bx_out" | sed -e 's/[[:space:]]*$//'
}

# array_guard_scan <repo-dir> — walk every `*.sh` file under scripts/ and hooks/
# and emit, per unguarded expansion, one line:
#   <dir>/<file>:<line>:<name[subscript]>
# where <line> is the source line with comments stripped. Emits nothing when the
# tree is clean. `acknowledged-exception:` lines are skipped on the RAW line,
# before comment stripping, mirroring the declared-set scan's escape hatch. Sets:
#   ARRAY_GUARD_SH_FILES  — number of *.sh files walked (fail-closed signal)
#   ARRAY_GUARD_HITS      — the collected hit text ("" when clean)
# Both are read by the enforcement script after the call.
array_guard_scan() {
  _ag_repo="$1"
  ARRAY_GUARD_SH_FILES=0
  ARRAY_GUARD_HITS=''
  for _ag_d in scripts hooks; do
    [ -d "$_ag_repo/$_ag_d" ] || continue
    _ag_files="$( find "$_ag_repo/$_ag_d" -type f -name '*.sh' 2>/dev/null )"
    while IFS= read -r _ag_f || [ -n "$_ag_f" ]; do
      [ -n "$_ag_f" ] || continue
      ARRAY_GUARD_SH_FILES=$((ARRAY_GUARD_SH_FILES + 1))
      _ag_fname="${_ag_f#$_ag_repo/}"
      # Candidate lines only — those containing a `${name[@` / `${name[*`. The
      # `|| true` is safe here: a no-match (exit 1) is a legitimate empty result
      # and the loop body simply continues.
      _ag_raw="$( grep -nE '\$\{[A-Za-z_][A-Za-z0-9_]*\[[@*]' \
        "$_ag_f" 2>/dev/null )" || true
      [ -n "$_ag_raw" ] || continue
      while IFS= read -r _ag_ln || [ -n "$_ag_ln" ]; do
        [ -n "$_ag_ln" ] || continue
        _ag_lineno="${_ag_ln%%:*}"
        _ag_content="${_ag_ln#*:}"
        case "$_ag_content" in
          *'acknowledged-exception:'*) continue ;;
        esac
        _ag_stripped="$( strip_comments "$_ag_content" )"
        _ag_hit="$( bare_expansions_in "$_ag_stripped" )"
        [ -n "$_ag_hit" ] || continue
        ARRAY_GUARD_HITS="${ARRAY_GUARD_HITS}${_ag_fname}:$_ag_lineno:$_ag_hit
"
      done <<EOF
$_ag_raw
EOF
    done <<EOF
$_ag_files
EOF
  done
}
