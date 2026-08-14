#!/bin/bash
# test-setup-org-mcp.sh — Regression tests for the org-level MCP declaration
# channel (spec 0091), mirroring scripts/tests/test-setup-mcp-merge.sh (0089).
#
# Units under test (all in scripts/lib/common.sh):
#   read_org_mcp_manifest   — reads `.mcpServers` from mcp-servers.org.json,
#                             degrading to `{}` when absent/empty/unparseable.
#   org_mcp_to_native       — neutral -> native mcpServers object per file CLI.
#   apply_org_mcp_servers   — right-biased fold over a config's `.mcpServers`,
#                             AFTER the 0089 operator merge, so the precedence is
#                             framework-reserved > org > operator (R10/R11).
#   org_mcp_to_claude_argv  — neutral entry -> `claude mcp add` argv (pure).
#   register_org_mcp_claude — Claude imperative applier (exercised via a `claude`
#                             stub on PATH — no live ~/.claude.json write).
#
# R13 realization note — Claude's imperative `claude mcp add` path cannot be run
# end-to-end in CI (needs the real `claude` binary + a live ~/.claude.json). Per
# the approved PLAN v2 and the cold-review rider, R13 is satisfied for Claude by
# the *sanctioned hermetic-equivalent*: the pure `org_mcp_to_claude_argv` unit
# test (§4) + a stubbed functional test of `register_org_mcp_claude` (§5) +
# structural call-site assertions (§6). This mirrors how spec 0089 made Claude
# its R5 reference behavior rather than end-to-end testing it. It is the
# *sanctioned* shape, NOT a silent parity gap (see docs/cli-matrix.md row 7h).
#
# HERMETIC: no HOME writes, no interactive scripts run. Every operation uses
# throwaway temp files under a temp root removed on exit.
#
# Usage:
#   bash scripts/tests/test-setup-org-mcp.sh

# -e intentionally omitted: pass/fail counters drive the harness, and some
# probes (jq -e presence checks, stubbed `claude mcp add` failures) return
# non-zero on purpose.
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
ORG_HTTP='{"transport":"http","url":"https://mcp.atlassian.example/mcp","headers":{"Authorization":"Bearer ${ATLASSIAN_TOKEN}"}}'
ORG_STDIO='{"transport":"stdio","command":"gh-mcp","args":["--stdio"],"env":{"GITHUB_HOST":"github.example"}}'
OP_ACME='{"command":"acme","args":["--serve","--port","9999"],"env":{"ACME_TOKEN":"xyz"}}'

# ---------------------------------------------------------------------------
echo "1. read_org_mcp_manifest — degrade to {} on absent/empty/unparseable"
# ---------------------------------------------------------------------------
[ "$(read_org_mcp_manifest "$TMP_ROOT/nope.json")" = "{}" ] \
  && ok "absent manifest -> {}" || bad "absent manifest should be {}"

printf '' > "$TMP_ROOT/empty.json"
[ "$(read_org_mcp_manifest "$TMP_ROOT/empty.json")" = "{}" ] \
  && ok "empty file -> {}" || bad "empty file should be {}"

printf 'not json {' > "$TMP_ROOT/bad.json"
[ "$(read_org_mcp_manifest "$TMP_ROOT/bad.json")" = "{}" ] \
  && ok "unparseable -> {}" || bad "unparseable should be {}"

printf '{"_example":{"x":{}}}' > "$TMP_ROOT/no-servers.json"
[ "$(read_org_mcp_manifest "$TMP_ROOT/no-servers.json")" = "{}" ] \
  && ok "no .mcpServers -> {}" || bad "no .mcpServers should be {}"

printf '{"mcpServers":{"acme":%s}}' "$ORG_STDIO" > "$TMP_ROOT/good.json"
if printf '%s' "$(read_org_mcp_manifest "$TMP_ROOT/good.json")" | jq -e 'has("acme")' >/dev/null 2>&1; then
  ok "valid manifest -> .mcpServers object"
else
  bad "valid manifest should echo .mcpServers with 'acme'"
fi

