#!/bin/bash
# test-setup-validation-backend.sh — Regression tests for the user-gate
# validation-backend setup helper (spec 0080).
#
# Unit under test: configure_validation_backend() in scripts/lib/common.sh,
# driven through its NON-INTERACTIVE path (the VALIDATION_* env vars), which is
# the hermetic CI surface. The interactive fzf path is never exercised here — it
# requires a TTY and human input, so it is out of scope for an automated test.
#
# Contract asserted (spec 0080 R15/R16, delta-01):
#   1. Well-formed conf per backend/option combination — a 2-line `#` header
#      then backend=/translate=/pedagogy=/illustration= (parsed skipping blank
#      and `#` lines).
#   2. Defaults apply to every unset VALIDATION_* var (internal / off /
#      contextual / off); setting ANY one of the four takes the non-interactive
#      path.
#   3. An invalid enum fails loudly (non-zero return) and leaves the conf
#      surface untouched — not written when absent, byte-unchanged when present
#      (the enum guard runs before the atomic tmp+mv write).
#   4. Parity — each of the four setup-*-interactive.sh scripts invokes the
#      shared helper (symmetric-script rule).
#
# Separately (NOT helper behaviour): the fallback INTENT. The helper records the
# chosen backend verbatim and never downgrades plannotator->internal; the
# binary-absent fallback is GATE-TIME skill behaviour, documented in the
# user-validate SKILL.md. This test asserts the verbatim persistence and a light
# doc-presence check, clearly separated from the helper assertions above.
#
# HERMETIC: HOME is redirected to a throwaway temp tree for the whole run, so the
# helper never reads or clobbers the real user's ~/.crewrig/validation.conf. The
# temp tree is removed on exit.
#
# Usage:
#   bash scripts/tests/test-setup-validation-backend.sh

# -e intentionally omitted: pass/fail counters control the harness, and the
# invalid-enum cases return non-zero on purpose.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
COMMON_LIB="$REPO_DIR/scripts/lib/common.sh"
SETUP_DIR="$REPO_DIR/scripts"
SKILL_MD="$REPO_DIR/artifacts/core/skills/user-validate/SKILL.md"

if [ ! -f "$COMMON_LIB" ]; then
  echo "FATAL: missing $COMMON_LIB" >&2
  exit 2
fi

# shellcheck source=scripts/lib/common.sh
source "$COMMON_LIB"

# --- Hermetic sandbox: redirect HOME away from the real user's config ---------
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

# reset_validation_env — clear all four toggles so no case leaks into the next
# (each is read as ${VAR:-default}, so a stray value from the host or a prior
# case would silently corrupt a defaults assertion).
reset_validation_env() {
  unset VALIDATION_BACKEND VALIDATION_TRANSLATE VALIDATION_PEDAGOGY VALIDATION_ILLUSTRATION
}

# fresh_home — point HOME at a pristine per-case dir so a case that asserts "no
# conf written" is never fooled by a sibling case's file. Sets HOME and CONF as
# globals in the CURRENT shell (never via command substitution, whose subshell
# HOME export would not reach the parent — and would let the helper write to the
# real ~/.crewrig, breaking hermeticity).
fresh_home() {
  HOME="$(mktemp -d "$TMP_ROOT/home.XXXXXX")"
  export HOME
  CONF="$HOME/.crewrig/validation.conf"
}

# conf_get <file> <key> — value for <key>, parsing data lines only (skip blank
# and `#` header lines), splitting on the first `=`. Non-zero if key absent.
conf_get() {
  local file="$1" key="$2" line k v
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    k="${line%%=*}"
    v="${line#*=}"
    if [ "$k" = "$key" ]; then printf '%s' "$v"; return 0; fi
  done < "$file"
  return 1
}

# assert_wellformed <conf> <label> — the structural contract: exactly a 2-line
# `#` header, exactly the four data keys, each a lowercase `key=value`.
assert_wellformed() {
  local conf="$1" label="$2"
  if [ ! -f "$CONF" ]; then bad "$label: conf not written"; return; fi

  local comment_lines data_lines keys
  comment_lines="$(grep -c '^#' "$CONF")"
  [ "$comment_lines" = "2" ] \
    && ok "$label: 2-line '#' header" \
    || bad "$label: expected 2 header comment lines, got $comment_lines"

  # data lines = non-blank, non-comment
  data_lines="$(grep -vE '^[[:space:]]*($|#)' "$CONF" | wc -l | tr -d ' ')"
  [ "$data_lines" = "4" ] \
    && ok "$label: 4 data lines" \
    || bad "$label: expected 4 data lines, got $data_lines"

  keys="$(grep -vE '^[[:space:]]*($|#)' "$CONF" | cut -d= -f1 | sort | tr '\n' ' ')"
  [ "$keys" = "backend illustration pedagogy translate " ] \
    && ok "$label: keys are exactly backend/translate/pedagogy/illustration" \
    || bad "$label: unexpected key set: [$keys]"

  if grep -vE '^[[:space:]]*($|#)' "$CONF" | grep -qvE '^[a-z]+=[a-z]+$'; then
    bad "$label: a data line is not a lowercase key=value"
  else
    ok "$label: every data line is a lowercase key=value"
  fi

  [ ! -e "${CONF}.tmp" ] \
    && ok "$label: no leftover .tmp (atomic write completed)" \
    || bad "$label: stray ${CONF}.tmp left behind"
}

