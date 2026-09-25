#!/bin/bash
# test-setup-gemini-settings-merge.sh — Hermetic regression suite for the
# in-place merge of ~/.gemini/settings.json by the Gemini setup (spec 0214,
# issue #1210).
#
# Before spec 0214 the setup rebuilt the whole file from
# config/gemini/settings.json on every run and carried across only the MCP
# servers (spec 0089) and the usage-capture commands (spec 0211 R13): every
# other operator key and every other hook entry was lost. This suite pins the
# preserving behaviour.
#
# Unit under test: gemini_settings_write in scripts/lib/gemini-settings.sh, the
# ONE function the setup calls for its settings write (backup, JSONC read,
# merge, reserved MCP entries, spec 0089 / 0091 folds). A "setup run" below is
# that call followed, in the setup's own order, by the library steps the
# interactive script runs after it: the HTTP registration of mempalace
# (register_mempalace_mcp), the session-recording merge
# (merge_session_recording_hooks, on the manifest patched by the same jq
# transform the setup applies) and the usage-capture answer
# (usage_capture_apply). The interactive script itself cannot run in CI (fzf
# prompts, the chroma daemon), so its wiring is asserted structurally (§13).
#
# Coverage map (spec 0214):
#   §1  R11, R13 — the absent-file document, against an inline oracle that is
#       independent of gemini_framework_mcp; empty and comment-only files.
#   §2  R2, R3, R18(a) — operator content and seeds.
#   §3  R3, R4, R5, R16, R18(b) — hooks across an accepting then a declining run.
#   §4  R6, R7, R18(c) — context.fileName union and malformed lists.
#   §5  R8, R18(d) — reserved entries replaced whole or removed.
#   §6  R11, R12, R13, R18(e) — repair of a file that is not a JSON object.
#   §7  R12, R18(g) — commented files, `//` and `/*` inside strings.
#   §8  R2, R7, R18(h) — non-object ancestors.
#   §9  R9, R14, R18(f) — idempotent re-runs, TLS wrapper once.
#   §10 R10 — framework-reserved > org > operator.
#   §11 R13 and the return codes (plan review v1-F3): backup first, rc 1, rc 2.
#   §12 Plain-JSON fast path (plan review v1-F2): a ~200 KB file.
#   §13 Structural checks on scripts/setup-gemini-interactive.sh (R15, R16).
#
# HERMETIC: HOME is a temp root, so ~/.gemini is never touched. No fzf, no
# MemPalace daemon, no network: register_mempalace_mcp only writes the file.
# The MemPalace interpreter is a fake path; nothing executes it.
#
# Usage:
#   bash scripts/tests/test-setup-gemini-settings-merge.sh

# -e intentionally omitted: pass/fail counters drive the harness, and some
# probes (jq -e, grep -q) return non-zero on purpose.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LIB_DIR="$REPO_DIR/scripts/lib"
SETUP_SCRIPT="$REPO_DIR/scripts/setup-gemini-interactive.sh"
TEMPLATE="$REPO_DIR/config/gemini/settings.json"
TRANSCRIPT_MANIFEST="$REPO_DIR/hooks/gemini-transcript-hooks.json"

for f in "$LIB_DIR/common.sh" "$LIB_DIR/usage-capture-optin.sh" "$LIB_DIR/gemini-settings.sh" \
         "$SETUP_SCRIPT" "$TEMPLATE" "$TRANSCRIPT_MANIFEST"; do
  [ -f "$f" ] || { echo "FATAL: missing $f" >&2; exit 2; }
done
command -v jq >/dev/null 2>&1 || { echo "FATAL: jq is required for this test" >&2; exit 2; }

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

# HOME is redirected BEFORE the libraries are sourced, so nothing they compute
# from it can point at the real home.
HOME="$TMP_ROOT/home0"
export HOME
mkdir -p "$HOME"

# shellcheck source=scripts/lib/common.sh
source "$LIB_DIR/common.sh"
# shellcheck source=scripts/lib/usage-capture-optin.sh
source "$LIB_DIR/usage-capture-optin.sh"
# shellcheck source=scripts/lib/gemini-settings.sh
source "$LIB_DIR/gemini-settings.sh"

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

echo "jq: $(jq --version 2>&1)"

# --- Constants ----------------------------------------------------------------
FAKE_PY="/opt/crewrig-test/bin/python3"
HTTP_TOKEN="test-token-0214"
TEMPLATE_FILES="$(jq -c '.context.fileName' "$TEMPLATE")"

# R11 oracle: the reserved MCP entries today's absent-file pipeline writes,
# spelled out as literals (placeholders __REPO__ / __PY__), NOT derived from
# gemini_framework_mcp. Only a change to the template's mcpServers breaks it.
ORACLE_MCP_PY_TMPL='{
  "mempalace": {
    "command": "bash",
    "args": ["__REPO__/scripts/lib/tls-exec.sh", "__PY__",
             "__REPO__/scripts/lib/mempalace-http-wrapper.py"]
  },
  "sequentialthinking": {
    "command": "bash",
    "args": ["__REPO__/scripts/lib/tls-exec.sh", "npx", "-y",
             "@modelcontextprotocol/server-sequential-thinking"]
  }
}'
ORACLE_MCP_PY="${ORACLE_MCP_PY_TMPL//__REPO__/$REPO_DIR}"
ORACLE_MCP_PY="${ORACLE_MCP_PY//__PY__/$FAKE_PY}"
ORACLE_MCP_NOPY="$(jq -c 'del(.mempalace)' <<< "$ORACLE_MCP_PY")"
ORACLE_MEMPALACE="$(jq -Sc '.mempalace' <<< "$ORACLE_MCP_PY")"
ORACLE_SEQ="$(jq -Sc '.sequentialthinking' <<< "$ORACLE_MCP_PY")"
# The whole absent-file document: the template, mcpServers replaced.
FRESH_PY="$(jq -Sc --argjson m "$ORACLE_MCP_PY" '.mcpServers = $m' "$TEMPLATE")"
FRESH_NOPY="$(jq -Sc --argjson m "$ORACLE_MCP_NOPY" '.mcpServers = $m' "$TEMPLATE")"

