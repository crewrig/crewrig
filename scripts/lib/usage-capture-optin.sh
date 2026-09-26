#!/usr/bin/env bash
# scripts/lib/usage-capture-optin.sh — the usage-capture opt-in of Claude Code,
# Gemini CLI and Copilot CLI (spec 0211), decoupled from the MemPalace
# session-recording opt-in. Sourced by setup-{claude,gemini,copilot}-interactive.sh
# AFTER scripts/lib/common.sh (it uses backup_file, warn_if_linked_worktree and
# write_json_config_secure). Do NOT execute directly.
#
# This file owns every read and every write of a capture entry in a CLI's hook
# configuration: detection, enable, keep, remove, and the preservation step the
# session-recording writer runs (merge_session_recording_hooks). Ownership is
# decided by CONTENT, never by position: a capture entry is a command that
# invokes a script path ending in `/hooks/usage-capture.sh` with the argv
# `<cli-id> <Event>` crewrig writes, wherever that path points (R10). The
# signature is positive (see uc_sig_re) so an operator's own hook that merely
# names a script called usage-capture.sh is never removed, kept, deduplicated
# or re-pointed (#1174, security review S2).
#
# <cli> is one of `claude`, `gemini`, `copilot`:
#   - claude / gemini are GROUPED: .hooks[<Event>][] = {<selector keys>, hooks:[handler…]}
#   - copilot is FLAT:             .hooks[<Event>][] = handler
#
# Contracts shared by every helper:
#   - Failure contract. A helper returns non-zero on failure and never calls
#     `exit`. The setups call these helpers from `||` / `if !` contexts, where
#     bash suspends errexit INSIDE the function too — so each fallible command
#     below is checked explicitly instead of trusting `set -e`.
#   - Mode-safe writes. Every write goes through write_json_config_secure
#     (umask-077 mktemp, forced 0600, mv only after a successful jq), so a
#     failed write leaves the file byte-identical and no write can widen a file
#     that holds the MemPalace bearer token. A file this library writes always
#     ends 0600.
#   - Readers return 2 on a file that exists but is not a JSON object; writers
#     return 1 on it and write nothing.
#
# All JSON work happens in jq, through the one definitions string below.

# --- jq definitions -----------------------------------------------------------
# Every program is compiled with `--arg shape grouped|flat`.
# shellcheck disable=SC2016  # jq program text, not shell expansions
_UC_JQ_DEFS='
# The capture signature, matched against the WHOLE command:
#   [VAR=value ...] [env] [bash|sh] <path> <cli-id> <Event>
# <path> is double-quoted, single-quoted, or an unquoted token (the legacy
# Gemini form of origin/main), and ends in `/hooks/usage-capture.sh`; <cli-id>
# is one of the three crewrig ids. `pre` and `post` are kept so a re-point rebuilds
# the command around a new, double-quoted path without touching anything else.
def uc_sig_re:
  "\\A(?<pre>\\s*(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)*(?:(?:\\S*/)?env\\s+)?(?:(?:\\S*/)?(?:bash|sh)\\s+)?)"
  + "(?:\"(?<dq>[^\"]*/hooks/usage-capture\\.sh)\"|\\x27(?<sq>[^\\x27]*/hooks/usage-capture\\.sh)\\x27|(?<uq>[^\\s\"\\x27]*/hooks/usage-capture\\.sh))"
  + "(?<post>\\s+(?:claude-code|gemini-cli|copilot-cli)\\s+[A-Za-z]+\\s*)\\z";

# The one legacy form an unquoted token cannot express: origin/main wrote the
# Gemini command unquoted, so a checkout path with a space gave
# `bash /My Projects/.../hooks/usage-capture.sh gemini-cli AfterModel`. Only
# the exact bytes main wrote are recognised: `bash `, an absolute path whose
# one character outside a plain word is a space, ` gemini-cli AfterModel`.
# The path class excludes every character the shell would read as syntax in
# an unquoted word (`; & | < > ( ) $` backtick backslash quotes, glob, brace,
# comment and tilde characters, control characters), so an operator compound
# such as `bash /opt/prep.sh && <abs> gemini-cli AfterModel` never matches
# (#1174, security review N1).
def uc_legacy_re:
  "\\A(?<pre>bash )(?<uq>/[^\\x00-\\x1f\\x7f\"\\x27;&|<>()$`\\\\*?\\[\\]{}#~]*/hooks/usage-capture\\.sh)(?<post> gemini-cli AfterModel)\\z";

# A spaced unquoted path is still ambiguous (`bash /x/tool /a b/hooks/…` is a
# tool with an argument), so a legacy match is capture only when the WHOLE path
# names an existing file. jq cannot test that: the shell tests each candidate
# (uc_legacy_candidates) and passes the existing ones as `--argjson
# uc_legacy_ok`; a program run without it recognises no legacy form.
def uc_legacy_ok: $ARGS.named.uc_legacy_ok // [];

