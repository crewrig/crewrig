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

# (a)+(b) Retargeted (spec 0256 R9, PR D1): the `storeGuidance` flag is read from the DECLARATION of
# each setup, not from a grep for the helper call. Pinned against the unchanged shell by
# scripts/tests/setup-retarget-others.test.ts ("storeGuidance is true exactly where the shell calls
# print_store_access_guidance"); the guidance text itself is asserted by (d) below.
decl() { node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$SCRIPT_DIR/scripts/tests/lib/print-setup-declarations.ts" "$1"; }
declared_guidance() {
  local declared
  declared="$(decl "$1")" || return 1
  printf '%s\n' "$declared" | grep '^store-guidance=' | head -1 | cut -d= -f2-
}
for cli in gemini copilot; do
  g="$(declared_guidance "$cli")" || g=""
  if [ "$g" = "true" ]; then
    ok "gap CLI declares store guidance: $cli"
  else
    bad "gap CLI does not declare store guidance (store-guidance='${g:-<absent>}'): $cli"
  fi
done
for cli in claude antigravity; do
  g="$(declared_guidance "$cli")" || g=""
  if [ "$g" = "false" ]; then
    ok "PASS-default CLI declares no store guidance: $cli"
  else
    bad "PASS-default CLI must declare store-guidance=false (got '${g:-<absent>}'): $cli"
  fi
done

# (c) no setup writes a durable trust entry for the store (R2/ADR-0013).
# Retargeted (spec 0256 R9, PR D2): the grep for `trustedFolders` / `permissions-config.json` over the
# non-comment lines of the setup text is replaced by RUNNING the TypeScript Gemini and Copilot entries
# (the CLIs that place the store; cell default-answers) in a sandboxed HOME and asserting that no file
# they wrote holds a `trustedFolders` key and that no permissions-config.json lands
# (scripts/tests/setup-retarget-gemini-copilot-run.test.ts). Pinned against the unchanged shell by the
# golden cell `<cli>/default-answers` (the shell's file tree for the same run). The Claude and
# Antigravity setups (PASS-default CLIs) are no longer checked here: the brief scopes this assertion to
# the two CLIs that place the store; their golden trees still pin what they write. Retired with the shell text: the
# comment-stripping grep.
# run_ts_behaviour <label> <test-name-pattern> <expected passes>: runs the named cases of
# scripts/tests/setup-retarget-gemini-copilot-run.test.ts, which executes the TypeScript Gemini / Copilot
# entries in a sandboxed HOME (golden cells; Linux + jq only, like the golden suites) and asserts on what
# they print and write. A host that cannot run the golden cells says so and skips, never passes silently.
# The golden sandbox of the TypeScript setup needs these real tools on PATH and the repository's config/
# tree; a hermetic PATH or a partial repository copy (the install oracle's) lacks them, and the group is
# then skipped off CI, but FAILED when CI is set and non-empty (GitHub Actions and GitLab CI set CI=true;
# the install oracle's hermetic env scrubs it, which is exactly where the skip stays allowed): a missing
# prerequisite in CI must never pass silently (i1-F24).
# ts_sandbox_prereq_missing names the missing prerequisite in TS_MISSING and returns 0, or returns 1.
ts_sandbox_prereq_missing() {
  local t
  TS_MISSING=""
  if [ "$(uname -s)" != "Linux" ]; then TS_MISSING="Linux (this host is $(uname -s))"; return 0; fi
  for t in jq git diff ls sort uniq tee touch stat realpath comm paste od expr dd tty mv rmdir tac rev hostname whoami; do
    command -v "$t" >/dev/null 2>&1 || { TS_MISSING="the tool $t"; return 0; }
  done
  if [ ! -d "${SCRIPT_DIR:-.}/config" ]; then TS_MISSING="the config/ tree of the repository"; return 0; fi
  return 1
}
run_ts_behaviour() {
  unset NODE_TEST_CONTEXT # a nested node --test must not see the parent runner's context
  local label="$1" pattern="$2" want="$3" out rc=0 n_pass n_fail n_skip
  if ts_sandbox_prereq_missing; then
    if [ -n "${CI:-}" ]; then
      bad "$label: the TypeScript entry cells cannot run on CI, missing prerequisite: $TS_MISSING"
    else
      echo "  skip: $label (the TypeScript entry cells need $TS_MISSING)"
    fi
    return 0
  fi
  out="$(node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-name-pattern="$pattern" \
    "${SCRIPT_DIR}/scripts/tests/setup-retarget-gemini-copilot-run.test.ts" 2>&1)" || rc=$?
  n_pass="$(sed -n 's/^ℹ pass //p' <<< "$out")"
  n_fail="$(sed -n 's/^ℹ fail //p' <<< "$out")"
  n_skip="$(sed -n 's/^ℹ skipped //p' <<< "$out")"
  if [ "$rc" -eq 0 ] && [ "$n_pass" = "$want" ] && [ "$n_fail" = "0" ] && [ "$n_skip" = "0" ]; then
    ok "$label ($n_pass TypeScript test(s) passed)"
  else
    bad "$label -- expected $want passing test(s), got pass=$n_pass fail=$n_fail skipped=$n_skip rc=$rc: $(tail -15 <<< "$out")"
  fi
}
run_ts_behaviour "no durable trust write for the store: TypeScript Gemini and Copilot entries" "no durable trust write" 2

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
