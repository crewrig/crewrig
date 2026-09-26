#!/bin/bash
# test-setup-mcp-merge.sh — Regression tests for the pre-existing MCP-server
# preservation-on-setup behaviour (spec 0089).
#
# Unit under test: merge_preexisting_mcp_servers() in scripts/lib/common.sh,
# the single shared helper the two overwrite-based setups (Copilot,
# Antigravity) call to fold an operator's pre-existing MCP declarations back
# over the framework-written config, and that the Gemini setup calls from
# gemini_settings_write (scripts/lib/gemini-settings.sh) after its in-place
# merge (spec 0214), for the R9 warnings. The helper owns the whole policy, so it is
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
#   R11 — asserted per framework-doc shape below AND, for the two
#     overwrite-based scripts, that the operator's pre-run config is CAPTURED
#     BEFORE the framework overwrite (ordering) and that the capture actually
#     reads the operator's servers (functional) — a plain call-site grep cannot
#     catch a mis-timed or wrong-file capture (spec 0089 review F1). Gemini no
#     longer overwrites: its capture-merge-fold sequence is one library
#     function, exercised behaviourally by test-setup-gemini-settings-merge.sh.
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
  if grep -q "'$name'" <<< "$OUT" \
     && grep -qF "$BACKUP_REF" <<< "$OUT"; then
    ok "$label: warning names '$name' and points at the backup"
  else
    bad "$label: missing R9 warning for '$name' (out: $OUT)"
  fi
}

