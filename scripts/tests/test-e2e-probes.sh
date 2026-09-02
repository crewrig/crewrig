#!/usr/bin/env bash
# test-e2e-probes.sh — Structural + resolver regression for the spec 0194
# probe scenarios (05-copilot-model-routing / probe A, 06-agent-surface-
# consumption / probe B). Host-side, no Docker, no credential, no provider
# quota (spec 0194 R19) — safe in CI.
#
# Locks:
#   - each probe directory exists with an executable run.sh, `bash -n`
#     clean, sourcing $E2E_LIB_DIR helpers
#   - probe A's skip path (78, no verdict.json) fires both when the byok_*
#     declaration is absent and when it is declared-but-unbacked
#   - probe A's argv assembly reads the effective per-CLI configuration,
#     not just two scalar keys
#   - scripts/e2e/publish-probe-verdict.sh --dry-run renders every required
#     field
#   - the verdict vocabulary is exactly BUG-PRESENT|BUG-ABSENT|INDETERMINATE
#   - probe A's BUG-ABSENT row is unreachable while hint_efficacy.nonce_observed
#     is true (mutation-resistant: calls the resolver function directly with
#     synthetic leg results — this is spec 0194 PLAN v2 step 6's requirement)
#   - tests/e2e/local.toml.example carries both byok_* keys; defaults.toml
#     carries neither
#   - probe B's cell-outcome vocabulary is exactly
#     consumed|not-consumed|indeterminate, and a cell without its in-cell
#     baseline resolves to indeterminate, never not-consumed (R12)
#   - probe B's ephemeral-home staging path is outside the repository
#     working tree (R4)
#   - publish-probe-verdict.sh --dry-run renders a probe-B-shaped
#     (cells-array) verdict too, including its contradicts array

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "# PASS $1"; PASS=$((PASS + 1)); }
note_fail() { echo "# FAIL $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "# SKIP $1: $2"; SKIP=$((SKIP + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCEN_DIR="${REPO_DIR}/tests/e2e/scenarios"
E2E_LIB_DIR="${REPO_DIR}/tests/e2e/lib"
DEFAULTS_TOML="${REPO_DIR}/tests/e2e/defaults.toml"
LOCAL_EXAMPLE="${REPO_DIR}/tests/e2e/local.toml.example"
PUBLISH_SH="${REPO_DIR}/scripts/e2e/publish-probe-verdict.sh"

command -v jq >/dev/null 2>&1 || { echo "# FAIL jq required — jq not on PATH"; echo "# 0 passed / 1 failed / 0 skipped"; exit 1; }
command -v yq >/dev/null 2>&1 || { echo "# FAIL yq required — yq not on PATH"; echo "# 0 passed / 1 failed / 0 skipped"; exit 1; }

# --- 1. Probe directory structure -------------------------------------------
PROBES=(05-copilot-model-routing 06-agent-surface-consumption)
for p in ${PROBES[@]+"${PROBES[@]}"}; do
  d="${SCEN_DIR}/${p}"
  r="${d}/run.sh"
  if [[ -x "$r" ]]; then
    note_pass "probe '$p' — run.sh exists and is executable"
  else
    note_fail "probe '$p' — run.sh executable" "not -x: $r"
    continue
  fi
  err="$(bash -n "$r" 2>&1)"
  if [[ -z "$err" ]]; then
    note_pass "probe '$p' — bash -n syntax check"
  else
    note_fail "probe '$p' — bash -n syntax check" "$(echo "$err" | tr '\n' '|')"
  fi
  if grep -Eq 'source[[:space:]]+"\$\{?E2E_LIB_DIR\}?/' "$r"; then
    note_pass "probe '$p' — sources \$E2E_LIB_DIR helper"
  else
    note_fail "probe '$p' — sources \$E2E_LIB_DIR helper" "no 'source \"\${E2E_LIB_DIR}/...\"' line found"
  fi
done

# --- 2. Probe A argv assembly reads the effective per-CLI config -----------
RUN_A="${SCEN_DIR}/05-copilot-model-routing/run.sh"
for key in '.cli.copilot.command' '.cli.copilot.mounts' '.cli.copilot.env_keys'; do
  if grep -Fq "$key" "$RUN_A"; then
    note_pass "probe A — argv assembly reads '${key}' from the effective JSON"
  else
    note_fail "probe A — argv assembly reads '${key}'" "no occurrence in $RUN_A"
  fi
done

# --- 3. Probe A skip path — byok_* absent -----------------------------------
TMP_ROOT="$(mktemp -d -t crewrig-probe-a-test.XXXXXX)"
trap 'rm -rf "$TMP_ROOT"' EXIT

RUN_RC=0
run_probe_a() {
  # $1 = effective.json content. Sets globals REPORT_DIR and RUN_RC — NOT
  # invoked via command substitution, which would run this in a subshell
  # and silently drop the REPORT_DIR assignment.
  local json="$1"
  REPORT_DIR="$(mktemp -d "${TMP_ROOT}/report.XXXXXX")"
  local effective="${REPORT_DIR}/effective.json"
  printf '%s' "$json" > "$effective"
  RUN_RC=0
  E2E_LIB_DIR="$E2E_LIB_DIR" \
    E2E_REPORT_DIR="$REPORT_DIR" \
    E2E_CLI="copilot" \
    E2E_IMAGE="crewrig/e2e-copilot:latest" \
    E2E_EFFECTIVE_JSON="$effective" \
    E2E_CREWRIG_E2E_HOME="${TMP_ROOT}/home/.crewrig-e2e" \
    E2E_SCENARIO_DIR="${SCEN_DIR}/05-copilot-model-routing" \
    E2E_RUN_ID="test" \
    bash "$RUN_A" >"${REPORT_DIR}/stdout" 2>"${REPORT_DIR}/stderr" || RUN_RC=$?
}

NO_BYOK_JSON='{"cli":{"copilot":{"image":"crewrig/e2e-copilot:latest","command":["copilot"],"command_args":[],"mounts":[],"env_keys":["COPILOT_GITHUB_TOKEN"]}}}'
run_probe_a "$NO_BYOK_JSON"
rc="$RUN_RC"
if [[ "$rc" -eq 78 ]]; then
  note_pass "probe A — skip (78) when byok_provider/byok_model absent"
else
  note_fail "probe A — skip when byok_* absent" "got rc=$rc; stderr: $(cat "${REPORT_DIR}/stderr" 2>/dev/null | tr '\n' ' ')"
fi
if [[ ! -f "${REPORT_DIR}/verdict.json" ]]; then
  note_pass "probe A — no verdict.json written on byok_* absent"
else
  note_fail "probe A — no verdict.json on byok_* absent" "verdict.json was written"
fi

UNBACKED_JSON='{"cli":{"copilot":{"image":"crewrig/e2e-copilot:latest","command":["copilot"],"command_args":[],"mounts":[],"env_keys":["COPILOT_GITHUB_TOKEN"],"byok_provider":"ollama-cloud","byok_model":"deepseek-v4-pro:cloud"}}}'
run_probe_a "$UNBACKED_JSON"
rc="$RUN_RC"
if [[ "$rc" -eq 78 ]]; then
  note_pass "probe A — skip (78) when byok_* declared but command unchanged from defaults"
else
  note_fail "probe A — skip when byok_* declared-but-unbacked" "got rc=$rc; stderr: $(cat "${REPORT_DIR}/stderr" 2>/dev/null | tr '\n' ' ')"
fi
if [[ ! -f "${REPORT_DIR}/verdict.json" ]]; then
  note_pass "probe A — no verdict.json written on declared-but-unbacked"
else
  note_fail "probe A — no verdict.json on declared-but-unbacked" "verdict.json was written"
fi

# Wrong CLI — applies_to is ["copilot"] only.
rc=0
REPORT_DIR="$(mktemp -d "${TMP_ROOT}/report.XXXXXX")"
effective="${REPORT_DIR}/effective.json"
printf '%s' "$NO_BYOK_JSON" > "$effective"
E2E_LIB_DIR="$E2E_LIB_DIR" \
  E2E_REPORT_DIR="$REPORT_DIR" \
  E2E_CLI="claude" \
  E2E_IMAGE="crewrig/e2e-claude:latest" \
  E2E_EFFECTIVE_JSON="$effective" \
  E2E_CREWRIG_E2E_HOME="${TMP_ROOT}/home/.crewrig-e2e" \
  E2E_SCENARIO_DIR="${SCEN_DIR}/05-copilot-model-routing" \
  E2E_RUN_ID="test" \
  bash "$RUN_A" >"${REPORT_DIR}/stdout" 2>"${REPORT_DIR}/stderr" || rc=$?
if [[ "$rc" -eq 78 ]]; then
  note_pass "probe A — skip (78) for a non-copilot CLI"
else
  note_fail "probe A — skip for non-copilot CLI" "got rc=$rc"
fi

# --- 4. publish-probe-verdict.sh --dry-run renders required fields ---------
SAMPLE_VERDICT='{
  "probe": "05-copilot-model-routing", "spec": "0194",
  "run_id": "test-1", "observed_at": "2026-09-02T00:00:00Z",
  "verdict": "BUG-PRESENT", "reason": null,
  "cli": "copilot", "cli_version": "1.0.51",
  "declared_provider": "ollama-cloud", "declared_model": "deepseek-v4-pro:cloud",
  "effective_command": ["bash", "-c", "OLLAMA_API_KEY=*** ollama launch copilot", "sh"],
  "credential_path": "COPILOT_GITHUB_TOKEN",
  "surface": ".claude/agents/", "layout": "nested (.claude/agents/<n>/AGENT.md)",
  "legs": {
    "control_no_hint": {"model_value": null, "nonce_observed": true, "evidence": "x"},
    "hint_efficacy": {"model_value": "crewrig-probe-no-such-model", "nonce_observed": false, "evidence": "x"},
    "model_bearing": {"model_value": "sonnet", "nonce_observed": false, "evidence": "not found on provider (HTTP 404)"}
  },
  "upstream_issue": "github/copilot-cli#4437"
}'
VERDICT_DIR="$(mktemp -d "${TMP_ROOT}/verdict.XXXXXX")"
printf '%s' "$SAMPLE_VERDICT" > "${VERDICT_DIR}/verdict.json"
RENDERED="$(bash "$PUBLISH_SH" "$VERDICT_DIR" --issue 1103 --dry-run 2>&1)"
for field in 'hint_efficacy' 'surface' 'effective_command' 'BUG-PRESENT'; do
  if grep -Fq "$field" <<<"$RENDERED"; then
    note_pass "publish-probe-verdict.sh --dry-run — renders '${field}'"
  else
    note_fail "publish-probe-verdict.sh --dry-run — renders '${field}'" "not found in rendered body"
  fi
