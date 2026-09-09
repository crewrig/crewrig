#!/usr/bin/env bash
# tests/e2e/lib/probe_c_resolve.sh — probe C (07-guidance-surface)
# outcome resolver. Pure functions, no I/O, no env-var preconditions —
# sourceable in isolation by scripts/tests/test-e2e-probes.sh with synthetic
# cell results (spec 0203 R9-R12).
#
# Closed verdict vocabulary: HONOURED | IGNORED | DISTURBED | INDETERMINATE
# Output format: "<verdict>|<reason-or-empty>"
#
# Cell C1: Copilot CLI (BYOK) — prose naming unserved model (no model: field).
# Cell C2: Copilot CLI (BYOK) — effort: frontmatter key (no model: field).
# Cell C3: Claude Code — guidance requesting specific model + effort.
# Cell C4: Antigravity CLI — guidance requesting specific agy models identifier.

set -o nounset

e2e_probe_c_resolve_c1() {
  local baseline_observed="$1" target_nonce_observed="$2" subagent_responded="$3" symptom_matched="$4"

  if [[ "$baseline_observed" != "true" ]]; then
    printf 'INDETERMINATE|session-broken-or-unresponsive\n'
    return 0
  fi
  if [[ "$target_nonce_observed" == "true" ]]; then
    printf 'IGNORED|prose-inert-subagent-responded\n'
    return 0
  fi
  if [[ "$symptom_matched" == "true" || "$subagent_responded" == "false" ]]; then
    printf 'DISTURBED|prose-disturbs-routing\n'
    return 0
  fi
  printf 'INDETERMINATE|no-discriminating-observation\n'
  return 0
}

e2e_probe_c_resolve_c2() {
  local baseline_observed="$1" target_nonce_observed="$2" subagent_responded="$3" symptom_matched="$4"

  if [[ "$baseline_observed" != "true" ]]; then
    printf 'INDETERMINATE|session-broken-or-unresponsive\n'
    return 0
  fi
  if [[ "$target_nonce_observed" == "true" ]]; then
    printf 'IGNORED|effort-frontmatter-inert\n'
    return 0
  fi
  if [[ "$symptom_matched" == "true" || "$subagent_responded" == "false" ]]; then
    printf 'DISTURBED|effort-frontmatter-disturbs-routing\n'
    return 0
  fi
  printf 'INDETERMINATE|no-discriminating-observation\n'
  return 0
}

e2e_probe_c_resolve_guidance() {
  local baseline_observed="$1" target_nonce_observed="$2" subagent_responded="$3" \
        observed_model="$4" requested_model="$5" control_model="$6"

  if [[ "$baseline_observed" != "true" ]]; then
    printf 'INDETERMINATE|session-broken-or-unresponsive\n'
    return 0
  fi
  if [[ "$target_nonce_observed" != "true" ]]; then
    if [[ "$subagent_responded" == "false" ]]; then
      printf 'DISTURBED|guidance-caused-failure\n'
    else
      printf 'INDETERMINATE|target-nonce-missing\n'
    fi
    return 0
  fi
  if [[ -z "$observed_model" ]]; then
    printf 'INDETERMINATE|no-model-label-in-spawn-marker\n'
    return 0
  fi

  local obs_lc req_lc ctrl_lc
  obs_lc="$(printf '%s' "$observed_model" | tr '[:upper:]' '[:lower:]')"
  req_lc="$(printf '%s' "$requested_model" | tr '[:upper:]' '[:lower:]')"
  ctrl_lc="$(printf '%s' "$control_model" | tr '[:upper:]' '[:lower:]')"

  if [[ "$obs_lc" == *"$req_lc"* ]]; then
    printf 'HONOURED|requested-model-selected\n'
    return 0
  fi
  if [[ -n "$ctrl_lc" && "$obs_lc" == *"$ctrl_lc"* ]] || [[ "$obs_lc" != *"$req_lc"* ]]; then
    printf 'IGNORED|session-or-default-model-selected\n'
    return 0
  fi

  printf 'INDETERMINATE|unrecognized-model-observation\n'
  return 0
}

e2e_probe_c_resolve_c3() {
  e2e_probe_c_resolve_guidance "$@"
}

e2e_probe_c_resolve_c4() {
  e2e_probe_c_resolve_guidance "$@"
}