# assert_values <conf> <label> <backend> <translate> <pedagogy> <illustration>
assert_values() {
  local conf="$1" label="$2" eb="$3" et="$4" ep="$5" ei="$6"
  local ab at ap ai
  ab="$(conf_get "$CONF" backend)"      || ab="<missing>"
  at="$(conf_get "$CONF" translate)"    || at="<missing>"
  ap="$(conf_get "$CONF" pedagogy)"     || ap="<missing>"
  ai="$(conf_get "$CONF" illustration)" || ai="<missing>"
  [ "$ab" = "$eb" ] && ok "$label: backend=$eb" || bad "$label: backend expected '$eb', got '$ab'"
  [ "$at" = "$et" ] && ok "$label: translate=$et" || bad "$label: translate expected '$et', got '$at'"
  [ "$ap" = "$ep" ] && ok "$label: pedagogy=$ep" || bad "$label: pedagogy expected '$ep', got '$ap'"
  [ "$ai" = "$ei" ] && ok "$label: illustration=$ei" || bad "$label: illustration expected '$ei', got '$ai'"
}

# ---------------------------------------------------------------------------
# 1. Golden path — each backend/option combination writes a well-formed conf.
#    Between the three cases every valid enum value is exercised at least once:
#      backend      : internal, plannotator
#      translate    : on, off
#      pedagogy     : simple, professor, contextual
#      illustration : on, off
# ---------------------------------------------------------------------------
echo "1. Golden path (well-formed conf per combination)"

# (a) backend=internal, all options explicit
reset_validation_env
fresh_home
VALIDATION_BACKEND=internal VALIDATION_TRANSLATE=on \
  VALIDATION_PEDAGOGY=simple VALIDATION_ILLUSTRATION=on
export VALIDATION_BACKEND VALIDATION_TRANSLATE VALIDATION_PEDAGOGY VALIDATION_ILLUSTRATION
rc=0; configure_validation_backend >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 0 ] && ok "internal/on/simple/on: returns 0" || bad "internal/on/simple/on: returned $rc"
assert_wellformed "$CONF" "internal/on/simple/on"
assert_values "$CONF" "internal/on/simple/on" internal on simple on

# (b) backend=plannotator, all options explicit
reset_validation_env
fresh_home
export VALIDATION_BACKEND=plannotator VALIDATION_TRANSLATE=off \
  VALIDATION_PEDAGOGY=professor VALIDATION_ILLUSTRATION=on
rc=0; configure_validation_backend >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 0 ] && ok "plannotator/off/professor/on: returns 0" || bad "plannotator/off/professor/on: returned $rc"
assert_wellformed "$CONF" "plannotator/off/professor/on"
assert_values "$CONF" "plannotator/off/professor/on" plannotator off professor on

# ---------------------------------------------------------------------------
# 2. Defaults apply to every unset var; setting ANY one takes the non-interactive
#    path (defaults: internal / off / contextual / off).
# ---------------------------------------------------------------------------
echo "2. Defaults for unset VALIDATION_* vars"

# (c) only backend set -> the other three take defaults
reset_validation_env
fresh_home
export VALIDATION_BACKEND=plannotator
rc=0; configure_validation_backend >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 0 ] && ok "only-backend: returns 0" || bad "only-backend: returned $rc"
assert_wellformed "$CONF" "only-backend"
assert_values "$CONF" "only-backend" plannotator off contextual off

# (d) only a non-backend var set -> still non-interactive; backend defaults to internal
reset_validation_env
fresh_home
export VALIDATION_TRANSLATE=on
rc=0; configure_validation_backend >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 0 ] && ok "only-translate: returns 0 (any var takes non-interactive path)" || bad "only-translate: returned $rc"
assert_wellformed "$CONF" "only-translate"
assert_values "$CONF" "only-translate" internal on contextual off

