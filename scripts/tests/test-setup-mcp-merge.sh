#!/bin/bash
# test-setup-mcp-merge.sh — Regression tests for the pre-existing MCP-server
# preservation-on-setup behaviour (spec 0089).
#
# Unit under test: merge_preexisting_mcp_servers() in scripts/lib/common.sh,
# the single shared helper the three overwrite-based setups (Gemini, Copilot,
# Antigravity) call to fold an operator's pre-existing MCP declarations back
# over the framework-written config. The helper owns the whole policy, so it is
# the hermetic surface for R11 — the interactive scripts themselves cannot run
# end-to-end in CI (fzf prompts, the `agy` guard, the launchd/systemd chroma
# daemon), so they are exercised structurally instead (§3, §4).
#
# Contract asserted (spec 0089):
#   R2/R3/R4 — a pre-existing non-reserved server (incl. a hand-customised
#     `github`) survives verbatim and wins over any same-named framework entry.
#   R7 — a framework reserved server (mempalace / sequentialthinking) selected
#     during the run keeps its own name (framework wins on a reserved collision).
#   R8 — a declined reserved server is absent from the result even if it
#     pre-existed, while every non-reserved declaration is still retained.
#   R9 — each reserved-name collision (replace on selection, remove on decline)
#     emits a non-silent warning naming the server and pointing at the backup.
#   R11 — asserted per framework-doc shape below AND, for each of the three
#     scripts, that the operator's pre-run config is CAPTURED BEFORE the
#     framework overwrite (ordering) and that the capture actually reads the
#     operator's servers (functional) — a plain call-site grep cannot catch a
#     mis-timed or wrong-file capture (spec 0089 review F1).
#
# HERMETIC: no HOME writes, no interactive scripts run. Every merge operates on
# throwaway temp files under a temp root removed on exit.
#
# Usage:
#   bash scripts/tests/test-setup-mcp-merge.sh

# -e intentionally omitted: pass/fail counters drive the harness, and some
# probes (jq -e presence checks) return non-zero on purpose.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
COMMON_LIB="$REPO_DIR/scripts/lib/common.sh"
SETUP_DIR="$REPO_DIR/scripts"

if [ ! -f "$COMMON_LIB" ]; then
  echo "FATAL: missing $COMMON_LIB" >&2
  exit 2
fi
command -v jq >/dev/null 2>&1 || { echo "FATAL: jq is required for this test" >&2; exit 2; }

# shellcheck source=scripts/lib/common.sh
source "$COMMON_LIB"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

# --- Fixtures ---------------------------------------------------------------
# Operator declarations (distinctive command/args/env so "verbatim" is meaningful).
OP_ACME='{"command":"acme","args":["--serve","--port","9999"],"env":{"ACME_TOKEN":"xyz"}}'
OP_GH='{"command":"gh-ent","args":["mcp","--stdio"],"env":{"GITHUB_HOST":"ghe.corp.example"}}'
OP_MEM='{"command":"python","args":["-m","legacy_mempalace"]}'
OP_SEQ='{"command":"node","args":["legacy-seqthink.js"]}'
# Framework declarations (what the framework write leaves on disk before the fold).
FW_GH='{"command":"docker","args":["run","ghcr.io/github/github-mcp-server"],"env":{"Authorization":"Bearer $GITHUB_PAT"}}'
FW_MEM='{"command":"bash","args":["/repo/scripts/lib/tls-exec.sh","/py","/repo/scripts/lib/mempalace-http-wrapper.py"]}'
FW_SEQ='{"command":"bash","args":["/repo/scripts/lib/tls-exec.sh","npx","-y","@modelcontextprotocol/server-sequential-thinking"]}'

BACKUP_REF="$TMP_ROOT/config.json.bak.20260722-000000"

# merge_run <label> <framework_mcpservers_json> <pre_run_mcpservers_json>
# Writes the framework config to a fresh temp file, runs the helper, and leaves
# the result path in RESULT_FILE and the helper's stdout (warnings) in OUT.
merge_run() {
  local framework="$2" pre="$3"
  RESULT_FILE="$(mktemp "$TMP_ROOT/cfg.XXXXXX")"
  printf '{"mcpServers":%s}' "$framework" > "$RESULT_FILE"
  OUT="$(merge_preexisting_mcp_servers "$pre" "$RESULT_FILE" "$BACKUP_REF" 2>&1)"
}

