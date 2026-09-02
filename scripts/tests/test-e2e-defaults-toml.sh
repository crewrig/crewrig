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
  # `${A[@]+…}` per docs/scripting-conventions.md Rule 5: bash 3.2 (stock macOS)
  # treats an empty array as an unset variable and aborts on it under `set -u`.
  for k in ${REQUIRED[@]+"${REQUIRED[@]}"}; do
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
# A `case` rather than an associative-array lookup table: bash 3.2 (stock
# macOS) has no associative arrays, per docs/scripting-conventions.md Rule 5.
# The three tags stay verbatim literals on purpose — deriving them as
# "crewrig/e2e-$cli:latest" would couple this assertion to the very naming
# convention it exists to pin, so it would assert nothing.
for cli in claude gemini copilot; do
  got="$(jq -r --arg c "$cli" '.cli[$c].image' <<< "$JSON")"
  case "$cli" in
    claude)  want="crewrig/e2e-claude:latest" ;;
    gemini)  want="crewrig/e2e-gemini:latest" ;;
    copilot) want="crewrig/e2e-copilot:latest" ;;
    *)       want="(no expected image declared for $cli)" ;;
  esac
  if [[ "$got" == "$want" ]]; then
    note_pass "[cli.$cli].image == $want"
  else
    note_fail "[cli.$cli].image" "want=$want got=$got"
  fi
done

# --- Case 6: cli.copilot.mounts declares exactly one workstation-credential
# passthrough (spec 0194 R1-R3; inverted from "empty array" — the credential
# now has an on-disk bundle to mount, PLAN v2 step 18) ---------------------
if jq -e '.cli.copilot.mounts | type == "array" and length == 1' <<< "$JSON" >/dev/null; then
  note_pass "[cli.copilot].mounts declares exactly one mount"
else
  note_fail "[cli.copilot].mounts exactly one entry" "got: $(jq -c '.cli.copilot.mounts' <<< "$JSON")"
fi
mount0="$(jq -r '.cli.copilot.mounts[0] // ""' <<< "$JSON")"
if [[ "$mount0" == *":/home/agent/.copilot:"* || "$mount0" == *":/home/agent/.copilot" ]]; then
  note_pass "[cli.copilot].mounts[0] targets /home/agent/.copilot"
else
  note_fail "[cli.copilot].mounts[0] container target" "got: $mount0"
fi
if [[ "$mount0" == '${CREWRIG_E2E_HOME}'* ]]; then
  note_pass "[cli.copilot].mounts[0] host side interpolates \${CREWRIG_E2E_HOME}"
else
  note_fail "[cli.copilot].mounts[0] host side" "got: $mount0"
fi
if [[ "$mount0" == *":rw" ]]; then
  note_pass "[cli.copilot].mounts[0] mode is rw (matches scenario 01's expectation)"
else
  note_fail "[cli.copilot].mounts[0] mode" "got: $mount0"
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