# ---------------------------------------------------------------------------
# 3. Invalid enum -> non-zero return AND the conf surface is left untouched.
# ---------------------------------------------------------------------------
echo "3. Invalid enum fails loudly, no partial write"

# (a) invalid backend, no pre-existing conf -> return non-zero, nothing written
reset_validation_env
fresh_home
export VALIDATION_BACKEND=bogus
rc=0; configure_validation_backend >/dev/null 2>&1 || rc=$?
[ "$rc" -ne 0 ] && ok "invalid backend: non-zero return ($rc)" || bad "invalid backend: unexpectedly returned 0"
[ ! -e "$CONF" ] && ok "invalid backend: no conf written" || bad "invalid backend: conf written despite invalid enum"
[ ! -e "${CONF}.tmp" ] && ok "invalid backend: no stray .tmp" || bad "invalid backend: stray .tmp left behind"

# (b) invalid pedagogy over a valid pre-existing conf -> return non-zero, conf byte-unchanged
reset_validation_env
fresh_home
export VALIDATION_BACKEND=internal VALIDATION_TRANSLATE=off \
  VALIDATION_PEDAGOGY=contextual VALIDATION_ILLUSTRATION=off
rc=0; configure_validation_backend >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 0 ] && ok "seed conf for unchanged-check: returns 0" || bad "seed conf: returned $rc"
before="$(cat "$CONF" 2>/dev/null)"
reset_validation_env
export VALIDATION_BACKEND=internal VALIDATION_PEDAGOGY=bogus
rc=0; configure_validation_backend >/dev/null 2>&1 || rc=$?
[ "$rc" -ne 0 ] && ok "invalid pedagogy: non-zero return ($rc)" || bad "invalid pedagogy: unexpectedly returned 0"
after="$(cat "$CONF" 2>/dev/null)"
[ "$before" = "$after" ] && ok "invalid pedagogy: pre-existing conf byte-unchanged" || bad "invalid pedagogy: conf was mutated"
[ ! -e "${CONF}.tmp" ] && ok "invalid pedagogy: no stray .tmp" || bad "invalid pedagogy: stray .tmp left behind"

reset_validation_env

# ---------------------------------------------------------------------------
# 4. Parity — each setup-*-interactive.sh invokes the shared helper.
# ---------------------------------------------------------------------------
echo "4. Setup-script parity (shared helper invoked by all four CLIs)"

for s in setup-claude-interactive.sh setup-gemini-interactive.sh \
         setup-copilot-interactive.sh setup-antigravity-interactive.sh; do
  if grep -q "configure_validation_backend" "$SETUP_DIR/$s"; then
    ok "invokes configure_validation_backend: $s"
  else
    bad "missing configure_validation_backend call: $s"
  fi
done

# ---------------------------------------------------------------------------
# 5. Fallback INTENT — documented, NOT helper behaviour.
#    The helper records the backend verbatim; it never downgrades
#    plannotator->internal (that fallback is gate-time skill behaviour). These
#    assertions guard the intent WITHOUT asserting a downgrade against the helper.
# ---------------------------------------------------------------------------
echo "5. Fallback intent (verbatim persistence + doc presence; not helper behaviour)"

# (a) plannotator is persisted verbatim regardless of whether the binary exists.
reset_validation_env
fresh_home
export VALIDATION_BACKEND=plannotator
rc=0; configure_validation_backend >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 0 ] && ok "plannotator selection: returns 0 (no helper-level downgrade)" || bad "plannotator selection: returned $rc"
persisted="$(conf_get "$CONF" backend)" || persisted="<missing>"
if command -v plannotator >/dev/null 2>&1; then
  ctx="(binary present)"
else
  ctx="(binary absent — verbatim persistence still holds)"
fi
[ "$persisted" = "plannotator" ] \
  && ok "backend persisted verbatim as plannotator $ctx" \
  || bad "backend expected 'plannotator' verbatim, got '$persisted' $ctx"
reset_validation_env

# (b) the SKILL.md documents the gate-time plannotator->internal fallback (R4).
if [ -f "$SKILL_MD" ]; then
  ok "user-validate SKILL.md present"
  grep -q "plannotator --version" "$SKILL_MD" \
    && ok "SKILL.md documents the plannotator --version presence check" \
    || bad "SKILL.md missing the plannotator --version presence check"
  grep -qiE 'fall.?back to the .?internal.? backend' "$SKILL_MD" \
    && ok "SKILL.md documents the gate-time fallback to the internal backend" \
    || bad "SKILL.md missing the gate-time fallback-to-internal wording"
else
  bad "user-validate SKILL.md not found at $SKILL_MD"
fi

# ---------------------------------------------------------------------------
echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
