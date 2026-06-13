#!/usr/bin/env bash
# test-chroma-fd-limits.sh — Regression test for spec 0029.
#
# Spec 0029 (R1–R3) requires both shipped daemon supervisor units to
# declare an open-file-descriptor floor of at least 65536, so a fresh
# install inherits the raised limit without manual tuning:
#
#   - launchd: SoftResourceLimits AND HardResourceLimits, each carrying a
#     NumberOfFiles >= 65536 (R1 soft, R2 hard).
#   - systemd: LimitNOFILE >= 65536 (systemd's single scalar sets both
#     soft and hard).
#
# This is a static config-assertion test (no daemon is started). It locks
# the floor in place so a future refactor of either unit cannot silently
# drop the limit and re-introduce the descriptor-exhaustion failure.

set -uo pipefail

PASS=0
FAIL=0
FLOOR=65536

note_pass() { echo "PASS  $1"; PASS=$((PASS + 1)); }
note_fail() { echo "FAIL  $1 — $2"; FAIL=$((FAIL + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLIST="${REPO_DIR}/config/launchd/com.mempalace.chroma-server.plist"
SERVICE="${REPO_DIR}/config/systemd/mempalace-chroma-server.service"

# ─────────────────────────────────────────────────────────────────────────────
# Helper: extract the <integer> value following a given limit <key> in the
# plist. Matches:
#   <key>SoftResourceLimits</key>
#   <dict>
#       <key>NumberOfFiles</key>
#       <integer>65536</integer>
#   </dict>
# by scanning from the limit key to the first NumberOfFiles integer after it.
# ─────────────────────────────────────────────────────────────────────────────
plist_limit() {
  local key="$1" file="$2"
  awk -v key="$key" '
    $0 ~ "<key>" key "</key>" { hot = 1; next }
    hot && /<key>NumberOfFiles<\/key>/ { want = 1; next }
    want {
      if (match($0, /<integer>[0-9]+<\/integer>/)) {
        v = substr($0, RSTART, RLENGTH)
        gsub(/[^0-9]/, "", v)
        print v
        exit
      }
    }
  ' "$file"
}

# ─────────────────────────────────────────────────────────────────────────────
# Test 1 — launchd plist exists and declares the soft + hard floor.
# ─────────────────────────────────────────────────────────────────────────────
if [[ ! -f "$PLIST" ]]; then
  note_fail "launchd plist present" "missing $PLIST"
else
  soft="$(plist_limit SoftResourceLimits "$PLIST")"
  hard="$(plist_limit HardResourceLimits "$PLIST")"

  if [[ -n "$soft" ]] && (( soft >= FLOOR )); then
    note_pass "launchd SoftResourceLimits NumberOfFiles >= ${FLOOR} (got ${soft})"
  else
    note_fail "launchd SoftResourceLimits NumberOfFiles >= ${FLOOR}" \
      "got '${soft:-<absent>}'"
  fi

  if [[ -n "$hard" ]] && (( hard >= FLOOR )); then
    note_pass "launchd HardResourceLimits NumberOfFiles >= ${FLOOR} (got ${hard})"
  else
    note_fail "launchd HardResourceLimits NumberOfFiles >= ${FLOOR}" \
      "got '${hard:-<absent>}'"
  fi

  # R2: hard limit must be at least the soft limit so the soft limit is
  # actually enforceable rather than capped below the intended value.
  if [[ -n "$soft" && -n "$hard" ]] && (( hard >= soft )); then
    note_pass "launchd hard limit >= soft limit (${hard} >= ${soft})"
  else
    note_fail "launchd hard limit >= soft limit" \
      "soft='${soft:-<absent>}' hard='${hard:-<absent>}'"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Test 2 — systemd unit exists and declares LimitNOFILE >= floor.
# ─────────────────────────────────────────────────────────────────────────────
if [[ ! -f "$SERVICE" ]]; then
  note_fail "systemd unit present" "missing $SERVICE"
else
  nofile="$(grep -E '^[[:space:]]*LimitNOFILE=' "$SERVICE" \
    | tail -n1 | sed -E 's/.*LimitNOFILE=([0-9]+).*/\1/')"
  if [[ -n "$nofile" ]] && (( nofile >= FLOOR )); then
    note_pass "systemd LimitNOFILE >= ${FLOOR} (got ${nofile})"
  else
    note_fail "systemd LimitNOFILE >= ${FLOOR}" "got '${nofile:-<absent>}'"
  fi
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
if (( FAIL > 0 )); then
  exit 1
fi
exit 0