# The session-recording manifest, patched by the same jq transform
# scripts/setup-gemini-interactive.sh applies (and
# test-setup-gemini-transcript.sh §2 replays).
HOOK_TARGET="$TMP_ROOT/gemini-hooks/mempalace-transcript.sh"
GUARD_ABS="$(cd "$REPO_DIR/hooks" && pwd -P)/worktree-git-guard.sh"
PATCHED_MANIFEST="$TMP_ROOT/patched-transcript-hooks.json"
jq --arg envp "MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=$FAKE_PY" \
   --arg hook_path "$HOOK_TARGET" --arg guard_path "$GUARD_ABS" '
  (.. | objects | select(.type? == "command")) |=
    (if (.name? == "transcript-git-guard" or (.command | contains("worktree-git-guard.sh")))
     then .command = ("bash " + $guard_path)
     else .command = ($envp + " " + (.command | gsub("\\$\\{GEMINI_PROJECT_DIR\\}/hooks/mempalace-transcript.sh"; $hook_path)))
     end)' "$TRANSCRIPT_MANIFEST" > "$PATCHED_MANIFEST" \
  || { echo "FATAL: could not patch $TRANSCRIPT_MANIFEST" >&2; exit 2; }
SESSION_CMDS="$(jq -c '[.hooks[][] | .hooks[] | .command] | unique' "$PATCHED_MANIFEST")"

# --- Harness --------------------------------------------------------------------
# new_case — a fresh HOME per case, so backups, hook targets and warnings never
# mix between cases. Sets T (the settings file), OUT and ERR.
CASE_N=0
new_case() {
  CASE_N=$((CASE_N + 1))
  HOME="$TMP_ROOT/case$CASE_N"
  export HOME
  mkdir -p "$HOME/.gemini"
  T="$HOME/.gemini/settings.json"
  OUT="$HOME/stdout.txt"
  ERR="$HOME/stderr.txt"
  : > "$OUT"
  : > "$ERR"
}

# gs_write <python|""> <org_native|""> — the settings step alone. Sets RC.
gs_write() {
  RC=0
  gemini_settings_write "$T" "$TEMPLATE" "$REPO_DIR" "$1" "$2" < /dev/null > "$OUT" 2> "$ERR" || RC=$?
}

# setup_run <python|""> <org|""> <session yes|no> <capture answer> <http yes|no>
# One setup run, in the setup's order. The capture answer is passed through
# usage_capture_apply exactly as the setup passes the fzf answer ("" = dismissed).
# Sets RC: 0, or the settings rc, or 10/11/12 for a later step that failed.
setup_run() {
  local py="$1" org="$2" session="$3" capture="$4" http="$5" state
  gs_write "$py" "$org"
  [ "$RC" -eq 0 ] || return 0
  if [ -n "$py" ] && [ "$http" = "yes" ]; then
    register_mempalace_mcp gemini "$HTTP_TOKEN" >> "$OUT" 2>> "$ERR" || { RC=10; return 0; }
  fi
  if [ "$session" = "yes" ]; then
    merge_session_recording_hooks gemini "$T" "$PATCHED_MANIFEST" >> "$OUT" 2>> "$ERR" || { RC=11; return 0; }
  fi
  state="$(usage_capture_state gemini "$T" 2>> "$ERR")" || { RC=12; return 0; }
  usage_capture_apply gemini "$T" "$REPO_DIR" "$state" "$capture" >> "$OUT" 2>> "$ERR" || RC=12
}

# put <content-via-stdin> — write the settings file from a heredoc.
put() { cat > "$T"; }

# doc — the settings file as canonical (sorted-key) compact JSON.
doc() { jq -Sc . "$T" 2>/dev/null; }

# expect_json <label> <jq filter on the file> <expected JSON>
expect_json() {
  local label="$1" filter="$2" expected="$3" got exp
  got="$(jq -Sc "$filter" "$T" 2>/dev/null)"
  exp="$(jq -Sc . <<< "$expected" 2>/dev/null)"
  if [ -n "$exp" ] && [ "$got" = "$exp" ]; then
    ok "$label"
  else
    bad "$label: expected $exp, got ${got:-<unreadable>}"
  fi
}

expect_rc() {
  if [ "$RC" -eq "$2" ]; then ok "$1: rc $2"; else bad "$1: expected rc $2, got $RC (stderr: $(cat "$ERR"))"; fi
}

expect_mode600() {
  local mode
  mode="$(ls -l "$T" 2>/dev/null | cut -c1-10)"
  if [ "$mode" = "-rw-------" ]; then ok "$1: settings.json is 0600"; else bad "$1: settings.json mode is '$mode', expected -rw-------"; fi
}

# expect_no_tmp <label> — no snapshot or fold temporary is left beside the file.
expect_no_tmp() {
  local f left=""
  for f in "$T".tmp*; do
    [ -e "$f" ] && left="$left $f"
  done
  if [ -z "$left" ]; then ok "$1: no temporary file left"; else bad "$1: temporary files left:$left"; fi
}

