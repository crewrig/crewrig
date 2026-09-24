#!/bin/bash
# test-setup-usage-capture-optin.sh — Regression suite for the usage-capture
# opt-in of Claude Code, Gemini CLI and Copilot CLI, decoupled from the
# MemPalace session-recording opt-in (spec 0211, issue #1174).
#
# Units under test:
#   - scripts/lib/usage-capture-optin.sh — the ONE implementation of every
#     read and write of a capture entry: detection, enable, keep, remove, the
#     answer mapping (`usage_capture_apply`), the Gemini carry-over
#     (`usage_capture_footprint` / `usage_capture_reinject`) and the
#     session-recording merge that must preserve capture
#     (`merge_session_recording_hooks`). The setups call these helpers; this
#     suite calls the SAME helpers directly, never a transcription (R15).
#   - hooks/{claude,gemini,copilot}-usage-capture-hooks.json — the fragments.
#   - scripts/setup-{claude,gemini,copilot}-interactive.sh — asserted
#     STRUCTURALLY only (§2, §4): their `fzf` prompts cannot run in CI.
#
# Sections:
#   §1  Fragments: valid JSON, exactly the R5 events with one handler each,
#       no MemPalace setting, and the substituted command byte-equal to the
#       pre-0211 coupled deployment's (R3, R5), except that Gemini's path is
#       now double-quoted (S3).
#   §2  R2, structural: no transcript manifest and no session-recording block
#       names the capture command.
#   §3  Behaviour, on all three CLIs (R15 superset of the spec scenarios):
#       (a) enable on an absent file · (b) enable over operator entries ·
#       (c) `no` / empty answer · (d) session-recording merge preserves
#       capture (R8) · (e) coupled install migrates as `keep` (R10/R13) ·
#       (f) `keep` re-points a vanished path and only a vanished path (R11)
#       with the linked-worktree warning (R6) · (f') a non-R5 capture handler
#       survives `keep` · (g)/(h) `remove` prunes (R12) · (i) enable+remove
#       round trip · (j) Gemini template-rewrite carry-over (R13) ·
#       (k) the registered command writes a journal record with no MemPalace
#       (R3) · (l) unparsable input is never written · (m) file mode stays or
#       ends 0600 · (n) helpers return, never exit, under `bash -e`.
#       Security hardening (PR #1209 security review, seat finding i1-F6):
#       (o) every backup is 0600 and older backups are narrowed (S1) ·
#       (p) an operator hook merely naming /hooks/usage-capture.sh is never
#       touched, nor a Gemini compound command or tool argument that ends in
#       it (N1), an unexpanded `$…`/`~` path is never re-pointed, and the
#       legacy coupled forms are still recognised (S2) · (q) a checkout path
#       with a space works end to end, and the legacy unquoted spaced form is
#       capture only when its whole path exists (S3, N1) · (r) usage_capture_abs refuses a
#       path that cannot be double-quoted safely (S3) · (s) keep on a
#       duplicated event keeps the live command, not a re-pointed vanished one
#       (i1-F6) · (t) a failed write leaves no temp file behind · (u) a
#       symlinked config is replaced by a regular 0600 file and the link
#       target is left untouched.
#   §4  Structural (R1, R4, R10, R15): prompt placement, defaults, `|| true`
#       guards, every library call site guarded, not gated on MemPalace,
#       Gemini carry-over ordering, and the never-copied invariant for
#       usage-capture.sh (moved here from the three transcript suites).
#   §5  R14: the Antigravity setup and hooks reference neither the new
#       library nor the fragments.
#
# Fixtures: scripts/tests/fixtures/setup-usage-capture/. `*-coupled.json` are
# the e344e54 transforms applied to the e344e54 manifests; `*-operator.json`
# carry an operator handler, non-hook keys and capture; `*-stripped.json` are
# the same files with capture never enabled (the R12 oracle). Placeholders
# __CAPTURE_ABS__, __HOOK_TARGET__ and __GUARD_ABS__ are substituted at test
# time, so no machine path is committed.
#
# HERMETIC: HOME and CREWRIG_USAGE_ROOT point into a temp root removed on
# exit; no network; no `fzf`; no interactive script runs. (k) needs Node.
#
# Usage:
#   bash scripts/tests/test-setup-usage-capture-optin.sh

# -e intentionally omitted: the pass/fail counters drive the harness, and many
# probes return non-zero on purpose.
set -uo pipefail
# Pinned so that every "0644 source ends 0600" assertion (§3 (m), (o), (u))
# starts from a file, and a plain copy, that WOULD be 0644. Under a runner's
# umask 077 those assertions would pass whatever the code does.
umask 022

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd -P)"
COMMON_LIB="$REPO_DIR/scripts/lib/common.sh"
OPTIN_LIB="$REPO_DIR/scripts/lib/usage-capture-optin.sh"
FIX="$REPO_DIR/scripts/tests/fixtures/setup-usage-capture"
CLAUDE_SESSION_FIXTURE="$REPO_DIR/scripts/tests/fixtures/usage-capture/claude-code/2.1.x-jsonl/session.jsonl"
GEMINI_TEMPLATE="$REPO_DIR/config/gemini/settings.json"
CLIS="claude gemini copilot"

for f in "$COMMON_LIB" "$OPTIN_LIB" "$CLAUDE_SESSION_FIXTURE" "$GEMINI_TEMPLATE" \
         "$REPO_DIR/hooks/usage-capture.sh" \
         "$REPO_DIR/hooks/claude-usage-capture-hooks.json" \
         "$REPO_DIR/hooks/gemini-usage-capture-hooks.json" \
         "$REPO_DIR/hooks/copilot-usage-capture-hooks.json"; do
  [ -f "$f" ] || { echo "FATAL: missing $f" >&2; exit 2; }
done
command -v jq >/dev/null 2>&1 || { echo "FATAL: jq is required for this test" >&2; exit 2; }
command -v git >/dev/null 2>&1 || { echo "FATAL: git is required for this test" >&2; exit 2; }
if ! command -v node >/dev/null 2>&1; then
  echo "FATAL: a Node.js runtime is required for §3 (k) — install Node and re-run \`npm install\`." >&2
  exit 2
fi

# A test run from inside a git hook would otherwise aim the temp repositories
# of §3 (f) at the enclosing repository.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR 2>/dev/null || true

TMP_ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP_ROOT"' EXIT
export HOME="$TMP_ROOT/home"
export CREWRIG_USAGE_ROOT="$TMP_ROOT/usage"
mkdir -p "$HOME"

# install_file() branches on INSTALL_MODE; pin it so nothing symlinks.
# shellcheck disable=SC2034  # read by install_file() in the lib sourced below
INSTALL_MODE="copy"
# shellcheck source=scripts/lib/common.sh
source "$COMMON_LIB"
# shellcheck source=scripts/lib/usage-capture-optin.sh
source "$OPTIN_LIB"

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

CAPTURE_ABS="$(cd "$REPO_DIR/hooks" && pwd -P)/usage-capture.sh"
GUARD_ABS="$(cd "$REPO_DIR/hooks" && pwd -P)/worktree-git-guard.sh"

# --- per-CLI tables (bash 3.2: no associative arrays) ------------------------
cli_events() {
  case "$1" in
    claude)  echo "Stop SessionEnd" ;;
    gemini)  echo "AfterModel" ;;
    copilot) echo "agentStop sessionEnd" ;;
  esac
}
cli_tag() {
  case "$1" in
    claude)  echo "claude-code" ;;
    gemini)  echo "gemini-cli" ;;
    copilot) echo "copilot-cli" ;;
  esac
}
# expected_cmd <cli> <event> <script path> — the exact command the opt-in
# writes: `bash "<path>" <cli-id> <Event>` on every CLI (contract C4).
expected_cmd() {
  printf 'bash "%s" %s %s' "$3" "$(cli_tag "$1")" "$2"
}
# legacy_cmd <cli> <event> <script path> — the command the coupled deployment
# wrote (e344e54, origin/main). It is the same except for Gemini's unquoted
# path, and it must still read as capture so that a coupled install migrates
# (R10, R13).
legacy_cmd() {
  case "$1" in
    gemini) printf 'bash %s gemini-cli %s' "$3" "$2" ;;
    *)      expected_cmd "$@" ;;
  esac
}
# home_config <cli> — the file each setup's capture block targets.
home_config() {
  case "$1" in
    claude)  echo "$HOME/.claude/settings.json" ;;
    gemini)  echo "$HOME/.gemini/settings.json" ;;
    copilot) echo "$HOME/.copilot/hooks/copilot-transcript-hooks.json" ;;
  esac
}
# non_r5_event <cli> — an event the fragment must never register (f').
non_r5_event() {
  case "$1" in
    claude)  echo "PreToolUse" ;;
    gemini)  echo "BeforeTool" ;;
    copilot) echo "postToolUse" ;;
  esac
}
setup_script() { echo "$REPO_DIR/scripts/setup-$1-interactive.sh"; }

