#!/bin/bash
# test-setup-mcp-fold-secrets-argv.sh — Regression tests for issue #1248: the
# MCP fold helpers must never put a JSON blob that can hold an operator/org
# secret on jq's argv (visible to other local users via /proc/<pid>/cmdline or
# `ps -axo args`), and every write to an MCP config target must go through an
# unpredictable, 0600, atomically-renamed temp file rather than a predictable
# "${config}.tmp".
#
# Units under test (all in scripts/lib/common.sh):
#   merge_preexisting_mcp_servers  — spec 0089 fold, rewritten to route the
#                                    operator's pre-run servers through
#                                    --slurpfile from a private 0600 file.
#   apply_org_mcp_servers          — spec 0091 fold, same treatment for BOTH
#                                    its R11 collision probe and its final fold.
#   write_json_config_secure_from  — new src-to-dest primitive backing the
#                                    three template writes in the Copilot and
#                                    Antigravity setup scripts.
#
# Method for the argv-secrecy assertions: a stub `jq` is placed first on PATH.
# It appends every argv token it receives (one per line) to a log file, then
# `exec`s the REAL jq (captured via `command -v jq` BEFORE PATH is touched) so
# the actual fold still runs correctly. A distinctive canary string is folded
# through each helper; the test asserts the canary never appears in the argv
# log while still landing verbatim in the resulting config file (functional
# parity with the pre-#1248 behaviour is not sacrificed for the hardening).
#
# HERMETIC: no HOME writes. Every fixture and result lives under a throwaway
# temp root removed on exit; PATH is restored after every stubbed call.
#
# Usage:
#   bash scripts/tests/test-setup-mcp-fold-secrets-argv.sh

# -e intentionally omitted: pass/fail counters drive the harness.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
COMMON_LIB="$REPO_DIR/scripts/lib/common.sh"

if [ ! -f "$COMMON_LIB" ]; then
  echo "FATAL: missing $COMMON_LIB" >&2
  exit 2
fi
command -v jq >/dev/null 2>&1 || { echo "FATAL: jq is required for this test" >&2; exit 2; }

# Captured BEFORE common.sh is sourced or PATH is ever touched, so every stub
# generated below can still delegate to the real interpreter.
REAL_JQ="$(command -v jq)"

# shellcheck source=scripts/lib/common.sh
source "$COMMON_LIB"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

# file_mode <file> — portable: GNU `stat -c %a`, else BSD `stat -f %Lp`.
file_mode() {
  local m
  if m="$(stat -c %a "$1" 2>/dev/null)" && [[ "$m" =~ ^[0-7]+$ ]]; then
    echo "$m"
  else
    stat -f %Lp "$1" 2>/dev/null
  fi
}

assert_mode_0600() {
  local label="$1" file="$2" m
  m="$(file_mode "$file")"
  [ "$m" = "600" ] && ok "$label: mode is 0600" || bad "$label: expected mode 600, got '$m'"
}

# with_jq_stub <argv_log> <command...> — runs <command...> with a logging jq
# stub first on PATH, then restores PATH. The stub's own argv (from the log
# file's name onward) is baked into the generated script at creation time; the
# stub's OWN invocation argv ("$@" at runtime) is escaped so it is captured
# fresh on every call.
with_jq_stub() {
  local log="$1"; shift
  local stub_dir
  stub_dir="$(mktemp -d "$TMP_ROOT/jqstub.XXXXXX")"
  cat > "$stub_dir/jq" <<STUBEOF
#!/usr/bin/env bash
printf '%s\n' "\$@" >> "$log"
printf -- '---\n' >> "$log"
exec "$REAL_JQ" "\$@"
STUBEOF
  chmod +x "$stub_dir/jq"
  local old_path="$PATH"
  PATH="$stub_dir:$PATH"
  hash -r
  "$@"
  local rc=$?
  PATH="$old_path"
  hash -r
  return $rc
}

