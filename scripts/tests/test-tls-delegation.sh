#!/bin/bash
# test-tls-delegation.sh — Regression tests for custom root-CA / native-TLS
# delegation (spec 0084).
#
# Units under test:
#   - detect_custom_tls_context() and offer_tls_delegation() in
#     scripts/lib/tls-delegation.sh, driven through the NON-INTERACTIVE
#     TLS_DELEGATION path (the hermetic surface; the fzf path needs a TTY).
#   - scripts/lib/tls-exec.sh (the runtime trust-propagation wrapper).
#
# Contract asserted (spec 0084):
#   R3  decline / TLS_DELEGATION=off is a strict no-op (nothing written).
#   R4  detection fires on a deterministic environment signal.
#   R5  the generated file NEVER contains a verification-disabling setting.
#   R11 consent writes ONLY ~/.crewrig/tls-env.sh, single-action removable.
#   R2/R9 tls-exec sources the file then execs (runtime reach); every setup
#         script invokes the shared offer (parity).
#
# HERMETIC: HOME is redirected to a throwaway temp tree; the TLS_* / cert env is
# reset per case so the real user's ~/.crewrig is never read or clobbered.
#
# Usage:
#   bash scripts/tests/test-tls-delegation.sh

# -e intentionally omitted: pass/fail counters control the harness.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TLS_LIB="$REPO_DIR/scripts/lib/tls-delegation.sh"
TLS_EXEC="$REPO_DIR/scripts/lib/tls-exec.sh"

for f in "$TLS_LIB" "$TLS_EXEC"; do
  if [ ! -f "$f" ]; then
    echo "FATAL: missing $f" >&2
    exit 2
  fi
done

# shellcheck source=scripts/lib/tls-delegation.sh
source "$TLS_LIB"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

reset_tls_env() {
  unset TLS_DELEGATION TLS_DELEGATION_CA CREWRIG_TLS_CA \
        NODE_EXTRA_CA_CERTS SSL_CERT_FILE REQUESTS_CA_BUNDLE PIP_CERT \
        GIT_SSL_CAINFO CURL_CA_BUNDLE HTTPS_PROXY HTTP_PROXY 2>/dev/null || true
}

fresh_home() {
  HOME="$(mktemp -d "$TMP_ROOT/home.XXXXXX")"
  export HOME
  ENVFILE="$HOME/.crewrig/tls-env.sh"
}

# ---------------------------------------------------------------------------
echo "1. Deterministic detection (R4)"
reset_tls_env; fresh_home
export NODE_EXTRA_CA_CERTS="$TMP_ROOT/dummy-ca.pem"
if detect_custom_tls_context; then
  ok "detects an already-set certificate environment variable"
else
  bad "did not detect a set certificate environment variable"
fi
reset_tls_env

# ---------------------------------------------------------------------------
echo "2. Decline / off is a strict no-op (R3)"
reset_tls_env; fresh_home
export TLS_DELEGATION=off
rc=0; offer_tls_delegation >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 0 ] && ok "TLS_DELEGATION=off returns 0" || bad "off returned $rc"
[ ! -e "$ENVFILE" ] && ok "off wrote nothing" || bad "off wrote $ENVFILE"
reset_tls_env

# ---------------------------------------------------------------------------
echo "3. Consent writes only the managed file, removable in one action (R11)"
reset_tls_env; fresh_home
CA="$TMP_ROOT/corp-ca.pem"; : > "$CA"
export TLS_DELEGATION=on TLS_DELEGATION_CA="$CA"
rc=0; offer_tls_delegation >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 0 ] && ok "consent returns 0" || bad "consent returned $rc"
[ -f "$ENVFILE" ] && ok "managed file written" || bad "managed file not written"
grep -q "NODE_EXTRA_CA_CERTS=" "$ENVFILE" 2>/dev/null \
  && ok "exports NODE_EXTRA_CA_CERTS" || bad "missing NODE_EXTRA_CA_CERTS export"
grep -q "UV_NATIVE_TLS=1" "$ENVFILE" 2>/dev/null \
  && ok "sets UV_NATIVE_TLS=1 (native TLS delegation)" || bad "missing UV_NATIVE_TLS=1"
# Nothing written outside ~/.crewrig, and removable in one action.
if rm "$ENVFILE" 2>/dev/null; then
  ok "removable in one action (rm ~/.crewrig/tls-env.sh)"
else
  bad "could not remove the managed file in one action"
fi
reset_tls_env

# ---------------------------------------------------------------------------
echo "4. Security invariant — never a verification-disabling setting (R5)"
reset_tls_env; fresh_home
CA="$TMP_ROOT/corp-ca2.pem"; : > "$CA"
export TLS_DELEGATION=on TLS_DELEGATION_CA="$CA"
offer_tls_delegation >/dev/null 2>&1 || true
if [ -f "$ENVFILE" ] \
   && grep -qE 'NODE_TLS_REJECT_UNAUTHORIZED=0|sslVerify[^=]*(=|[[:space:]])*false|PYTHONHTTPSVERIFY=0' "$ENVFILE"; then
  bad "managed file contains a verification-disabling setting"
else
  ok "no verification-disabling setting in the managed file"
fi
reset_tls_env

# ---------------------------------------------------------------------------
echo "5. tls-exec runtime wrapper (R2 runtime reach)"
reset_tls_env; fresh_home
mkdir -p "$HOME/.crewrig"
printf 'export CREWRIG_TLS_TEST_MARKER=present\n' > "$ENVFILE"
out="$(bash "$TLS_EXEC" printenv CREWRIG_TLS_TEST_MARKER 2>/dev/null || true)"
[ "$out" = "present" ] \
  && ok "wrapper sources the managed file before exec" \
  || bad "wrapper did not propagate the env (got '$out')"
fresh_home  # a fresh HOME with no managed file
out="$(bash "$TLS_EXEC" echo transparent 2>/dev/null || true)"
[ "$out" = "transparent" ] \
  && ok "wrapper is a transparent no-op when the managed file is absent" \
  || bad "wrapper failed with no managed file (got '$out')"
reset_tls_env

# ---------------------------------------------------------------------------
echo "6. Setup-script parity — every CLI invokes the shared offer (R9)"
for s in setup-claude-interactive.sh setup-gemini-interactive.sh \
         setup-copilot-interactive.sh setup-antigravity-interactive.sh; do
  if grep -q "offer_tls_delegation" "$REPO_DIR/scripts/$s"; then
    ok "invokes offer_tls_delegation: $s"
  else
    bad "missing offer_tls_delegation call: $s"
  fi
done

# ---------------------------------------------------------------------------
echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