# --- test-owned jq oracle ---------------------------------------------------
# `handlers` flattens both shapes into {e: event, s: selector, h: handler}:
# grouped (claude/gemini, `.hooks[E][] = {selector…, hooks:[h…]}`) and flat
# (copilot, `.hooks[E][] = h`). `is_capture` is R10's predicate in its iter-2
# form (the developer's contract C1), written here independently of the
# library: an optional `VAR=value` / `env` / `bash|sh` prefix, the script path
# double-quoted, single-quoted or bare, then exactly `<cli-id> <Event>` and
# nothing else, on a handler whose `.type` is absent or "command".
# PLUS the legacy spaced Gemini form (contract amendments 1 and 2): exactly
# `bash <abs path> gemini-cli AfterModel`, the path holding spaces but no
# character the shell reads as syntax in an unquoted word, and capture ONLY when
# that whole path is an existing file. jq cannot test that, so the shell side
# (oracle_legacy_ok) passes the existing legacy paths as `$legacy_ok`; without
# it the oracle recognises no legacy form.
JQ_DEFS='
def is_cmd:
  (type == "object") and ((.type // "command") == "command")
  and ((.command | type) == "string");
def legacy_path:
  .command | capture("\\Abash (?<p>/[^\\x00-\\x1f\\x7f\"\\x27;&|<>()$`\\\\*?\\[\\]{}#~]*/hooks/usage-capture\\.sh) gemini-cli AfterModel\\z") | .p;
def is_c1:
  is_cmd
  and (.command | test("\\A\\s*(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)*(?:(?:\\S*/)?env\\s+)?(?:(?:\\S*/)?(?:bash|sh)\\s+)?(?:\"[^\"]*/hooks/usage-capture\\.sh\"|\\x27[^\\x27]*/hooks/usage-capture\\.sh\\x27|[^\\s\"\\x27]*/hooks/usage-capture\\.sh)\\s+(?:claude-code|gemini-cli|copilot-cli)\\s+[A-Za-z]+\\s*\\z"));
def is_capture:
  is_c1
  or (is_cmd and ([legacy_path] | any(.[]; . as $p | any(($ARGS.named.legacy_ok // [])[]; . == $p))));
def handlers:
  (.hooks // {}) | to_entries[] | .key as $e | .value[] |
  if (type == "object" and has("hooks"))
  then (del(.hooks) as $s | .hooks[] | {e: $e, s: $s, h: .})
  else {e: $e, h: .} end;
def strip_capture_no_prune:
  if has("hooks") then .hooks |= map_values(map(
    if (type == "object" and has("hooks")) then .hooks |= map(select(is_capture | not))
    else select(is_capture | not) end)) else . end;
'
# oracle_legacy_ok <file> — JSON array of the file's legacy-shaped paths
# (legacy_path, on handlers that are not already C1) that exist.
oracle_legacy_ok() {
  local p ok="" cands
  cands="$(jq -r "$JQ_DEFS"'[handlers | .h | select(is_cmd and (is_c1 | not)) | legacy_path] | unique | .[]' "$1" 2>/dev/null)"
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if [ -f "$p" ]; then ok="${ok}${p}
"; fi
  done <<< "$cands"
  printf '%s' "$ok" | jq -R -s -c 'split("\n") | map(select(length > 0))'
}
jqo() { local f="$1"; shift; jq -r --argjson legacy_ok "$(oracle_legacy_ok "$f")" "$@" "$f" 2>/dev/null; }
capture_count() { jqo "$1" --arg ev "$2" "$JQ_DEFS"'[handlers | select(.e == $ev and (.h | is_capture))] | length'; }
capture_cmds()  { jqo "$1" --arg ev "$2" "$JQ_DEFS"'handlers | select(.e == $ev and (.h | is_capture)) | .h.command'; }
capture_events() { jqo "$1" "$JQ_DEFS"'[handlers | select(.h | is_capture) | .e] | unique | join(" ")'; }
total_capture() { jqo "$1" "$JQ_DEFS"'[handlers | select(.h | is_capture)] | length'; }
# noncapture_view <file> — everything capture does not own: every non-hook key,
# and per event (sorted) its non-capture handlers with their selectors, in
# registration order. Event order is not significant to any CLI.
JQ_DEFS="$JQ_DEFS"'
def noncapture_view:
  [handlers | select(.h | is_capture | not)] as $all
  | {rest: del(.hooks),
     hooks: [$all | map(.e) | unique[] as $e | {e: $e, hs: [$all[] | select(.e == $e) | del(.e)]}]};
'
noncapture_view() { jq -cS --argjson legacy_ok "$(oracle_legacy_ok "$1")" "$JQ_DEFS"'noncapture_view' "$1" 2>/dev/null; }
json_eq() { [ "$(jq -cS . "$1" 2>/dev/null)" = "$(jq -cS . "$2" 2>/dev/null)" ] && [ -n "$(jq -cS . "$1" 2>/dev/null)" ]; }
has_backup() { compgen -G "$1.bak.*" >/dev/null; }
sorted_words() { printf '%s\n' $1 | sort | tr '\n' ' ' | sed 's/ $//'; }

# file_mode <file> — portable: GNU `stat -c %a`, else BSD `stat -f %Lp`.
file_mode() {
  local m
  if m="$(stat -c %a "$1" 2>/dev/null)" && [[ "$m" =~ ^[0-7]+$ ]]; then
    echo "$m"
  else
    stat -f %Lp "$1" 2>/dev/null
  fi
}

# materialize <fixture> <dest> [capture path] — substitute the placeholders.
materialize() {
  local name="$1" dest="$2" cap="${3:-$CAPTURE_ABS}" cli="${1%%-*}"
  mkdir -p "$(dirname "$dest")"
  jq --arg c "$cap" --arg h "$HOME/.$cli/hooks/mempalace-transcript.sh" --arg g "$GUARD_ABS" \
    'walk(if type == "string"
          then gsub("__CAPTURE_ABS__"; $c) | gsub("__HOOK_TARGET__"; $h) | gsub("__GUARD_ABS__"; $g)
          else . end)' "$FIX/$name" > "$dest"
}

# patched_manifest <cli> <dest> — what the session-recording opt-in merges
# after spec 0211: the coupled deployment with its capture handlers deleted
# (and, for Claude, without `.env`, which travels as the env patch).
patched_manifest() {
  local tmp="$TMP_ROOT/pm.$$.json"
  materialize "$1-coupled.json" "$tmp"
  jq "$JQ_DEFS"'strip_capture_no_prune | del(.env)' "$tmp" > "$2"
  rm -f "$tmp"
}
ENV_PATCH='{"MEMPALACE_TRANSCRIPT_ENABLED":"1"}'
merge_sr() {
  if [ "$1" = "claude" ]; then
    merge_session_recording_hooks "$1" "$2" "$3" "$ENV_PATCH"
  else
    merge_session_recording_hooks "$1" "$2" "$3"
  fi
}

# assert_capture_once_at <label> <cli> <file> <script path> [legacy] — R5:
# exactly the R5 events, exactly once each, at exactly the given path, in the
# quoted form, or in the e344e54 form when the 5th argument is `legacy`.
assert_capture_once_at() {
  local label="$1" cli="$2" file="$3" path="$4" form="${5:-quoted}" ev n cmd want
  for ev in $(cli_events "$cli"); do
    n="$(capture_count "$file" "$ev")"
    cmd="$(capture_cmds "$file" "$ev")"
    if [ "$form" = "legacy" ]; then want="$(legacy_cmd "$cli" "$ev" "$path")"; else want="$(expected_cmd "$cli" "$ev" "$path")"; fi
    if [ "$n" = "1" ] && [ "$cmd" = "$want" ]; then
      ok "$label: $cli '$ev' carries exactly one capture command at $path"
    else
      bad "$label: $cli '$ev' capture count=$n command='$cmd' (want 1 x '$want')"
    fi
  done
  if [ "$(capture_events "$file")" = "$(sorted_words "$(cli_events "$cli")")" ]; then
    ok "$label: $cli capture registered on no event outside R5"
  else
    bad "$label: $cli capture events are '$(capture_events "$file")' (want '$(cli_events "$cli")')"
  fi
}

# ---------------------------------------------------------------------------
# §1. The fragments (R3, R5).
# ---------------------------------------------------------------------------
echo "§1 capture fragments (R3, R5)"

for cli in $CLIS; do
  frag="$REPO_DIR/hooks/$cli-usage-capture-hooks.json"
  if jq -e '.hooks | type == "object"' "$frag" >/dev/null 2>&1; then
    ok "$cli fragment is valid JSON with an object 'hooks'"
  else
    bad "$cli fragment is not valid JSON with an object 'hooks'"
  fi
  if [ "$(jq -r '.hooks | keys | join(" ")' "$frag" 2>/dev/null)" = "$(sorted_words "$(cli_events "$cli")")" ]; then
    ok "$cli fragment registers exactly the R5 events ($(cli_events "$cli"))"
  else
    bad "$cli fragment events are '$(jq -r '.hooks | keys | join(" ")' "$frag" 2>/dev/null)'"
  fi
  if [ "$(jqo "$frag" "$JQ_DEFS"'[handlers] | length')" = "$(cli_events "$cli" | wc -w | tr -d ' ')" ] \
     && [ "$(jqo "$frag" "$JQ_DEFS"'[handlers | select(.h | is_capture | not)] | length')" = "0" ]; then
    ok "$cli fragment holds one capture handler per event and nothing else"
  else
    bad "$cli fragment does not hold exactly one capture handler per event"
  fi
  if grep -q 'MEMPALACE' "$frag"; then
    bad "$cli fragment carries a MEMPALACE setting (R3)"
  else
    ok "$cli fragment carries no MEMPALACE setting (R3)"
  fi

  frag_out="$TMP_ROOT/frag-$cli.json"
  usage_capture_fragment "$cli" "$REPO_DIR" > "$frag_out" 2>/dev/null
  rc=$?
  if [ "$rc" -eq 0 ] && ! grep -qE '(CLAUDE|GEMINI|COPILOT)_PROJECT_DIR' "$frag_out"; then
    ok "$cli usage_capture_fragment succeeds and leaves no project-dir token"
  else
    bad "$cli usage_capture_fragment rc=$rc or a project-dir token survived"
  fi
  coupled="$TMP_ROOT/coupled-$cli.json"
  materialize "$cli-coupled.json" "$coupled"
  for ev in $(cli_events "$cli"); do
    # The coupled command with its bare path double-quoted: a no-op on Claude
    # and Copilot, whose coupled path was already quoted.
    want="$(capture_cmds "$coupled" "$ev" | sed -E 's#^bash ([^ "]*/hooks/usage-capture\.sh) #bash "\1" #')"
    if [ -n "$want" ] && [ "$(capture_cmds "$frag_out" "$ev")" = "$want" ] \
       && [ "$want" = "$(expected_cmd "$cli" "$ev" "$CAPTURE_ABS")" ]; then
      ok "$cli '$ev' substituted fragment command is the coupled deployment's, path double-quoted"
    else
      bad "$cli '$ev' fragment command '$(capture_cmds "$frag_out" "$ev")' != '$want'"
    fi
  done
  if [ "$cli" = "gemini" ]; then
    # The fixture must keep the origin/main (unquoted) form: it is what the
    # migration detection of (e), (g) and (j) is exercised against.
    if [ "$(capture_cmds "$coupled" AfterModel)" = "$(legacy_cmd gemini AfterModel "$CAPTURE_ABS")" ]; then
      ok "gemini-coupled.json still carries the legacy unquoted capture command"
    else
      bad "gemini-coupled.json capture command is '$(capture_cmds "$coupled" AfterModel)' (want the legacy unquoted form)"
    fi
  fi
done

# ---------------------------------------------------------------------------
# §2. R2, structural: session recording no longer names capture.
# ---------------------------------------------------------------------------
echo "§2 session recording no longer registers capture (R2)"

# transcript_block <setup> — from `ENABLE_TRANSCRIPTS=` to its top-level `fi`,
# comment lines dropped.
transcript_block() {
  awk '/^ENABLE_TRANSCRIPTS=/ {on=1} on {print} on && /^fi([[:space:];#]|$)/ {exit}' "$1" \
    | grep -vE '^[[:space:]]*#'
}
R2_CAPTURE_RE='usage-capture\.sh|CAPTURE_ABS|usage_capture_(enable|fragment|abs|apply|keep)'
for cli in $CLIS; do
  manifest="$REPO_DIR/hooks/$cli-transcript-hooks.json"
  if grep -q 'usage-capture\.sh' "$manifest"; then
    bad "hooks/$cli-transcript-hooks.json still names usage-capture.sh"
  else
    ok "hooks/$cli-transcript-hooks.json names no usage-capture.sh"
  fi
  block="$(transcript_block "$(setup_script "$cli")")"
  if [ -z "$block" ]; then
    bad "setup-$cli-interactive.sh: no session-recording block found (ENABLE_TRANSCRIPTS= at column 0)"
  # R2 forbids naming the capture COMMAND (its script, its path, or a helper
  # that builds or registers it). Prose naming the feature is allowed, e.g.
  # Gemini's decline line saying that capture is carried over (i1-F7).
  elif grep -qE "$R2_CAPTURE_RE" <<< "$block"; then
    bad "setup-$cli-interactive.sh: the session-recording block still names the capture command: $(grep -nE "$R2_CAPTURE_RE" <<< "$block" | head -3 | tr '\n' ' ')"
  else
    ok "setup-$cli-interactive.sh: the session-recording block names neither the capture script, CAPTURE_ABS, nor a helper that registers it"
  fi
done

# ---------------------------------------------------------------------------
# §3. Behaviour, all three CLIs.
# ---------------------------------------------------------------------------
echo "§3 (a) enable on an absent file (R2, R3, R5, R9; scenario 1)"
for cli in $CLIS; do
  cfg="$(home_config "$cli")"
  rm -f "$cfg"
  out="$(usage_capture_enable "$cli" "$cfg" "$REPO_DIR" 2>&1)"
  rc=$?
  if [ "$rc" -eq 0 ] && [ -f "$cfg" ]; then
    ok "(a) $cli enable on an absent file succeeds and creates it"
  else
    bad "(a) $cli enable rc=$rc, file exists=$([ -f "$cfg" ] && echo yes || echo no): $out"
    continue
  fi
  assert_capture_once_at "(a)" "$cli" "$cfg" "$CAPTURE_ABS"
  if [ "$(jqo "$cfg" "$JQ_DEFS"'[handlers | select(.h | is_capture | not)] | length')" = "0" ]; then
    ok "(a) $cli file holds no transcript and no guard entry (R2)"
  else
    bad "(a) $cli file holds a non-capture handler (R2)"
  fi
  if jq -e 'has("env") | not' "$cfg" >/dev/null 2>&1 && ! grep -q 'MEMPALACE' "$cfg"; then
    ok "(a) $cli file sets no env and names no MEMPALACE setting (R2, R3)"
  else
    bad "(a) $cli file carries an env block or a MEMPALACE setting"
  fi
  if has_backup "$cfg"; then
    bad "(a) $cli a backup was made of a file that did not exist"
  else
    ok "(a) $cli no backup of an absent file (R9)"
  fi
  if [ "$(file_mode "$cfg")" = "600" ]; then
    ok "(a) $cli the created file is 0600"
  else
    bad "(a) $cli the created file is $(file_mode "$cfg"), want 600"
  fi
done

echo "§3 (a') disclosure before writing (R6)"
for cli in $CLIS; do
  cfg="$TMP_ROOT/disclose/$cli/config.json"
  out="$(usage_capture_disclose "$cli" "$cfg" "$REPO_DIR" 2>&1)"
  missing=""
  for needle in $(cli_events "$cli") "$CAPTURE_ABS" "$cfg"; do
    [[ "$out" == *"$needle"* ]] || missing="$missing '$needle'"
  done
  grep -qi 'no prompt or response text' <<< "$out" || missing="$missing 'no prompt or response text'"
  grep -qi 'MemPalace is not required' <<< "$out" || missing="$missing 'MemPalace is not required'"
  if [ -z "$missing" ]; then
    ok "(a') $cli disclosure names the events, the path, the file, no prompt text, no MemPalace"
  else
    bad "(a') $cli disclosure lacks:$missing"
  fi
  if [ -e "$cfg" ]; then
    bad "(a') $cli disclosure wrote the config"
  else
    ok "(a') $cli disclosure writes nothing"
  fi
done

echo "§3 (b) enable over operator entries (R7, R9)"
for cli in $CLIS; do
  cfg="$TMP_ROOT/b/$cli/config.json"
  materialize "$cli-operator.json" "$cfg"
  before="$(noncapture_view "$cfg")"
  usage_capture_enable "$cli" "$cfg" "$REPO_DIR" >/dev/null 2>&1
  rc=$?
  if [ "$rc" -eq 0 ] && [ "$(noncapture_view "$cfg")" = "$before" ] && [ -n "$before" ]; then
    ok "(b) $cli every operator handler and non-hook key is preserved"
  else
    bad "(b) $cli rc=$rc, entries capture does not own changed"
  fi
  assert_capture_once_at "(b)" "$cli" "$cfg" "$CAPTURE_ABS"
  if has_backup "$cfg"; then ok "(b) $cli the existing file was backed up (R9)"; else bad "(b) $cli no backup of the existing file (R9)"; fi
done

echo "§3 (c) empty or 'no' answer on state absent writes nothing (R4; scenario 8)"
for cli in $CLIS; do
  for answer in "" "no"; do
    label="answer='${answer}'"
    cfg="$TMP_ROOT/c/$cli-absent-${answer:-empty}/config.json"
    out="$(usage_capture_apply "$cli" "$cfg" "$REPO_DIR" absent "$answer" 2>&1)"
    rc=$?
    if [ "$rc" -eq 0 ] && [ ! -e "$(dirname "$cfg")" ]; then
      ok "(c) $cli $label on an absent file creates nothing"
    else
      bad "(c) $cli $label rc=$rc or something was created under $(dirname "$cfg")"
    fi
    if [[ "$out" == *"not enabled"* ]] && [[ "$out" == *"setup-$cli-interactive.sh"* ]]; then
      ok "(c) $cli $label prints how to enable capture later"
    else
      bad "(c) $cli $label does not print the enable-later line (got: $out)"
    fi
    cfg="$TMP_ROOT/c/$cli-existing-${answer:-empty}/config.json"
    materialize "$cli-operator-stripped.json" "$cfg"
    cp "$cfg" "$cfg.orig"
    usage_capture_apply "$cli" "$cfg" "$REPO_DIR" absent "$answer" >/dev/null 2>&1
    if cmp -s "$cfg" "$cfg.orig" && ! has_backup "$cfg"; then
      ok "(c) $cli $label on an existing file modifies nothing and backs up nothing"
    else
      bad "(c) $cli $label modified or backed up an existing file"
    fi
  done
done

echo "§3 (d) the session-recording merge preserves capture (R8; scenario 4)"
for cli in $CLIS; do
  patched="$TMP_ROOT/d/$cli-patched.json"
  mkdir -p "$TMP_ROOT/d"
  patched_manifest "$cli" "$patched"
  # Capture-only install whose command names another checkout's script: the
  # merge must neither drop, duplicate nor re-point it.
  other="$TMP_ROOT/d/other-checkout/hooks/usage-capture.sh"
  cfg="$TMP_ROOT/d/$cli/config.json"
  mkdir -p "$(dirname "$cfg")"
  jq --arg from "$CAPTURE_ABS" --arg to "$other" \
    'walk(if type == "string" then (split($from) | join($to)) else . end)' \
    "$(home_config "$cli")" > "$cfg"
  rc1=0; rc2=0
  merge_sr "$cli" "$cfg" "$patched" >/dev/null 2>&1 || rc1=$?
  cp "$cfg" "$cfg.first"
  merge_sr "$cli" "$cfg" "$patched" >/dev/null 2>&1 || rc2=$?
  if [ "$rc1" -eq 0 ] && [ "$rc2" -eq 0 ]; then
    ok "(d) $cli merge_session_recording_hooks succeeds twice"
  else
    bad "(d) $cli merge_session_recording_hooks rc=$rc1/$rc2"
  fi
  assert_capture_once_at "(d) after two merges" "$cli" "$cfg" "$other"
  if [ "$(jq -cS "$JQ_DEFS"'noncapture_view | .hooks' "$cfg" 2>/dev/null)" \
       = "$(jq -cS "$JQ_DEFS"'noncapture_view | .hooks' "$patched" 2>/dev/null)" ]; then
    ok "(d) $cli the session-recording and guard entries were added"
  else
    bad "(d) $cli the session-recording entries are not those of the patched manifest"
  fi
  if json_eq "$cfg" "$cfg.first"; then
    ok "(d) $cli a second merge changes nothing"
  else
    bad "(d) $cli a second merge changed the file"
  fi
  if [ "$cli" = "claude" ]; then
    if [ "$(jq -r '.env.MEMPALACE_TRANSCRIPT_ENABLED // ""' "$cfg")" = "1" ]; then
      ok "(d) claude the env patch is still applied"
    else
      bad "(d) claude the env patch was not applied"
    fi
  fi
  # On a coupled install (both present), re-accepting session recording is a
  # fixed point: capture stays exactly where the coupled deployment put it.
  cfg="$TMP_ROOT/d/$cli-coupled/config.json"
  materialize "$cli-coupled.json" "$cfg"
  merge_sr "$cli" "$cfg" "$patched" >/dev/null 2>&1
  merge_sr "$cli" "$cfg" "$patched" >/dev/null 2>&1
  materialize "$cli-coupled.json" "$cfg.orig"
  if json_eq "$cfg" "$cfg.orig"; then
    ok "(d) $cli two merges over a coupled install leave it unchanged"
  else
    bad "(d) $cli two merges over a coupled install changed it: $(jq -c "$JQ_DEFS"'[handlers | select(.h | is_capture) | .e]' "$cfg" 2>/dev/null)"
  fi
  if has_backup "$cfg"; then ok "(d) $cli the merge backs the file up first"; else bad "(d) $cli the merge took no backup"; fi
done

echo "§3 (e) a coupled install is detected as installed and kept (R10, R11, R13; scenarios 5, 6)"
for cli in $CLIS; do
  cfg="$TMP_ROOT/e/$cli/config.json"
  materialize "$cli-coupled.json" "$cfg"
  cp "$cfg" "$cfg.orig"
  state="$(usage_capture_state "$cli" "$cfg" 2>/dev/null)"
  if [ "$state" = "installed" ]; then
    ok "(e) $cli coupled install is state 'installed'"
  else
    bad "(e) $cli coupled install is state '$state'"
  fi
  rc1=0; rc2=0
  out="$(usage_capture_apply "$cli" "$cfg" "$REPO_DIR" installed "" 2>&1)" || rc1=$?
  usage_capture_apply "$cli" "$cfg" "$REPO_DIR" installed "" >/dev/null 2>&1 || rc2=$?
  if [ "$rc1" -eq 0 ] && [ "$rc2" -eq 0 ] && cmp -s "$cfg" "$cfg.orig" && ! has_backup "$cfg"; then
    ok "(e) $cli empty answer twice = keep: byte-identical, no backup"
  else
    bad "(e) $cli empty answer rc=$rc1/$rc2, file changed or backed up"
  fi
  if [[ "$out" == *re-pointed* ]]; then
    bad "(e) $cli keep reported a re-point on a path that resolves"
  else
    ok "(e) $cli keep reports no re-point on a path that resolves"
  fi
  usage_capture_apply "$cli" "$cfg" "$REPO_DIR" installed "keep" >/dev/null 2>&1
  if cmp -s "$cfg" "$cfg.orig"; then ok "(e) $cli explicit keep is byte-identical"; else bad "(e) $cli explicit keep changed the file"; fi

  # R11 "exactly once": a duplicated capture handler is collapsed by keep.
  dup="$TMP_ROOT/e/$cli-dup/config.json"
  mkdir -p "$(dirname "$dup")"
  first_ev="$(cli_events "$cli" | awk '{print $1}')"
  if [ "$cli" = "copilot" ]; then
    jq --arg ev "$first_ev" '.hooks[$ev] += [.hooks[$ev][-1]]' "$cfg.orig" > "$dup"
  else
    jq --arg ev "$first_ev" '.hooks[$ev][0].hooks += [.hooks[$ev][0].hooks[-1]]' "$cfg.orig" > "$dup"
  fi
  usage_capture_apply "$cli" "$dup" "$REPO_DIR" installed "keep" >/dev/null 2>&1
  if [ "$(capture_count "$dup" "$first_ev")" = "1" ] && [ "$(noncapture_view "$dup")" = "$(noncapture_view "$cfg.orig")" ]; then
    ok "(e) $cli keep collapses a duplicated capture handler on '$first_ev' and touches nothing else"
  else
    bad "(e) $cli keep left $(capture_count "$dup" "$first_ev") capture handlers on '$first_ev'"
  fi
done

echo "§3 (f) keep re-points a vanished path and only a vanished path (R6, R11; scenario 7)"
# A linked worktree with a stub capture script, to observe R6's warning.
WT_MAIN="$TMP_ROOT/wt/main"
WT_LINKED="$TMP_ROOT/wt/linked"
mkdir -p "$WT_MAIN/hooks"
printf '#!/bin/bash\nexit 0\n' > "$WT_MAIN/hooks/usage-capture.sh"
cp "$REPO_DIR"/hooks/*-usage-capture-hooks.json "$WT_MAIN/hooks/"
if git -C "$WT_MAIN" init -q 2>/dev/null \
   && git -C "$WT_MAIN" add hooks \
   && git -C "$WT_MAIN" -c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false commit -q -m init \
   && git -C "$WT_MAIN" worktree add -q --detach "$WT_LINKED" >/dev/null 2>&1; then
  ok "(f) temp repository and linked worktree created"
else
  bad "(f) could not create the temp linked worktree"
fi
WT_CAPTURE_ABS="$(cd "$WT_LINKED/hooks" 2>/dev/null && pwd -P)/usage-capture.sh"

for cli in $CLIS; do
  other="$TMP_ROOT/f/$cli-other-checkout/hooks/usage-capture.sh"
  mkdir -p "$(dirname "$other")"
  cp "$REPO_DIR/hooks/usage-capture.sh" "$other"
  cfg="$TMP_ROOT/f/$cli/config.json"
  materialize "$cli-coupled.json" "$cfg" "$other"
  cp "$cfg" "$cfg.orig"

  out="$(usage_capture_keep "$cli" "$cfg" "$REPO_DIR" 2>&1)"
  if cmp -s "$cfg" "$cfg.orig" && [[ "$out" != *re-pointed* ]] && ! has_backup "$cfg"; then
    ok "(f) $cli keep leaves a still-resolving path unchanged, reports nothing, backs up nothing"
  else
    bad "(f) $cli keep touched a still-resolving path (out: $out)"
  fi

  rm -f "$other"
  out="$(usage_capture_keep "$cli" "$cfg" "$REPO_DIR" 2>&1)"
  rc=$?
  if [ "$rc" -eq 0 ] && [[ "$out" == *re-pointed* ]]; then
    ok "(f) $cli keep reports the re-point of a vanished path"
  else
    bad "(f) $cli keep rc=$rc did not report a re-point (out: $out)"
  fi
  assert_capture_once_at "(f) after re-point" "$cli" "$cfg" "$CAPTURE_ABS"
  if [ "$(noncapture_view "$cfg")" = "$(noncapture_view "$cfg.orig")" ]; then
    ok "(f) $cli the re-point changed no other entry"
  else
    bad "(f) $cli the re-point changed an entry capture does not own"
  fi
  if has_backup "$cfg"; then ok "(f) $cli the re-point backed the file up"; else bad "(f) $cli the re-point took no backup"; fi

  # R6 on keep: warn when CAPTURE_ABS is written from a linked worktree, and
  # only then.
  cfg="$TMP_ROOT/f/$cli-wt/config.json"
  materialize "$cli-coupled.json" "$cfg" "$TMP_ROOT/f/vanished/hooks/usage-capture.sh"
  out="$(usage_capture_keep "$cli" "$cfg" "$WT_LINKED" 2>&1)"
  if [[ "$out" == *"linked git worktree"* ]] && [ "$(capture_cmds "$cfg" "$(cli_events "$cli" | awk '{print $1}')")" \
       = "$(expected_cmd "$cli" "$(cli_events "$cli" | awk '{print $1}')" "$WT_CAPTURE_ABS")" ]; then
    ok "(f) $cli re-pointing from a linked worktree prints the linked-worktree WARNING"
  else
    bad "(f) $cli re-pointing from a linked worktree: no WARNING or wrong target (out: $out)"
  fi
  out="$(usage_capture_keep "$cli" "$cfg" "$WT_LINKED" 2>&1)"
  if [[ "$out" == *"linked git worktree"* ]]; then
    bad "(f) $cli a no-op keep from a linked worktree still prints the WARNING"
  else
    ok "(f) $cli a no-op keep from a linked worktree prints no WARNING"
  fi
  out="$(usage_capture_disclose "$cli" "$cfg" "$WT_LINKED" 2>&1)"
  if [[ "$out" == *"linked git worktree"* ]]; then
    ok "(f) $cli the enable disclosure from a linked worktree prints the WARNING (R6)"
  else
    bad "(f) $cli the enable disclosure from a linked worktree prints no WARNING"
  fi
done

echo "§3 (f') a capture handler on a non-R5 event survives keep (R11)"
for cli in $CLIS; do
  ev="$(non_r5_event "$cli")"
  cfg="$TMP_ROOT/fp/$cli/config.json"
  materialize "$cli-coupled.json" "$cfg"
  cmd="$(expected_cmd "$cli" "$ev" "$CAPTURE_ABS")"
  if [ "$cli" = "copilot" ]; then
    jq --arg ev "$ev" --arg c "$cmd" '.hooks[$ev] += [{type: "command", command: $c}]' "$cfg" > "$cfg.tmp"
  else
    jq --arg ev "$ev" --arg c "$cmd" '.hooks[$ev] = ((.hooks[$ev] // []) + [{matcher: "Hand", hooks: [{type: "command", command: $c}]}])' "$cfg" > "$cfg.tmp"
  fi
  mv "$cfg.tmp" "$cfg"
  before="$(jq -c --arg ev "$ev" '.hooks[$ev]' "$cfg")"
  usage_capture_keep "$cli" "$cfg" "$REPO_DIR" >/dev/null 2>&1
  if [ "$(jq -c --arg ev "$ev" '.hooks[$ev]' "$cfg")" = "$before" ] && [ "$(capture_count "$cfg" "$ev")" = "1" ]; then
    ok "(f') $cli the hand-placed capture handler on '$ev' is byte-identical after keep"
  else
    bad "(f') $cli keep changed '$ev': $(jq -c --arg ev "$ev" '.hooks[$ev]' "$cfg")"
  fi
done

echo "§3 (g) remove on a coupled install leaves session recording and the guard (R9, R12; scenario 3)"
for cli in $CLIS; do
  cfg="$TMP_ROOT/g/$cli/config.json"
  materialize "$cli-coupled.json" "$cfg"
  expect="$TMP_ROOT/g/$cli-expect.json"
  jq "$JQ_DEFS"'strip_capture_no_prune' "$cfg" > "$expect"
  usage_capture_remove "$cli" "$cfg" >/dev/null 2>&1
  rc=$?
  if [ "$rc" -eq 0 ] && has_backup "$cfg"; then ok "(g) $cli remove succeeds after backing the file up"; else bad "(g) $cli remove rc=$rc or took no backup"; fi
  if [ "$(total_capture "$cfg")" = "0" ] && [ "$(usage_capture_state "$cli" "$cfg" 2>/dev/null)" = "absent" ]; then
    ok "(g) $cli no capture command remains; state is 'absent'"
  else
    bad "(g) $cli $(total_capture "$cfg") capture command(s) remain"
  fi
  if json_eq "$cfg" "$expect"; then
    ok "(g) $cli transcript and guard entries equal the fixture minus capture"
  else
    bad "(g) $cli remove changed an entry it does not own"
  fi
  # R9: removal on an absent file writes nothing.
  absent="$TMP_ROOT/g/$cli-absent/config.json"
  usage_capture_remove "$cli" "$absent" >/dev/null 2>&1
  if [ ! -e "$absent" ] && ! has_backup "$absent"; then ok "(g) $cli remove on an absent file writes nothing"; else bad "(g) $cli remove created a file"; fi
done

echo "§3 (h) remove keeps the operator handler and prunes emptied containers (R7, R12; scenario 9)"
for fixture in claude-operator gemini-operator gemini-capture-only copilot-operator; do
  cli="${fixture%%-*}"
  cfg="$TMP_ROOT/h/$fixture/config.json"
  materialize "$fixture.json" "$cfg"
  rc=0
  usage_capture_apply "$cli" "$cfg" "$REPO_DIR" installed remove >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq 0 ] && json_eq "$cfg" "$FIX/$fixture-stripped.json"; then
    ok "(h) $fixture: remove leaves exactly what capture-never-enabled holds"
  else
    bad "(h) $fixture: rc=$rc, got $(jq -cS . "$cfg" 2>/dev/null) want $(jq -cS . "$FIX/$fixture-stripped.json")"
  fi
done
cfg="$TMP_ROOT/h/claude-operator/config.json"
if [ "$(jq -c '.hooks.Stop' "$cfg" 2>/dev/null)" = '[{"matcher":"","hooks":[{"type":"command","command":"/opt/operator/bin/notify-done.sh"}]}]' ] \
   && jq -e '.hooks | has("SessionEnd") | not' "$cfg" >/dev/null 2>&1; then
  ok "(h) scenario 9: Stop carries the operator command alone and SessionEnd is no longer registered"
else
  bad "(h) scenario 9: Stop=$(jq -c '.hooks.Stop' "$cfg" 2>/dev/null) SessionEnd present=$(jq -c '.hooks | has("SessionEnd")' "$cfg" 2>/dev/null)"
fi
if jq -e 'has("hooks") | not' "$TMP_ROOT/h/gemini-capture-only/config.json" >/dev/null 2>&1; then
  ok "(h) gemini: a settings.json whose only hooks were capture loses its 'hooks' key"
else
  bad "(h) gemini: a capture-only settings.json kept a 'hooks' key"
fi
if jq -e '(.hooks | type) == "object" and .version == 1' "$TMP_ROOT/h/copilot-operator/config.json" >/dev/null 2>&1; then
  ok "(h) copilot: the manifest keeps its own 'hooks' and 'version' keys"
else
  bad "(h) copilot: the manifest lost its schema keys"
fi

echo "§3 (i) enable then remove returns the original (R12)"
for fixture in claude-nohooks claude-operator-stripped gemini-operator-stripped gemini-capture-only-stripped copilot-operator-stripped; do
  cli="${fixture%%-*}"
  cfg="$TMP_ROOT/i/$fixture/config.json"
  materialize "$fixture.json" "$cfg"
  rc1=0; rc2=0
  usage_capture_enable "$cli" "$cfg" "$REPO_DIR" >/dev/null 2>&1 || rc1=$?
  enabled_n="$(total_capture "$cfg")"
  usage_capture_remove "$cli" "$cfg" >/dev/null 2>&1 || rc2=$?
  if [ "$rc1" -eq 0 ] && [ "$rc2" -eq 0 ] && [ "${enabled_n:-0}" -gt 0 ] && json_eq "$cfg" "$FIX/$fixture.json"; then
    ok "(i) $fixture: enable+remove is jq -S-equal to the original"
  else
    bad "(i) $fixture: rc=$rc1/$rc2 enabled=$enabled_n, got $(jq -cS . "$cfg" 2>/dev/null)"
  fi
done

echo "§3 (j) Gemini: the capture entry survives the settings template rewrite (R13)"
cfg="$TMP_ROOT/j/settings.json"
materialize "gemini-coupled.json" "$cfg"
fp="$(usage_capture_footprint gemini "$cfg" 2>/dev/null)"
rc=$?
if [ "$rc" -eq 0 ] && [ "$(jq -r 'length' <<< "$fp" 2>/dev/null)" = "1" ]; then
  ok "(j) footprint of a coupled Gemini install holds its one capture handler"
else
  bad "(j) footprint rc=$rc: $fp"
fi
cp "$GEMINI_TEMPLATE" "$cfg"
usage_capture_reinject gemini "$cfg" "$fp" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ] && [ "$(usage_capture_state gemini "$cfg" 2>/dev/null)" = "installed" ]; then
  ok "(j) after template rewrite + reinject the install is 'installed'"
else
  bad "(j) reinject rc=$rc, state '$(usage_capture_state gemini "$cfg" 2>/dev/null)'"
fi
# The carried-over entry is the coupled one, verbatim: still unquoted.
assert_capture_once_at "(j)" gemini "$cfg" "$CAPTURE_ABS" legacy
if [ "$(jq -cS 'del(.hooks)' "$cfg" 2>/dev/null)" = "$(jq -cS 'del(.hooks)' "$GEMINI_TEMPLATE")" ]; then
  ok "(j) reinject changed nothing but the capture entry"
else
  bad "(j) reinject changed a non-hook setting of the template"
fi
fp_empty="$(usage_capture_footprint gemini "$TMP_ROOT/j/absent.json" 2>/dev/null)"
if [ "$(jq -c . <<< "$fp_empty" 2>/dev/null)" = "[]" ]; then ok "(j) footprint of an absent file is []"; else bad "(j) footprint of an absent file is '$fp_empty'"; fi
printf '{"hooks": ' > "$TMP_ROOT/j/broken.json"
usage_capture_footprint gemini "$TMP_ROOT/j/broken.json" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 2 ] && [ "$(cat "$TMP_ROOT/j/broken.json")" = '{"hooks": ' ]; then
  ok "(j) footprint of an unparsable file returns 2 and leaves it untouched (the setup falls back to [])"
else
  bad "(j) footprint of an unparsable file rc=$rc (want 2)"
fi

echo "§3 (k) the registered command writes a journal record with no MemPalace (R3; scenario 1)"
K_BIN="$TMP_ROOT/k/bin"
K_CWD="$TMP_ROOT/k/elsewhere"
mkdir -p "$K_BIN" "$K_CWD"
ln -s "$(command -v node)" "$K_BIN/node"
K_PATH="$K_BIN:/usr/bin:/bin"
if PATH="$K_PATH" command -v mempalace >/dev/null 2>&1; then
  bad "(k) mempalace is reachable on the restricted PATH ($K_PATH) — the no-MemPalace premise does not hold"
else
  ok "(k) mempalace is not on the restricted PATH"
fi
cp "$CLAUDE_SESSION_FIXTURE" "$TMP_ROOT/k/session.jsonl"
for cli in $CLIS; do
  ev="$(cli_events "$cli" | awk '{print $1}')"
  cmd="$(capture_cmds "$(home_config "$cli")" "$ev")"
  case "$cli" in
    claude) payload="{\"transcript_path\":\"$TMP_ROOT/k/session.jsonl\"}" ;;
    *)      payload='{}' ;;
  esac
  root="$TMP_ROOT/k/usage-$cli"
  if [ -z "$cmd" ]; then
    bad "(k) $cli no registered command to run (see (a))"
    continue
  fi
  (cd "$K_CWD" && PATH="$K_PATH" CREWRIG_USAGE_ROOT="$root" /bin/sh -c "$cmd" <<< "$payload") >/dev/null 2>&1
  rc=$?
  n="$(find "$root/journal" -name '*.json' ! -name '*.wing.json' ! -name '*.attr.json' 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$rc" -eq 0 ] && [ "${n:-0}" -ge 1 ]; then
    ok "(k) $cli the registered '$ev' command, run from outside the repo, wrote $n journal record(s)"
  else
    bad "(k) $cli the registered command rc=$rc wrote $n journal record(s)"
  fi
done

echo "§3 (l) unparsable input: every writer fails and leaves the file byte-identical"
for cli in $CLIS; do
  patched="$TMP_ROOT/l/$cli-patched.json"
  mkdir -p "$TMP_ROOT/l"
  patched_manifest "$cli" "$patched"
  good="$TMP_ROOT/l/$cli-good.json"
  materialize "$cli-coupled.json" "$good"
  fp="$(usage_capture_footprint "$cli" "$good" 2>/dev/null)"
  for writer in state footprint enable keep remove reinject merge; do
    cfg="$TMP_ROOT/l/$cli-$writer/config.json"
    mkdir -p "$(dirname "$cfg")"
    printf '{"hooks": {"Stop": [' > "$cfg"
    cp "$cfg" "$cfg.orig"
    rc=0
    case "$writer" in
      state)     usage_capture_state "$cli" "$cfg" >/dev/null 2>&1 || rc=$? ;;
      footprint) usage_capture_footprint "$cli" "$cfg" >/dev/null 2>&1 || rc=$? ;;
      enable)    usage_capture_enable "$cli" "$cfg" "$REPO_DIR" >/dev/null 2>&1 || rc=$? ;;
      keep)      usage_capture_keep "$cli" "$cfg" "$REPO_DIR" >/dev/null 2>&1 || rc=$? ;;
      remove)    usage_capture_remove "$cli" "$cfg" >/dev/null 2>&1 || rc=$? ;;
      reinject)  usage_capture_reinject "$cli" "$cfg" "$fp" >/dev/null 2>&1 || rc=$? ;;
      merge)     merge_sr "$cli" "$cfg" "$patched" >/dev/null 2>&1 || rc=$? ;;
    esac
    if [ "$rc" -ne 0 ] && cmp -s "$cfg" "$cfg.orig"; then
      ok "(l) $cli $writer returns non-zero ($rc) and leaves the file byte-identical"
    else
      bad "(l) $cli $writer rc=$rc, file identical=$(cmp -s "$cfg" "$cfg.orig" && echo yes || echo no)"
    fi
  done
done

echo "§3 (m) file mode: 0600 stays 0600, 0644 ends 0600"
for cli in $CLIS; do
  patched="$TMP_ROOT/m/$cli-patched.json"
  mkdir -p "$TMP_ROOT/m"
  patched_manifest "$cli" "$patched"
  good="$TMP_ROOT/m/$cli-good.json"
  materialize "$cli-coupled.json" "$good"
  fp="$(usage_capture_footprint "$cli" "$good" 2>/dev/null)"
  for mode in 600 644; do
    for writer in enable remove keep-repoint reinject merge; do
      cfg="$TMP_ROOT/m/$cli-$mode-$writer/config.json"
      case "$writer" in
        enable|reinject) materialize "$cli-operator-stripped.json" "$cfg" ;;
        keep-repoint)    materialize "$cli-coupled.json" "$cfg" "$TMP_ROOT/m/vanished/hooks/usage-capture.sh" ;;
        merge)           materialize "$cli-operator.json" "$cfg" ;;
        *)               materialize "$cli-coupled.json" "$cfg" ;;
      esac
      chmod "$mode" "$cfg"
      cp "$cfg" "$cfg.orig"
      rc=0
      case "$writer" in
        enable)       usage_capture_enable "$cli" "$cfg" "$REPO_DIR" >/dev/null 2>&1 || rc=$? ;;
        remove)       usage_capture_remove "$cli" "$cfg" >/dev/null 2>&1 || rc=$? ;;
        keep-repoint) usage_capture_keep "$cli" "$cfg" "$REPO_DIR" >/dev/null 2>&1 || rc=$? ;;
        reinject)     usage_capture_reinject "$cli" "$cfg" "$fp" >/dev/null 2>&1 || rc=$? ;;
        merge)        merge_sr "$cli" "$cfg" "$patched" >/dev/null 2>&1 || rc=$? ;;
      esac
      got="$(file_mode "$cfg")"
      if [ "$rc" -eq 0 ] && ! cmp -s "$cfg" "$cfg.orig" && [ "$got" = "600" ]; then
        ok "(m) $cli $writer on a 0$mode file writes it and leaves it 0600"
      else
        bad "(m) $cli $writer on a 0$mode file: rc=$rc, written=$(cmp -s "$cfg" "$cfg.orig" && echo no || echo yes), mode=$got (want 600)"
      fi
    done
  done
done

echo "§3 (n) helpers return, never exit, under bash -e on unparsable input"
N_CFG="$TMP_ROOT/n/config.json"
N_PATCHED="$TMP_ROOT/n/patched.json"
mkdir -p "$TMP_ROOT/n"
printf '{"hooks": ' > "$N_CFG"
patched_manifest claude "$N_PATCHED"
for call in \
  'X="$(usage_capture_state claude "$CFG")" || rc=$?' \
  'X="$(usage_capture_footprint claude "$CFG")" || rc=$?' \
  'usage_capture_enable claude "$CFG" "$REPO" || rc=$?' \
  'usage_capture_keep claude "$CFG" "$REPO" || rc=$?' \
  'usage_capture_remove claude "$CFG" || rc=$?' \
  'usage_capture_reinject claude "$CFG" "[]" || rc=$?' \
  'usage_capture_apply claude "$CFG" "$REPO" installed remove || rc=$?' \
  'usage_capture_apply claude "$CFG" "$REPO" absent yes || rc=$?' \
  'merge_session_recording_hooks claude "$CFG" "$PATCHED" "{}" || rc=$?'; do
  out="$(CFG="$N_CFG" REPO="$REPO_DIR" PATCHED="$N_PATCHED" COMMON="$COMMON_LIB" LIB="$OPTIN_LIB" \
    "$BASH" -e -c 'INSTALL_MODE=copy; source "$COMMON"; source "$LIB"; rc=0; '"$call"'; echo "SENTINEL rc=$rc"' 2>/dev/null)"
  fn="$(grep -oE '(usage_capture_[a-z_]+|merge_session_recording_hooks)' <<< "$call" | head -1)"
  if [[ "$out" =~ SENTINEL\ rc=([0-9]+) ]] && [ "${BASH_REMATCH[1]}" -ne 0 ]; then
    ok "(n) $fn returns ${BASH_REMATCH[1]} under the guarded idiom and the sentinel after it is reached"
  else
    bad "(n) '$call' — sentinel not reached or rc 0 (out: $(tail -1 <<< "$out"))"
  fi
done

# ---------------------------------------------------------------------------
# §3 (o)–(u). Security hardening (PR #1209 security review S1–S3 and finding 6,
# seat finding i1-F6). Shared builders first.
# ---------------------------------------------------------------------------

# init_cfg <cli> <file> — a config holding one non-hook key and no capture.
init_cfg() {
  mkdir -p "$(dirname "$2")"
  case "$1" in
    claude)  printf '{"model":"opus"}\n' > "$2" ;;
    gemini)  printf '{"theme":"Default"}\n' > "$2" ;;
    copilot) printf '{"version":1,"hooks":{}}\n' > "$2" ;;
  esac
}
# add_cmds <cli> <file> <event> <command>… — append the commands to <event> as
# one new matcher group (grouped shapes) or as flat handlers (Copilot).
add_cmds() {
  local cli="$1" file="$2" ev="$3" arr prog
  shift 3
  arr="$(printf '%s\n' "$@" | jq -R . | jq -sc 'map({type: "command", command: .})')"
  case "$cli" in
    claude)  prog='.hooks[$ev] = ((.hooks[$ev] // []) + [{matcher: "", hooks: $a}])' ;;
    gemini)  prog='.hooks[$ev] = ((.hooks[$ev] // []) + [{hooks: $a}])' ;;
    copilot) prog='.hooks[$ev] = ((.hooks[$ev] // []) + $a)' ;;
  esac
  jq --arg ev "$ev" --argjson a "$arr" "$prog" "$file" > "$file.t" && mv "$file.t" "$file"
}
backup_count() { compgen -G "$1.bak.*" 2>/dev/null | wc -l | tr -d ' '; }
empty_groups() { jqo "$1" '[.hooks // {} | .[]? | .[]? | select(type == "object" and (.hooks | type) == "array" and (.hooks | length) == 0)] | length'; }
OLD_STAMP="20200101-000000"

echo "§3 (o) S1: every backup is 0600, and older backups of the config are narrowed"
for cli in $CLIS; do
  patched="$TMP_ROOT/o/$cli-patched.json"
  mkdir -p "$TMP_ROOT/o"
  patched_manifest "$cli" "$patched"
  for writer in enable keep remove merge; do
    cfg="$TMP_ROOT/o/$cli-$writer/config.json"
    case "$writer" in
      enable) materialize "$cli-operator-stripped.json" "$cfg" ;;
      keep)   materialize "$cli-coupled.json" "$cfg" "$TMP_ROOT/o/vanished/hooks/usage-capture.sh" ;;
      remove) materialize "$cli-coupled.json" "$cfg" ;;
      merge)  materialize "$cli-operator.json" "$cfg" ;;
    esac
    chmod 644 "$cfg"
    # A main-era backup: a world-readable copy of the token-bearing file.
    old="$cfg.bak.$OLD_STAMP"
    printf '{"Authorization":"Bearer OLD"}\n' > "$old"
    chmod 644 "$old"
    cp "$old" "$old.orig"
    rc=0
    case "$writer" in
      enable) usage_capture_enable "$cli" "$cfg" "$REPO_DIR" >/dev/null 2>&1 || rc=$? ;;
      keep)   usage_capture_keep "$cli" "$cfg" "$REPO_DIR" >/dev/null 2>&1 || rc=$? ;;
      remove) usage_capture_remove "$cli" "$cfg" >/dev/null 2>&1 || rc=$? ;;
      merge)  merge_sr "$cli" "$cfg" "$patched" >/dev/null 2>&1 || rc=$? ;;
    esac
    new="$(compgen -G "$cfg.bak.*" | grep -vE "\.bak\.$OLD_STAMP(\.orig)?$" | head -1)"
    if [ "$rc" -eq 0 ] && [ -n "$new" ] && [ "$(file_mode "$new")" = "600" ]; then
      ok "(o) $cli $writer: the new backup of a 0644 source is 0600"
    else
      bad "(o) $cli $writer: rc=$rc, new backup '${new##*/}' mode=$( [ -n "$new" ] && file_mode "$new") (want 600)"
    fi
    if [ "$(file_mode "$old")" = "600" ] && cmp -s "$old" "$old.orig"; then
      ok "(o) $cli $writer: a pre-existing 0644 backup ends 0600, content unchanged"
    else
      bad "(o) $cli $writer: the pre-existing backup is $(file_mode "$old") (want 600), identical=$(cmp -s "$old" "$old.orig" && echo yes || echo no)"
    fi
  done
done
# The setups call backup_file directly too (Gemini before its template write):
# narrowing does not depend on a backup being made.
cfg="$TMP_ROOT/o/absent/settings.json"
mkdir -p "$(dirname "$cfg")"
printf 'old\n' > "$cfg.bak.$OLD_STAMP"
chmod 644 "$cfg.bak.$OLD_STAMP"
out="$(backup_file "$cfg" 2>&1)"
if [ -z "$out" ] && [ "$(file_mode "$cfg.bak.$OLD_STAMP")" = "600" ] && [ "$(backup_count "$cfg")" = "1" ]; then
  ok "(o) backup_file on an absent target prints nothing, creates nothing, and narrows its older backups"
else
  bad "(o) backup_file on an absent target: out='$out', old backup mode=$(file_mode "$cfg.bak.$OLD_STAMP"), backups=$(backup_count "$cfg")"
fi

echo "§3 (p) S2: an operator hook naming /hooks/usage-capture.sh is never touched"
# An operator script that happens to share the name, and EXISTS: the former
# `keep` used the first existing registered path as its re-registration target.
FOREIGN="$TMP_ROOT/p/operator-tools/hooks/usage-capture.sh"
mkdir -p "$(dirname "$FOREIGN")"
printf '#!/bin/bash\nexit 0\n' > "$FOREIGN"
for cli in $CLIS; do
  tag="$(cli_tag "$cli")"
  base="$TMP_ROOT/p/$cli-foreign.json"
  init_cfg "$cli" "$base"
  for ev in $(cli_events "$cli"); do
    add_cmds "$cli" "$base" "$ev" \
      "bash \"$FOREIGN\" --weekly-report" \
      "bash \"$FOREIGN\" $tag $ev --extra" \
      "bash \"$FOREIGN\" nightly" \
      "bash \"$FOREIGN\" other-cli $ev" \
      "echo hi; bash \"$CAPTURE_ABS\" $tag $ev" \
      "bash \"/opt/x/hooks/my-usage-capture.sh\" $tag $ev"
  done
  # A non-command handler whose text is a capture command.
  first_ev="$(cli_events "$cli" | awk '{print $1}')"
  if [ "$cli" = "copilot" ]; then
    jq --arg ev "$first_ev" --arg c "$(expected_cmd "$cli" "$first_ev" "$CAPTURE_ABS")" \
      '.hooks[$ev] += [{type: "prompt", command: $c}]' "$base" > "$base.t"
  else
    jq --arg ev "$first_ev" --arg c "$(expected_cmd "$cli" "$first_ev" "$CAPTURE_ABS")" \
      '.hooks[$ev][0].hooks += [{type: "prompt", command: $c}]' "$base" > "$base.t"
  fi
  mv "$base.t" "$base"

  # Detection.
  state="$(usage_capture_state "$cli" "$base" 2>/dev/null)"
  fpn="$(usage_capture_footprint "$cli" "$base" 2>/dev/null | jq 'length' 2>/dev/null)"
  paths="$(usage_capture_paths "$cli" "$base" 2>/dev/null)"
  if [ "$state" = "absent" ] && [ "$fpn" = "0" ] && [ -z "$paths" ]; then
    ok "(p) $cli look-alike commands are not capture: state absent, empty footprint, no path"
  else
    bad "(p) $cli look-alikes read as capture: state=$state footprint=$fpn paths=$(tr '\n' ' ' <<< "$paths")"
  fi

  # remove: deletes crewrig's handlers only; the rest equals the base.
  cfg="$TMP_ROOT/p/$cli-remove/config.json"
  mkdir -p "$(dirname "$cfg")"
  cp "$base" "$cfg"
  for ev in $(cli_events "$cli"); do add_cmds "$cli" "$cfg" "$ev" "$(expected_cmd "$cli" "$ev" "$CAPTURE_ABS")"; done
  cp "$cfg" "$TMP_ROOT/p/$cli-with-capture.json"
  usage_capture_remove "$cli" "$cfg" >/dev/null 2>&1
  if json_eq "$cfg" "$base"; then
    ok "(p) $cli remove deletes crewrig's capture and leaves every look-alike as it was"
  else
    bad "(p) $cli remove changed a look-alike: $(jq -c .hooks "$cfg" 2>/dev/null)"
  fi

  # keep with crewrig's capture beside the look-alikes: a no-op (no dedup).
  cfg="$TMP_ROOT/p/$cli-keep-noop/config.json"
  mkdir -p "$(dirname "$cfg")"
  cp "$TMP_ROOT/p/$cli-with-capture.json" "$cfg"
  cp "$cfg" "$cfg.orig"
  usage_capture_keep "$cli" "$cfg" "$REPO_DIR" >/dev/null 2>&1
  if cmp -s "$cfg" "$cfg.orig" && ! has_backup "$cfg"; then
    ok "(p) $cli keep beside look-alikes is a byte-identical no-op (none is deduplicated)"
  else
    bad "(p) $cli keep changed a file whose only capture is crewrig's: $(jq -c .hooks "$cfg" 2>/dev/null)"
  fi

  # keep with look-alikes only: re-registers crewrig's script, never the
  # operator's, and touches no look-alike.
  cfg="$TMP_ROOT/p/$cli-keep-add/config.json"
  mkdir -p "$(dirname "$cfg")"
  cp "$base" "$cfg"
  usage_capture_keep "$cli" "$cfg" "$REPO_DIR" >/dev/null 2>&1
  if [ "$(noncapture_view "$cfg")" = "$(noncapture_view "$base")" ] && [ -n "$(noncapture_view "$base")" ]; then
    ok "(p) $cli keep leaves every look-alike and non-hook key as it was"
  else
    bad "(p) $cli keep changed a look-alike: $(jq -c .hooks "$cfg" 2>/dev/null)"
  fi
  assert_capture_once_at "(p) keep over look-alikes" "$cli" "$cfg" "$CAPTURE_ABS"
done
# Security review N1: the legacy spaced Gemini form must not swallow an
# operator compound command, nor a tool whose argument merely ends in
# /hooks/usage-capture.sh (a spaced "path" that does not exist as a whole).
# Each case sits alone on AfterModel beside an operator neighbour. The last
# one is a compound whose whole `&&`-spanning text ALSO names an existing
# file, so only the path class (never the existence test) can reject it.
N1_PRE="$TMP_ROOT/p/n1/prep"
N1_CAP="$TMP_ROOT/p/n1/tools/hooks/usage-capture.sh"
mkdir -p "$(dirname "$N1_CAP")" "$(dirname "$N1_PRE && $N1_CAP")"
printf '#!/bin/bash\nexit 0\n' > "$N1_CAP"
printf '#!/bin/bash\nexit 0\n' > "$N1_PRE && $N1_CAP"
N1_CASES="and|bash /opt/prep.sh && $CAPTURE_ABS gemini-cli AfterModel
semi|bash /opt/notify.sh; bash $CAPTURE_ABS gemini-cli AfterModel
toolarg|bash /x/tool /a b/hooks/usage-capture.sh gemini-cli AfterModel
and-existing|bash $N1_PRE && $N1_CAP gemini-cli AfterModel"
while IFS='|' read -r label c; do
  [ -n "$label" ] || continue
  base="$TMP_ROOT/p/n1-$label.json"
  init_cfg gemini "$base"
  add_cmds gemini "$base" AfterModel "echo operator" "$c"
  state="$(usage_capture_state gemini "$base" 2>/dev/null)"
  fpn="$(usage_capture_footprint gemini "$base" 2>/dev/null | jq 'length' 2>/dev/null)"
  paths="$(usage_capture_paths gemini "$base" 2>/dev/null)"
  if [ "$state" = "absent" ] && [ "$fpn" = "0" ] && [ -z "$paths" ] \
     && [ "$(total_capture "$base")" = "0" ]; then
    ok "(p) gemini N1 '$label' command is not capture: state absent, empty footprint, no path"
  else
    bad "(p) gemini N1 '$label' reads as capture: state=$state footprint=$fpn paths=$(tr '\n' ' ' <<< "$paths")"
  fi
  # remove: nothing of the file is capture, so every entry stays as it was.
  cfg="$TMP_ROOT/p/n1-$label-remove/config.json"
  mkdir -p "$(dirname "$cfg")"
  cp "$base" "$cfg"
  usage_capture_remove gemini "$cfg" >/dev/null 2>&1
  if json_eq "$cfg" "$base" \
     && [ "$(jq -r '.hooks.AfterModel[0].hooks[1].command' "$cfg" 2>/dev/null)" = "$c" ]; then
    ok "(p) gemini N1 '$label': remove leaves the operator command byte-unchanged"
  else
    bad "(p) gemini N1 '$label': remove changed it: $(jq -c .hooks "$cfg" 2>/dev/null)"
  fi
  # keep: re-registers crewrig's capture beside it, never rewrites it.
  cfg="$TMP_ROOT/p/n1-$label-keep/config.json"
  mkdir -p "$(dirname "$cfg")"
  cp "$base" "$cfg"
  out="$(usage_capture_keep gemini "$cfg" "$REPO_DIR" 2>&1)"
  if [ "$(noncapture_view "$cfg")" = "$(noncapture_view "$base")" ] \
     && [ "$(jq -r '.hooks.AfterModel[0].hooks[1].command' "$cfg" 2>/dev/null)" = "$c" ] \
     && [[ "$out" != *re-pointed* ]]; then
    ok "(p) gemini N1 '$label': keep leaves the operator command byte-unchanged"
  else
    bad "(p) gemini N1 '$label': keep changed it (out: $out): $(jq -c .hooks "$cfg" 2>/dev/null)"
  fi
  assert_capture_once_at "(p) gemini N1 '$label' keep" gemini "$cfg" "$CAPTURE_ABS"
done <<< "$N1_CASES"

echo "§3 (p') S2: keep never re-points an unexpanded \$…, \${…} or ~ path"
for cli in $CLIS; do
  tag="$(cli_tag "$cli")"
  for form in home brace tilde; do
    cfg="$TMP_ROOT/pp/$cli-$form/config.json"
    init_cfg "$cli" "$cfg"
    for ev in $(cli_events "$cli"); do
      case "$form" in
        home)  c="bash \"\$HOME/tools/hooks/usage-capture.sh\" $tag $ev" ;;
        brace) c="bash \"\${CLAUDE_PROJECT_DIR}/hooks/usage-capture.sh\" $tag $ev" ;;
        tilde) c="bash ~/tools/hooks/usage-capture.sh $tag $ev" ;;
      esac
      add_cmds "$cli" "$cfg" "$ev" "$c"
    done
    cp "$cfg" "$cfg.orig"
    state="$(usage_capture_state "$cli" "$cfg" 2>/dev/null)"
    out="$(usage_capture_keep "$cli" "$cfg" "$REPO_DIR" 2>&1)"
    rc=$?
    if [ "$state" = "installed" ] && [ "$rc" -eq 0 ] && cmp -s "$cfg" "$cfg.orig" \
       && [[ "$out" != *re-pointed* ]] && ! has_backup "$cfg"; then
      ok "(p') $cli the $form-form command reads as capture and keep leaves it byte-unchanged"
    else
      bad "(p') $cli $form form: state=$state rc=$rc, changed=$(cmp -s "$cfg" "$cfg.orig" && echo no || echo yes) (out: $out)"
    fi
  done
done

echo "§3 (p'') S2: the origin/main coupled forms are still recognised"
for cli in $CLIS; do
  cfg="$TMP_ROOT/ppp/$cli/config.json"
  materialize "$cli-coupled.json" "$cfg"
  n="$(usage_capture_footprint "$cli" "$cfg" 2>/dev/null | jq 'length' 2>/dev/null)"
  paths="$(usage_capture_paths "$cli" "$cfg" 2>/dev/null)"
  if [ "$n" = "$(cli_events "$cli" | wc -w | tr -d ' ')" ] && [ "$paths" = "$CAPTURE_ABS" ]; then
    ok "(p'') $cli coupled install: one capture handler per R5 event, registered path $CAPTURE_ABS"
  else
    bad "(p'') $cli coupled install: footprint=$n paths=$(tr '\n' ' ' <<< "$paths")"
  fi
done

echo "§3 (q) S3: a checkout path with a space works end to end"
SP_REPO="$TMP_ROOT/My Projects/crewrig"
mkdir -p "$SP_REPO/scripts/lib"
cp -R "$REPO_DIR/hooks" "$SP_REPO/"
cp -R "$REPO_DIR/scripts/lib/usage-capture" "$REPO_DIR/scripts/lib/usage-store" "$SP_REPO/scripts/lib/"
[ ! -d "$REPO_DIR/node_modules" ] || ln -s "$REPO_DIR/node_modules" "$SP_REPO/node_modules"
SP_ABS="$(cd "$SP_REPO/hooks" && pwd -P)/usage-capture.sh"
for cli in $CLIS; do
  cfg="$TMP_ROOT/q/$cli/config.json"
  rc=0
  usage_capture_enable "$cli" "$cfg" "$SP_REPO" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq 0 ]; then ok "(q) $cli enable from a checkout path with a space succeeds"; else bad "(q) $cli enable rc=$rc"; continue; fi
  assert_capture_once_at "(q)" "$cli" "$cfg" "$SP_ABS"
  paths="$(usage_capture_paths "$cli" "$cfg" 2>/dev/null)"
  if [ "$paths" = "$SP_ABS" ]; then
    ok "(q) $cli usage_capture_paths reports the whole spaced path"
  else
    bad "(q) $cli usage_capture_paths reports '$(tr '\n' '|' <<< "$paths")'"
  fi
  cp "$cfg" "$cfg.enabled"
  usage_capture_keep "$cli" "$cfg" "$SP_REPO" >/dev/null 2>&1
  out="$(usage_capture_keep "$cli" "$cfg" "$SP_REPO" 2>&1)"
  if cmp -s "$cfg" "$cfg.enabled" && [[ "$out" != *re-pointed* ]] && ! has_backup "$cfg"; then
    ok "(q) $cli two keeps leave the spaced command byte-identical (no corruption loop)"
  else
    bad "(q) $cli keep rewrote the spaced command: $(capture_cmds "$cfg" "$(cli_events "$cli" | awk '{print $1}')")"
  fi
  ev="$(cli_events "$cli" | awk '{print $1}')"
  cmd="$(capture_cmds "$cfg" "$ev")"
  case "$cli" in
    claude) payload="{\"transcript_path\":\"$TMP_ROOT/k/session.jsonl\"}" ;;
    *)      payload='{}' ;;
  esac
  root="$TMP_ROOT/q/usage-$cli"
  (cd "$K_CWD" && PATH="$K_PATH" CREWRIG_USAGE_ROOT="$root" /bin/sh -c "$cmd" <<< "$payload") >/dev/null 2>&1
  rc=$?
  n="$(find "$root/journal" -name '*.json' ! -name '*.wing.json' ! -name '*.attr.json' 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$rc" -eq 0 ] && [ "${n:-0}" -ge 1 ]; then
    ok "(q) $cli the registered spaced-path '$ev' command runs and writes $n journal record(s)"
  else
    bad "(q) $cli the registered spaced-path command rc=$rc wrote $n journal record(s)"
  fi