# out_has / out_lacks <label> <fixed string> [file] — stdout (default) holds / lacks.
out_has() {
  if grep -qF -- "$2" "${3:-$OUT}"; then ok "$1"; else bad "$1: '$2' not found in: $(cat "${3:-$OUT}")"; fi
}
out_lacks() {
  if grep -qF -- "$2" "${3:-$OUT}"; then bad "$1: unexpected '$2' in: $(cat "${3:-$OUT}")"; else ok "$1"; fi
}

# backup_after <marker> — the backup path named on the line after the first
# stdout line holding <marker> (every warning names the backup on its second line).
backup_after() {
  awk -v m="$1" 'found { sub(/.*timestamped backup: /, ""); print; exit } index($0, m) { found = 1 }' "$OUT"
}

# expect_warning_backup <label> <marker> <original-bytes-file>
# The warning holding <marker> names a backup that exists, sits beside the
# target, and holds the prior bytes.
expect_warning_backup() {
  local label="$1" marker="$2" orig="$3" b
  b="$(backup_after "$marker")"
  case "$b" in
    "$T".bak.*) ;;
    *) bad "$label: warning '$marker' names no timestamped backup (got '$b'; stdout: $(cat "$OUT"))"; return ;;
  esac
  if [ -f "$b" ] && cmp -s "$b" "$orig"; then
    ok "$label: warning names the backup, which holds the prior bytes"
  else
    bad "$label: named backup '$b' is missing or differs from the prior file"
  fi
}

COMMENT_WARN="holds comments; they are not kept in the rewritten file."
INVALID_WARN="is not a JSON object, even with its comments removed; it was replaced by a fresh configuration."

# ---------------------------------------------------------------------------
echo "1. Absent and empty files give today's absent-file document (R11, R13)"
# ---------------------------------------------------------------------------
new_case
gs_write "$FAKE_PY" ""
expect_rc "1a fresh install, MemPalace present" 0
if [ "$(doc)" = "$FRESH_PY" ]; then ok "1a document equals the R11 oracle (MemPalace present)"; else bad "1a document differs from the R11 oracle: $(doc)"; fi
expect_mode600 "1a fresh install, stdio mempalace"
expect_no_tmp "1a"
out_lacks "1a absent file prints no warning" "WARNING"
if [ ! -s "$ERR" ]; then ok "1a no stderr"; else bad "1a unexpected stderr: $(cat "$ERR")"; fi

new_case
gs_write "" ""
expect_rc "1b fresh install, MemPalace absent" 0
if [ "$(doc)" = "$FRESH_NOPY" ]; then ok "1b document equals the R11 oracle (MemPalace absent)"; else bad "1b document differs from the R11 oracle: $(doc)"; fi
expect_mode600 "1b fresh install, MemPalace absent"

# label | content (printf format) | holds a comment?
while IFS='|' read -r label content has_comment; do
  new_case
  # shellcheck disable=SC2059  # the fixture IS the format: \n, \t, \r escapes
  printf "$content" > "$T"
  chmod 644 "$T"
  gs_write "" ""
  expect_rc "1c $label" 0
  if [ "$(doc)" = "$FRESH_NOPY" ]; then ok "1c $label: treated as absent"; else bad "1c $label: not the absent-file document: $(doc)"; fi
  expect_mode600 "1c $label"
  out_lacks "1c $label: no not-a-JSON-object warning" "$INVALID_WARN"
  if [ "$has_comment" = "yes" ]; then
    out_has "1c $label: comment warning" "WARNING: $T $COMMENT_WARN"
  else
    out_lacks "1c $label: no comment warning" "$COMMENT_WARN"
  fi
done <<'EOF'
zero-byte file||no
whitespace only| \n\t\r\n  |no
line comment only|// only a comment\n|yes
whitespace and block comment|\n  /* a block\n comment */ \n\n|yes
EOF

# ---------------------------------------------------------------------------
echo "2. Operator content survives; seeds fill only what is absent (R2, R3, R18a)"
# ---------------------------------------------------------------------------
new_case
put <<'EOF'
{
  "ui": {"theme": "Dracula", "hideBanner": true},
  "security": {"auth": {"selectedType": "gemini-api-key"}},
  "privacy": {"telemetryOptOut": true},
  "general": {"vimMode": true},
  "hooks": {"Notification": [{"matcher": "*", "hooks": [{"type": "command", "command": "notify-send gemini"}]}]},
  "mcpServers": {"acme-tools": {"command": "acme", "args": ["--serve"], "env": {"ACME_TOKEN": "xyz"}}}
}
EOF
cp "$T" "$HOME/before.json"
setup_run "$FAKE_PY" "" no "" no
expect_rc "2a re-run" 0
expect_json "2a operator key absent from the template kept" '.ui' '{"theme": "Dracula", "hideBanner": true}'
expect_json "2a operator security.auth.selectedType kept" '.security.auth.selectedType' '"gemini-api-key"'
expect_json "2a seed added beside the operator value (security.folderTrust)" '.security' \
  '{"auth": {"selectedType": "gemini-api-key"}, "folderTrust": {"enabled": true}}'
expect_json "2a seed added inside an operator object (privacy)" '.privacy' \
  '{"telemetryOptOut": true, "usageStatisticsEnabled": false}'
expect_json "2a deleted seed comes back (general.previewFeatures)" '.general' \
  '{"vimMode": true, "previewFeatures": true}'
expect_json "2a operator Notification hook kept" '.hooks' \
  '{"Notification": [{"matcher": "*", "hooks": [{"type": "command", "command": "notify-send gemini"}]}]}'
expect_json "2a non-reserved MCP server kept verbatim" '.mcpServers["acme-tools"]' \
  '{"command": "acme", "args": ["--serve"], "env": {"ACME_TOKEN": "xyz"}}'