# The shipped stub reads to {} (empty operational channel; R9).
SHIPPED="$REPO_DIR/mcp-servers.org.json"
if [ -f "$SHIPPED" ]; then
  [ "$(read_org_mcp_manifest "$SHIPPED")" = "{}" ] \
    && ok "shipped mcp-servers.org.json is an empty operational channel (R9)" \
    || bad "shipped manifest .mcpServers must be empty (R9)"
  if jq -e '(.. | strings) | test("Bearer [A-Za-z0-9]{12,}")' "$SHIPPED" >/dev/null 2>&1; then
    bad "shipped manifest appears to carry a literal credential (R9)"
  else
    ok "shipped manifest carries no literal credential (R9)"
  fi
else
  bad "shipped mcp-servers.org.json missing (spec 0091 GROUNDING back-fill)"
fi

# ---------------------------------------------------------------------------
echo "2. org_mcp_to_native — grounded native shapes per file CLI"
# ---------------------------------------------------------------------------
NEUTRAL="$(printf '{"atlassian":%s,"github":%s}' "$ORG_HTTP" "$ORG_STDIO")"

GEM="$(org_mcp_to_native gemini "$NEUTRAL" 2>/dev/null)"
jq -e '.atlassian.type == "http" and .atlassian.url and .atlassian.headers and (.atlassian | has("command") | not)' <<<"$GEM" >/dev/null 2>&1 \
  && ok "gemini http -> {type:http,url,headers}" || bad "gemini http shape wrong: $GEM"
jq -e '.github.command == "gh-mcp" and (.github | has("type") | not)' <<<"$GEM" >/dev/null 2>&1 \
  && ok "gemini stdio -> {command,args,env} (no type)" || bad "gemini stdio shape wrong: $GEM"

COP="$(org_mcp_to_native copilot "$NEUTRAL" 2>/dev/null)"
jq -e '.atlassian.type == "http" and .atlassian.url' <<<"$COP" >/dev/null 2>&1 \
  && ok "copilot http -> {type:http,url,headers}" || bad "copilot http shape wrong: $COP"
jq -e '.github.type == "stdio" and .github.command == "gh-mcp"' <<<"$COP" >/dev/null 2>&1 \
  && ok "copilot stdio -> {type:stdio,command,args,env}" || bad "copilot stdio shape wrong: $COP"

# Antigravity: stdio AND remote delivered. Remote uses the native `serverUrl`
# shape (NOT `url`, no `type`) per the official Antigravity MCP docs — which
# supersede spec 0054's stale "format not publicly documented" note, closing
# the former http/sse gap-acceptance (docs/cli-matrix.md row 7h).
AGY="$(org_mcp_to_native antigravity "$NEUTRAL" 2>/dev/null)"
jq -e '.github.command == "gh-mcp" and (.github | has("type") | not)' <<<"$AGY" >/dev/null 2>&1 \
  && ok "antigravity stdio -> {command,args,env} (no type)" || bad "antigravity stdio shape wrong: $AGY"
jq -e '.atlassian.serverUrl == "https://mcp.atlassian.example/mcp"
       and (.atlassian | has("url") | not)
       and (.atlassian | has("type") | not)
       and .atlassian.headers.Authorization' <<<"$AGY" >/dev/null 2>&1 \
  && ok "antigravity http -> {serverUrl,headers}: manifest 'url' translated to 'serverUrl', headers preserved" \
  || bad "antigravity remote shape wrong (expected serverUrl, no url/type, headers kept): $AGY"

# ---------------------------------------------------------------------------
echo "3. apply_org_mcp_servers — fold precedence (R6/R10/R11)"
# ---------------------------------------------------------------------------
# Config as it stands AFTER the 0089 operator fold: framework reserved mempalace
# + operator acme + operator atlassian (a non-reserved hand-added server).
CFG="$(mktemp "$TMP_ROOT/cfg.XXXXXX")"
printf '{"mcpServers":{"mempalace":{"command":"bash","args":["wrapper"]},"acme":%s,"atlassian":{"command":"op-old-atlassian"}}}' "$OP_ACME" > "$CFG"
PRE="$(printf '{"acme":%s,"atlassian":{"command":"op-old-atlassian"}}' "$OP_ACME")"
# Org declares atlassian (collides w/ operator, R11) + mempalace (reserved, R10).
ORG_NEUTRAL="$(printf '{"atlassian":%s,"mempalace":{"transport":"stdio","command":"evil"}}' "$ORG_HTTP")"
ORG_NATIVE="$(org_mcp_to_native gemini "$ORG_NEUTRAL" 2>/dev/null)"
BK="$TMP_ROOT/cfg.bak.20260722-000000"
OUT="$(apply_org_mcp_servers "$ORG_NATIVE" "$CFG" "$PRE" "$BK" 2>&1)"