done

# --- 5. Verdict vocabulary is exactly BUG-PRESENT|BUG-ABSENT|INDETERMINATE --
if grep -Eq 'BUG-PRESENT.*BUG-ABSENT.*INDETERMINATE' "$RUN_A"; then
  note_pass "probe A — verdict vocabulary documented as BUG-PRESENT|BUG-ABSENT|INDETERMINATE"
else
  note_fail "probe A — verdict vocabulary" "expected all three literals, in that order, in a single line of $RUN_A"
fi

# --- 6. Resolver truth table — mutation-resistant, direct function call ----
RESOLVER="${E2E_LIB_DIR}/probe_a_resolve.sh"
if [[ -f "$RESOLVER" ]]; then
  note_pass "probe A resolver — tests/e2e/lib/probe_a_resolve.sh present"
else
  note_fail "probe A resolver — present" "missing at $RESOLVER"
fi

resolve() {
  bash -c "source '$RESOLVER'; e2e_probe_a_resolve '$1' '$2' '$3' '$4' '$5'"
}

# Row 1: control absent → INDETERMINATE.
got="$(resolve false false false false false)"
[[ "$got" == "INDETERMINATE|surface-not-read-or-session-broken" ]] \
  && note_pass "resolver — control nonce absent → INDETERMINATE/surface-not-read-or-session-broken" \
  || note_fail "resolver — row 1" "got: $got"