expect_json "2a framework-owned context.fileName written" '.context.fileName' "$TEMPLATE_FILES"
expect_mode600 "2a"

# Operator values of any type win, false and null included (a `//` merge would
# read them as absent).
new_case
put <<'EOF'
{"general": {"previewFeatures": false}, "security": {"auth": {"selectedType": null}}, "privacy": null, "hooks": "operator-string"}
EOF
setup_run "" "" no "" no
expect_rc "2b re-run" 0
expect_json "2b operator false kept (general.previewFeatures)" '.general.previewFeatures' 'false'
expect_json "2b operator null kept (security.auth.selectedType)" '.security.auth' '{"selectedType": null}'
expect_json "2b null ancestor kept, no seed beneath it (privacy)" '.privacy' 'null'
expect_json "2b non-object hooks value kept (R3)" '.hooks' '"operator-string"'

# ---------------------------------------------------------------------------
echo "3. Hooks across an accepting then a declining run (R3, R4, R5, R16, R18b)"
# ---------------------------------------------------------------------------
new_case
put <<'EOF'
{"hooks": {"Notification": [{"matcher": "*", "hooks": [{"type": "command", "command": "notify-send gemini"}]}]}}
EOF
setup_run "$FAKE_PY" "" yes yes no
expect_rc "3a accepting run, capture enabled" 0
if jq -e --argjson want "$SESSION_CMDS" \
     '[.hooks[][] | .hooks[]? | .command] as $have | all($want[]; . as $c | any($have[]; . == $c))' "$T" >/dev/null 2>&1; then
  ok "3a session-recording hooks and worktree git guard registered"
else
  bad "3a session-recording commands missing: $(jq -c '.hooks' "$T")"
fi
expect_json "3a Notification hook kept on an accepting run (R5)" '.hooks.Notification' \
  '[{"matcher": "*", "hooks": [{"type": "command", "command": "notify-send gemini"}]}]'
if [ "$(usage_capture_state gemini "$T" 2>/dev/null)" = "installed" ]; then ok "3a usage capture installed"; else bad "3a usage capture not installed"; fi
HOOKS_RUN1="$(jq -Sc '.hooks' "$T")"
PATHS_RUN1="$(usage_capture_paths gemini "$T" 2>/dev/null)"

# Decline session recording, dismiss the capture question.
setup_run "$FAKE_PY" "" no "" no
expect_rc "3b declining run" 0
if [ "$(jq -Sc '.hooks' "$T")" = "$HOOKS_RUN1" ]; then
  ok "3b every hook entry of the earlier run left in place, unchanged (R4)"
else
  bad "3b hooks changed by a declining run: before $HOOKS_RUN1, after $(jq -Sc '.hooks' "$T")"
fi
if [ "$(usage_capture_state gemini "$T" 2>/dev/null)" = "installed" ] \
   && [ "$(usage_capture_paths gemini "$T" 2>/dev/null)" = "$PATHS_RUN1" ]; then
  ok "3b usage capture still registered at the same path (R16, spec 0211 R13)"
else
  bad "3b usage capture lost or moved by a declining run"
fi
expect_mode600 "3b"

# ---------------------------------------------------------------------------
echo "4. context.fileName is the ordered, de-duplicated union (R6, R7, R18c)"
# ---------------------------------------------------------------------------
new_case
put <<'EOF'
{"context": {"fileName": ["TEAM_NOTES.md", "AGENTS.md", "LOCAL.md", "TEAM_NOTES.md"], "loadMemoryFromIncludeDirectories": true}}
EOF
gs_write "" ""
expect_rc "4a union" 0
expect_json "4a template list in order, then TEAM_NOTES.md, then LOCAL.md, once each" '.context.fileName' \
  "$(jq -c '. + ["TEAM_NOTES.md", "LOCAL.md"]' <<< "$TEMPLATE_FILES")"
expect_json "4a other context members kept" '.context.loadMemoryFromIncludeDirectories' 'true'
out_lacks "4a no R7 warning for a valid list" "'context.fileName'"

new_case
put <<'EOF'
{"context": {"fileName": "MINE.md"}}
EOF
gs_write "" ""
expect_json "4b a single string is a one-entry list" '.context.fileName' \
  "$(jq -c '. + ["MINE.md"]' <<< "$TEMPLATE_FILES")"
out_lacks "4b no R7 warning for a string" "'context.fileName'"

for bad_value in '3' '["LOCAL.md", 1]'; do
  new_case
  printf '{"context": {"fileName": %s}}\n' "$bad_value" > "$T"
  cp "$T" "$HOME/before.json"
  gs_write "" ""
  expect_rc "4c fileName $bad_value" 0
  expect_json "4c fileName $bad_value replaced by the template list" '.context.fileName' "$TEMPLATE_FILES"
  out_has "4c fileName $bad_value: R7 warning names context.fileName" \
    "WARNING: 'context.fileName' in $T is not a string or a list of strings; it was replaced by the framework's value."
  expect_warning_backup "4c fileName $bad_value" "'context.fileName' in" "$HOME/before.json"
done

# ---------------------------------------------------------------------------
echo "5. Reserved MCP entries are replaced whole, or removed (R8, R18d)"
# ---------------------------------------------------------------------------
STALE_RESERVED='{"mcpServers": {
  "acme-tools": {"command": "acme", "args": ["--serve"]},
  "mempalace": {"type": "http", "url": "http://127.0.0.1:1/mcp", "headers": {"Authorization": "Bearer STALE-SECRET"}, "trust": true},
  "sequentialthinking": {"command": "bash", "args": ["/old/tls-exec.sh", "npx", "-y", "@modelcontextprotocol/server-sequential-thinking"], "timeout": 5}
}}'

