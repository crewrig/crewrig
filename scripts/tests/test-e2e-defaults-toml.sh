#!/usr/bin/env bash
# test-e2e-defaults-toml.sh — Schema integrity for tests/e2e/defaults.toml.
# Locks ADR 0003's committed schema (per-CLI table + required keys).

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "# PASS $1"; PASS=$((PASS + 1)); }
note_fail() { echo "# FAIL $1 — $2"; FAIL=$((FAIL + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULTS="${REPO_DIR}/tests/e2e/defaults.toml"

cd "$REPO_DIR" || exit 1

# --- Case 1: file exists, tracked, valid TOML ----------------------------
if [[ -f "$DEFAULTS" ]]; then
  note_pass "defaults.toml exists"
else
  note_fail "defaults.toml exists" "missing"
  echo "# $PASS passed / $((FAIL + 1)) failed / $SKIP skipped"; exit 1
fi

if git ls-files --error-unmatch tests/e2e/defaults.toml >/dev/null 2>&1; then
  note_pass "defaults.toml is git-tracked"
else
  note_fail "defaults.toml tracked" "ls-files --error-unmatch failed"
fi

if ! command -v yq >/dev/null 2>&1; then
  note_fail "yq dependency" "yq not on PATH — required for the rest"
  echo "# $PASS passed / $FAIL failed / $SKIP skipped"; exit 1
fi

if yq -p=toml -o=json '.' "$DEFAULTS" >/dev/null 2>&1; then
  note_pass "defaults.toml parses as TOML"
else
  note_fail "defaults.toml parses" "yq parse error"
  echo "# $PASS passed / $FAIL failed / $SKIP skipped"; exit 1
fi

JSON="$(yq -p=toml -o=json '.' "$DEFAULTS")"

# --- Case 2: three [cli.*] tables: claude, gemini, copilot --------------
for cli in claude gemini copilot; do
  if jq -e --arg c "$cli" '.cli | has($c)' <<< "$JSON" >/dev/null; then
    note_pass "[cli.$cli] table present"
  else
    note_fail "[cli.$cli] present" "missing"
  fi
done

# --- Case 3: each [cli.*] has required fields ---------------------------
REQUIRED=(image command command_args env_keys mounts)
for cli in claude gemini copilot; do
  for k in "${REQUIRED[@]}"; do
    if jq -e --arg c "$cli" --arg k "$k" '.cli[$c] | has($k)' <<< "$JSON" >/dev/null; then
      note_pass "[cli.$cli].$k present"
    else
      note_fail "[cli.$cli].$k present" "missing"
    fi
  done
done

# --- Case 4: command is an array, not a string -------------------------
for cli in claude gemini copilot; do
  t="$(jq -r --arg c "$cli" '.cli[$c].command | type' <<< "$JSON")"
  if [[ "$t" == "array" ]]; then
    note_pass "[cli.$cli].command is array"
  else
    note_fail "[cli.$cli].command is array" "got type=$t"
  fi
done

# --- Case 5: known image tags ------------------------------------------
declare -A WANT_IMG=( [claude]="crewrig/e2e-claude:latest"
                      [gemini]="crewrig/e2e-gemini:latest"
                      [copilot]="crewrig/e2e-copilot:latest" )
for cli in claude gemini copilot; do
  got="$(jq -r --arg c "$cli" '.cli[$c].image' <<< "$JSON")"
  want="${WANT_IMG[$cli]}"
  if [[ "$got" == "$want" ]]; then
    note_pass "[cli.$cli].image == $want"
  else
    note_fail "[cli.$cli].image" "want=$want got=$got"
  fi
done

# --- Case 6: cli.copilot.mounts is an empty array ----------------------
if jq -e '.cli.copilot.mounts | type == "array" and length == 0' <<< "$JSON" >/dev/null; then
  note_pass "[cli.copilot].mounts is an empty array"
else
  note_fail "[cli.copilot].mounts empty" "got: $(jq -c '.cli.copilot.mounts' <<< "$JSON")"
fi

# --- Case 7: env_keys values match ^[A-Z_][A-Z0-9_]*$ ------------------
bad=""
for cli in claude gemini copilot; do
  while IFS= read -r k; do
    [[ -z "$k" ]] && continue
    if [[ ! "$k" =~ ^[A-Z_][A-Z0-9_]*$ ]]; then
      bad="$bad [cli.$cli]=$k"
    fi
  done < <(jq -r --arg c "$cli" '.cli[$c].env_keys // [] | .[]' <<< "$JSON")
done
if [[ -z "$bad" ]]; then
  note_pass "env_keys values all match ^[A-Z_][A-Z0-9_]*$"
else
  note_fail "env_keys regex" "offenders:$bad"
fi

echo "# $PASS passed / $FAIL failed / $SKIP skipped"
if [[ $FAIL -gt 0 ]]; then exit 1; fi
exit 0