# Row 2: control present, efficacy present → INDETERMINATE (hint inert).
got="$(resolve true true false false false)"
[[ "$got" == "INDETERMINATE|hint-inert-trigger-not-armed" ]] \
  && note_pass "resolver — efficacy nonce present → INDETERMINATE/hint-inert-trigger-not-armed" \
  || note_fail "resolver — row 2" "got: $got"

# v2-F1: efficacy absent but UNCORROBORATED (no symptom match) → INDETERMINATE,
# never BUG-ABSENT or BUG-PRESENT, regardless of the bearing leg's own result.
got="$(resolve true false false true false)"
[[ "$got" == "INDETERMINATE|efficacy-leg-failed-unexplained" ]] \
  && note_pass "resolver (v2-F1) — efficacy absent+uncorroborated, bearing present → INDETERMINATE/efficacy-leg-failed-unexplained, not BUG-ABSENT" \
  || note_fail "resolver (v2-F1) — uncorroborated efficacy absence, bearing present" "got: $got"

got="$(resolve true false false false true)"
[[ "$got" == "INDETERMINATE|efficacy-leg-failed-unexplained" ]] \
  && note_pass "resolver (v2-F1) — efficacy absent+uncorroborated, bearing symptom → INDETERMINATE/efficacy-leg-failed-unexplained, not BUG-PRESENT" \
  || note_fail "resolver (v2-F1) — uncorroborated efficacy absence, bearing symptom" "got: $got"