new_case
printf '%s\n' "$STALE_RESERVED" > "$T"
cp "$T" "$HOME/before.json"
gs_write "$FAKE_PY" ""
expect_rc "5a stdio registration over a stale HTTP entry" 0
expect_json "5a mempalace is exactly the framework stdio entry (no url/headers/trust)" '.mcpServers.mempalace' "$ORACLE_MEMPALACE"
expect_json "5a sequentialthinking is exactly the framework entry (no timeout, one wrapper)" '.mcpServers.sequentialthinking' "$ORACLE_SEQ"
expect_json "5a operator server kept" '.mcpServers["acme-tools"]' '{"command": "acme", "args": ["--serve"]}'
if grep -qF "STALE-SECRET" "$T"; then bad "5a stale bearer token survived in settings.json"; else ok "5a stale bearer token gone from settings.json"; fi
out_has "5a spec 0089 R9 warning names mempalace" \
  "WARNING: 'mempalace' is a framework-managed MCP server — your prior 'mempalace' entry was replaced (framework wins)."
expect_warning_backup "5a R9 warning" "your prior 'mempalace' entry was replaced" "$HOME/before.json"

new_case
printf '%s\n' "$STALE_RESERVED" > "$T"
cp "$T" "$HOME/before.json"
gs_write "" ""
expect_rc "5b MemPalace absent" 0
if jq -e '.mcpServers | has("mempalace")' "$T" >/dev/null 2>&1; then bad "5b mempalace entry left although MemPalace is absent"; else ok "5b no mempalace entry"; fi
expect_json "5b operator server kept" '.mcpServers["acme-tools"]' '{"command": "acme", "args": ["--serve"]}'
out_has "5b spec 0089 R9 removal warning names mempalace" \
  "WARNING: 'mempalace' is a framework-managed MCP server — your prior 'mempalace' entry was removed (you declined it)."
expect_warning_backup "5b R9 warning" "your prior 'mempalace' entry was removed" "$HOME/before.json"

# ---------------------------------------------------------------------------
echo "6. A file that is not a JSON object is repaired (R11, R12, R13, R18e)"
# ---------------------------------------------------------------------------
# label | content (printf format). `1/**/2` and `tr/* */ue`: a comment is
# whitespace, so the tokens are not joined into 12 / true (plan review v1-F1);
# Gemini CLI rejects both. A leading BOM and a lone NBSP are rejected by
# JSON.parse, as the file is read by Gemini CLI.
while IFS='|' read -r label content; do
  new_case
  # shellcheck disable=SC2059  # the fixture IS the format: octal escapes
  printf "$content" > "$T"
  chmod 644 "$T"
  cp "$T" "$HOME/before.json"
  gs_write "" ""
  expect_rc "6 $label" 0
  if [ "$(doc)" = "$FRESH_NOPY" ]; then ok "6 $label: replaced by the absent-file document"; else bad "6 $label: not the absent-file document: $(doc)"; fi
  out_has "6 $label: not-a-JSON-object warning names the file" "WARNING: $T $INVALID_WARN"
  expect_warning_backup "6 $label" "$INVALID_WARN" "$HOME/before.json"
  expect_mode600 "6 $label"
  expect_no_tmp "6 $label"
