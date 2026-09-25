#!/usr/bin/env bash
# scripts/lib/gemini-settings.sh — the in-place merge of ~/.gemini/settings.json
# (spec 0214). Sourced by setup-gemini-interactive.sh AFTER scripts/lib/common.sh
# (it uses backup_file, MCP_RESERVED_NAMES, merge_preexisting_mcp_servers,
# apply_org_mcp_servers and write_json_config_secure). Do NOT execute directly.
#
# The setup no longer rebuilds the file from config/gemini/settings.json. It
# reads the existing file once, the way Gemini CLI reads it
# (`JSON.parse(stripJsonComments(...))`), and merges it with the template:
#   - framework-owned (R1): the `context.fileName` list — the ordered union of
#     the template's list and the operator's (R6, R7) — and the reserved MCP
#     entries of spec 0089 R1, rebuilt whole from the template on every run, so
#     the spec 0084 TLS wrapper is applied exactly once (R8, R9);
#   - every other template key is a seed (R2): written only when absent and
#     every ancestor is absent or an object; an operator value always wins;
#   - everything else — hooks included — is operator content, kept as it is
#     (R3, R16).
# The merged snapshot is renamed over the target at 0600 before anything else
# reads it, so every later reader (the 0089 / 0091 folds, ensure_mempalace_http,
# merge_session_recording_hooks, the usage_capture_* readers) sees plain JSON.
#
# Contracts shared by every function below:
#   - Failure contract. A function returns non-zero on failure and never calls
#     `exit`. The setup calls gemini_settings_write from a `||` context, where
#     bash suspends errexit INSIDE the function too, so each fallible command is
#     checked explicitly.
#   - jq only. The setup requires jq and nothing else for this path.
#   - No secret on argv. The existing file can hold the MemPalace bearer token
#     (register_mempalace_mcp), so its content only ever reaches jq as input or
#     through --slurpfile; the reserved values are redacted to `{}` before the
#     MCP server map is handed to the 0089 / 0091 helpers as --argjson.
#   - Owner-only. gemini_settings_write runs under umask 077 and ends with the
#     target at 0600 (R13).
#
# All JSON work happens in jq, through the one definitions string below.

# --- jq definitions -----------------------------------------------------------
# shellcheck disable=SC2016  # jq program text, not shell expansions
_GS_JQ_DEFS='
# JSONC comment removal, the strip-json-comments semantics Gemini CLI uses.
# One left-to-right scan: a string literal is matched whole and put back
# unchanged, so `//`, `/*` and an escaped quote inside a string are never read
# as a comment; a line comment runs to the end of its line; a block comment
# runs to its `*/`, or to the end of the text when it is never closed. Each
# comment becomes ONE SPACE, never the empty string, so the tokens on either
# side are not joined (`1/**/2` stays two tokens and is rejected, as
# JSON.parse rejects it). A string never closed runs to the end of the text,
# as it does in strip-json-comments, where nothing after it is a comment. No
# alternative can match the empty string, and every loop is possessive, with
# alternatives that start on distinct characters: no match ever backtracks
# (an adversarial run of escaped quotes took seconds with a backtracking loop).
def gs_strip_jsonc:
  gsub("(?<s>\"(?:[^\"\\\\]|\\\\[\\s\\S])*+(?:\"|\\z))|//[^\n]*+|/\\*(?:[^*]|\\*++[^*/])*+(?:\\*++/|\\**+\\z)";
       if .s then .s else " " end);

# JSON.parse grammar check of text that jq already parsed. jq accepts literals
# JSON.parse rejects (`01`, `+1`, `.5`, `1.`, `Infinity`, `NaN`, `nan`), and
# would silently change their values, so a text passes only when it is, token
# for token, strict JSON: string literals, structural characters, JSON
# whitespace, `true` / `false` / `null`, and numbers of the JSON grammar
# `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?` ending at a token boundary.
# One anchored `test`, every alternative starting on a distinct character and
# every loop possessive, so the match is linear and never backtracks.
def gs_strict_json:
  test("\\A(?:\"(?:[^\"\\\\]|\\\\.)*+\"|[\\[\\]{}:, \\t\\n\\r]"
       + "|(?:true|false|null)(?![0-9A-Za-z_$])"
       + "|-?(?:0|[1-9][0-9]*+)(?:\\.[0-9]++)?(?:[eE][+-]?[0-9]++)?(?![0-9A-Za-z_$.+-]))*+\\z");