# assert_verbatim <label> <name> <expected_json> — server present and byte-for-
# byte equal (sorted-key canonical form) to the expected object.
assert_verbatim() {
  local label="$1" name="$2" expected="$3" got exp
  got="$(jq -Sc --arg n "$name" '.mcpServers[$n]' "$RESULT_FILE")"
  exp="$(printf '%s' "$expected" | jq -Sc .)"
  [ "$got" = "$exp" ] \
    && ok "$label: '$name' preserved verbatim" \
    || bad "$label: '$name' expected $exp, got $got"
}

# assert_absent <label> <name>
assert_absent() {
  local label="$1" name="$2"
  if jq -e --arg n "$name" '.mcpServers | has($n)' "$RESULT_FILE" >/dev/null 2>&1; then
    bad "$label: '$name' should be absent but is present"
  else
    ok "$label: '$name' absent"
  fi
}

# assert_warn <label> <name> — a warning names the server AND points at the backup.
assert_warn() {
  local label="$1" name="$2"
  if printf '%s' "$OUT" | grep -q "'$name'" \
     && printf '%s' "$OUT" | grep -qF "$BACKUP_REF"; then
    ok "$label: warning names '$name' and points at the backup"
  else
    bad "$label: missing R9 warning for '$name' (out: $OUT)"
  fi
}

# assert_no_warn <label> <name>
assert_no_warn() {
  local label="$1" name="$2"
  if printf '%s' "$OUT" | grep -q "'$name'"; then
    bad "$label: unexpected warning for '$name'"
  else
    ok "$label: no warning for '$name'"
  fi
}

# ---------------------------------------------------------------------------
echo "1. Framework-doc shape A (Gemini/Copilot: github + toggleable reserved)"
# ---------------------------------------------------------------------------

# 1a. Selection collision: operator acme-tools + custom github + old mempalace;
#     framework selected mempalace (github + mempalace + seqthink on disk).
merge_run "A-select" \
  "{\"github\":$FW_GH,\"mempalace\":$FW_MEM,\"sequentialthinking\":$FW_SEQ}" \
  "{\"acme-tools\":$OP_ACME,\"github\":$OP_GH,\"mempalace\":$OP_MEM}"
assert_verbatim "A-select" "acme-tools" "$OP_ACME"      # R2/R3 non-reserved survives
assert_verbatim "A-select" "github" "$OP_GH"            # R2/R3 operator github wins over framework
assert_verbatim "A-select" "mempalace" "$FW_MEM"        # R7 framework wins on reserved collision
assert_verbatim "A-select" "sequentialthinking" "$FW_SEQ"
assert_warn     "A-select" "mempalace"                  # R9 replace warning
assert_no_warn  "A-select" "sequentialthinking"         # not a collision (absent from pre-run)

# 1b. Decline collision: operator acme-tools + old mempalace; framework declined
#     mempalace (github + seqthink on disk, mempalace del'd).
merge_run "A-decline" \
  "{\"github\":$FW_GH,\"sequentialthinking\":$FW_SEQ}" \
  "{\"acme-tools\":$OP_ACME,\"mempalace\":$OP_MEM}"
assert_verbatim "A-decline" "acme-tools" "$OP_ACME"     # R8 non-reserved retained
assert_absent   "A-decline" "mempalace"                 # R8 declined reserved removed
assert_warn     "A-decline" "mempalace"                 # R9 remove warning

# ---------------------------------------------------------------------------
echo "2. Framework-doc shape B (Antigravity: no github, both reserved toggleable)"
# ---------------------------------------------------------------------------

# 2a. Selection collision on sequentialthinking: operator acme-tools + old
#     seqthink; framework selected both reserved.
merge_run "B-select" \
  "{\"mempalace\":$FW_MEM,\"sequentialthinking\":$FW_SEQ}" \
  "{\"acme-tools\":$OP_ACME,\"sequentialthinking\":$OP_SEQ}"
assert_verbatim "B-select" "acme-tools" "$OP_ACME"      # R2/R3 non-reserved survives (empty-base shape)
assert_verbatim "B-select" "sequentialthinking" "$FW_SEQ"  # R7 framework wins
assert_warn     "B-select" "sequentialthinking"         # R9 replace warning
assert_no_warn  "B-select" "mempalace"                  # not a collision

# 2b. Decline both: operator acme-tools + old mempalace + old seqthink; framework
#     declined both (empty framework mcpServers).
merge_run "B-decline" \
  "{}" \
  "{\"acme-tools\":$OP_ACME,\"mempalace\":$OP_MEM,\"sequentialthinking\":$OP_SEQ}"