done <<'EOF'
truncated object|{"hooks":
array|[1, 2]\n
string|"s"\n
null|null\n
number joined across a block comment|{"a": 1/**/2}\n
literal split by a block comment|{"t": tr/* x */ue}\n
leading UTF-8 BOM|\357\273\277{"ui": {"theme": "x"}}\n
lone no-break space|\302\240
EOF

# 6b. Number literals jq's fromjson accepts but JSON.parse rejects (checked
# against Gemini CLI's own strip-json-comments + JSON.parse: "Unexpected
# number", "Unexpected token 'I'"). R12 makes Gemini's reading the reference,
# so such a file is not a JSON object and takes the repair path, exactly like
# `1/**/2` above (plan review v1-F1). `nan` is rejected too: the orchestrator's
# decision on #1210 supersedes the plan review's acceptance of it as a jq-only
# literal, for consistency with JSON.parse.
while IFS='|' read -r label content; do
  new_case
  printf '%s\n' "$content" > "$T"
  cp "$T" "$HOME/before.json"
  gs_write "" ""
  expect_rc "6b $label" 0
  if [ "$(doc)" = "$FRESH_NOPY" ]; then ok "6b $label: replaced by the absent-file document"; else bad "6b $label: merged as an object although Gemini CLI rejects it: $(doc)"; fi
  out_has "6b $label: not-a-JSON-object warning names the file" "WARNING: $T $INVALID_WARN"
done <<'EOF'
leading-zero number|{"ui": {"theme": "x"}, "retries": 01}
Infinity literal|{"ui": {"theme": "x"}, "limit": Infinity}
nan literal|{"ui": {"theme": "x"}, "limit": nan}
plus-signed number|{"ui": {"theme": "x"}, "retries": +1}
leading-zero number after a comment|{"ui": {"theme": "x"}, /* c */ "retries": 007}
EOF

# 6c. The strict-grammar check of 6b never rejects a number JSON.parse accepts,
# on the plain-JSON path and on the comment-stripping path, and never looks
# inside a string literal.
while IFS='|' read -r label content expected; do
  new_case
  printf '%s\n' "$content" > "$T"
  gs_write "" ""
  expect_rc "6c $label" 0
  # Compared with jq ==, not as text: jq 1.7+ keeps a number's literal form.
  expect_json "6c $label: merged as an object, value kept" "(.n == $expected)" 'true'
  out_lacks "6c $label: no not-a-JSON-object warning" "$INVALID_WARN"
done <<'EOF'
negative zero|{"n": -0}|-0
upper-case exponent with sign|{"n": 1E+2}|100
fraction with negative exponent|{"n": 0.5e-3}|0.0005
number list after a comment|/* c */ {"n": [0, -1.5, 10e2, true, false, null]}|[0, -1.5, 1000, true, false, null]
rejected forms inside a string|{"n": "01 +1 .5 Infinity NaN nan 0x1"}|"01 +1 .5 Infinity NaN nan 0x1"
EOF

# ---------------------------------------------------------------------------
echo "7. A commented file is merged; strings holding // and /* are intact (R12, R18g)"
# ---------------------------------------------------------------------------
new_case
put <<'EOF'
{
  // team proxy
  "$schema": "https://raw.githubusercontent.com/google-gemini/gemini-cli/main/schemas/settings.schema.json",
  /* a block
     comment */
  "ui": {"theme": "dark"}, /* inline */
  "notes": "has // and /* */ inside",
  "quote": "escaped \" quote // x",
  "back": "back\\", // a comment right after an escaped backslash
  "proxy": "http://proxy.example:8080/*"
}
EOF
cp "$T" "$HOME/before.json"
gs_write "" ""
expect_rc "7a commented file" 0
expect_json "7a operator key kept" '.ui' '{"theme": "dark"}'
expect_json "7a string values holding // and /* unchanged" '[.notes, .quote, .back, .proxy]' \
  '["has // and /* */ inside", "escaped \" quote // x", "back\\", "http://proxy.example:8080/*"]'
expect_json "7a \$schema URL unchanged" '."$schema"' '"https://raw.githubusercontent.com/google-gemini/gemini-cli/main/schemas/settings.schema.json"'
expect_json "7a framework-owned context.fileName written" '.context.fileName' "$TEMPLATE_FILES"
expect_json "7a framework-owned sequentialthinking written" '.mcpServers.sequentialthinking' "$ORACLE_SEQ"
out_has "7a comment warning names the file" "WARNING: $T $COMMENT_WARN"
expect_warning_backup "7a comment warning" "$COMMENT_WARN" "$HOME/before.json"
out_lacks "7a no not-a-JSON-object warning" "$INVALID_WARN"
if jq -e . "$T" >/dev/null 2>&1; then ok "7a rewritten file is plain JSON"; else bad "7a rewritten file is not plain JSON"; fi

# An unclosed block comment runs to the end of the file (strip-json-comments).
new_case
printf '{"ui": {"theme": "x"}}\n/* never closed\n' > "$T"
gs_write "" ""
expect_rc "7b unclosed trailing block comment" 0
expect_json "7b object kept" '.ui' '{"theme": "x"}'
out_has "7b comment warning" "WARNING: $T $COMMENT_WARN"

# A plain-JSON re-run on the file the setup wrote: the template's $schema URL
# holds `//` and is not a comment.
gs_write "" ""
out_lacks "7c plain re-run: no comment warning" "$COMMENT_WARN"

# ---------------------------------------------------------------------------
echo "8. Non-object ancestors (R2, R7, R18h)"
# ---------------------------------------------------------------------------
new_case
put <<'EOF'
{"security": "x", "context": "y", "mcpServers": "z"}
EOF
cp "$T" "$HOME/before.json"
gs_write "" ""
expect_rc "8 non-object ancestors" 0
expect_json "8 security kept as the string \"x\", no seed beneath it" '.security' '"x"'
out_lacks "8 no warning about security" "security"
expect_json "8 context replaced by an object holding the template list" '.context' "{\"fileName\": $TEMPLATE_FILES}"
out_has "8 R7 warning names context" "WARNING: 'context' in $T is not an object; it was replaced by the framework's value."
expect_warning_backup "8 context warning" "'context' in" "$HOME/before.json"
expect_json "8 mcpServers replaced by the framework entries" '.mcpServers' "$ORACLE_MCP_NOPY"
out_has "8 R7 warning names mcpServers" "WARNING: 'mcpServers' in $T is not an object; it was replaced by the framework's value."

# ---------------------------------------------------------------------------
echo "9. Re-runs are idempotent (R9, R14, R18f)"
# ---------------------------------------------------------------------------
new_case
put <<'EOF'
{
  "ui": {"theme": "Dracula"},
  "context": {"fileName": ["LOCAL.md", "AGENTS.md"]},
  "hooks": {"Notification": [{"matcher": "*", "hooks": [{"type": "command", "command": "notify-send gemini"}]}]},
  "mcpServers": {"acme-tools": {"command": "acme"}}
}
EOF
setup_run "$FAKE_PY" "" yes yes yes
expect_rc "9 run 1 (accept, capture yes, HTTP)" 0
setup_run "$FAKE_PY" "" yes keep yes
expect_rc "9 run 2 (accept, capture keep, HTTP)" 0
DOC_RUN2="$(doc)"
out_lacks "9 run 2: no comment warning on the file the setup wrote" "$COMMENT_WARN"
setup_run "$FAKE_PY" "" yes keep yes
expect_rc "9 run 3 (same answers)" 0
if [ -n "$DOC_RUN2" ] && [ "$(doc)" = "$DOC_RUN2" ]; then
  ok "9 run 3 leaves the same JSON document as run 2"
else
  bad "9 run 3 differs from run 2: $(diff <(jq -S . <<< "$DOC_RUN2") <(jq -S . "$T"))"
fi
expect_json "9 sequentialthinking carries the TLS wrapper exactly once" \
  '[.mcpServers.sequentialthinking.args[] | select(endswith("tls-exec.sh"))] | length' '1'
expect_json "9 sequentialthinking is exactly the framework entry" '.mcpServers.sequentialthinking' "$ORACLE_SEQ"
expect_json "9 mempalace is the HTTP registration" '.mcpServers.mempalace.type' '"http"'
expect_json "9 no hook command duplicated on any event" \
  '[.hooks[] | [.[] | .hooks[]? | .command] | length == (unique | length)] | all' 'true'
expect_json "9 no context.fileName entry duplicated" '.context.fileName | length == (unique | length)' 'true'
expect_json "9 operator content kept" '[.ui, .mcpServers["acme-tools"], .hooks.Notification]' \
  '[{"theme": "Dracula"}, {"command": "acme"}, [{"matcher": "*", "hooks": [{"type": "command", "command": "notify-send gemini"}]}]]'
expect_mode600 "9 after three full runs"

# ---------------------------------------------------------------------------
echo "10. MCP precedence: framework-reserved > org > operator (R10)"
# ---------------------------------------------------------------------------
new_case
put <<'EOF'
{"mcpServers": {"acme-tools": {"command": "operator-acme"}, "zeta": {"command": "zeta"}}}
EOF
cp "$T" "$HOME/before.json"
gs_write "$FAKE_PY" '{"acme-tools": {"command": "org-acme"}, "org-only": {"command": "org-cmd"}, "mempalace": {"command": "org-mem"}}'
expect_rc "10 org manifest" 0
expect_json "10 org server wins over the same-named operator server" '.mcpServers["acme-tools"]' '{"command": "org-acme"}'
expect_json "10 org-only server added" '.mcpServers["org-only"]' '{"command": "org-cmd"}'
expect_json "10 other operator server kept" '.mcpServers.zeta' '{"command": "zeta"}'
expect_json "10 reserved name stays the framework's" '.mcpServers.mempalace' "$ORACLE_MEMPALACE"
out_has "10 spec 0091 R11 warning names acme-tools" \
  "WARNING: org-declared MCP server 'acme-tools' overrides your pre-existing 'acme-tools' entry (org declaration wins)."
expect_warning_backup "10 R11 warning" "org-declared MCP server 'acme-tools'" "$HOME/before.json"
out_has "10 spec 0091 R10 warning: org mempalace not applied" \
  "WARNING: 'mempalace' is a framework-managed MCP server — the org declaration for 'mempalace' was NOT applied (framework wins)."

# ---------------------------------------------------------------------------
echo "11. Backup first, owner-only, and the return codes (R13, plan review v1-F3)"
# ---------------------------------------------------------------------------
new_case
printf '{"ui": {"theme": "x"}}\n' > "$T"
chmod 644 "$T"
cp "$T" "$HOME/before.json"
gs_write "$FAKE_PY" ""
expect_rc "11a existing 0644 file" 0
set -- "$T".bak.*
if [ -f "$1" ] && cmp -s "$1" "$HOME/before.json"; then ok "11a timestamped backup holds the prior bytes"; else bad "11a no backup of the prior bytes (found: $*)"; fi
expect_mode600 "11a existing 0644 file"
expect_no_tmp "11a"

STUB_DIR="$TMP_ROOT/stub-bin"
mkdir -p "$STUB_DIR"

# 11b rc 1: the backup cannot be made (a `cp` that always fails, first on PATH;
# works under a root CI runner, unlike a chmod).
new_case
mkdir -p "$STUB_DIR/cp-fails"
printf '#!/bin/sh\nexit 1\n' > "$STUB_DIR/cp-fails/cp"
chmod +x "$STUB_DIR/cp-fails/cp"
printf '{"ui": {"theme": "x"}}\n' > "$T"
cp "$T" "$HOME/before.json"
RC=0
( PATH="$STUB_DIR/cp-fails:$PATH"; gemini_settings_write "$T" "$TEMPLATE" "$REPO_DIR" "$FAKE_PY" "" ) > "$OUT" 2> "$ERR" || RC=$?
expect_rc "11b backup failure" 1
if cmp -s "$T" "$HOME/before.json"; then ok "11b target byte-identical"; else bad "11b target changed although no backup exists"; fi
out_has "11b ERROR names the target as unchanged" "ERROR: the backup could not be created; $T was left unchanged." "$ERR"
expect_no_tmp "11b"

# 11c rc 1 after the backup: the framework entries cannot be built (a template
# that is not JSON). The ERROR names the backup.
new_case
printf '{"ui": {"theme": "x"}}\n' > "$T"
cp "$T" "$HOME/before.json"
printf '{ not json\n' > "$HOME/bad-template.json"
RC=0
gemini_settings_write "$T" "$HOME/bad-template.json" "$REPO_DIR" "$FAKE_PY" "" > "$OUT" 2> "$ERR" || RC=$?
expect_rc "11c unreadable template" 1
if cmp -s "$T" "$HOME/before.json"; then ok "11c target byte-identical"; else bad "11c target changed on a failed merge"; fi
out_has "11c ERROR says the target was left unchanged" "$T was left unchanged." "$ERR"
out_has "11c ERROR names the backup" "The prior file is preserved in the timestamped backup: $T.bak." "$ERR"
expect_no_tmp "11c"

# 11d rc 2: the target is merged, the org fold fails (a jq wrapper that fails
# on the fold's program only, plus a non-empty org manifest).
new_case
mkdir -p "$STUB_DIR/jq-org-fails"
REAL_JQ="$(command -v jq)"
cat > "$STUB_DIR/jq-org-fails/jq" <<STUB
#!/bin/sh
case "\$*" in *org_min_reserved*) exit 3 ;; esac
exec "$REAL_JQ" "\$@"
STUB
chmod +x "$STUB_DIR/jq-org-fails/jq"
printf '{"ui": {"theme": "x"}, "hooks": {"Notification": []}}\n' > "$T"
chmod 644 "$T"
RC=0
( PATH="$STUB_DIR/jq-org-fails:$PATH"; gemini_settings_write "$T" "$TEMPLATE" "$REPO_DIR" "$FAKE_PY" '{"org-only": {"command": "org-cmd"}}' ) > "$OUT" 2> "$ERR" || RC=$?
expect_rc "11d org fold failure" 2
expect_json "11d target holds the merged settings" '[.ui, .hooks, .context.fileName, .mcpServers.mempalace]' \
  "[{\"theme\": \"x\"}, {\"Notification\": []}, $TEMPLATE_FILES, $ORACLE_MEMPALACE]"