def uc_is_command:
  type == "object" and ((.type // "command") == "command")
  and ((.command | type) == "string");

# {pre, path, post, quoted} for a capture handler, null for anything else.
def uc_parse:
  if uc_is_command
  then ([.command | capture(uc_sig_re),
         (capture(uc_legacy_re) | select(.uq as $p | any(uc_legacy_ok[]; . == $p)))]
        | if length > 0
          then .[0] | {pre, path: (.dq // .sq // .uq), post, quoted: (.uq == null)}
          else null end)
  else null end;

def uc_is_capture: uc_parse != null;

# The registered script path, quotes stripped.
def uc_path: uc_parse | if . == null then null else .path end;

# Rebuild a capture handler around a new script path, double-quoted.
def uc_with_path($p):
  uc_parse as $x
  | if $x == null then . else .command = ($x.pre + "\"" + $p + "\"" + $x.post) end;

# Every handler as {event, selector, handler}; selector is the group object
# minus its `hooks` key on grouped shapes, null on the flat shape.
def uc_all_handlers:
  (.hooks // {}) | if type == "object" then to_entries[] else empty end
  | .key as $e
  | (.value | if type == "array" then .[] else empty end)
  | if $shape == "flat" then {event: $e, selector: null, handler: .}
    elif (type == "object" and (.hooks | type) == "array")
    then del(.hooks) as $sel | .hooks[] | {event: $e, selector: $sel, handler: .}
    else empty end;

def uc_footprint: [uc_all_handlers | select(.handler | uc_is_capture)];

def uc_distinct: reduce .[] as $x ([]; if any(.[]; . == $x) then . else . + [$x] end);

# The paths of every legacy-shaped command the signature does not already
# match, for the shell to test with `[ -f ]`.
def uc_legacy_candidates:
  [uc_all_handlers | .handler | select(uc_is_command) | .command
   | select(test(uc_sig_re) | not) | capture(uc_legacy_re) | .uq] | uc_distinct;

def uc_paths: [uc_footprint[] | .handler | uc_path | select(. != null)] | uc_distinct;

# R12 pruning rule. A group is deleted only when it held >= 1 handler before and
# none after; an event only when its array was non-empty before and empty
# after; on the grouped (settings.json) shapes `.hooks` itself only when it was
# non-empty before and {} after. The flat Copilot manifest keeps `.hooks`: its
# schema keys belong to the file.
# Generic strip machinery, parameterized on an ownership predicate, so the R12
# pruning rule (a group is dropped only when it held >= 1 handler before and
# none after; likewise an event, and `.hooks` itself on a grouped shape) is
# written once. uc_strip / uc_strip_group keep their names and uc_is_capture
# for every existing caller; sr_strip (#1234) reuses the same machinery with
# sr_is_own instead of duplicating it.
def uc_strip_group_by(is_own):
  if type == "object" and (.hooks | type) == "array" then
    (.hooks | length > 0) as $had
    | .hooks |= map(select(is_own | not))
    | if $had and (.hooks | length) == 0 then empty else . end
  else . end;

def uc_strip_by(is_own):
  if (.hooks | type) == "object" then
    (.hooks | length > 0) as $had
    | .hooks |= with_entries(
        if (.value | type) == "array" then
          (.value | length > 0) as $evhad
          | .value |= (if $shape == "flat" then map(select(is_own | not))
                       else map(uc_strip_group_by(is_own)) end)
          | if $evhad and (.value | length) == 0 then empty else . end
        else . end)
    | if $shape != "flat" and $had and .hooks == {} then del(.hooks) else . end
  else . end;

def uc_strip_group: uc_strip_group_by(uc_is_capture);
def uc_strip: uc_strip_by(uc_is_capture);

# Add one {event, selector, handler}. Grouped shapes join the FIRST group whose
# selector equals the given one, else append a new selector + {hooks:[h]} group.
def uc_add($x):
  (if (.hooks | type) == "object" then .
   elif .hooks == null then .hooks = {}
   else error("hooks is not an object") end)
  | (if (.hooks[$x.event] | type) == "array" then .
     elif .hooks[$x.event] == null then .hooks[$x.event] = []
     else error("hook event is not an array") end)
  | if $shape == "flat" then .hooks[$x.event] += [$x.handler]
    else
      ($x.selector // {}) as $sel
      | ([.hooks[$x.event] | to_entries[]
          | select((.value | type) == "object" and (.value.hooks | type) == "array"
                   and ((.value | del(.hooks)) == $sel))
          | .key][0]) as $i
      | if $i == null then .hooks[$x.event] += [$sel + {hooks: [$x.handler]}]
        else .hooks[$x.event][$i].hooks += [$x.handler] end
    end;

def uc_reinject($fp): uc_strip | reduce $fp[] as $x (.; uc_add($x));

# A session-recording handler this framework wrote: the WHOLE command is an
# optional `VAR=value…`/`env`/`bash|sh` prefix (the same `pre` shape
# uc_sig_re anchors, so an env-var prefix on Gemini or a bare `bash` wrapper
# on Claude is free to vary) around a path — double-quoted, single-quoted or
# bare — ending in `/mempalace-transcript.sh` or `/worktree-git-guard.sh`,
# and nothing else (plan/1234#1 v1-F1: an EARLIER, unanchored version of this
# predicate matched anywhere in the command, so an operator hook that merely
# chained its own script with `&& bash .../mempalace-transcript.sh` was
# misclassified as framework-owned and silently dropped — a narrower
# recurrence of #1234 itself). These commands carry no distinguishing argv of
# their own — unlike the `<cli-id> <Event>` a capture command always carries
# (R10), they take none, because the script reads the firing event from its
# own hook payload — so anchoring the path suffix as the ENTIRE remainder of
# the command is what makes this "content, never position" rather than
# "substring, anywhere", the same discipline uc_sig_re already applies to its
# own `<cli-id> <Event>` suffix. An installed copy sits under a `hooks/`
# directory on both CLIs, but nothing here assumes that literal segment
# name, only that a `/` precedes the basename.
def sr_is_own:
  uc_is_command
  and (.command | test(
    "\\A\\s*(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)*(?:(?:\\S*/)?env\\s+)?(?:(?:\\S*/)?(?:bash|sh)\\s+)?"
    + "(?:\"[^\"]*/(?:mempalace-transcript|worktree-git-guard)\\.sh\""
    + "|\\x27[^\\x27]*/(?:mempalace-transcript|worktree-git-guard)\\.sh\\x27"
    + "|[^\\s\"\\x27]*/(?:mempalace-transcript|worktree-git-guard)\\.sh)"
    + "\\s*\\z"));

def sr_strip: uc_strip_by(sr_is_own);

# Refresh, in place, the session-recording handlers this run owns: strip
# every handler sr_is_own picks out, then add manifest $m handlers back
# fresh (uc_add joins the existing group at the same selector — matcher on
# Claude, the sole `{hooks:[...]}` group on Gemini — or opens a new one).
# Anything uc_strip_by(sr_is_own) does not select is left exactly where it
# was: a hook an operator registered on the same event, and a registered
# usage-capture command, survive without help from uc_reinject (#1234 — the
# merge no longer replaces the whole per-event array, only the entries this
# framework owns in it).
def sr_merge($m): sr_strip | reduce ($m | uc_all_handlers) as $x (.; uc_add($x));

# keep (a): re-point, in place, a capture handler whose path vanished. Only the
# path token changes (it comes back double-quoted); prefix and argv are kept.
# A live path left unquoted with a space in it (the legacy Gemini form above,
# which never ran) keeps its path and only gains the quotes.
def uc_needs_quotes: uc_parse | . != null and (.quoted | not) and (.path | test("\\s"));

def uc_repoint_handler($vanished; $abs):
  uc_path as $p
  | if $p == null then .
    elif any($vanished[]; . == $p) then uc_with_path($abs)
    elif uc_needs_quotes then uc_with_path($p)
    else . end;

def uc_repoint_event($vanished; $abs):
  if $shape == "flat" then map(uc_repoint_handler($vanished; $abs))
  else map(if type == "object" and (.hooks | type) == "array"
           then .hooks |= map(uc_repoint_handler($vanished; $abs)) else . end)
  end;

# keep (b): keep exactly one capture handler of one event and delete the
# others, pruning a group that this deletion alone emptied. The survivor is the
# first handler whose path is live; failing that the first unresolvable one
# (a `$…`, `~…` or relative path, never judged); failing that the first one
# (#1174 i1-F6: a live command is never dropped in favour of a dead one).
def uc_rank($live; $vanished):
  uc_path as $p
  | if any($live[]; . == $p) then 0
    elif any($vanished[]; . == $p) then 2
    else 1 end;

def uc_event_handlers:
  if $shape == "flat" then .[]
  else .[] | select(type == "object" and (.hooks | type) == "array") | .hooks[] end;

def uc_dedup_event($live; $vanished):
  ([uc_event_handlers | select(uc_is_capture) | uc_rank($live; $vanished)] | min) as $best
  | if $best == null then . else
    if $shape == "flat" then
      [foreach .[] as $h ({done: false, keep: true};
         if ($h | uc_is_capture) then
           (if (.done | not) and (($h | uc_rank($live; $vanished)) == $best)
            then {done: true, keep: true} else {done: .done, keep: false} end)
         else {done: .done, keep: true} end;
         select(.keep) | $h)]
    else
      [foreach .[] as $g ({done: false, drop: false, g: null};
         if ($g | type) == "object" and ($g.hooks | type) == "array" then
           ($g.hooks | length) as $n
           | (reduce $g.hooks[] as $h ({done: .done, hs: []};
                if ($h | uc_is_capture) then
                  (if (.done | not) and (($h | uc_rank($live; $vanished)) == $best)
                   then (.hs += [$h] | .done = true) else . end)
                else .hs += [$h] end)) as $r
           | {done: $r.done,
              drop: ($n > 0 and ($r.hs | length) == 0),
              g: ($g | .hooks = $r.hs)}
         else {done: .done, drop: false, g: $g} end;
         select(.drop | not) | .g)]
    end
  end;

def uc_event_has_capture($e):
  any(uc_footprint[]; .event == $e);

# keep (b), (a), (c) on the R5 events only — dedup first, so the survivor is
# chosen on the paths as registered; capture handlers on any other event are
# left untouched (R11: keep "SHALL change no other entry").
def uc_keep_dedup($r5; $live; $vanished):
  reduce $r5[] as $e (.;
    if (.hooks | type) == "object" and (.hooks[$e] | type) == "array"
    then .hooks[$e] |= uc_dedup_event($live; $vanished) else . end);

def uc_r5_paths($r5):
  [uc_footprint[] | select(.event as $e | any($r5[]; . == $e))
   | .handler | uc_path | select(. != null)] | uc_distinct;

def uc_keep($r5; $live; $vanished; $abs; $fragfp; $target):
  uc_keep_dedup($r5; $live; $vanished)
  | reduce $r5[] as $e (.;
      if (.hooks | type) == "object" and (.hooks[$e] | type) == "array"
      then .hooks[$e] |= uc_repoint_event($vanished; $abs) else . end)
  | reduce $fragfp[] as $x (.;
      if uc_event_has_capture($x.event) then .
      else uc_add($x | .handler |= uc_with_path($target)) end);
'

# --- small internals ------------------------------------------------------------

# _uc_shape <cli> — prints grouped|flat; returns 1 on an unknown CLI.
_uc_shape() {
  case "$1" in
    claude|gemini) printf 'grouped\n' ;;
    copilot)       printf 'flat\n' ;;
    *) echo "  ERROR: unknown CLI '$1' (expected claude, gemini or copilot)." >&2; return 1 ;;
  esac
}

# _uc_token <cli> — the tokenized script path the fragment carries.
_uc_token() {
  case "$1" in
    claude)  printf '%s\n' '$CLAUDE_PROJECT_DIR/hooks/usage-capture.sh' ;;
    gemini)  printf '%s\n' '${GEMINI_PROJECT_DIR}/hooks/usage-capture.sh' ;;
    copilot) printf '%s\n' '${COPILOT_PROJECT_DIR:-$PWD}/hooks/usage-capture.sh' ;;
    *) return 1 ;;
  esac
}