done
# The origin/main Gemini form on a spaced checkout (unquoted, so it never ran)
# is the input of the former keep corruption loop. Contract amendment 1: it is
# recognised whole, and keep only adds the quotes, once.
cfg="$TMP_ROOT/q/gemini-legacy/config.json"
init_cfg gemini "$cfg"
add_cmds gemini "$cfg" AfterModel "$(legacy_cmd gemini AfterModel "$SP_ABS")"
paths="$(usage_capture_paths gemini "$cfg" 2>/dev/null)"
if [ "$(usage_capture_state gemini "$cfg" 2>/dev/null)" = "installed" ] && [ "$paths" = "$SP_ABS" ] \
   && [ "$(capture_count "$cfg" AfterModel)" = "1" ]; then
  ok "(q) gemini legacy unquoted spaced command reads as capture at the whole spaced path"
else
  bad "(q) gemini legacy unquoted spaced command: state=$(usage_capture_state gemini "$cfg" 2>/dev/null) paths='$(tr '\n' '|' <<< "$paths")'"
fi
usage_capture_keep gemini "$cfg" "$SP_REPO" >/dev/null 2>&1
cp "$cfg" "$cfg.once"
usage_capture_keep gemini "$cfg" "$SP_REPO" >/dev/null 2>&1
assert_capture_once_at "(q) legacy spaced form after keep" gemini "$cfg" "$SP_ABS"
if cmp -s "$cfg" "$cfg.once"; then
  ok "(q) gemini a second keep after the re-quote is a byte-identical no-op"
