#!/bin/bash
# test-e2e-auth-scripts.sh — Regression test for scripts/e2e/auth-*.sh.
#
# Locks the per-script invariants required by docs/adr/0002-e2e-auth-flow.md:
#
#   - bash shebang + `set -euo pipefail`
#   - clean `bash -n` syntax
#   - sources lib/auth-common.sh
#   - claude/gemini: image precondition fires when image is missing;
#                    e2e_chown_bootstrap is invoked
#   - copilot:       PAT-creation URL, export hint, and 90-day reminder
#                    appear in the guidance banner when no token is set;
#                    exit code is 0 when the script only prints guidance
#
# Image-dependent assertions SKIP when docker (or the image) is unavailable.

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "PASS  $1"; PASS=$((PASS + 1)); }
note_fail() { echo "FAIL  $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "SKIP  $1 — $2"; SKIP=$((SKIP + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPTS_DIR="${REPO_DIR}/scripts/e2e"

# ---------------------------------------------------------------------------
# Generic invariants — every auth-*.sh script
# ---------------------------------------------------------------------------
SCRIPTS=(auth-claude.sh auth-gemini.sh auth-copilot.sh)

for s in "${SCRIPTS[@]}"; do
  path="${SCRIPTS_DIR}/$s"

  if [[ -f "$path" ]]; then
    note_pass "$s — file exists"
  else
    note_fail "$s — file exists" "missing at $path"
    continue
  fi

  if [[ -x "$path" ]]; then
    note_pass "$s — executable bit set"
  else
    note_fail "$s — executable bit set" "chmod +x missing"
  fi

  shebang="$(head -n 1 "$path")"
  if [[ "$shebang" == "#!/usr/bin/env bash" || "$shebang" == "#!/bin/bash" ]]; then
    note_pass "$s — bash shebang ($shebang)"
  else
    note_fail "$s — bash shebang" "got '$shebang'"
  fi

  if head -n 30 "$path" | grep -qE '^set -euo pipefail\b'; then
    note_pass "$s — set -euo pipefail near top"
  else
    note_fail "$s — set -euo pipefail" "not found in first 30 lines"
  fi

  if bash -n "$path" 2>/tmp/auth-syntax.err; then
    note_pass "$s — bash -n syntax check"
  else
    note_fail "$s — bash -n syntax check" "$(tr '\n' ' ' </tmp/auth-syntax.err)"
  fi
  rm -f /tmp/auth-syntax.err

  if grep -q 'lib/auth-common.sh' "$path"; then
    note_pass "$s — sources lib/auth-common.sh"
  else
    note_fail "$s — sources lib/auth-common.sh" "no reference to lib/auth-common.sh"
  fi
done

# ---------------------------------------------------------------------------
# Interactive container scripts: claude + gemini
# ---------------------------------------------------------------------------
INTERACTIVE=(claude gemini)

for cli in "${INTERACTIVE[@]}"; do
  s="auth-${cli}.sh"
  path="${SCRIPTS_DIR}/$s"

  # --- e2e_chown_bootstrap invocation --------------------------------------
  if grep -q 'e2e_chown_bootstrap' "$path"; then
    note_pass "$s — calls e2e_chown_bootstrap"
  else
    note_fail "$s — calls e2e_chown_bootstrap" "not referenced"
  fi

  # --- Image precondition fires when image is missing ----------------------
  if ! command -v docker >/dev/null 2>&1; then
    note_skip "$s — image precondition fires when image is missing" \
              "docker not available"
    continue
  fi

  image="crewrig/e2e-${cli}:latest"
  backup="crewrig/e2e-${cli}:_test_backup_$$"

  if ! docker image inspect "$image" >/dev/null 2>&1; then
    note_skip "$s — image precondition fires when image is missing" \
              "image $image not built locally"
    continue
  fi

  # Trap-protected retag → assert → restore. Restore must happen even if
  # the test below fails.
  restored=0
  restore() {
    if [[ "$restored" -eq 0 ]]; then
      docker tag "$backup" "$image" >/dev/null 2>&1 || true
      docker rmi "$backup" >/dev/null 2>&1 || true
      restored=1
    fi
  }
  trap restore EXIT INT TERM

  docker tag "$image" "$backup" >/dev/null 2>&1
  docker rmi "$image" >/dev/null 2>&1

  set +e
  out="$(bash "$path" </dev/null 2>&1)"
  rc=$?
  set -e

  # The script should fail (non-zero) and the error should mention the build
  # hint pointing at `task e2e:build:<cli>`.
  if [[ "$rc" -ne 0 ]] && echo "$out" | grep -qE "e2e:build:${cli}|task e2e:build:${cli}"; then
    note_pass "$s — image-missing precondition fires (rc=$rc, build hint present)"
  else
    note_fail "$s — image-missing precondition fires" \
              "rc=$rc, output=$(printf '%s' "$out" | tr '\n' ' ' | head -c 200)"
  fi

  restore
  trap - EXIT INT TERM
done

# ---------------------------------------------------------------------------
# Guidance-only script: copilot
# ---------------------------------------------------------------------------
COPILOT="${SCRIPTS_DIR}/auth-copilot.sh"

set +e
out="$(env -u COPILOT_GITHUB_TOKEN bash "$COPILOT" </dev/null 2>&1)"
rc=$?
set -e

if [[ "$rc" -eq 0 ]]; then
  note_pass "auth-copilot.sh — exits 0 when only printing guidance"
else
  note_fail "auth-copilot.sh — exits 0 when only printing guidance" "got rc=$rc"
fi

if echo "$out" | grep -q 'github.com/settings/personal-access-tokens/new'; then
  note_pass "auth-copilot.sh — guidance contains PAT-creation URL"
else
  note_fail "auth-copilot.sh — guidance contains PAT-creation URL" "URL not found"
fi

if echo "$out" | grep -q 'export COPILOT_GITHUB_TOKEN'; then
  note_pass "auth-copilot.sh — guidance contains export hint"
else
  note_fail "auth-copilot.sh — guidance contains export hint" "missing export line"
fi

if echo "$out" | grep -qE '90[ -]?DAYS|90[ -]?days'; then
  note_pass "auth-copilot.sh — guidance contains 90-day expiry reminder"
else
  note_fail "auth-copilot.sh — 90-day reminder" "not found in stdout/stderr"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
[[ "$FAIL" -eq 0 ]]