jq -e '.mcpServers.mempalace.command == "bash"' "$CFG" >/dev/null 2>&1 \
  && ok "R10: reserved 'mempalace' stays framework-managed (org 'evil' NOT applied)" \
  || bad "R10: mempalace must not be displaced by the org declaration"
printf '%s' "$OUT" | grep -q "mempalace" \
  && ok "R10: non-silent warning names the reserved collision" \
  || bad "R10: missing reserved-collision warning (out: $OUT)"

jq -e '.mcpServers.atlassian.type == "http"' "$CFG" >/dev/null 2>&1 \
  && ok "R11: org 'atlassian' overrides the operator entry (org wins)" \
  || bad "R11: org atlassian should win over operator"
if printf '%s' "$OUT" | grep -q "'atlassian'" && printf '%s' "$OUT" | grep -qF "$BK"; then
  ok "R11: non-silent warning names 'atlassian' and points at the backup"
else
  bad "R11: missing override warning + backup pointer (out: $OUT)"
fi

got_acme="$(jq -Sc '.mcpServers.acme' "$CFG")"
exp_acme="$(printf '%s' "$OP_ACME" | jq -Sc .)"
[ "$got_acme" = "$exp_acme" ] \
  && ok "R6: operator 'acme' (org does not name) survives verbatim" \
  || bad "R6: acme changed — expected $exp_acme, got $got_acme"

# Empty org channel is a no-op (fresh adopter, R9).
CFG2="$(mktemp "$TMP_ROOT/cfg2.XXXXXX")"
printf '{"mcpServers":{"acme":%s}}' "$OP_ACME" > "$CFG2"
apply_org_mcp_servers "{}" "$CFG2" "$PRE" "$BK" >/dev/null 2>&1
[ "$(jq -Sc '.mcpServers.acme' "$CFG2")" = "$exp_acme" ] \
  && ok "empty org channel is a no-op (operator config untouched)" \
  || bad "empty org channel must not alter the config"

# ---------------------------------------------------------------------------
echo "4. org_mcp_to_claude_argv — pure argv translation (Claude R13 equivalent)"
# ---------------------------------------------------------------------------
# `while read` rather than `mapfile` for bash 3.2 compat (macOS default), and
# `${A[*]:-}` rather than `${A[*]}` because bash 3.2 treats an empty array as an
# unset variable under `set -u`. Both per docs/scripting-conventions.md Rule 5;
# an empty argv joins to the empty string either way, so the assertions below
# see exactly the value they saw before.
ARGV_STDIO=()
while IFS= read -r line || [ -n "$line" ]; do ARGV_STDIO+=("$line"); done \
  < <(org_mcp_to_claude_argv github "$ORG_STDIO")
STDIO_STR="${ARGV_STDIO[*]:-}"
[[ "$STDIO_STR" == *"--scope user"* ]] && ok "stdio argv: --scope user" || bad "stdio argv missing --scope user ($STDIO_STR)"
[[ "$STDIO_STR" == *"-e GITHUB_HOST=github.example"* ]] && ok "stdio argv: -e KEY=VALUE" || bad "stdio argv missing -e env ($STDIO_STR)"
[[ "$STDIO_STR" == *"github -- gh-mcp --stdio"* ]] && ok "stdio argv: <name> -- <command> <args>" || bad "stdio argv command tail wrong ($STDIO_STR)"

ARGV_HTTP=()
while IFS= read -r line || [ -n "$line" ]; do ARGV_HTTP+=("$line"); done \
  < <(org_mcp_to_claude_argv atlassian "$ORG_HTTP")