assert_verbatim "B-decline" "acme-tools" "$OP_ACME"     # R8 non-reserved retained
assert_absent   "B-decline" "mempalace"                 # R8 declined reserved removed
assert_absent   "B-decline" "sequentialthinking"        # R8 declined reserved removed
assert_warn     "B-decline" "mempalace"
assert_warn     "B-decline" "sequentialthinking"

# ---------------------------------------------------------------------------
echo "3. Per-script capture wiring (spec 0089 R11 / review F1)"
# ---------------------------------------------------------------------------
# For each script the helper's correctness hinges on the operator config being
# captured BEFORE the framework overwrite and FROM the right file. A call-site
# grep (§4) cannot see that, so assert both the ordering (capture line before
# the framework write) and the function (the extracted capture line, run against
# a seeded fixture, yields the operator's servers).

# script | target-var referenced by the capture | first framework-write marker
check_capture() {
  local script="$1" target_var="$2" write_marker="$3"
  local path="$SETUP_DIR/$script"
  if [ ! -f "$path" ]; then bad "$script: not found"; return; fi

  local cap_ln write_ln merge_ln
  cap_ln="$(grep -nE '^[[:space:]]*PREEXISTING_MCP=' "$path" | head -1 | cut -d: -f1)"
  write_ln="$(grep -nF "$write_marker" "$path" | head -1 | cut -d: -f1)"
  merge_ln="$(grep -nF 'merge_preexisting_mcp_servers "$PREEXISTING_MCP"' "$path" | head -1 | cut -d: -f1)"

  if [ -z "$cap_ln" ]; then bad "$script: no PREEXISTING_MCP= capture line"; return; fi
  if [ -z "$write_ln" ]; then bad "$script: no framework-write line ($write_marker)"; return; fi
  if [ -z "$merge_ln" ]; then bad "$script: no merge_preexisting_mcp_servers call"; return; fi

  # Ordering: capture BEFORE the framework overwrite, fold AFTER it.
  [ "$cap_ln" -lt "$write_ln" ] \
    && ok "$script: capture (l$cap_ln) precedes framework write (l$write_ln)" \
    || bad "$script: capture (l$cap_ln) must precede framework write (l$write_ln)"
  [ "$merge_ln" -gt "$write_ln" ] \
    && ok "$script: fold (l$merge_ln) follows framework write (l$write_ln)" \
    || bad "$script: fold (l$merge_ln) must follow framework write (l$write_ln)"

  # Functional: the extracted capture line, run against a seeded operator
  # fixture, reads the operator's servers (right file, right filter).
  local cap_line fix captured
  cap_line="$(grep -E '^[[:space:]]*PREEXISTING_MCP=' "$path" | head -1)"
  fix="$(mktemp "$TMP_ROOT/precap.XXXXXX")"
  printf '{"mcpServers":{"acme-tools":%s}}' "$OP_ACME" > "$fix"
  captured="$(
    eval "${target_var}=\"$fix\""
    eval "$cap_line"
    printf '%s' "$PREEXISTING_MCP"
  )"
  if printf '%s' "$captured" | jq -e 'has("acme-tools")' >/dev/null 2>&1; then
    ok "$script: capture reads the operator's pre-run servers"
  else
    bad "$script: capture did not read the operator's servers (got: $captured)"
  fi
}

check_capture setup-gemini-interactive.sh      SETTINGS_TARGET    '${SETTINGS_TARGET}.tmp'
check_capture setup-copilot-interactive.sh     MCP_CONFIG_TARGET  '${MCP_CONFIG_TARGET}.tmp'
check_capture setup-antigravity-interactive.sh AGY_MCP_CONFIG     '${AGY_MCP_CONFIG}.tmp'

# ---------------------------------------------------------------------------
echo "4. Setup-script parity (all three overwrite-based setups call the helper)"
# ---------------------------------------------------------------------------
for s in setup-gemini-interactive.sh setup-copilot-interactive.sh \
         setup-antigravity-interactive.sh; do
  if grep -q "merge_preexisting_mcp_servers" "$SETUP_DIR/$s"; then
    ok "invokes merge_preexisting_mcp_servers: $s"
  else
    bad "missing merge_preexisting_mcp_servers call: $s"
  fi
done

# ---------------------------------------------------------------------------
echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