# --- Fixtures ---------------------------------------------------------------
CANARY_A="CANARY_SECRET_9f3d2a"
CANARY_ORG="CANARY_ORG_7b2e1c"
CANARY_PRE="CANARY_PRE_4d8f0a"
CANARY_D="CANARY_FROM_1a2b3c"

# ---------------------------------------------------------------------------
echo "1. merge_preexisting_mcp_servers — canary never on jq's argv"
# ---------------------------------------------------------------------------
op_pre_a="{\"github\":{\"command\":\"gh-ent\",\"args\":[\"mcp\",\"--stdio\"],\"env\":{\"GITHUB_TOKEN\":\"$CANARY_A\"}}}"
cfg_a="$TMP_ROOT/a-cfg.json"
printf '{"mcpServers":{}}' > "$cfg_a"
log_a="$TMP_ROOT/a-argv.log"
: > "$log_a"

with_jq_stub "$log_a" merge_preexisting_mcp_servers "$op_pre_a" "$cfg_a" "" >/dev/null
rc_a=$?

[ "$rc_a" -eq 0 ] && ok "1: merge_preexisting_mcp_servers succeeded" || bad "1: merge_preexisting_mcp_servers failed (rc=$rc_a)"

if grep -qF "$CANARY_A" "$log_a"; then
  bad "1: canary secret appeared on jq's argv"
else
  ok "1: canary secret never appears on jq's argv"
fi

got_a="$(jq -r '.mcpServers.github.env.GITHUB_TOKEN // empty' "$cfg_a" 2>/dev/null)"
[ "$got_a" = "$CANARY_A" ] \
  && ok "1: canary lands verbatim in the config (functional parity, R2/R3/R4)" \
  || bad "1: expected canary '$CANARY_A' in config, got '$got_a'"

assert_mode_0600 "1" "$cfg_a"

# ---------------------------------------------------------------------------
echo "2. apply_org_mcp_servers — canaries never on jq's argv (collision probe + fold)"
# ---------------------------------------------------------------------------
org_native_b="{\"github\":{\"command\":\"gh-org\",\"args\":[\"mcp\"],\"env\":{\"ORG_TOKEN\":\"$CANARY_ORG\"}}}"
preexisting_b="{\"github\":{\"command\":\"gh-old\",\"args\":[\"mcp\"],\"env\":{\"OLD_TOKEN\":\"$CANARY_PRE\"}}}"
cfg_b="$TMP_ROOT/b-cfg.json"
printf '{"mcpServers":{}}' > "$cfg_b"
log_b="$TMP_ROOT/b-argv.log"
: > "$log_b"

out_b="$(with_jq_stub "$log_b" apply_org_mcp_servers "$org_native_b" "$cfg_b" "$preexisting_b" "" 2>&1)"
rc_b=$?

[ "$rc_b" -eq 0 ] && ok "2: apply_org_mcp_servers succeeded" || bad "2: apply_org_mcp_servers failed (rc=$rc_b)"

if grep -qF "$CANARY_ORG" "$log_b" || grep -qF "$CANARY_PRE" "$log_b"; then
  bad "2: a canary secret appeared on jq's argv (out: $out_b)"
else
  ok "2: neither canary (org nor pre-existing) appears on jq's argv"
fi

# R11: 'github' is a non-reserved name declared by both org and the operator,
# so the collision-probe warning must fire (exercises that jq call too).
if grep -qF "'github'" <<< "$out_b"; then
  ok "2: R11 collision warning fired for the colliding non-reserved name"
else
  bad "2: expected R11 collision warning for 'github' (out: $out_b)"
fi

got_b="$(jq -r '.mcpServers.github.env.ORG_TOKEN // empty' "$cfg_b" 2>/dev/null)"
[ "$got_b" = "$CANARY_ORG" ] \
  && ok "2: org declaration wins verbatim in the config (functional parity, R11)" \
  || bad "2: expected org canary '$CANARY_ORG' in config, got '$got_b'"

assert_mode_0600 "2" "$cfg_b"