# Classify the raw bytes of an existing file. Output: one line
# "<state> <had_comments>", then the snapshot document on one line.
#   object  — a JSON object once comments are removed;
#   empty   — nothing but JSON whitespace once comments are removed (R11);
#   invalid — anything else (R12 repair).
# Plain JSON is tried first: text that parses as JSON has no comment outside a
# string, and the regex scan is only paid for a file that needs it. A leading
# UTF-8 byte-order mark is invalid, because JSON.parse rejects it (Gemini CLI
# reads the file as utf-8 and does not strip it), although jq would accept it.
def gs_classify:
  . as $raw
  | if startswith("﻿") then {state: "invalid", comments: false, doc: {}}
    else
      ((try fromjson catch null) as $fast
       | if ($fast | type) == "object" then
           (if gs_strict_json then {state: "object", comments: false, doc: $fast}
            else {state: "invalid", comments: false, doc: {}} end)
         else
           (gs_strip_jsonc) as $s
           | ($s != $raw) as $c
           | if ($s | test("\\A[ \\t\\n\\r]*\\z")) then {state: "empty", comments: $c, doc: {}}
             else
               ((try ($s | fromjson) catch null) as $o
                | if ($o | type) == "object" and ($s | gs_strict_json)
                  then {state: "object", comments: $c, doc: $o}
                  else {state: "invalid", comments: $c, doc: {}} end)
             end
         end)
    end
  | (.state + " " + (.comments | tostring)), (.doc | tojson);

def gs_is_str_list: type == "array" and all(.[]; type == "string");

# Ordered, de-duplicated union: every entry of $a in order, then every entry
# of $b not seen yet, in order (R6).
def gs_union($a; $b):
  reduce ($a + $b)[] as $x ([]; if any(.[]; . == $x) then . else . + [$x] end);

# The framework-owned values a run would replace, as key names (R7). Input: the
# snapshot. `mcpServers` is always written beneath: the template always carries
# the reserved `sequentialthinking` entry, and the 0089 / 0091 folds assume an
# object.
def gs_replaced_keys:
  (if has("context") and (.context | type) != "object" then "context" else empty end),
  (if (.context | type) == "object" and (.context | has("fileName"))
      and (.context.fileName | type) != "string" and (.context.fileName | gs_is_str_list | not)
   then "context.fileName" else empty end),
  (if has("mcpServers") and (.mcpServers | type) != "object" then "mcpServers" else empty end);

# The merge. Input: the snapshot. $t: the template; $fw: the reserved entries
# of this run (gemini_framework_mcp); $res: the reserved names.
# `$seeds * .` is jq recursive object merge: the right side (the operator) wins
# on anything that is not an object on both sides, which is R2, including the
# non-object-ancestor rule. Presence is tested with `*` and `type`, never with
# `//`, which would read an operator `false` or `null` as absent.
def gs_merge($t; $fw; $res):
  ($t | del(.context.fileName) | .mcpServers |= reduce $res[] as $r (.; del(.[$r]))) as $seeds
  | (if (.context | type) == "object" then .context.fileName else null end) as $cur
  | ($seeds * .)
  | .context = (if (.context | type) == "object" then .context else {} end)
  | .context.fileName = gs_union($t.context.fileName;
      if ($cur | type) == "string" then [$cur] elif ($cur | gs_is_str_list) then $cur else [] end)
  | .mcpServers = ((if (.mcpServers | type) == "object" then .mcpServers else {} end)
                   | reduce $res[] as $r (.; del(.[$r]))) + $fw;

# The snapshot MCP server map handed to the 0089 / 0091 helpers: an object,
# with every reserved value redacted to `{}`. The helpers read reserved names
# only through has() and delete them from the preserved side, so their results
# and warnings are unchanged, and the bearer token never reaches their argv.
def gs_pre_mcp($res):
  if (.mcpServers | type) == "object"
  then .mcpServers | with_entries(.key as $k | if any($res[]; . == $k) then .value = {} else . end)
  else {} end;
'

# _gs_reserved_json — the reserved names (spec 0089 R1) as a compact JSON array.
_gs_reserved_json() {
  jq -cn '$ARGS.positional' --args ${MCP_RESERVED_NAMES[@]+"${MCP_RESERVED_NAMES[@]}"}
}