# assert_no_warn <label> <name>
assert_no_warn() {
  local label="$1" name="$2"
  if grep -q "'$name'" <<< "$OUT"; then
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

check_capture setup-copilot-interactive.sh     MCP_CONFIG_TARGET  'write_json_config_secure_from "$MCP_CONFIG_TARGET"'
check_capture setup-antigravity-interactive.sh AGY_MCP_CONFIG     'write_json_config_secure_from "$AGY_MCP_CONFIG"'

# ---------------------------------------------------------------------------
echo "4. Setup-script parity (all three file setups reach the helper)"
# ---------------------------------------------------------------------------
for s in setup-copilot-interactive.sh setup-antigravity-interactive.sh; do
  if grep -q "merge_preexisting_mcp_servers" "$SETUP_DIR/$s"; then
    ok "invokes merge_preexisting_mcp_servers: $s"
  else
    bad "missing merge_preexisting_mcp_servers call: $s"
  fi
done
# Gemini (spec 0214): the setup calls gemini_settings_write, and that library
# function is where the helper is called.
GEMINI_LIB="$SETUP_DIR/lib/gemini-settings.sh"
if grep -qE '^[[:space:]]*gemini_settings_write[[:space:]]' "$SETUP_DIR/setup-gemini-interactive.sh"; then
  ok "invokes gemini_settings_write: setup-gemini-interactive.sh"
else
  bad "missing gemini_settings_write call: setup-gemini-interactive.sh"
fi
if grep -qE '^[[:space:]]*merge_preexisting_mcp_servers[[:space:]]' "$GEMINI_LIB"; then
  ok "invokes merge_preexisting_mcp_servers: lib/gemini-settings.sh"
else
  bad "missing merge_preexisting_mcp_servers call: lib/gemini-settings.sh"
fi

# ---------------------------------------------------------------------------
echo "5. backup_file helper behaviour (spec 0089 R9/R10, issue #982)"
# ---------------------------------------------------------------------------

# 5a. Existing regular file is backed up, sets LAST_BACKUP_PATH, announces success
src_file="$TMP_ROOT/valid_src.json"
echo '{"hello":"world"}' > "$src_file"
out_5a_file="$TMP_ROOT/out_5a.txt"
backup_file "$src_file" > "$out_5a_file" 2>&1
out_5a="$(cat "$out_5a_file")"
if [ -n "$LAST_BACKUP_PATH" ] && [ -f "$LAST_BACKUP_PATH" ]; then
  ok "backup_file sets LAST_BACKUP_PATH to existing file on success"
else
  bad "backup_file failed to set valid LAST_BACKUP_PATH (got: '$LAST_BACKUP_PATH')"
fi
if grep -q "Backed up: valid_src.json ->" <<< "$out_5a"; then
  ok "backup_file reports success on stdout"
else
  bad "backup_file missing success message on stdout (got: '$out_5a')"
fi

# 5b. Absent target leaves LAST_BACKUP_PATH empty and emits no output
absent_file="$TMP_ROOT/nonexistent.json"
out_5b_file="$TMP_ROOT/out_5b.txt"
backup_file "$absent_file" > "$out_5b_file" 2>&1
out_5b="$(cat "$out_5b_file")"
if [ -z "$LAST_BACKUP_PATH" ]; then
  ok "backup_file leaves LAST_BACKUP_PATH empty on absent file"
else
  bad "backup_file set LAST_BACKUP_PATH on absent file (got: '$LAST_BACKUP_PATH')"
fi
if [ -z "$out_5b" ]; then
  ok "backup_file produces no output for absent target"
else
  bad "backup_file produced unexpected output for absent target: '$out_5b'"
fi

# 5c. Target cannot be copied (forcing cp failure when writing backup next to target)
#
# A `chmod 555` on the directory used to simulate this, but a containerized CI
# runner as root (UID 0) bypasses Unix permission checks entirely, so under
# root `cp` would silently succeed and this whole case would turn into a
# no-op pass (issue #1215). Stub `cp` on PATH instead, scoped to this one
# invocation of backup_file via a PATH assignment prefix (verified not to leak
# outside the command it prefixes): any argument under `$no_write_dir` fails
# deterministically, so both the source being backed up and the sibling
# backup destination trip it, exactly reproducing the write failure
# `backup_file` must handle — regardless of the runner's UID.
no_write_dir="$TMP_ROOT/nowrite_dir"
mkdir -p "$no_write_dir"
unwritable_target="$no_write_dir/src.json"
echo '{"test":1}' > "$unwritable_target"
cp_stub_dir="$TMP_ROOT/cp_stub_bin"
mkdir -p "$cp_stub_dir"
real_cp="$(command -v cp)"
cat > "$cp_stub_dir/cp" <<STUB
#!/usr/bin/env bash
for arg in "\$@"; do
  case "\$arg" in
    "${no_write_dir}"/*) exit 1 ;;
  esac
done
exec "${real_cp}" "\$@"
STUB
chmod +x "$cp_stub_dir/cp"
out_5c_file="$TMP_ROOT/out_5c.txt"
PATH="$cp_stub_dir:$PATH" backup_file "$unwritable_target" > "$out_5c_file" 2>&1
out_5c="$(cat "$out_5c_file")"
if [ -z "$LAST_BACKUP_PATH" ]; then
  ok "backup_file leaves LAST_BACKUP_PATH empty when cp fails (issue #982)"
else
  bad "backup_file published nonexistent LAST_BACKUP_PATH on failure (got: '$LAST_BACKUP_PATH')"
fi
if grep -q "WARNING: Failed to back up src.json" <<< "$out_5c"; then
  ok "backup_file emits warning on stderr when backup fails"
else
  bad "backup_file missing failure warning (got: '$out_5c')"
fi
if grep -q "Backed up:" <<< "$out_5c"; then
  bad "backup_file falsely reported success when copy failed"
else
  ok "backup_file does not falsely report success when copy fails"
fi

# 5d. Symlink target is backed up with -P (preserves symlink)
link_target="$TMP_ROOT/link_src.json"
echo '{"link":true}' > "$link_target"
symlink_path="$TMP_ROOT/symlink.json"
ln -s "$link_target" "$symlink_path"
out_5d_file="$TMP_ROOT/out_5d.txt"
backup_file "$symlink_path" > "$out_5d_file" 2>&1
out_5d="$(cat "$out_5d_file")"
if [ -n "$LAST_BACKUP_PATH" ] && [ -L "$LAST_BACKUP_PATH" ]; then
  ok "backup_file preserves symlink on backup (-P)"
else
  bad "backup_file failed to preserve symlink as backup (got: '$LAST_BACKUP_PATH')"
fi

# 5e. Same-second collision: two backup_file calls on the same target within
# the same wall-clock second must not silently overwrite the first backup
# (issue #1246). `date` is stubbed on PATH, scoped to each backup_file call
# (same technique as 5c's `cp` stub), so both calls resolve to the identical
# fixed stamp regardless of real time, forcing a deterministic collision.
date_stub_dir="$TMP_ROOT/date_stub_bin"
mkdir -p "$date_stub_dir"
cat > "$date_stub_dir/date" <<'STUB'
#!/usr/bin/env bash
echo "20260101-120000"
STUB
chmod +x "$date_stub_dir/date"

collision_target="$TMP_ROOT/collision_src.json"
echo -n 'A' > "$collision_target"
first_backup="${collision_target}.bak.20260101-120000"
second_backup="${collision_target}.bak.20260101-120000.01"

PATH="$date_stub_dir:$PATH" backup_file "$collision_target" >/dev/null 2>&1
if [ "$LAST_BACKUP_PATH" = "$first_backup" ]; then
  ok "backup_file (issue #1246): first same-second backup keeps the unsuffixed name"
else
  bad "backup_file (issue #1246): expected first backup at '$first_backup', got LAST_BACKUP_PATH='$LAST_BACKUP_PATH'"
fi

echo -n 'B' > "$collision_target"
PATH="$date_stub_dir:$PATH" backup_file "$collision_target" >/dev/null 2>&1

if [ -f "$first_backup" ] && [ "$(cat "$first_backup")" = 'A' ]; then
  ok "backup_file (issue #1246): first backup survives the second call's same-second collision"
else
  bad "backup_file (issue #1246): first backup was overwritten by the collision (got: '$(cat "$first_backup" 2>/dev/null)')"
fi
if [ -f "$second_backup" ] && [ "$(cat "$second_backup")" = 'B' ]; then
  ok "backup_file (issue #1246): collision gets a distinctly-named second backup ('.01')"
else
  bad "backup_file (issue #1246): expected a distinct second backup at '$second_backup'"
fi
if [ "$LAST_BACKUP_PATH" = "$second_backup" ]; then
  ok "backup_file (issue #1246): LAST_BACKUP_PATH points at the second backup after collision"
else
  bad "backup_file (issue #1246): LAST_BACKUP_PATH expected '$second_backup', got '$LAST_BACKUP_PATH'"
fi

# ---------------------------------------------------------------------------
echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