# ---------------------------------------------------------------------------
echo "3. Pre-planted \${config}.tmp symlink probe (regression pin)"
# ---------------------------------------------------------------------------
# Neither helper creates a literal "\${config_path}.tmp" any more — only
# mktemp'd names (write_json_config_secure's own "\${cfg}.tmp.XXXXXX", plus
# this ticket's "\${prefix}.secret.XXXXXX") — so a pre-planted symlink at the
# OLD predictable name can never be followed. This test pins that guarantee.

# 3a. merge_preexisting_mcp_servers
cfg_c1="$TMP_ROOT/c1-cfg.json"
printf '{"mcpServers":{}}' > "$cfg_c1"
canary_file_c1="$TMP_ROOT/c1-canary.txt"
printf 'UNTOUCHED-MERGE' > "$canary_file_c1"
ln -s "$canary_file_c1" "${cfg_c1}.tmp"

merge_preexisting_mcp_servers '{"acme-tools":{"command":"acme"}}' "$cfg_c1" "" >/dev/null
rc_c1=$?

content_c1="$(cat "$canary_file_c1")"
[ "$rc_c1" -eq 0 ] && [ "$content_c1" = "UNTOUCHED-MERGE" ] \
  && ok "3a: merge_preexisting_mcp_servers never follows a pre-planted \${config}.tmp symlink" \
  || bad "3a: canary file was modified (rc=$rc_c1, content='$content_c1')"

[ -L "${cfg_c1}.tmp" ] \
  && ok "3a: the pre-planted \${config}.tmp symlink itself is untouched" \
  || bad "3a: the pre-planted \${config}.tmp symlink was consumed"

if jq -e '.mcpServers | has("acme-tools")' "$cfg_c1" >/dev/null 2>&1; then
  ok "3a: the real config still received the fold"
else
  bad "3a: the real config path was not correctly written"
fi

# 3b. apply_org_mcp_servers
cfg_c2="$TMP_ROOT/c2-cfg.json"
printf '{"mcpServers":{}}' > "$cfg_c2"
canary_file_c2="$TMP_ROOT/c2-canary.txt"
printf 'UNTOUCHED-ORG' > "$canary_file_c2"
ln -s "$canary_file_c2" "${cfg_c2}.tmp"

apply_org_mcp_servers '{"github":{"command":"gh-org"}}' "$cfg_c2" '{}' "" >/dev/null
rc_c2=$?

content_c2="$(cat "$canary_file_c2")"
[ "$rc_c2" -eq 0 ] && [ "$content_c2" = "UNTOUCHED-ORG" ] \
  && ok "3b: apply_org_mcp_servers never follows a pre-planted \${config}.tmp symlink" \
  || bad "3b: canary file was modified (rc=$rc_c2, content='$content_c2')"

[ -L "${cfg_c2}.tmp" ] \
  && ok "3b: the pre-planted \${config}.tmp symlink itself is untouched" \
  || bad "3b: the pre-planted \${config}.tmp symlink was consumed"

if jq -e '.mcpServers | has("github")' "$cfg_c2" >/dev/null 2>&1; then
  ok "3b: the real config still received the fold"
else
  bad "3b: the real config path was not correctly written"
fi

# ---------------------------------------------------------------------------
echo "4. write_json_config_secure_from"
# ---------------------------------------------------------------------------

# 4a. string-src form, with a --slurpfile secret in a realistic call shape
# (defense-in-depth: none of the real call sites plumb a secret through
# _from itself, but the primitive must still never put one on argv).
src_d1="$TMP_ROOT/d1-src.json"
printf '{"mcpServers":{}}' > "$src_d1"
secret_file_d1="$TMP_ROOT/d1-secret.json"
printf '{"token":"%s"}' "$CANARY_D" > "$secret_file_d1"
dest_d1="$TMP_ROOT/d1-dest.json"
log_d1="$TMP_ROOT/d1-argv.log"
: > "$log_d1"