# BUG-ABSENT only reachable when efficacy nonce is absent AND corroborated.
got="$(resolve true false true true false)"
[[ "$got" == "BUG-ABSENT|" ]] \
  && note_pass "resolver — efficacy absent+corroborated, bearing present → BUG-ABSENT" \
  || note_fail "resolver — BUG-ABSENT row" "got: $got"

# The mutation the reviewer of v1 would have performed by hand: BUG-ABSENT
# must be UNREACHABLE while hint_efficacy.nonce_observed is true, for every
# combination of the remaining three booleans.
unreachable_ok=true
for bearing in true false; do
  for bearing_symptom in true false; do
    got="$(resolve true true false "$bearing" "$bearing_symptom")"
    verdict="${got%%|*}"
    if [[ "$verdict" == "BUG-ABSENT" ]]; then
      unreachable_ok=false
      note_fail "resolver — BUG-ABSENT unreachable while efficacy nonce present" \
        "control=true efficacy=true bearing=$bearing bearing_symptom=$bearing_symptom → $got"
    fi
  done
done
[[ "$unreachable_ok" == "true" ]] \
  && note_pass "resolver — BUG-ABSENT is unreachable while hint_efficacy.nonce_observed is true (exhaustive)"

# BUG-PRESENT only reachable when efficacy absent+corroborated, bearing absent+symptom.
got="$(resolve true false true false true)"
[[ "$got" == "BUG-PRESENT|" ]] \
  && note_pass "resolver — efficacy absent+corroborated, bearing absent+symptom → BUG-PRESENT" \
  || note_fail "resolver — BUG-PRESENT row" "got: $got"

got="$(resolve true false true false false)"
[[ "$got" == "INDETERMINATE|no-discriminating-observation" ]] \
  && note_pass "resolver — efficacy absent+corroborated, bearing absent+no symptom → INDETERMINATE/no-discriminating-observation" \
  || note_fail "resolver — no-discriminating-observation row" "got: $got"

# --- 7. local.toml.example carries both byok_* keys; defaults.toml carries neither
if grep -q 'byok_provider' "$LOCAL_EXAMPLE" && grep -q 'byok_model' "$LOCAL_EXAMPLE"; then
  note_pass "local.toml.example — declares byok_provider and byok_model under [cli.copilot]"
else
  note_fail "local.toml.example — byok_* keys" "missing in $LOCAL_EXAMPLE"
fi

DEFAULTS_COPILOT_JSON="$(yq -p=toml -o=json '.cli.copilot' "$DEFAULTS_TOML")"
if jq -e 'has("byok_provider") or has("byok_model") | not' <<<"$DEFAULTS_COPILOT_JSON" >/dev/null; then
  note_pass "defaults.toml — [cli.copilot] declares neither byok_provider nor byok_model"
else
  note_fail "defaults.toml — byok_* absent" "one or both keys present: $DEFAULTS_COPILOT_JSON"
fi

