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
#   - probe A's row-1 fallback control, and probe B's cell 3 (its
#     independently-authored twin), each stage an ephemeral home and never
#     mount the real persisted credential bundle directly (finding v2-F4;
#     added by the DEV-stage tester audit of #1103 — neither call site had
#     a hermetic regression guard before, though the hazard is a static
#     property, not a live-only one, so R19 does not exempt it)
#   - tests/e2e/run.sh brackets every scenario case with
#     e2e_ensure_bundle_dir before / e2e_assert_bundle_modes after, in BOTH
#     the delegation and the legacy direct-docker branch (R5; same audit)
#   - tests/e2e/lib/mask_command.sh masks both bypass shapes the tester
#     audit found in the first implementation (a flag-style --key=value
#     secret; a quoted value containing a space), preserves array element
#     count/order (jq's --args silently drops a literal "-c" element
#     without a trailing "--"), and probe A's run.sh calls the shared
#     function rather than a private re-implementation of it (v2-F3)

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

# --- 2b. Row-1 fallback control (finding v2-F4) never mounts the real
# persisted bundle directly — only the mktemp -d ephemeral home. Structural,
# not live-only (R19): the hazard v2-F4 named is a static property of which
# path feeds `-v`, so a regression here is hermetically detectable. Extracts
# the `if [[ "$CONTROL_OBSERVED" != "true" ]]; then ... fi` block (the row-1
# failure path) by its unindented `fi`, which the nested ifs inside it do
# not match (they're indented).
FALLBACK_BLOCK="$(sed -n '/^if \[\[ "\$CONTROL_OBSERVED" != "true" \]\]; then$/,/^fi$/p' "$RUN_A")"
if [[ -z "$FALLBACK_BLOCK" ]]; then
  note_fail "probe A — row-1 fallback block located" \
            "could not find the CONTROL_OBSERVED-guarded block in $RUN_A"
else
  note_pass "probe A — row-1 fallback block located"
  if grep -Eq '\-v[[:space:]]+"\$\{?bundle_dir\}?' <<<"$FALLBACK_BLOCK"; then
    note_fail "probe A — row-1 fallback never mounts \$bundle_dir directly (v2-F4)" \
              "found a -v mount referencing \$bundle_dir directly — this would write into the developer's real persisted credential bundle"
  else
    note_pass "probe A — row-1 fallback never mounts \$bundle_dir directly (v2-F4)"
  fi
  if grep -Fq 'e2e_stage_copilot_ephemeral_home "$bundle_dir"' <<<"$FALLBACK_BLOCK" \
     && grep -Fq 'e2e_copilot_home_mount_override "$ephemeral_home"' <<<"$FALLBACK_BLOCK"; then
    note_pass "probe A — row-1 fallback stages and mounts the ephemeral home (v2-F4)"
  else
    note_fail "probe A — row-1 fallback ephemeral-home staging (v2-F4)" \
              "expected both a 'e2e_stage_copilot_ephemeral_home \"\$bundle_dir\"' call and a 'e2e_copilot_home_mount_override \"\$ephemeral_home\"' call in the fallback block"
  fi
fi

# --- 2c. Probe B cell 3 (cross-cell control, finding v2-F4's twin) also
# never mounts the real bundle directly — same hazard, same helper, a second
# independently-authored call site (PLAN v2 step 26).
RUN_B="${SCEN_DIR}/06-agent-surface-consumption/run.sh"
EPHEMERAL_BLOCK="$(sed -n '/^  elif \[\[ "\$mount_mode" == "ephemeral-home" \]\]; then$/,/^  fi$/p' "$RUN_B")"
if [[ -z "$EPHEMERAL_BLOCK" ]]; then
  note_fail "probe B — ephemeral-home cell block located" \
            "could not find the mount_mode==ephemeral-home block in $RUN_B"
