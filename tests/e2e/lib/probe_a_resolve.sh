#!/usr/bin/env bash
# tests/e2e/lib/probe_a_resolve.sh — probe A (05-copilot-model-routing)
# verdict resolver. Pure function, no I/O, no env-var preconditions —
# sourceable in isolation by scripts/tests/test-e2e-probes.sh with synthetic
# leg results (spec 0194 R9; PLAN v2 comment 5506614582 step 2's truth table,
# step 6's mutation-resistance requirement, and finding v2-F1).
#
# e2e_probe_a_resolve <control_nonce_observed> <efficacy_nonce_observed> \
#                      <efficacy_symptom_matched> <bearing_nonce_observed> \
#                      <bearing_symptom_matched>
#
#   Each argument is the literal string "true" or "false". Echoes
#   "<verdict>|<reason-or-empty>" on stdout. Rows are tried in order; the
#   first match wins, and the order IS the contract:
#
#   | control | efficacy | efficacy    | bearing | bearing | verdict         |
#   | nonce   | nonce    | symptom     | nonce   | symptom |                 |
#   |---------|----------|-------------|---------|---------|-----------------|
#   | absent  | —        | —           | —       | —       | INDETERMINATE / surface-not-read-or-session-broken |
#   | present | present  | —           | —       | —       | INDETERMINATE / hint-inert-trigger-not-armed |
#   | present | absent   | NOT matched | —       | —       | INDETERMINATE / efficacy-leg-failed-unexplained (v2-F1) |
#   | present | absent   | matched     | present | —       | BUG-ABSENT |
#   | present | absent   | matched     | absent  | matched | BUG-PRESENT |
#   | present | absent   | matched     | absent  | not matched | INDETERMINATE / no-discriminating-observation |
#
#   v2-F1: an efficacy-leg nonce absence is corroborating evidence the
#   `model:` hint is live ONLY when backed by one of the documented symptom
#   strings (docs/cli-matrix.md's "[GAP] Copilot CLI subagent model routing
#   on BYOK/Ollama" bullet, row 4). An uncorroborated absence — a
#   transient timeout, quota exhaustion, a nondeterministic prose reply — is
#   not evidence, and used to fall straight through to row 3/4 (`BUG-ABSENT`
#   reachable on an uncorroborated silence). The row above closes that gap.
#
# Verdict vocabulary: BUG-PRESENT | BUG-ABSENT | INDETERMINATE (spec 0194 R9).

set -o nounset

e2e_probe_a_resolve() {
  local control="$1" efficacy="$2" efficacy_symptom="$3" bearing="$4" bearing_symptom="$5"

  if [[ "$control" != "true" ]]; then
    printf 'INDETERMINATE|surface-not-read-or-session-broken\n'
    return 0
  fi
  if [[ "$efficacy" == "true" ]]; then
    printf 'INDETERMINATE|hint-inert-trigger-not-armed\n'
    return 0
  fi
  # Efficacy nonce absent from here on. v2-F1: require corroboration before
  # treating that absence as proof the hint fired.
  if [[ "$efficacy_symptom" != "true" ]]; then
    printf 'INDETERMINATE|efficacy-leg-failed-unexplained\n'
    return 0
  fi
  if [[ "$bearing" == "true" ]]; then
    printf 'BUG-ABSENT|\n'
    return 0
  fi
  if [[ "$bearing_symptom" == "true" ]]; then
    printf 'BUG-PRESENT|\n'
    return 0
  fi
  printf 'INDETERMINATE|no-discriminating-observation\n'
  return 0
}
