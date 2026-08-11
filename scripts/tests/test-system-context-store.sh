#!/bin/bash
# test-system-context-store.sh — Regression tests for the user-space
# system-context store (spec 0068).
#
# Asserts the three DEV guarantees of spec 0068:
#   1. Zero rule loss (R7): every stub in artifacts/core/rules/60-tools.md that
#      points into the store resolves to a store file that exists and is
#      non-empty, and every store file is referenced by such a stub.
#   2. Byte-identical install (R1): install_dir installs the store
#      byte-identically to the repo source under BOTH INSTALL_MODE=copy and
#      INSTALL_MODE=link, and switching modes is idempotent.
#   3. Retrieval-protocol presence: 60-tools.md carries the deterministic
#      direct-read / MemPalace / explicit-signal protocol (R2, R3, R4) and the
#      Session Start sweep carries the optional MemPalace store-mirror step.
#
# The live per-CLI headless probe (spec 0068 Step 1) is NOT reproduced here — it
# needs network + CLI auth and is not hermetic. Its one-off results live in
# docs/research/system-context-sandbox-probe.md.
#
# Usage:
#   bash scripts/tests/test-system-context-store.sh

# -e intentionally omitted: pass/fail counters control the harness.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
STORE_DIR="$SCRIPT_DIR/artifacts/core/system-context"
TOOLS_FILE="$SCRIPT_DIR/artifacts/core/rules/60-tools.md"
COMMON_LIB="$SCRIPT_DIR/scripts/lib/common.sh"

for f in "$STORE_DIR" "$TOOLS_FILE" "$COMMON_LIB"; do
  if [ ! -e "$f" ]; then
    echo "FATAL: missing $f" >&2
    exit 2
  fi
done