else
  bad "(q) gemini the second keep changed the command again: $(capture_cmds "$cfg" AfterModel)"
fi
# Contract amendment 2: the same legacy shape whose whole spaced path does not
# exist is ambiguous, so it is NOT capture: detection ignores it, and keep and
# remove leave it to the operator.
GONE_SP="$TMP_ROOT/Gone Projects/crewrig/hooks/usage-capture.sh"
c="$(legacy_cmd gemini AfterModel "$GONE_SP")"
cfg="$TMP_ROOT/q/gemini-legacy-gone/config.json"
init_cfg gemini "$cfg"
add_cmds gemini "$cfg" AfterModel "$c"
cp "$cfg" "$cfg.base"
paths="$(usage_capture_paths gemini "$cfg" 2>/dev/null)"
fpn="$(usage_capture_footprint gemini "$cfg" 2>/dev/null | jq 'length' 2>/dev/null)"
if [ ! -e "$GONE_SP" ] && [ "$(usage_capture_state gemini "$cfg" 2>/dev/null)" = "absent" ] \
   && [ "$fpn" = "0" ] && [ -z "$paths" ] && [ "$(total_capture "$cfg")" = "0" ]; then
  ok "(q) gemini legacy spaced command at a path that does not exist is not capture"
else
  bad "(q) gemini legacy spaced command at a missing path: state=$(usage_capture_state gemini "$cfg" 2>/dev/null) footprint=$fpn paths='$(tr '\n' '|' <<< "$paths")'"