with_jq_stub "$log_d1" write_json_config_secure_from "$dest_d1" "$src_d1" \
  --slurpfile s "$secret_file_d1" '.mcpServers.x = $s[0]' >/dev/null
rc_d1=$?

[ "$rc_d1" -eq 0 ] && ok "4a: write_json_config_secure_from (string src) succeeded" \
  || bad "4a: write_json_config_secure_from (string src) failed (rc=$rc_d1)"

if grep -qF "$CANARY_D" "$log_d1"; then
  bad "4a: canary appeared on jq's argv"
else
  ok "4a: canary never appears on jq's argv"
fi

got_d1="$(jq -r '.mcpServers.x.token // empty' "$dest_d1" 2>/dev/null)"
[ "$got_d1" = "$CANARY_D" ] \
  && ok "4a: canary lands verbatim in the destination" \
  || bad "4a: expected canary '$CANARY_D' in destination, got '$got_d1'"
assert_mode_0600 "4a" "$dest_d1"

# 4b. stdin ("-") src form.
dest_d2="$TMP_ROOT/d2-dest.json"
echo '{"mcpServers":{"mempalace":{"command":"bash"}}}' | write_json_config_secure_from "$dest_d2" - '.'
rc_d2=$?

[ "$rc_d2" -eq 0 ] && ok "4b: write_json_config_secure_from (stdin src) succeeded" \
  || bad "4b: write_json_config_secure_from (stdin src) failed (rc=$rc_d2)"

if jq -e '.mcpServers.mempalace.command == "bash"' "$dest_d2" >/dev/null 2>&1; then
  ok "4b: stdin content lands correctly in the destination"
else
  bad "4b: stdin content did not land in the destination"
fi
assert_mode_0600 "4b" "$dest_d2"

# 4c. Pre-planted "${dest}.tmp" AND "${dest}.stage" symlinks — neither name is
# ever produced literally (only mktemp'd "${dest}.stage.XXXXXX" and, inside
# write_json_config_secure, "${stage}.tmp.XXXXXX"), so both are expected to
# stay untouched; this test pins that guarantee against regression.
dest_d3="$TMP_ROOT/d3-dest.json"
canary_tmp_d3="$TMP_ROOT/d3-tmp-canary.txt"
printf 'UNTOUCHED-TMP' > "$canary_tmp_d3"
canary_stage_d3="$TMP_ROOT/d3-stage-canary.txt"
printf 'UNTOUCHED-STAGE' > "$canary_stage_d3"
ln -s "$canary_tmp_d3" "${dest_d3}.tmp"
ln -s "$canary_stage_d3" "${dest_d3}.stage"

src_d3="$TMP_ROOT/d3-src.json"
printf '{"mcpServers":{}}' > "$src_d3"

write_json_config_secure_from "$dest_d3" "$src_d3" '.mcpServers.y = 1' >/dev/null
rc_d3=$?

content_tmp_d3="$(cat "$canary_tmp_d3")"
content_stage_d3="$(cat "$canary_stage_d3")"
[ "$rc_d3" -eq 0 ] && [ "$content_tmp_d3" = "UNTOUCHED-TMP" ] && [ "$content_stage_d3" = "UNTOUCHED-STAGE" ] \
  && ok "4c: write_json_config_secure_from never follows a pre-planted .tmp or .stage symlink" \
  || bad "4c: a canary file was modified (rc=$rc_d3, tmp='$content_tmp_d3', stage='$content_stage_d3')"

[ -L "${dest_d3}.tmp" ] && [ -L "${dest_d3}.stage" ] \
  && ok "4c: both pre-planted symlinks are themselves untouched" \
  || bad "4c: a pre-planted symlink was consumed"

if jq -e '.mcpServers.y == 1' "$dest_d3" >/dev/null 2>&1; then
  ok "4c: the real destination still received the write"
else
  bad "4c: the real destination path was not correctly written"
fi
assert_mode_0600 "4c" "$dest_d3"

# ---------------------------------------------------------------------------
echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