# shellcheck source=scripts/lib/common.sh
source "$COMMON_LIB"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok()   { echo "  ok: $1"; pass=$((pass + 1)); }
bad()  { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

# ---------------------------------------------------------------------------
# 1. Zero rule loss — stubs <-> store files
# ---------------------------------------------------------------------------
echo "1. Zero rule loss (stub <-> store)"

# Store files present and non-empty
store_files=()
while IFS= read -r sf; do store_files+=("$sf"); done < <(find "$STORE_DIR" -maxdepth 1 -name '*.md' | sort)
if [ "${#store_files[@]}" -eq 0 ]; then
  bad "no *.md files in $STORE_DIR"
else
  ok "${#store_files[@]} store file(s) present"
fi
for sf in ${store_files[@]+"${store_files[@]}"}; do
  if [ -s "$sf" ]; then ok "non-empty: ${sf##*/}"; else bad "empty store file: ${sf##*/}"; fi
done

# Every stub reference resolves to an existing store file
refs="$(grep -oE '~/\.crewrig/system-context/[A-Za-z0-9._-]+\.md' "$TOOLS_FILE" | sed 's#.*/##' | sort -u)"
if [ -z "$refs" ]; then
  bad "no store references found in 60-tools.md"
else
  while IFS= read -r ref; do
    if [ -s "$STORE_DIR/$ref" ]; then ok "stub resolves: $ref"; else bad "stub references missing/empty store file: $ref"; fi
  done <<< "$refs"
fi

# Every store file is referenced by a stub (no orphan)
for sf in ${store_files[@]+"${store_files[@]}"}; do
  base="${sf##*/}"
  if grep -qF "system-context/$base" "$TOOLS_FILE"; then ok "referenced: $base"; else bad "orphan store file (no stub): $base"; fi
done

# ---------------------------------------------------------------------------
# 2. Byte-identical install (install_dir) under both modes
# ---------------------------------------------------------------------------
echo "2. Byte-identical install (copy + link)"

# copy mode
INSTALL_MODE="copy"
TGT_COPY="$TMP_ROOT/copy/system-context"
install_dir "$STORE_DIR" "$TGT_COPY" "test-copy" >/dev/null
if [ -d "$TGT_COPY" ] && [ ! -L "$TGT_COPY" ]; then ok "copy mode: target is a real directory"; else bad "copy mode: target is not a plain directory"; fi
if diff -r "$STORE_DIR" "$TGT_COPY" >/dev/null 2>&1; then ok "copy mode: byte-identical to source"; else bad "copy mode: differs from source"; fi

# link mode
INSTALL_MODE="link"
TGT_LINK="$TMP_ROOT/link/system-context"
install_dir "$STORE_DIR" "$TGT_LINK" "test-link" >/dev/null
if [ -L "$TGT_LINK" ]; then ok "link mode: target is a symlink"; else bad "link mode: target is not a symlink"; fi
if diff -r "$STORE_DIR" "$TGT_LINK" >/dev/null 2>&1; then ok "link mode: byte-identical to source"; else bad "link mode: differs from source"; fi

# idempotent mode switch: link -> copy over the same target path
INSTALL_MODE="copy"
install_dir "$STORE_DIR" "$TGT_LINK" "test-switch" >/dev/null
if [ -d "$TGT_LINK" ] && [ ! -L "$TGT_LINK" ]; then ok "switch link->copy: target is now a real directory"; else bad "switch link->copy: target still a symlink"; fi
if diff -r "$STORE_DIR" "$TGT_LINK" >/dev/null 2>&1; then ok "switch link->copy: byte-identical to source"; else bad "switch link->copy: differs from source"; fi

# ---------------------------------------------------------------------------
# 3. Retrieval protocol + Session Start mirror step present
# ---------------------------------------------------------------------------
echo "3. Retrieval protocol presence"

grep -q "## Retrieving the system-context store" "$TOOLS_FILE" \
  && ok "retrieval-protocol section present" || bad "retrieval-protocol section missing"
grep -qi "Direct file read" "$TOOLS_FILE" \
  && ok "direct-read default documented (R2)" || bad "direct-read default missing (R2)"
grep -qi "optional enhancement" "$TOOLS_FILE" \
  && ok "MemPalace optional enhancement documented (R3)" || bad "MemPalace optional enhancement missing (R3)"
grep -qi "explicit signal" "$TOOLS_FILE" \
  && ok "explicit-signal fallback documented (R4)" || bad "explicit-signal fallback missing (R4)"
grep -q "System-context store mirror" "$TOOLS_FILE" \
  && ok "Session Start store-mirror step present" || bad "Session Start store-mirror step missing"

# ---------------------------------------------------------------------------
# 4. Setup-time guidance parity (spec 0075)
# ---------------------------------------------------------------------------
# The store read is gated behind trust/path approval on exactly two CLIs
# (Gemini, Copilot); their setup scripts must print actionable per-invocation
# grant guidance, the two PASS-default CLIs (Claude, Antigravity) must not, and
# NO setup script may write a durable trust entry for the store (R2/ADR-0013).
echo "4. Setup-time guidance parity (spec 0075)"

SETUP_DIR="$SCRIPT_DIR/scripts"
GAP_SCRIPTS=(setup-gemini-interactive.sh setup-copilot-interactive.sh)
PASS_SCRIPTS=(setup-claude-interactive.sh setup-antigravity-interactive.sh)

# (a) the two gap CLIs call the guidance helper
for s in ${GAP_SCRIPTS[@]+"${GAP_SCRIPTS[@]}"}; do
  if grep -q "print_store_access_guidance" "$SETUP_DIR/$s"; then
    ok "gap CLI calls print_store_access_guidance: $s"
  else
    bad "gap CLI missing print_store_access_guidance call: $s"
  fi
done

# (b) the two PASS-default CLIs do NOT call it (no silent asymmetry)
for s in ${PASS_SCRIPTS[@]+"${PASS_SCRIPTS[@]}"}; do
  if grep -q "print_store_access_guidance" "$SETUP_DIR/$s"; then
    bad "PASS-default CLI unexpectedly calls print_store_access_guidance: $s"
  else
    ok "PASS-default CLI emits no store guidance: $s"
  fi
done

# (c) no setup script writes a durable trust entry for the store (R2/ADR-0013).
# trustedFolders / permissions-config.json are the durable-trust surfaces named
# in the sandbox probe; they have no legitimate non-store use in setup, so their
# absence from executable (non-comment) code is the guard. Full-line comment
# mentions (e.g. the copilot note explaining trustedFolders does NOT work) are
# stripped first so they do not trip the check.
for s in ${GAP_SCRIPTS[@]+"${GAP_SCRIPTS[@]}"} ${PASS_SCRIPTS[@]+"${PASS_SCRIPTS[@]}"}; do
  code="$(grep -v '^[[:space:]]*#' "$SETUP_DIR/$s")"
  if echo "$code" | grep -Eq 'trustedFolders|permissions-config\.json'; then
    bad "setup writes a durable trust surface (trustedFolders/permissions-config.json): $s"
  else
    ok "no durable trust write for the store: $s"
  fi
done

# (d) the helper names the correct per-invocation grant per CLI (source-and-call)
if print_store_access_guidance gemini | grep -q -- "--include-directories"; then
  ok "gemini guidance names --include-directories"
else
  bad "gemini guidance missing --include-directories"
fi
if print_store_access_guidance copilot | grep -q -- "--add-dir"; then
  ok "copilot guidance names --add-dir"
else
  bad "copilot guidance missing --add-dir"
fi

# ---------------------------------------------------------------------------
echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