fi
usage_capture_remove gemini "$cfg" >/dev/null 2>&1
if json_eq "$cfg" "$cfg.base"; then
  ok "(q) gemini remove leaves the missing-path legacy command as it was"
else
  bad "(q) gemini remove changed the missing-path legacy command: $(jq -c .hooks "$cfg" 2>/dev/null)"
fi
out="$(usage_capture_keep gemini "$cfg" "$SP_REPO" 2>&1)"
if [ "$(jq -r '.hooks.AfterModel[0].hooks[0].command' "$cfg" 2>/dev/null)" = "$c" ] \
   && [ "$(noncapture_view "$cfg")" = "$(noncapture_view "$cfg.base")" ] \
   && [[ "$out" != *re-pointed* ]] && [[ "$out" != *quoted* ]]; then
  ok "(q) gemini keep neither re-points nor re-quotes the missing-path legacy command"
else
  bad "(q) gemini keep touched the missing-path legacy command (out: $out): $(jq -c .hooks "$cfg" 2>/dev/null)"
fi
assert_capture_once_at "(q) gemini keep beside a missing-path legacy command" gemini "$cfg" "$SP_ABS"

echo "§3 (r) S3: usage_capture_abs refuses a path that cannot be double-quoted safely"
r_n=0
for ch in '"' '$' '`' '\' $'\n'; do
  r_n=$((r_n + 1))
  d="$TMP_ROOT/r/bad$r_n-a${ch}b"
  mkdir -p "$d/hooks"
  cp "$REPO_DIR"/hooks/*-usage-capture-hooks.json "$d/hooks/"
  printf '#!/bin/bash\nexit 0\n' > "$d/hooks/usage-capture.sh"
  label="$(printf '%q' "$ch")"
  so="$(usage_capture_abs "$d" 2>"$TMP_ROOT/r/err")"
  rc=$?
  if [ "$rc" -eq 1 ] && [ -z "$so" ] && grep -q 'cannot be wired safely' "$TMP_ROOT/r/err"; then
    ok "(r) usage_capture_abs refuses a checkout path containing $label"
  else
    bad "(r) usage_capture_abs on a path containing $label: rc=$rc stdout='$so' stderr='$(cat "$TMP_ROOT/r/err")'"
  fi
  for cli in $CLIS; do
    cfg="$TMP_ROOT/r/cfg$r_n-$cli/config.json"
    rc=0
    usage_capture_enable "$cli" "$cfg" "$d" >/dev/null 2>&1 || rc=$?
    if [ "$rc" -ne 0 ] && [ ! -e "$cfg" ]; then
      ok "(r) $cli enable from a path containing $label fails and writes nothing"
    else
      bad "(r) $cli enable from a path containing $label: rc=$rc, config written=$([ -e "$cfg" ] && echo yes || echo no)"
    fi
  done
done
# The check covers the resolved path, not only the argument.
ln -s "$TMP_ROOT/r/bad2-a\$b" "$TMP_ROOT/r/clean-link"
so="$(usage_capture_abs "$TMP_ROOT/r/clean-link" 2>/dev/null)"
rc=$?
if [ "$rc" -eq 1 ] && [ -z "$so" ]; then
  ok "(r) usage_capture_abs refuses a clean argument whose physical path contains \$"
else
  bad "(r) usage_capture_abs via a symlink to a \$ path: rc=$rc stdout='$so'"
fi
d="$TMP_ROOT/r/it's (a&b)"
mkdir -p "$d/hooks"
printf '#!/bin/bash\nexit 0\n' > "$d/hooks/usage-capture.sh"
so="$(usage_capture_abs "$d" 2>/dev/null)"
if [ "$so" = "$(cd "$d/hooks" && pwd -P)/usage-capture.sh" ]; then
  ok "(r) usage_capture_abs accepts a path with a quote, parentheses and an ampersand"
else
  bad "(r) usage_capture_abs on \"$d\" printed '$so'"
fi

echo "§3 (s) i1-F6: keep on a duplicated event keeps the live command"
S_OTHER="$TMP_ROOT/s/other-checkout/hooks/usage-capture.sh"
S_GONE="$TMP_ROOT/s/gone-checkout/hooks/usage-capture.sh"
mkdir -p "$(dirname "$S_OTHER")"
printf '#!/bin/bash\nexit 0\n' > "$S_OTHER"
for cli in $CLIS; do
  cfg="$TMP_ROOT/s/$cli/config.json"
  init_cfg "$cli" "$cfg"
  first_ev="$(cli_events "$cli" | awk '{print $1}')"
  for ev in $(cli_events "$cli"); do
    if [ "$ev" = "$first_ev" ]; then
      add_cmds "$cli" "$cfg" "$ev" "$(expected_cmd "$cli" "$ev" "$S_GONE")"
    fi
    add_cmds "$cli" "$cfg" "$ev" "$(expected_cmd "$cli" "$ev" "$S_OTHER")"
  done
  out="$(usage_capture_keep "$cli" "$cfg" "$REPO_DIR" 2>&1)"
  rc=$?
  assert_capture_once_at "(s) after keep" "$cli" "$cfg" "$S_OTHER"
  paths="$(usage_capture_paths "$cli" "$cfg" 2>/dev/null)"
  if [ "$rc" -eq 0 ] && [ "$paths" = "$S_OTHER" ] && [[ "$out" != *re-pointed* ]]; then
    ok "(s) $cli one checkout remains registered, and nothing was reported re-pointed"
  else
    bad "(s) $cli rc=$rc, registered paths '$(tr '\n' ' ' <<< "$paths")' (out: $out)"
  fi
  if [ "$cli" = "copilot" ] || [ "$(empty_groups "$cfg")" = "0" ]; then
    ok "(s) $cli no matcher group was left empty by the dedup"
  else
    bad "(s) $cli $(empty_groups "$cfg") empty matcher group(s) remain"
  fi
done

echo "§3 (t) a failed write leaves no temp file in the config directory"
for cli in $CLIS; do
  first_ev="$(cli_events "$cli" | awk '{print $1}')"
  good="$TMP_ROOT/t/$cli-good.json"
  mkdir -p "$TMP_ROOT/t"
  materialize "$cli-coupled.json" "$good"
  fp="$(usage_capture_footprint "$cli" "$good" 2>/dev/null)"
  for writer in enable reinject; do
    dir="$TMP_ROOT/t/$cli-$writer"
    cfg="$dir/config.json"
    mkdir -p "$dir"
    # A JSON object the pre-checks accept but the write program rejects
    # (uc_add: "hooks is not an object" / "hook event is not an array").
    case "$writer" in
      enable)   printf '{"hooks":"x"}\n' > "$cfg" ;;
      reinject) jq -n --arg ev "$first_ev" '{hooks: {($ev): "x"}}' > "$cfg" ;;
    esac
    cp "$cfg" "$TMP_ROOT/t/$cli-$writer.orig"
    rc=0
    case "$writer" in
      enable)   usage_capture_enable "$cli" "$cfg" "$REPO_DIR" >/dev/null 2>&1 || rc=$? ;;
      reinject) usage_capture_reinject "$cli" "$cfg" "$fp" >/dev/null 2>&1 || rc=$? ;;
    esac
    strays="$(compgen -G "$dir/*.tmp*" | tr '\n' ' ')"
    if [ "$rc" -ne 0 ] && cmp -s "$cfg" "$TMP_ROOT/t/$cli-$writer.orig" && [ -z "$strays" ]; then
      ok "(t) $cli $writer: the failed write returns $rc, leaves the file byte-identical and no temp file"
    else
      bad "(t) $cli $writer: rc=$rc, identical=$(cmp -s "$cfg" "$TMP_ROOT/t/$cli-$writer.orig" && echo yes || echo no), strays='$strays'"
    fi
  done
  # enable reached the write (its backup was taken) before failing.
  if has_backup "$TMP_ROOT/t/$cli-enable/config.json"; then
    ok "(t) $cli enable failed at the write step, after its pre-checks and backup"
  else
    bad "(t) $cli enable failed before the write step: the case does not exercise the temp file"
  fi
done

echo "§3 (u) a symlinked config: a regular 0600 file is written, the link target is untouched"
for cli in $CLIS; do
  target="$TMP_ROOT/u/$cli-dotfiles/config.json"
  materialize "$cli-operator-stripped.json" "$target"
  chmod 644 "$target"
  cp "$target" "$target.orig"
  cfg="$TMP_ROOT/u/$cli/config.json"
  mkdir -p "$(dirname "$cfg")"
  ln -s "$target" "$cfg"
  # An older backup that is itself a link: narrowing must not follow it.
  ext="$TMP_ROOT/u/$cli-dotfiles/unrelated.json"
  printf '{}\n' > "$ext"
  chmod 644 "$ext"
  ln -s "$ext" "$cfg.bak.$OLD_STAMP"
  rc=0
  usage_capture_enable "$cli" "$cfg" "$REPO_DIR" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq 0 ] && [ -f "$cfg" ] && [ ! -L "$cfg" ] && [ "$(file_mode "$cfg")" = "600" ] \
     && [ "$(usage_capture_state "$cli" "$cfg" 2>/dev/null)" = "installed" ]; then
    ok "(u) $cli the link is replaced by a regular 0600 file holding capture"
  else
    bad "(u) $cli rc=$rc, link=$([ -L "$cfg" ] && echo yes || echo no), mode=$(file_mode "$cfg")"
  fi
  if cmp -s "$target" "$target.orig" && [ "$(file_mode "$target")" = "644" ]; then
    ok "(u) $cli the link target is byte-identical and keeps its 0644 mode"
  else
    bad "(u) $cli the link target was written or re-moded ($(file_mode "$target"))"
  fi
  new="$(compgen -G "$cfg.bak.*" | grep -v "\.bak\.$OLD_STAMP$" | head -1)"
  if [ -n "$new" ] && [ -L "$new" ] && [ "$(readlink "$new")" = "$target" ] && [ "$(file_mode "$ext")" = "644" ]; then
    ok "(u) $cli the backup is the link itself, and no backup narrowing followed a link"
  else
    bad "(u) $cli backup '${new##*/}' link=$([ -n "$new" ] && [ -L "$new" ] && echo yes || echo no), unrelated link target mode=$(file_mode "$ext")"
  fi