# --- 8. Probe B resolver — cell-outcome vocabulary (spec 0194 R12-R14) ------
PROBE_B_RESOLVER="${E2E_LIB_DIR}/probe_b_resolve.sh"
if [[ -f "$PROBE_B_RESOLVER" ]]; then
  note_pass "probe B resolver — tests/e2e/lib/probe_b_resolve.sh present"
else
  note_fail "probe B resolver — present" "missing at $PROBE_B_RESOLVER"
fi

resolve_b() {
  bash -c "source '$PROBE_B_RESOLVER'; e2e_probe_b_resolve_cell '$1' '$2'"
}

got="$(resolve_b true true)"
[[ "$got" == "consumed" ]] \
  && note_pass "probe B resolver — nonce observed → consumed" \
  || note_fail "probe B resolver — consumed row" "got: $got"

got="$(resolve_b true false)"
[[ "$got" == "consumed" ]] \
  && note_pass "probe B resolver — nonce observed even without baseline → still consumed" \
  || note_fail "probe B resolver — consumed without baseline" "got: $got"

got="$(resolve_b false true)"
[[ "$got" == "not-consumed" ]] \
  && note_pass "probe B resolver — nonce absent, baseline present → not-consumed" \
  || note_fail "probe B resolver — not-consumed row" "got: $got"

# R12: "never omitted from the record" — a broken session (no baseline
# either) must resolve to indeterminate, NEVER not-consumed. This is the
# row a reviewer would mutate by hand to check.
got="$(resolve_b false false)"
[[ "$got" == "indeterminate" ]] \
  && note_pass "probe B resolver — nonce absent AND baseline absent → indeterminate, never not-consumed" \
  || note_fail "probe B resolver — indeterminate row" "got: $got"

# --- 9. Probe B ephemeral-home staging is outside the repository tree (R4) --
if grep -Eq 'mktemp[[:space:]]+-d[[:space:]]+"\$\{TMPDIR:-/tmp\}' "${E2E_LIB_DIR}/copilot_ephemeral_home.sh"; then
  note_pass "copilot_ephemeral_home.sh — stages under \$TMPDIR (outside the repository working tree)"
else
  note_fail "copilot_ephemeral_home.sh — staging root" "no mktemp -d under \${TMPDIR:-/tmp} found"
fi
if grep -q 'E2E_REPORT_DIR' "${E2E_LIB_DIR}/copilot_ephemeral_home.sh"; then
  note_fail "copilot_ephemeral_home.sh — must not stage under \$E2E_REPORT_DIR" \
    "found a reference to E2E_REPORT_DIR in the staging helper"
else
  note_pass "copilot_ephemeral_home.sh — does not stage under \$E2E_REPORT_DIR"
fi

# --- 10. publish-probe-verdict.sh --dry-run renders probe B's cells + contradicts
SAMPLE_B_VERDICT='{
  "probe": "06-agent-surface-consumption", "spec": "0194",
  "run_id": "test-b-1", "observed_at": "2026-09-02T00:00:00Z",
  "cells": [
    {"cli": "copilot", "layout": ".claude/agents/ (nested)", "outcome": "not-consumed"},
    {"cli": "claude", "layout": ".claude/agents/ (flat)", "outcome": "consumed"}
  ],
  "contradicts": ["specs/0143-copilot-subagent-model-fallback.md -> ## Intent"]
}'
VERDICT_B_DIR="$(mktemp -d "${TMP_ROOT}/verdict-b.XXXXXX")"
printf '%s' "$SAMPLE_B_VERDICT" > "${VERDICT_B_DIR}/verdict.json"
RENDERED_B="$(bash "$PUBLISH_SH" "$VERDICT_B_DIR" --issue 1103 --dry-run 2>&1)"
for field in 'not-consumed' 'consumed' 'Contradicts' 'specs/0143'; do
  if grep -Fq "$field" <<<"$RENDERED_B"; then
    note_pass "publish-probe-verdict.sh --dry-run (probe B shape) — renders '${field}'"
  else
    note_fail "publish-probe-verdict.sh --dry-run (probe B shape) — renders '${field}'" "not found in rendered body"
  fi
done

echo ""
echo "# $PASS passed / $FAIL failed / $SKIP skipped"
if [[ $FAIL -gt 0 ]]; then exit 1; fi
exit 0
