#!/usr/bin/env bash
# test-e2e-scenarios-structure.sh — Structural test for the four pillar
# scenarios scaffolded by issue #80.
#
# Verifies that each scenario directory under tests/e2e/scenarios/ ships
# the contract surface required by the runner (ADR 0005 Decision 3):
#
#   - run.sh exists and is executable
#   - run.sh parses under `bash -n` (no shell-syntax rot)
#   - run.sh sources at least one helper from $E2E_LIB_DIR (proof that
#     it honors the runner-injected library directory)
#   - tests/e2e/scenarios/README.md exists and is non-empty
#   - tests/e2e/defaults.toml declares a [scenarios.<name>] table for
#     every directory present on disk
#
# Host-side, no Docker, no auth. Safe to run in CI.

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "# PASS $1"; PASS=$((PASS + 1)); }
note_fail() { echo "# FAIL $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "# SKIP $1: $2"; SKIP=$((SKIP + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCEN_DIR="${REPO_DIR}/tests/e2e/scenarios"
DEFAULTS_TOML="${REPO_DIR}/tests/e2e/defaults.toml"
README="${SCEN_DIR}/README.md"

SCENARIOS=(01-layered-context 02-cross-tool-memory 03-skill-build 04-harness-loop 05-copilot-model-routing 06-agent-surface-consumption)

# --- 1. Each scenario dir + run.sh present and executable --------------------
for s in ${SCENARIOS[@]+"${SCENARIOS[@]}"}; do
  d="${SCEN_DIR}/${s}"
  r="${d}/run.sh"
  if [[ ! -d "$d" ]]; then
    note_fail "scenario '$s' — directory exists" "missing at $d"
    continue
  fi
  if [[ -x "$r" ]]; then
    note_pass "scenario '$s' — run.sh exists and is executable"
  else
    note_fail "scenario '$s' — run.sh executable" "not -x: $r"
  fi
done

# --- 2. Each run.sh passes `bash -n` syntax check ----------------------------
for s in ${SCENARIOS[@]+"${SCENARIOS[@]}"}; do
  r="${SCEN_DIR}/${s}/run.sh"
  [[ -f "$r" ]] || continue
  err="$(bash -n "$r" 2>&1)"
  if [[ -z "$err" ]]; then
    note_pass "scenario '$s' — bash -n syntax check"
  else
    note_fail "scenario '$s' — bash -n syntax check" "$(echo "$err" | tr '\n' '|')"
  fi
done

# --- 3. Each run.sh sources a helper from $E2E_LIB_DIR -----------------------
# Accept any of: assert.sh, structural.sh, llm_judge.sh (the v1 lib set).
for s in ${SCENARIOS[@]+"${SCENARIOS[@]}"}; do
  r="${SCEN_DIR}/${s}/run.sh"
  [[ -f "$r" ]] || continue
  if grep -Eq 'source[[:space:]]+"\$\{?E2E_LIB_DIR\}?/' "$r" \
     || grep -Eq '\.[[:space:]]+"\$\{?E2E_LIB_DIR\}?/' "$r"; then
    note_pass "scenario '$s' — sources \$E2E_LIB_DIR helper"
  else
    note_fail "scenario '$s' — sources \$E2E_LIB_DIR helper" \
              "no 'source \"\${E2E_LIB_DIR}/...\"' line found"
  fi
done

# --- 4. scenarios/README.md exists and is non-empty --------------------------
if [[ -s "$README" ]]; then
  note_pass "scenarios/README.md — present and non-empty"
else
  note_fail "scenarios/README.md — present and non-empty" "missing or empty: $README"
fi

# --- 5. defaults.toml declares [scenarios.<name>] for each scenario ---------
if [[ ! -f "$DEFAULTS_TOML" ]]; then
  note_fail "defaults.toml — present" "missing at $DEFAULTS_TOML"
else
  for s in ${SCENARIOS[@]+"${SCENARIOS[@]}"}; do
    if grep -Eq "^\[scenarios\.${s}\]" "$DEFAULTS_TOML"; then
      note_pass "defaults.toml — [scenarios.${s}] table present"
    else
      note_fail "defaults.toml — [scenarios.${s}] table present" \
                "no '[scenarios.${s}]' header found"
    fi
  done
fi

# --- 6. Duplicate-mount guard (PLAN v2 step 19) -----------------------------
# A scenario that consumes a CLI's effective `.mounts` array (the
# expand_mount loop) must not ALSO hardcode a `-v` targeting the same
# container path unless the resolved mount string is byte-identical to the
# declared one — a mismatch is fatal (measured in PLAN v2 step 17: same
# target, different source or mode -> docker exit 125 "Duplicate mount
# point"). This is the mutation-resistant form of that measurement: it
# would have caught 01-layered-context's now-removed copilot arm colliding
# with defaults.toml's [cli.copilot].mounts (spec 0194 step 16).
#
# One documented exception: 01-layered-context/claude's hardcoded
# `${rules_dir}:${rules_mount_target}:ro` composition IS byte-identical to
# defaults.toml's own [cli.claude].mounts[0] (both expand
# `${CREWRIG_E2E_HOME}/claude` the same way) — tolerated, not hidden.
#
# A scenario that sources tests/e2e/lib/copilot_ephemeral_home.sh
# implements its own reviewed substitution mechanism for the copilot target
# (v2-F4: never mount the real bundle rw for a probe fixture) rather than a
# hardcoded duplicate, so it is exempted from the copilot check here.
if [[ -f "$DEFAULTS_TOML" ]] && command -v yq >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
  DEFAULTS_JSON="$(yq -p=toml -o=json '.' "$DEFAULTS_TOML" 2>/dev/null)"
  KNOWN_BYTE_IDENTICAL_DUPLICATES=("01-layered-context:claude:/home/agent/.claude")

  for s in ${SCENARIOS[@]+"${SCENARIOS[@]}"}; do
    r="${SCEN_DIR}/${s}/run.sh"
    [[ -f "$r" ]] || continue
    grep -Fq 'expand_mount' "$r" || continue

    uses_ephemeral_home=false
    grep -Fq 'copilot_ephemeral_home.sh' "$r" && uses_ephemeral_home=true

    for cli in claude gemini copilot; do
      if [[ "$cli" == "copilot" && "$uses_ephemeral_home" == "true" ]]; then
        note_pass "scenario '$s' — [cli.copilot] target handled by the reviewed ephemeral-home substitution (v2-F4), not a hardcoded duplicate"
        continue
      fi
      mapfile -t declared_targets < <(jq -r --arg c "$cli" '.cli[$c].mounts // [] | .[] | split(":")[1] // empty' <<<"$DEFAULTS_JSON")
      for target in ${declared_targets[@]+"${declared_targets[@]}"}; do
        [[ -z "$target" ]] && continue
        hits="$(grep -Fv 'expand_mount' "$r" | grep -v '^[[:space:]]*#' | grep -Fc -- "$target" || true)"
        if [[ "$hits" -gt 0 ]]; then
          exception_key="${s}:${cli}:${target}"
          allowed=false
          for k in ${KNOWN_BYTE_IDENTICAL_DUPLICATES[@]+"${KNOWN_BYTE_IDENTICAL_DUPLICATES[@]}"}; do
            [[ "$k" == "$exception_key" ]] && allowed=true && break
          done
          if [[ "$allowed" == "true" ]]; then
            note_pass "scenario '$s' — hardcoded '$target' for [cli.$cli] is the documented byte-identical duplicate"
          else
            note_fail "scenario '$s' — no undocumented duplicate mount to [cli.$cli] target '$target'" \
              "target also declared in defaults.toml [cli.$cli].mounts and is not a documented byte-identical exception — verify the resolved mount string matches exactly, or remove the hardcoded arm (regression class: PLAN v2 step 17)"
          fi
        fi
      done
    done
  done
else
  note_skip "duplicate-mount guard" "yq/jq/defaults.toml unavailable"
fi

echo ""
echo "# $PASS passed / $FAIL failed / $SKIP skipped"
[[ "$FAIL" -eq 0 ]]