done

# ---------------------------------------------------------------------------
# §4. Structural assertions on the three setups (R1, R4, R10, R15).
# ---------------------------------------------------------------------------
echo "§4 setup structure (R1, R4, R10, R15)"

# joined <file> — "<last line no>:<logical line>", backslash continuations
# joined, so a guard on a continuation line still counts.
joined() {
  awk '{ if (sub(/\\$/, "")) { buf = buf $0; next } print NR ":" buf $0; buf = "" }' "$1"
}
first_line_no() { grep -nE "$2" "$1" | head -1 | cut -d: -f1; }

for cli in $CLIS; do
  S="$(setup_script "$cli")"
  name="setup-$cli-interactive.sh"
  tstart="$(first_line_no "$S" '^ENABLE_TRANSCRIPTS=')"
  tend="$(awk -v s="${tstart:-0}" 'NR > s && /^fi([[:space:];#]|$)/ {print NR; exit}' "$S")"
  if [ -z "$tstart" ] || [ -z "$tend" ]; then
    bad "$name: session-recording block not found"
    continue
  fi

  if grep -qE 'source[^#]*scripts/lib/usage-capture-optin\.sh' "$S"; then
    ok "$name sources scripts/lib/usage-capture-optin.sh"
  else
    bad "$name does not source scripts/lib/usage-capture-optin.sh"
  fi

  enable_ln="$(grep -nE 'fzf' "$S" | grep -E "(printf|echo -e|echo)[[:space:]]+['\"]no\\\\nyes" | awk -F: -v e="$tend" '$1 > e {print $1; exit}')"
  keep_ln="$(grep -nE 'fzf' "$S" | grep -E "(printf|echo -e|echo)[[:space:]]+['\"]keep\\\\nremove" | awk -F: -v e="$tend" '$1 > e {print $1; exit}')"
  state_ln="$(grep -nE 'usage_capture_state' "$S" | grep -vE '^[0-9]+:[[:space:]]*#' | head -1 | cut -d: -f1)"
  apply_lns="$(grep -nE 'usage_capture_apply' "$S" | grep -vE '^[0-9]+:[[:space:]]*#' | cut -d: -f1)"
  last_apply="$(printf '%s\n' $apply_lns | tail -1)"

  # R1: the question sits after the session-recording block, outside it.
  if [ -n "$enable_ln" ] && [ -n "$keep_ln" ] && [ -n "$state_ln" ] && [ "$state_ln" -gt "$tend" ]; then
    ok "$name: the enable prompt (input starts 'no', l. $enable_ln) and the keep prompt (input starts 'keep', l. $keep_ln) come after the session-recording block's closing fi (l. $tend)"
  else
    bad "$name: capture prompts not found after l. $tend (enable=$enable_ln keep=$keep_ln state=$state_ln)"
    continue
  fi
  open_ifs="$(sed -n "$((tend + 1)),$((state_ln - 1))p" "$S" | grep -vE '^[[:space:]]*#' | grep -cE '^[[:space:]]*if[[:space:]]')"
  closed_ifs="$(sed -n "$((tend + 1)),$((state_ln - 1))p" "$S" | grep -vE '^[[:space:]]*#' | grep -cE '^[[:space:]]*fi([[:space:];#]|$)')"
  if [ "$open_ifs" = "$closed_ifs" ]; then
    ok "$name: the capture block starts at top level (no enclosing if)"
  else
    bad "$name: the capture block is nested in an if opened between l. $tend and l. $state_ln"
  fi
  if sed -n "$((tend + 1)),${last_apply:-$state_ln}p" "$S" | grep -q 'MEMPALACE_INSTALLED'; then
    bad "$name: the capture block is gated on MEMPALACE_INSTALLED (R3)"
  else
    ok "$name: the capture block is not gated on MEMPALACE_INSTALLED (R3)"
  fi

  # Cancel (Esc -> fzf 130) must not abort setup under set -e.
  for ln in "$enable_ln" "$keep_ln"; do
    if sed -n "${ln}p" "$S" | grep -q '|| true'; then
      ok "$name: the capture prompt at l. $ln carries || true"
    else
      bad "$name: the capture prompt at l. $ln lacks || true"
    fi
  done
  if [ "$cli" = "copilot" ]; then confirm_var="CONFIRM"; else confirm_var="CONFIRM_TRANSCRIPTS"; fi
  for var in ENABLE_TRANSCRIPTS "$confirm_var"; do
    line="$(grep -E "^[[:space:]]*$var=.*fzf" "$S" | head -1)"
    if [ -n "$line" ] && grep -q '|| true' <<< "$line"; then
      ok "$name: the session-recording prompt $var carries || true"
    else
      bad "$name: the session-recording prompt $var lacks || true (got: $line)"
    fi
  done

  # The raw answer reaches usage_capture_apply.
  for ln in "$enable_ln" "$keep_ln"; do
    var="$(sed -n "${ln}p" "$S" | sed -nE 's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=.*/\1/p')"
    reached=""
    for aln in $apply_lns; do
      if [ "$aln" -gt "$ln" ] && sed -n "${aln}p" "$S" | grep -qE "\"\\\$\\{?$var\\}?\""; then reached=1; fi
    done
    if [ -n "$var" ] && [ -n "$reached" ]; then
      ok "$name: the answer \$$var (l. $ln) reaches usage_capture_apply"
    else
      bad "$name: the answer at l. $ln ('$var') does not reach usage_capture_apply"
    fi
  done

  # No unguarded library call under set -e.
  calls="$(joined "$S" | grep -E '(usage_capture_[a-z_]+|merge_session_recording_hooks)' \
                        | grep -vE '^[0-9]+:[[:space:]]*#')"
  unguarded="$(grep -vE '\|\||^[0-9]+:[[:space:]]*(if|elif)[[:space:]]' <<< "$calls")"
  n_calls="$(grep -c . <<< "$calls")"
  if [ -n "$calls" ] && [ -z "$unguarded" ]; then
    ok "$name: all $n_calls library call site(s) are guarded (||, or an if condition)"
  else
    bad "$name: unguarded library call(s): $(tr '\n' ' ' <<< "$unguarded")"
  fi
  if grep -qE 'merge_session_recording_hooks[[:space:]]+'"$cli" <<< "$calls"; then
    ok "$name: session recording writes through merge_session_recording_hooks $cli"
  else
    bad "$name: no merge_session_recording_hooks $cli call"
  fi

  # Never-copied invariant (moved from the transcript suites, v1-F6).
  if grep -qE 'install_file[^#]*usage-capture\.sh' "$S"; then
    bad "$name install_file's usage-capture.sh — it must be wired by in-repo absolute path"
  else
    ok "$name never install_file's usage-capture.sh"
  fi
done

for d in "$HOME/.claude/hooks" "$HOME/.gemini/hooks" "$HOME/.copilot/hooks"; do
  if [ -f "$d/usage-capture.sh" ]; then
    bad "usage-capture.sh was copied into the sandboxed ${d#"$HOME"/}"
  else
    ok "no usage-capture.sh under the sandboxed ${d#"$HOME"/} after §3 (a)"
  fi
done

# Gemini: footprint before the template write, reinject after the org-MCP fold.
S="$(setup_script gemini)"
fp_ln="$(grep -nE 'usage_capture_footprint[[:space:]]+gemini' "$S" | grep -vE '^[0-9]+:[[:space:]]*#' | head -1 | cut -d: -f1)"
bak_ln="$(grep -nE '^backup_file "\$SETTINGS_TARGET"' "$S" | head -1 | cut -d: -f1)"
tpl_ln="$(grep -nE '"\$SETTINGS_SRC"' "$S" | grep -vE 'SETTINGS_SRC=' | head -1 | cut -d: -f1)"
fold_ln="$(grep -nE 'apply_org_mcp_servers' "$S" | grep -vE '^[0-9]+:[[:space:]]*#' | head -1 | cut -d: -f1)"
ri_ln="$(grep -nE 'usage_capture_reinject[[:space:]]+gemini' "$S" | grep -vE '^[0-9]+:[[:space:]]*#' | head -1 | cut -d: -f1)"
if [ -n "$fp_ln" ] && [ -n "$bak_ln" ] && [ -n "$tpl_ln" ] && [ "$fp_ln" -gt "$bak_ln" ] && [ "$fp_ln" -lt "$tpl_ln" ]; then
  ok "setup-gemini: the capture footprint is taken after the backup (l. $bak_ln) and before the template write (l. $tpl_ln)"
else
  bad "setup-gemini: footprint l. $fp_ln not between backup l. $bak_ln and template write l. $tpl_ln"
fi
if [ -n "$fp_ln" ] && joined "$S" | grep -E "^[0-9]+:.*usage_capture_footprint[[:space:]]+gemini" | grep -q "'\[\]'"; then
  ok "setup-gemini: the footprint falls back to '[]' on an unparsable file"
else
  bad "setup-gemini: the footprint line carries no '[]' fallback"
fi
if [ -n "$ri_ln" ] && [ -n "$fold_ln" ] && [ "$ri_ln" -gt "$fold_ln" ]; then
  ok "setup-gemini: the capture reinject (l. $ri_ln) follows the org-MCP fold (l. $fold_ln)"
else
  bad "setup-gemini: reinject l. $ri_ln does not follow the org-MCP fold l. $fold_ln"
fi

# ---------------------------------------------------------------------------
# §5. R14: Antigravity is untouched.
# ---------------------------------------------------------------------------
echo "§5 Antigravity CLI unchanged (R14)"
for f in "$REPO_DIR/scripts/setup-antigravity-interactive.sh" "$REPO_DIR"/hooks/antigravity-*; do
  if grep -qE 'usage-capture-optin|usage-capture-hooks\.json|usage_capture_(enable|keep|remove|apply|state)|merge_session_recording_hooks' "$f"; then
    bad "${f#"$REPO_DIR"/} references the new opt-in library or fragments"
  else
    ok "${f#"$REPO_DIR"/} references neither the new library nor the fragments"
  fi
done

# ---------------------------------------------------------------------------
echo ""
echo "PASS: $pass  FAIL: $fail"
[ "$fail" -eq 0 ]