# _uc_jq <shape> <jq args…> <program> <file> — run one read-only program.
_uc_jq() {
  local shape="$1"; shift
  jq --arg shape "$shape" "$@"
}

# _uc_unsafe_path <path> — 0 when the path cannot be spliced, double-quoted,
# into a shell command without changing its meaning: it holds `"`, `$`, a
# backtick, a backslash or a newline (#1174, security review S3).
_uc_unsafe_path() {
  local nl='
'
  case "$1" in
    *'"'*|*'$'*|*'`'*|*'\'*|*"$nl"*) return 0 ;;
  esac
  return 1
}

# _uc_unresolvable_path <path> — 0 when setup cannot judge whether the path
# resolves: it is relative, or holds `$` or a backtick the hook's shell would
# expand (`$HOME/…`, `${CLAUDE_PROJECT_DIR}/…`, `~/…`). Such a path is never
# "vanished" and never re-pointed (#1174, security review S2).
_uc_unresolvable_path() {
  case "$1" in
    /*) ;;
    *) return 0 ;;
  esac
  case "$1" in
    *'$'*|*'`'*) return 0 ;;
  esac
  return 1
}

# _uc_is_object <file> — 0 when the file parses as one JSON object.
_uc_is_object() {
  jq -e 'type == "object"' "$1" >/dev/null 2>&1
}

# _uc_legacy_ok <shape> <config> — print, as a JSON array, the legacy spaced
# Gemini paths (see uc_legacy_re) of the config that name an existing file.
# Every program that classifies the handlers of <config> receives it as
# `--argjson uc_legacy_ok`; an absent or unparsable config gives `[]`.
_uc_legacy_ok() {
  local shape="$1" config="$2" cands p ok=""
  if [ ! -f "$config" ] || ! _uc_is_object "$config"; then
    printf '[]\n'
    return 0
  fi
  cands="$(_uc_jq "$shape" -r "$_UC_JQ_DEFS uc_legacy_candidates | .[]" "$config")" || return 1
  # The path class holds no control character, so one path per line is exact.
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if [ -f "$p" ]; then
      ok="${ok}${p}
"
    fi
  done <<< "$cands"
  printf '%s' "$ok" | jq -R -s -c 'split("\n") | map(select(length > 0))' || return 1
  return 0
}

# _uc_read <cli> <config> <jq-expr> — evaluate a read-only expression
# on the config. Absent file → the expression evaluated on {}; unparsable → 2.
_uc_read() {
  local cli="$1" config="$2" expr="$3" shape lg
  shape="$(_uc_shape "$cli")" || return 1
  if [ ! -f "$config" ]; then
    printf '{}' | _uc_jq "$shape" -c "$_UC_JQ_DEFS $expr" || return 1
    return 0
  fi
  if ! _uc_is_object "$config"; then
    echo "  ERROR: $config is not readable as a JSON object." >&2
    return 2
  fi
  lg="$(_uc_legacy_ok "$shape" "$config")" || return 2
  _uc_jq "$shape" -c --argjson uc_legacy_ok "$lg" "$_UC_JQ_DEFS $expr" "$config" || return 2
  return 0
}

# _uc_create_empty <config> — create an absent config as `{}` at 0600.
_uc_create_empty() {
  local config="$1" dir
  dir="$(dirname "$config")"
  if ! mkdir -p "$dir"; then return 1; fi
  if ! ( umask 077; printf '{}\n' > "$config" ); then return 1; fi
  chmod 600 "$config" || return 1
  return 0
}

# --- public API -----------------------------------------------------------------

# usage_capture_abs <repo_dir> — the in-repo absolute path of the capture
# script (CAPTURE_ABS), physical (`pwd -P`). Returns 1 when it does not exist,
# or when the checkout path holds a character that would change the meaning of
# the double-quoted hook command (`"`, `$`, backtick, backslash, newline).
usage_capture_abs() {
  local src="$1/hooks/usage-capture.sh" dir abs
  if _uc_unsafe_path "$1"; then
    echo "  ERROR: the checkout path $1 contains a character (\" \$ \` \\ or a newline) that cannot be wired safely into a hook command; move the checkout to a path without it." >&2
    return 1
  fi
  if [ ! -f "$src" ]; then
    echo "  ERROR: capture script not found at $src." >&2
    return 1
  fi
  dir="$(cd "$(dirname "$src")" && pwd -P)" || return 1
  abs="$dir/$(basename "$src")"
  if _uc_unsafe_path "$abs"; then
    echo "  ERROR: the checkout path $dir contains a character (\" \$ \` \\ or a newline) that cannot be wired safely into a hook command; move the checkout to a path without it." >&2
    return 1
  fi
  printf '%s\n' "$abs"
}

# usage_capture_fragment <cli> <repo_dir> — print the CLI's capture fragment
# (hooks/<cli>-usage-capture-hooks.json) with the tokenized script path
# `<prefix>/hooks/usage-capture.sh` replaced, whole, by CAPTURE_ABS. Returns 1
# when the fragment is missing or unparsable, or when a token survives.
usage_capture_fragment() {
  local cli="$1" repo_dir="$2" frag_src abs tok out
  _uc_shape "$cli" >/dev/null || return 1
  frag_src="$repo_dir/hooks/${cli}-usage-capture-hooks.json"
  if [ ! -f "$frag_src" ]; then
    echo "  ERROR: capture fragment not found at $frag_src." >&2
    return 1
  fi
  abs="$(usage_capture_abs "$repo_dir")" || return 1
  tok="$(_uc_token "$cli")" || return 1
  if ! out="$(jq -c --arg tok "$tok" --arg abs "$abs" \
      '(.. | objects | select(.type? == "command") | .command) |= (split($tok) | join($abs))' \
      "$frag_src" 2>/dev/null)"; then
    echo "  ERROR: capture fragment $frag_src is not valid JSON." >&2
    return 1
  fi
  case "$out" in
    *_PROJECT_DIR*)
      echo "  ERROR: unresolved project-dir token in the $cli capture fragment." >&2
      return 1
      ;;
  esac
  # Round trip: every command the fragment registers must read back as a
  # capture handler, or detection, keep and remove would not recognise it.
  if ! _uc_jq "$(_uc_shape "$cli")" -e \
      "$_UC_JQ_DEFS [.. | objects | select(.type? == \"command\")] | length > 0 and all(uc_is_capture)" \
      >/dev/null 2>&1 <<< "$out"; then
    echo "  ERROR: the $cli capture fragment $frag_src does not match the capture signature." >&2
    return 1
  fi
  printf '%s\n' "$out"
}

# usage_capture_footprint <cli> <config> — print the JSON array of
# {event, selector, handler} for every capture handler. `[]` for an absent
# file; returns 2 (file untouched) for one that is not a JSON object.
usage_capture_footprint() {
  _uc_read "$1" "$2" 'uc_footprint'
}

# usage_capture_paths <cli> <config> — print the distinct registered capture
# script paths, one per line, in registration order. Returns 2 on unparsable JSON.
usage_capture_paths() {
  local out rc=0
  out="$(_uc_read "$1" "$2" 'uc_paths | .[]')" || rc=$?
  [ "$rc" -eq 0 ] || return "$rc"
  # -c prints strings JSON-quoted; decode each line.
  [ -n "$out" ] || return 0
  printf '%s\n' "$out" | jq -r '.' || return 2
}

# usage_capture_state <cli> <config> — print `absent` or `installed`.
# Returns 2 on unparsable JSON.
usage_capture_state() {
  local n rc=0
  n="$(_uc_read "$1" "$2" 'uc_footprint | length')" || rc=$?
  [ "$rc" -eq 0 ] || return "$rc"
  if [ "$n" = "0" ]; then printf 'absent\n'; else printf 'installed\n'; fi
}

# usage_capture_reinject <cli> <config> <footprint_json> — one secure write:
# strip every capture handler, then add back each footprint entry. No backup:
# its callers own backups.
usage_capture_reinject() {
  local cli="$1" config="$2" fp="$3" shape lg
  shape="$(_uc_shape "$cli")" || return 1
  if [ ! -f "$config" ] || ! _uc_is_object "$config"; then
    echo "  ERROR: $config is absent or not a JSON object; usage capture not re-injected." >&2
    return 1
  fi
  if ! jq -e 'type == "array"' >/dev/null 2>&1 <<< "$fp"; then
    echo "  ERROR: invalid usage-capture footprint." >&2
    return 1
  fi
  lg="$(_uc_legacy_ok "$shape" "$config")" || return 1
  write_json_config_secure "$config" --arg shape "$shape" --argjson fp "$fp" \
    --argjson uc_legacy_ok "$lg" "$_UC_JQ_DEFS uc_reinject(\$fp)" || return 1
  return 0
}

# usage_capture_disclose <cli> <config> <repo_dir> — the pre-write disclosure (R6).
usage_capture_disclose() {
  local cli="$1" config="$2" repo_dir="$3" frag abs events
  frag="$(usage_capture_fragment "$cli" "$repo_dir")" || return 1
  abs="$(usage_capture_abs "$repo_dir")" || return 1
  events="$(jq -r '.hooks | keys_unsorted | join(", ")' <<< "$frag")" || return 1
  echo "Enabling usage capture will:"
  echo "  1. Register $abs"
  echo "     on the $events event(s), in $config"
  if [ "$cli" = "copilot" ]; then
    echo "     (the same file session recording uses; its entries are left as they are)"
  fi
  echo "  2. Back up $config first when it exists, and change no other entry in it"
  echo "  The capture script is wired in place, by its in-repo absolute path; it is never copied."
  echo "  No prompt or response text is recorded: only token counts, model and timing."
  echo "  MemPalace is not required: records go to the file-system usage journal."
  warn_if_linked_worktree "$repo_dir" "usage capture"
  echo ""
  return 0
}

# usage_capture_enable <cli> <config> <repo_dir> — register the fragment (R5, R9).
usage_capture_enable() {
  local cli="$1" config="$2" repo_dir="$3" shape frag events lg
  shape="$(_uc_shape "$cli")" || return 1
  frag="$(usage_capture_fragment "$cli" "$repo_dir")" || return 1
  events="$(jq -r '.hooks | keys_unsorted | join(", ")' <<< "$frag")" || return 1
  if [ -f "$config" ]; then
    if ! _uc_is_object "$config"; then
      echo "  ERROR: $config is not a JSON object; usage capture not enabled." >&2
      return 1
    fi
    lg="$(_uc_legacy_ok "$shape" "$config")" || return 1
    backup_file "$config"
    write_json_config_secure "$config" --arg shape "$shape" --argjson frag "$frag" \
      --argjson uc_legacy_ok "$lg" \
      "$_UC_JQ_DEFS (\$frag | uc_footprint) as \$ffp | uc_reinject(\$ffp)" \
      || { echo "  ERROR: could not write $config." >&2; return 1; }
  else
    _uc_create_empty "$config" || { echo "  ERROR: could not create $config." >&2; return 1; }
    if ! write_json_config_secure "$config" --argjson frag "$frag" '$frag'; then
      rm -f "$config"
      echo "  ERROR: could not write $config." >&2
      return 1
    fi
  fi
  echo "  Usage capture enabled on $events in $config"
  return 0
}

# usage_capture_keep <cli> <config> <repo_dir> — R11. On the R5 events:
# (b) keep one capture handler per event — the first live one, else the first
# unresolvable one, else the first — (a) re-point in place a kept handler whose
# registered path no longer resolves, (c) add the fragment handler to an event
# that has none. A path is live when it is absolute, holds no `$` or backtick,
# and `[ -f ]` finds it; vanished when absolute, expansion-free and missing;
# unresolvable otherwise, and then left as it is. Writes nothing (and backs up
# nothing) on a no-op.
usage_capture_keep() {
  local cli="$1" config="$2" repo_dir="$3" shape frag abs r5 fragfp
  local paths p vanished_list="" live_list="" target="" vanished live missing
  local repointed requoted wrote_abs=0 before after lg
  shape="$(_uc_shape "$cli")" || return 1
  if [ ! -f "$config" ]; then
    echo "  No usage-capture entry in $config; nothing to keep."
    return 0
  fi
  if ! _uc_is_object "$config"; then
    echo "  ERROR: $config is not a JSON object; usage capture left as it is." >&2
    return 1
  fi
  frag="$(usage_capture_fragment "$cli" "$repo_dir")" || return 1
  abs="$(usage_capture_abs "$repo_dir")" || return 1
  r5="$(jq -c '.hooks | keys_unsorted' <<< "$frag")" || return 1
  fragfp="$(_uc_jq "$shape" -c "$_UC_JQ_DEFS uc_footprint" <<< "$frag")" || return 1
  # Legacy spaced paths that exist, decided once on the file as it is now.
  lg="$(_uc_legacy_ok "$shape" "$config")" || return 1
  # Paths registered on the R5 events, in order.
  paths="$(_uc_jq "$shape" -r --argjson r5 "$r5" --argjson uc_legacy_ok "$lg" \
    "$_UC_JQ_DEFS uc_r5_paths(\$r5) | .[]" \
    "$config")" || return 1
  # Paths are decoded from JSON one per line (a path cannot hold a newline
  # once usage_capture_abs refuses it; a hand-written one would split into
  # fragments that match nothing and so change nothing).
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if _uc_unresolvable_path "$p"; then
      continue
    elif [ -f "$p" ]; then
      live_list="${live_list}${p}
"
      if [ -z "$target" ] && ! _uc_unsafe_path "$p"; then target="$p"; fi
    else
      vanished_list="${vanished_list}${p}
"
    fi
  done <<< "$paths"
  [ -n "$target" ] || target="$abs"
  vanished="$(printf '%s' "$vanished_list" | jq -R -s -c 'split("\n") | map(select(length > 0))')" || return 1
  live="$(printf '%s' "$live_list" | jq -R -s -c 'split("\n") | map(select(length > 0))')" || return 1
  # Events of R5 with no capture handler before this run: (c) adds one there.
  missing="$(_uc_jq "$shape" -r --argjson r5 "$r5" --argjson uc_legacy_ok "$lg" \
    "$_UC_JQ_DEFS [\$r5[] as \$e | select(any(uc_footprint[]; .event == \$e) | not) | \$e] | length" \
    "$config")" || return 1
  local program="$_UC_JQ_DEFS uc_keep(\$r5; \$live; \$vanished; \$abs; \$fragfp; \$target)"
  before="$(jq -c '.' "$config")" || return 1
  after="$(_uc_jq "$shape" -c --argjson r5 "$r5" --argjson live "$live" --argjson vanished "$vanished" \
    --arg abs "$abs" --argjson fragfp "$fragfp" --arg target "$target" --argjson uc_legacy_ok "$lg" \
    "$program" "$config")" || return 1
  if [ "$before" = "$after" ]; then
    echo "  Usage capture kept unchanged in $config"
    return 0
  fi
  backup_file "$config"
  write_json_config_secure "$config" --arg shape "$shape" --argjson r5 "$r5" \
    --argjson live "$live" --argjson vanished "$vanished" --arg abs "$abs" \
    --argjson fragfp "$fragfp" --arg target "$target" --argjson uc_legacy_ok "$lg" "$program" \
    || { echo "  ERROR: could not write $config." >&2; return 1; }
  # Name only the vanished paths a kept handler really carried: one dropped as
  # a duplicate was deleted, not re-pointed.
  repointed="$(_uc_jq "$shape" -r --argjson r5 "$r5" --argjson live "$live" \
    --argjson vanished "$vanished" --argjson uc_legacy_ok "$lg" \
    "$_UC_JQ_DEFS uc_keep_dedup(\$r5; \$live; \$vanished) | uc_r5_paths(\$r5) as \$now | \$vanished[] | select(. as \$v | any(\$now[]; . == \$v))" \
    <<< "$before")" || repointed=""
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    echo "  Usage capture re-pointed $p -> $abs"
    wrote_abs=1
  done <<< "$repointed"
  requoted="$(_uc_jq "$shape" -r --argjson r5 "$r5" --argjson live "$live" \
    --argjson vanished "$vanished" --argjson uc_legacy_ok "$lg" \
    "$_UC_JQ_DEFS [uc_keep_dedup(\$r5; \$live; \$vanished) | uc_footprint[] | select(.event as \$e | any(\$r5[]; . == \$e)) | .handler | select(uc_needs_quotes) | uc_path | select(. as \$p | any(\$vanished[]; . == \$p) | not)] | uc_distinct | .[]" \
    <<< "$before")" || requoted=""
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    echo "  Usage capture path quoted (it holds a space): $p"
  done <<< "$requoted"
  if [ "$missing" != "0" ]; then
    echo "  Usage capture re-registered on $missing event(s) at $target"
    [ "$target" != "$abs" ] || wrote_abs=1
  fi
  echo "  Usage capture kept in $config (one entry per event)"
  if [ "$wrote_abs" -eq 1 ]; then
    warn_if_linked_worktree "$repo_dir" "usage capture"
  fi
  return 0
}

# usage_capture_remove <cli> <config> — R9, R12: delete every capture handler,
# pruning only the containers that deletion emptied. Absent file → no write.
usage_capture_remove() {
  local cli="$1" config="$2" shape lg
  shape="$(_uc_shape "$cli")" || return 1
  if [ ! -f "$config" ]; then
    echo "  No usage-capture entry to remove ($config does not exist)."
    return 0
  fi
  if ! _uc_is_object "$config"; then
    echo "  ERROR: $config is not a JSON object; usage capture not removed." >&2
    return 1
  fi
  lg="$(_uc_legacy_ok "$shape" "$config")" || return 1
  backup_file "$config"
  write_json_config_secure "$config" --arg shape "$shape" --argjson uc_legacy_ok "$lg" \
    "$_UC_JQ_DEFS uc_strip" \
    || { echo "  ERROR: could not write $config." >&2; return 1; }
  echo "  Usage capture removed from $config (every other entry left as it was)"
  return 0
}

# usage_capture_apply <cli> <config> <repo_dir> <state> <answer> — the mapping
# of a raw prompt answer, kept out of the setups so it is testable (R4, R10):
#   absent    + yes    → enable; any other answer, empty included → no write
#   installed + remove → remove; any other answer, empty included → keep
# Any other state is rejected (non-zero, nothing written).
usage_capture_apply() {
  local cli="$1" config="$2" repo_dir="$3" state="$4" answer="$5"
  _uc_shape "$cli" >/dev/null || return 1
  case "$state" in
    absent)
      if [ "$answer" = "yes" ]; then
        usage_capture_enable "$cli" "$config" "$repo_dir"
        return $?
      fi
      echo "Usage capture not enabled (re-run scripts/setup-${cli}-interactive.sh to enable it)."
      return 0
      ;;
    installed)
      if [ "$answer" = "remove" ]; then
        usage_capture_remove "$cli" "$config"
        return $?
      fi
      usage_capture_keep "$cli" "$config" "$repo_dir"
      return $?
      ;;
    *)
      echo "  ERROR: unknown usage-capture state '$state'; nothing written." >&2
      return 1
      ;;
  esac
}

# merge_session_recording_hooks <cli> <config> <patched_manifest> [<env_patch_json>]
# The session-recording write of all three CLIs. Claude and Gemini refresh
# this framework's own session-recording handlers in place (sr_merge, keyed
# on sr_is_own) instead of replacing the whole per-event array, so an
# operator's own hook registered on the same event survives a run that
# accepts or re-accepts session recording (#1234); Copilot keeps its full
# replace. uc_reinject($fp) on top of that additionally re-asserts the
# capture footprint it found canonically, so it never removes, duplicates or
# re-points a registered capture command (R8). Refuses (returns 1, writes
# nothing) on a config that is not a JSON object.
merge_session_recording_hooks() {
  local cli="$1" config="$2" patched="$3" env_patch="${4:-}" shape fp rc=0 created=0 program lg
  shape="$(_uc_shape "$cli")" || return 1
  fp="$(usage_capture_footprint "$cli" "$config")" || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "  ERROR: $config is not readable as JSON; session-recording hooks not merged." >&2
    return 1
  fi
  if ! jq -e 'type == "object"' "$patched" >/dev/null 2>&1; then
    echo "  ERROR: patched hook manifest $patched is not a JSON object." >&2
    return 1
  fi
  [ -n "$env_patch" ] || env_patch='{}'
  if ! jq -e 'type == "object"' >/dev/null 2>&1 <<< "$env_patch"; then
    echo "  ERROR: invalid environment patch for $config." >&2
    return 1
  fi
  case "$cli" in
    claude)  program='sr_merge($m[0]) | (if ($patch | length) > 0 then .env = ((.env // {}) + $patch) else . end) | uc_reinject($fp)' ;;
    gemini)  program='sr_merge($m[0]) | uc_reinject($fp)' ;;
    copilot) program='$m[0] | uc_reinject($fp)' ;;
  esac
  # The same legacy classification the footprint above was read with, so the
  # strip inside uc_reinject removes exactly the handlers it re-adds.
  lg="$(_uc_legacy_ok "$shape" "$config")" || return 1
  if [ -f "$config" ]; then
    backup_file "$config"
  else
    _uc_create_empty "$config" || { echo "  ERROR: could not create $config." >&2; return 1; }
    created=1
  fi
  if ! write_json_config_secure "$config" --arg shape "$shape" --slurpfile m "$patched" \
      --argjson fp "$fp" --argjson patch "$env_patch" --argjson uc_legacy_ok "$lg" \
      "$_UC_JQ_DEFS $program"; then
    [ "$created" -eq 0 ] || rm -f "$config"
    echo "  ERROR: could not write $config." >&2
    return 1
  fi
  return 0
}