else
  note_pass "probe B — ephemeral-home cell block located"
  if grep -Eq '\-v[[:space:]]+"\$\{?bundle_dir\}?' <<<"$EPHEMERAL_BLOCK"; then
    note_fail "probe B — cell 3 never mounts \$bundle_dir directly (v2-F4 twin)" \
              "found a -v mount referencing \$bundle_dir directly — this would write into the developer's real persisted credential bundle"
  else
    note_pass "probe B — cell 3 never mounts \$bundle_dir directly (v2-F4 twin)"
  fi
  if grep -Fq 'e2e_stage_copilot_ephemeral_home "$bundle_dir"' <<<"$EPHEMERAL_BLOCK" \
     && grep -Fq 'e2e_copilot_home_mount_override "$ephemeral_home"' <<<"$EPHEMERAL_BLOCK"; then
    note_pass "probe B — cell 3 stages and mounts the ephemeral home (v2-F4 twin)"
  else
    note_fail "probe B — cell 3 ephemeral-home staging (v2-F4 twin)" \
              "expected both a 'e2e_stage_copilot_ephemeral_home \"\$bundle_dir\"' call and a 'e2e_copilot_home_mount_override \"\$ephemeral_home\"' call in the cell 3 block"
  fi
fi

# --- 2d. tests/e2e/run.sh brackets EVERY scenario case with ensure-before /
# assert-after (spec 0194 R5, PLAN v2 step 15) — in BOTH the delegation
# branch and the legacy direct-docker branch. Structural: an
# e2e_ensure_bundle_dir call and its e2e_assert_bundle_modes counterpart must
# each appear exactly twice (once per branch), in ensure-then-assert order —
# not just once, which would silently leave one branch (and one of R10's two
# "requirements 1-7 unrealised" paths, per PLAN v2 step 15) unbracketed.
RUNNER_SH="${REPO_DIR}/tests/e2e/run.sh"
mapfile -t _bracket_calls < <(grep -n 'e2e_ensure_bundle_dir "\$cli"\|e2e_assert_bundle_modes "\$cli"' "$RUNNER_SH" | sed -E 's/^[0-9]+:[[:space:]]*//')
if [[ "${#_bracket_calls[@]}" -eq 4 \
      && "${_bracket_calls[0]}" == 'e2e_ensure_bundle_dir "$cli"' \
      && "${_bracket_calls[1]}" == 'e2e_assert_bundle_modes "$cli"' \
      && "${_bracket_calls[2]}" == 'e2e_ensure_bundle_dir "$cli"' \
      && "${_bracket_calls[3]}" == 'e2e_assert_bundle_modes "$cli"' ]]; then
  note_pass "tests/e2e/run.sh — ensure-before/assert-after brackets both branches (R5)"
else
  note_fail "tests/e2e/run.sh — ensure-before/assert-after brackets both branches (R5)" \
            "expected exactly 2 ensure+assert pairs in ensure,assert,ensure,assert order; got: ${_bracket_calls[*]+"${_bracket_calls[*]}"}"
fi

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
# combination of the remaining THREE booleans (efficacy_symptom included —
# a DEV-stage tester audit caught an earlier version of this loop that
# fixed efficacy_symptom=false and called two varied booleans "exhaustive";
# row 2 of the resolver short-circuits on efficacy alone, before
# efficacy_symptom is ever consulted, so the outcome does not change — but
# the test now proves that rather than assuming it).
unreachable_ok=true
for efficacy_symptom in true false; do
  for bearing in true false; do
    for bearing_symptom in true false; do
      got="$(resolve true true "$efficacy_symptom" "$bearing" "$bearing_symptom")"
      verdict="${got%%|*}"
      if [[ "$verdict" == "BUG-ABSENT" ]]; then
        unreachable_ok=false
        note_fail "resolver — BUG-ABSENT unreachable while efficacy nonce present" \
          "control=true efficacy=true efficacy_symptom=$efficacy_symptom bearing=$bearing bearing_symptom=$bearing_symptom → $got"
      fi
    done
  done
done
[[ "$unreachable_ok" == "true" ]] \
  && note_pass "resolver — BUG-ABSENT is unreachable while hint_efficacy.nonce_observed is true (exhaustive over all 3 remaining booleans)"

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

# --- 11. Command masking (finding v2-F3) survives both bypass shapes -------
# DEV-stage tester audit (high): the first implementation split each
# command-array element on a plain space and masked whole words starting
# with a bare identifier. Two bypasses: (a) a `--flag=value` secret never
# matched (no leading dash allowed), (b) a quoted value containing a space
# was split across words by the naive split, masking only the first
# fragment and leaving the rest of the secret in the clear. Both are
# regression-locked here against the actual shared function, not a
# re-implementation of it.
MASK_LIB="${E2E_LIB_DIR}/mask_command.sh"
if [[ -f "$MASK_LIB" ]]; then
  note_pass "mask_command.sh — tests/e2e/lib/mask_command.sh present"