# gemini_settings_normalise <target> <snapshot> <backup_ref>
#
# Reads <target> the way Gemini CLI does and writes the plain-JSON object to
# merge into <snapshot>: the file's object, or `{}` when it is absent, empty
# once comments are removed, or not a JSON object (R11, R12). Prints the R12
# warnings on stdout, each naming <backup_ref>:
#   - the comment warning, for a file holding comments that is an object or
#     empty once they are removed;
#   - the not-a-JSON-object warning, for a file that is neither.
# An absent file (a dangling symlink included, which Gemini CLI also reads as
# absent) and a file holding only whitespace print nothing.
# Returns 1 when <target> cannot be read or <snapshot> cannot be written.
gemini_settings_normalise() {
  local target="$1" snapshot="$2" backup_ref="$3" out head state comments
  if [ ! -e "$target" ]; then
    printf '{}\n' > "$snapshot" || return 1
    return 0
  fi
  out="$(mktemp "${snapshot}.cls.XXXXXX")" || return 1
  chmod 600 "$out" || { rm -f "$out"; return 1; }
  if ! jq -Rrs "$_GS_JQ_DEFS gs_classify" "$target" > "$out" 2>/dev/null; then
    rm -f "$out"
    return 1
  fi
  IFS= read -r head < "$out" || { rm -f "$out"; return 1; }
  state="${head%% *}"
  comments="${head#* }"
  if ! sed 1d "$out" > "$snapshot"; then
    rm -f "$out"
    return 1
  fi
  rm -f "$out"
  case "$state" in
    object|empty)
      if [ "$comments" = "true" ]; then
        echo "  WARNING: $target holds comments; they are not kept in the rewritten file."
        echo "           They are preserved in the timestamped backup: ${backup_ref:-(none)}"
      fi
      ;;
    invalid)
      echo "  WARNING: $target is not a JSON object, even with its comments removed; it was replaced by a fresh configuration."
      echo "           The prior content is preserved in the timestamped backup: ${backup_ref:-(none)}"
      ;;
    *) return 1 ;;
  esac
  return 0
}

# gemini_framework_mcp <template> <repo_dir> <python|"">
#
# Prints (compact JSON) the reserved MCP entries of this run, built from the
# template's `.mcpServers` — the entries today's template write produced:
#   - with a MemPalace interpreter, `mempalace` runs `bash <tls-exec> <python>`
#     plus the template args, with __CREWRIG_REPO_DIR__ replaced by <repo_dir>;
#     without one, `mempalace` is absent (spec 0089 R8);
#   - `sequentialthinking` is routed through tls-exec.sh (spec 0084 R2/R9).
# These entries hold no secret, so passing them on as --argjson is safe.
gemini_framework_mcp() {
  local template="$1" repo_dir="$2" py="$3"
  local tlsexec="$repo_dir/scripts/lib/tls-exec.sh"
  local mempalace_prog
  if [ -n "$py" ]; then
    mempalace_prog='.mcpServers.mempalace.command = "bash"
     | .mcpServers.mempalace.args = ([$tlsexec, $py]
         + (.mcpServers.mempalace.args | map(gsub("__CREWRIG_REPO_DIR__"; $repo))))'
  else
    mempalace_prog='del(.mcpServers.mempalace)'
  fi
  jq -c --arg tlsexec "$tlsexec" --arg py "$py" --arg repo "$repo_dir" "
    $mempalace_prog
    | if .mcpServers.sequentialthinking then
        .mcpServers.sequentialthinking.args = ([\$tlsexec, .mcpServers.sequentialthinking.command]
          + .mcpServers.sequentialthinking.args)
        | .mcpServers.sequentialthinking.command = \"bash\"
      else . end
    | .mcpServers // {}" "$template"
}