if jq -e '.mcpServers | has("org-only")' "$T" >/dev/null 2>&1; then bad "11d org server applied although the fold failed"; else ok "11d org fold not applied"; fi
out_has "11d ERROR says the merge landed but the fold did not" \
  "ERROR: $T holds the merged settings, but the org MCP server fold (spec 0091) did not complete." "$ERR"
out_has "11d ERROR names the backup" "The prior file is preserved in the timestamped backup: $T.bak." "$ERR"
expect_mode600 "11d"
expect_no_tmp "11d"

# ---------------------------------------------------------------------------
echo "12. A large plain-JSON file is processed quickly (plan review v1-F2)"
# ---------------------------------------------------------------------------
# Every command string holds `//` and `/*`, the worst case for the comment
# scan; plain JSON must not pay for it. The bound is generous on purpose.
new_case
jq -n '{hooks: {Notification: [range(0; 900) | {matcher: "*", hooks: [{type: "command",
  command: ("echo entry \(.) // not a comment /* nor this */ padding-padding-padding-padding")}]}]}}' > "$T"
size="$(wc -c < "$T" | tr -d '[:space:]')"
if [ "$size" -ge 190000 ]; then ok "12 fixture is ~200 KB ($size bytes)"; else bad "12 fixture too small ($size bytes)"; fi
started=$SECONDS
gs_write "" ""
elapsed=$((SECONDS - started))
expect_rc "12 large file" 0
if [ "$elapsed" -le 5 ]; then ok "12 merged in ${elapsed}s (bound: 5s)"; else bad "12 merge took ${elapsed}s (bound: 5s)"; fi
expect_json "12 every hook entry kept" '.hooks.Notification | length' '900'
out_lacks "12 no comment warning" "$COMMENT_WARN"