HTTP_STR="${ARGV_HTTP[*]:-}"
[[ "$HTTP_STR" == *"--transport http"* ]] && ok "http argv: --transport http" || bad "http argv missing --transport http ($HTTP_STR)"
[[ "$HTTP_STR" == *"atlassian https://mcp.atlassian.example/mcp"* ]] && ok "http argv: <name> <url>" || bad "http argv name/url wrong ($HTTP_STR)"
# DELIBERATE bearer-in-argv occurrence, and the only one under scripts/ (spec
# 0149 R4). What follows asserts the SHAPE of the argv the Claude adapter
# builds from an org declaration — the flag plus the header name it emits —
# not a live credential: the value comes from the ORG_HTTP fixture at :58,
# whose token is the literal placeholder `${ATLASSIAN_TOKEN}`. The reader
# sweeping the repository for this pattern is meant to land here and stop. The
# credential-bearing surface is elsewhere and guarded elsewhere: the MemPalace
# daemon probes feed their header through a stdin curl config, enforced by the
# reintroduction guard in scripts/tests/test-mcp-daemon.sh section 3.
[[ "$HTTP_STR" == *"--header Authorization: Bearer"* ]] && ok "http argv: --header \"K: V\"" || bad "http argv missing --header ($HTTP_STR)"

# ---------------------------------------------------------------------------
echo "5. register_org_mcp_claude — functional via a 'claude' stub"
# ---------------------------------------------------------------------------
# A stub `claude` on PATH records its argv and simulates `mcp list`/`add`/`remove`
# via env vars, so the imperative path is exercised without a live install.
STUB_BIN="$TMP_ROOT/bin"
mkdir -p "$STUB_BIN"
cat > "$STUB_BIN/claude" <<'STUB'
#!/bin/bash
echo "$*" >> "$CLAUDE_STUB_LOG"
if [ "$1 $2" = "mcp list" ]; then
  for n in ${CLAUDE_STUB_REGISTERED:-}; do echo "$n: stub-command"; done
  exit 0
fi
if [ "$1 $2" = "mcp add" ]; then
  [ "${CLAUDE_STUB_ADD_FAIL:-0}" = "1" ] && exit 1
  exit 0
fi
exit 0
STUB
chmod +x "$STUB_BIN/claude"
OLD_PATH="$PATH"
export PATH="$STUB_BIN:$PATH"

# 5a. Reserved name -> skip + warning, NEVER an `mcp add` (R10).
LOG="$TMP_ROOT/claude-r10.log"; : > "$LOG"
export CLAUDE_STUB_LOG="$LOG" CLAUDE_STUB_REGISTERED="" CLAUDE_STUB_ADD_FAIL=0
printf '{"mcpServers":{"mempalace":{"transport":"stdio","command":"evil"}}}' > "$TMP_ROOT/man-r10.json"
R10_OUT="$(register_org_mcp_claude "$TMP_ROOT/man-r10.json" "$TMP_ROOT/nonexistent.claude.json" 2>&1)"
printf '%s' "$R10_OUT" | grep -q "mempalace" && ok "claude R10: reserved skip warns" || bad "claude R10: no warning ($R10_OUT)"
grep -q "mcp add" "$LOG" && bad "claude R10: reserved name must NOT be added" || ok "claude R10: no 'mcp add' issued for reserved name"

# 5b. New non-reserved name -> `claude mcp add` with the translated argv.
LOG="$TMP_ROOT/claude-new.log"; : > "$LOG"
export CLAUDE_STUB_LOG="$LOG" CLAUDE_STUB_REGISTERED="" CLAUDE_STUB_ADD_FAIL=0
printf '{"mcpServers":{"acme":{"transport":"stdio","command":"acme","args":["--serve"]}}}' > "$TMP_ROOT/man-new.json"
register_org_mcp_claude "$TMP_ROOT/man-new.json" "$TMP_ROOT/nonexistent.claude.json" >/dev/null 2>&1
grep -qF "mcp add --scope user acme -- acme --serve" "$LOG" \
  && ok "claude add: new server registered with grounded argv" \
  || bad "claude add: expected 'mcp add --scope user acme -- acme --serve' (log: $(cat "$LOG"))"