# gemini_settings_write <target> <template> <repo_dir> <python|""> <org_native_json|"">
#
# The whole settings write of the Gemini setup: backup, normalise, merge, then
# the spec 0089 and 0091 folds. The setup and the hermetic suite call this ONE
# function, so the suite never transcribes the sequence.
#   <python>          the MemPalace interpreter, or "" when MemPalace is absent.
#   <org_native_json> the org servers in Gemini's native shape
#                     (org_mcp_to_native gemini), or "" when there is no
#                     org manifest.
# Prints the backup line, the R12 / R7 warnings and the 0089 / 0091 warnings on
# stdout, and its own ERROR line on stderr, naming the backup.
# Returns:
#   0 — merged, folds applied, target 0600;
#   1 — nothing written: the target is byte-identical (backup missing, file
#       unreadable, or the merge failed);
#   2 — the target holds the merged document, but the MCP folds or the final
#       chmod did not complete.
# Runs in a subshell under umask 077, so the snapshot and the helpers'
# temporary files are owner-only; LAST_BACKUP_PATH does not reach the caller.
gemini_settings_write() (
  umask 077
  target="$1" template="$2" repo_dir="$3" py="$4" org_native="$5"
  bak="" snap="" reserved="" pre="" fw="" key="" what=""

  _gs_fail1() {
    [ -z "$snap" ] || rm -f "$snap"
    echo "  ERROR: $1; $target was left unchanged." >&2
    [ -z "$bak" ] || echo "         The prior file is preserved in the timestamped backup: $bak" >&2
    return 1
  }
  _gs_fail2() {
    # Best effort first: the target holds the merged settings, operator MCP
    # secrets included, whatever mode a failed fold's rename gave it.
    chmod 600 "$target" 2>/dev/null
    # A failed 0089 / 0091 fold leaves its "${config}.tmp" behind.
    rm -f "${target}.tmp"
    echo "  ERROR: $target holds the merged settings, but $1 did not complete." >&2
    [ -z "$bak" ] || echo "         The prior file is preserved in the timestamped backup: $bak" >&2
    return 2
  }

  # Temporary files: the snapshot "${target}.tmp.XXXXXX", and the files made
  # next to it ("${snap}.cls.XXXXXX" by gemini_settings_normalise,
  # "${snap}.tmp.XXXXXX" by write_json_config_secure). Any of them can hold the
  # bearer token, so an interrupted run removes them. `snap` is emptied right
  # after the rename, so the cleanup never touches the renamed target.
  _gs_cleanup() {
    [ -z "$snap" ] || rm -f "$snap" "$snap".*
  }
  trap '_gs_cleanup' EXIT
  trap '_gs_cleanup; exit 129' HUP
  trap '_gs_cleanup; exit 130' INT
  trap '_gs_cleanup; exit 143' TERM

  mkdir -p "$(dirname "$target")" || { _gs_fail1 "cannot create $(dirname "$target")"; return 1; }

  # R13: the backup exists before the first change, or nothing changes.
  if [ -e "$target" ] || [ -L "$target" ]; then
    backup_file "$target"
    bak="$LAST_BACKUP_PATH"
    [ -n "$bak" ] || { _gs_fail1 "the backup could not be created"; return 1; }
  fi

  reserved="$(_gs_reserved_json)" || { _gs_fail1 "the reserved MCP names could not be read"; return 1; }

  # The snapshot lives next to the target, so the final rename is atomic.
  snap="$(mktemp "${target}.tmp.XXXXXX")" || { snap=""; _gs_fail1 "no temporary file could be created"; return 1; }
  chmod 600 "$snap" || { _gs_fail1 "the temporary file could not be restricted to 0600"; return 1; }

  gemini_settings_normalise "$target" "$snap" "$bak" || { _gs_fail1 "the existing file could not be read"; return 1; }

  pre="$(jq -c --argjson res "$reserved" "$_GS_JQ_DEFS gs_pre_mcp(\$res)" "$snap" 2>/dev/null)" \
    || { _gs_fail1 "the existing MCP servers could not be read"; return 1; }
  fw="$(gemini_framework_mcp "$template" "$repo_dir" "$py" 2>/dev/null)" \
    || { _gs_fail1 "the framework MCP entries could not be built from $template"; return 1; }

  # R7: one warning per framework-owned value the merge replaces.
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    case "$key" in
      context.fileName) what="a string or a list of strings" ;;
      *)                what="an object" ;;
    esac
    echo "  WARNING: '$key' in $target is not $what; it was replaced by the framework's value."
    echo "           The prior value is preserved in the timestamped backup: ${bak:-(none)}"
  done <<EOF
$(jq -r "$_GS_JQ_DEFS gs_replaced_keys" "$snap" 2>/dev/null)
EOF

  write_json_config_secure "$snap" --slurpfile t "$template" --argjson fw "$fw" --argjson res "$reserved" \
    "$_GS_JQ_DEFS gs_merge(\$t[0]; \$fw; \$res)" \
    || { _gs_fail1 "the settings merge failed"; return 1; }
  mv -f "$snap" "$target" || { _gs_fail1 "the merged file could not be moved into place"; return 1; }
  snap=""
  chmod 600 "$target" || { _gs_fail2 "restricting it to 0600"; return 2; }

  # The 0089 / 0091 helpers write through the predictable "${target}.tmp" with
  # `>` then `mv`: a stale one an older setup left behind would be truncated in
  # place, keep its old mode (0644), and hand that mode to the target. Removed
  # here, it is created fresh, owner-only, under this subshell's umask 077.
  rm -f "${target}.tmp" || { _gs_fail2 "removing the stale ${target}.tmp"; return 2; }

  # Spec 0089: its R9 warnings for every reserved name the file held. The fold
  # itself is a content no-op here: every non-reserved server is already kept.
  merge_preexisting_mcp_servers "$pre" "$target" "$bak" \
    || { _gs_fail2 "the operator MCP server fold (spec 0089)"; return 2; }

  # Spec 0091: AFTER the 0089 fold, so framework-reserved > org > operator.
  if [ -n "$org_native" ]; then
    apply_org_mcp_servers "$org_native" "$target" "$pre" "$bak" \
      || { _gs_fail2 "the org MCP server fold (spec 0091)"; return 2; }
  fi

  # Belt and braces after the helpers' own renames.
  chmod 600 "$target" || { _gs_fail2 "restricting it to 0600"; return 2; }
  return 0
)