# ---------------------------------------------------------------------------
echo "13. Setup wiring (R15, R16)"
# ---------------------------------------------------------------------------
# first_call <regex> — line number of the first non-comment line matching it.
first_call() { grep -nE "$1" "$SETUP_SCRIPT" | grep -vE '^[0-9]+:[[:space:]]*#' | head -1 | cut -d: -f1; }

write_ln="$(first_call '^[[:space:]]*gemini_settings_write[[:space:]]')"
http_ln="$(first_call '^[[:space:]]*ensure_mempalace_http[[:space:]]')"
uc_ln="$(first_call 'usage_capture_state gemini')"
session_ln="$(first_call 'merge_session_recording_hooks gemini')"
if [ -z "$write_ln" ]; then
  bad "13 setup does not call gemini_settings_write"
else
  for pair in "ensure_mempalace_http:$http_ln" "merge_session_recording_hooks:$session_ln" "usage_capture_state:$uc_ln"; do
    name="${pair%%:*}"
    ln="${pair#*:}"
    if [ -n "$ln" ] && [ "$write_ln" -lt "$ln" ]; then
      ok "13 gemini_settings_write (l$write_ln) precedes $name (l$ln)"
    else
      bad "13 gemini_settings_write (l$write_ln) must precede $name (l${ln:-none})"
    fi
  done
fi
if grep -nE 'usage_capture_(footprint|reinject)' "$SETUP_SCRIPT" | grep -vE '^[0-9]+:[[:space:]]*#' > "$TMP_ROOT/uc-calls.txt"; then
  bad "13 setup still calls the usage-capture carry-over: $(cat "$TMP_ROOT/uc-calls.txt")"
else
  ok "13 setup calls neither usage_capture_footprint nor usage_capture_reinject (R16)"
fi
if grep -nE '^[^#]*(PREEXISTING_MCP=|> "\$\{SETTINGS_TARGET\}\.tmp")' "$SETUP_SCRIPT" > "$TMP_ROOT/rebuild.txt"; then
  bad "13 setup still rebuilds settings.json from the template: $(cat "$TMP_ROOT/rebuild.txt")"
else
  ok "13 setup no longer writes settings.json from the template itself"
fi
# R15: the line printed after each decline / cancel headline.
for headline in 'Transcript activation canceled by user.' 'Session recording disabled'; do
  msg="$(grep -A1 -F "$headline" "$SETUP_SCRIPT" | sed -n 2p)"
  if [ -z "$msg" ]; then
    bad "13 R15: no message after '$headline'"
  elif grep -qiE 'rebuilt|were not kept|not carried' <<< "$msg"; then
    bad "13 R15: message after '$headline' still says the file was rebuilt: $msg"
  elif grep -qF 'left in place' <<< "$msg"; then
    ok "13 R15: message after '$headline' says an earlier registration is left in place"
  else
    bad "13 R15: message after '$headline' does not say it is left in place: $msg"
  fi
done

# ---------------------------------------------------------------------------
echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