else
  note_fail "mask_command.sh — present" "missing at $MASK_LIB"
fi

mask_str() {
  bash -c "source '$MASK_LIB'; e2e_mask_command_string \"\$1\"" _ "$1"
}

# Bypass (a): flag-style assignment (--flag=value).
got="$(mask_str 'ollama launch copilot --api-key=sk-abc123 --yes')"
if [[ "$got" == *'--api-key=***'* && "$got" != *'sk-abc123'* ]]; then
  note_pass "mask_command — bypass (a) flag-style secret (--api-key=...) is masked"
else
  note_fail "mask_command — bypass (a) flag-style secret" "got: $got"
fi
# Untouched: a space-separated flag with no '=' carries no secret shape.
if [[ "$got" == *'ollama launch copilot'*'--yes'* ]]; then
  note_pass "mask_command — bypass (a) case leaves non-assignment argv untouched"
else
  note_fail "mask_command — bypass (a) collateral damage" "got: $got"
fi

# Bypass (b): quoted value containing a space.
got="$(mask_str 'OLLAMA_API_KEY="sk secret withspace" ollama serve')"
if [[ "$got" == *'OLLAMA_API_KEY=***'* && "$got" != *'secret withspace'* && "$got" != *'sk secret'* ]]; then
  note_pass "mask_command — bypass (b) quoted value with an internal space is fully masked"
else
  note_fail "mask_command — bypass (b) quoted-with-space secret" "got: $got"
fi

# Assignment right after a shell quote/operator boundary (e.g. inside a
# `bash -c "..."` wrapper), not only at start-of-string or after whitespace.
got="$(mask_str 'bash -c "OLLAMA_MODELS=/tmp/x ollama launch copilot"')"
if [[ "$got" == *'OLLAMA_MODELS=***'* && "$got" != *'/tmp/x'* ]]; then
  note_pass "mask_command — assignment right after an opening quote is masked"
else
  note_fail "mask_command — quote-boundary assignment" "got: $got"
fi

# e2e_mask_command_json preserves element COUNT and ORDER — regression for
# a second bug found while fixing this: jq's --args re-parses a positional
# argument that merely looks like a flag (a literal "-c" element) as one of
# jq's own options unless a bare "--" follows --args, silently dropping it.
JSON_IN='["bash","-c","OLLAMA_API_KEY=\"sk secret\" ollama serve --api-key=sk-xyz","sh"]'
JSON_OUT="$(bash -c "source '$MASK_LIB'; e2e_mask_command_json" <<<"$JSON_IN")"
n_in="$(jq 'length' <<<"$JSON_IN")"
n_out="$(jq 'length' <<<"$JSON_OUT" 2>/dev/null || echo -1)"
if [[ "$n_out" == "$n_in" ]]; then
  note_pass "mask_command_json — preserves element count ($n_in) including a literal '-c' element"
else
  note_fail "mask_command_json — element count preserved" "input had $n_in elements, output '$JSON_OUT' has $n_out"
fi
if jq -e '.[1] == "-c"' <<<"$JSON_OUT" >/dev/null 2>&1; then
  note_pass "mask_command_json — a literal '-c' array element survives (not swallowed by jq --args)"
else
  note_fail "mask_command_json — '-c' element survives" "got: $JSON_OUT"
fi
if grep -q 'sk secret' <<<"$JSON_OUT" || grep -q 'sk-xyz' <<<"$JSON_OUT"; then
  note_fail "mask_command_json — no secret leaks through the full array pipeline" "got: $JSON_OUT"
else
  note_pass "mask_command_json — no secret leaks through the full array pipeline"
fi

# --- 12. Probe A's run.sh calls the shared masking function, not a private
# re-implementation of it (so a future fix here reaches every call site).
if grep -Fq 'e2e_mask_command_json' "$RUN_A" && grep -Fq "source \"\${E2E_LIB_DIR}/mask_command.sh\"" "$RUN_A"; then
  note_pass "probe A — uses the shared e2e_mask_command_json (finding v2-F3)"
else
  note_fail "probe A — uses the shared masking function" \
            "expected both a source of mask_command.sh and a call to e2e_mask_command_json in $RUN_A"
fi

echo ""
echo "# $PASS passed / $FAIL failed / $SKIP skipped"
if [[ $FAIL -gt 0 ]]; then exit 1; fi
exit 0