# 5c. R11 collision + FAILED re-add -> operator entry is RESTORED (rider #3).
LOG="$TMP_ROOT/claude-r11.log"; : > "$LOG"
CLAUDE_CFG="$TMP_ROOT/claude.json"
printf '{"mcpServers":{"acme":{"command":"OPERATOR-ORIGINAL","args":["--keepme"]}}}' > "$CLAUDE_CFG"
export CLAUDE_STUB_LOG="$LOG" CLAUDE_STUB_REGISTERED="acme" CLAUDE_STUB_ADD_FAIL=1
printf '{"mcpServers":{"acme":{"transport":"stdio","command":"acme-NEW"}}}' > "$TMP_ROOT/man-r11.json"
R11_OUT="$(register_org_mcp_claude "$TMP_ROOT/man-r11.json" "$CLAUDE_CFG" 2>&1)"
grep -q "mcp remove" "$LOG" && ok "claude R11: attempts remove-then-add" || bad "claude R11: no remove attempted (log: $(cat "$LOG"))"
printf '%s' "$R11_OUT" | grep -qi "restor" \
  && ok "claude R11 guard: a failed re-add is surfaced (restore message)" \
  || bad "claude R11 guard: failed re-add not surfaced (out: $R11_OUT)"
if [ "$(jq -r '.mcpServers.acme.command' "$CLAUDE_CFG")" = "OPERATOR-ORIGINAL" ]; then
  ok "claude R11 guard: failed re-add RESTORES the operator's prior entry (rider #3)"
else
  bad "claude R11 guard: operator entry not restored after failed re-add ($(jq -c '.mcpServers.acme' "$CLAUDE_CFG"))"
fi

export PATH="$OLD_PATH"
unset CLAUDE_STUB_LOG CLAUDE_STUB_REGISTERED CLAUDE_STUB_ADD_FAIL

# ---------------------------------------------------------------------------
echo "6. Setup-script call-site parity"
# ---------------------------------------------------------------------------
# The three file setups must translate + fold org servers AFTER the 0089 merge.
check_file_setup() {
  local script="$1" cli="$2"
  local path="$SETUP_DIR/$script"
  if [ ! -f "$path" ]; then bad "$script: not found"; return; fi

  grep -q "org_mcp_to_native $cli" "$path" \
    && ok "$script: translates via org_mcp_to_native $cli" \
    || bad "$script: missing org_mcp_to_native $cli"
  grep -q "apply_org_mcp_servers" "$path" \
    && ok "$script: folds via apply_org_mcp_servers" \
    || bad "$script: missing apply_org_mcp_servers"

  local merge_ln apply_ln
  merge_ln="$(grep -nF 'merge_preexisting_mcp_servers "$PREEXISTING_MCP"' "$path" | head -1 | cut -d: -f1)"
  apply_ln="$(grep -nF 'apply_org_mcp_servers' "$path" | head -1 | cut -d: -f1)"
  if [ -n "$merge_ln" ] && [ -n "$apply_ln" ] && [ "$apply_ln" -gt "$merge_ln" ]; then
    ok "$script: org fold (l$apply_ln) follows the 0089 merge (l$merge_ln)"
  else
    bad "$script: org fold must follow the 0089 merge (merge=$merge_ln apply=$apply_ln)"
  fi
}
check_file_setup setup-gemini-interactive.sh      gemini
check_file_setup setup-copilot-interactive.sh     copilot
check_file_setup setup-antigravity-interactive.sh antigravity

# Claude runs the imperative org loop after the reserved-server registration.
CLAUDE_SETUP="$SETUP_DIR/setup-claude-interactive.sh"
grep -q "register_org_mcp_claude" "$CLAUDE_SETUP" \
  && ok "setup-claude-interactive.sh: runs register_org_mcp_claude" \
  || bad "setup-claude-interactive.sh: missing register_org_mcp_claude"

# ---------------------------------------------------------------------------
echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
