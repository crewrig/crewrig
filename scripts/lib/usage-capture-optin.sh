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
# invokes a script path ending in `/hooks/usage-capture.sh` (the legacy shell
# entry) or `/hooks/usage-capture.ts` (the direct `node` entry, spec 0243) with
# the argv `<cli-id> <Event>` crewrig writes, wherever that path points (R10,
# spec 0243 R20). The TypeScript twin of this predicate is
# scripts/lib/hook-recognition.ts; both are run over one corpus. The
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
# All JSON work happens in jq, through the one definitions string below, except
# the two operations that need the direct command line (spec 0243 R16, R23):
# rendering the fragment and rewriting legacy commands run in
# scripts/hook-wiring.ts, reached through `node` once the Node.js floor is met
# (usage_capture_require_node_floor). No configuration content ever reaches an
# argument list.

# --- jq definitions -----------------------------------------------------------
# Every program is compiled with `--arg shape grouped|flat`.
# shellcheck disable=SC2016  # jq program text, not shell expansions
_UC_JQ_DEFS='
# The capture signature, matched against the WHOLE command:
#   [VAR=value ...] [env] [bash|sh|node] <path> <cli-id> <Event>
# <path> is double-quoted, single-quoted, or an unquoted token (the legacy
# Gemini form of origin/main), and ends in `/hooks/usage-capture.sh` or
# `/hooks/usage-capture.ts` (spec 0243 R20); <cli-id>
# is one of the three crewrig ids. `pre` and `post` are kept so a re-point rebuilds
# the command around a new, double-quoted path without touching anything else.
def uc_sig_re:
  "\\A(?<pre>\\s*(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)*(?:(?:\\S*/)?env\\s+)?(?:(?:\\S*/)?(?:bash|sh|node)\\s+)?)"
  + "(?:\"(?<dq>[^\"]*/hooks/usage-capture\\.(?:sh|ts))\"|\\x27(?<sq>[^\\x27]*/hooks/usage-capture\\.(?:sh|ts))\\x27|(?<uq>[^\\s\"\\x27]*/hooks/usage-capture\\.(?:sh|ts)))"
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

# {pre, path, ext, post, quoted} for a capture handler, null for anything else;
# ext is `ts` for the direct entry and `sh` for the legacy shell script.
def uc_parse:
  if uc_is_command
  then ([.command | capture(uc_sig_re),
         (capture(uc_legacy_re) | select(.uq as $p | any(uc_legacy_ok[]; . == $p)))]
        | if length > 0
          then .[0] | (.dq // .sq // .uq) as $p
               | {pre, path: $p, ext: (if ($p | endswith(".ts")) then "ts" else "sh" end),
                  post, quoted: (.uq == null)}
          else null end)
  else null end;

def uc_is_capture: uc_parse != null;

# The registered script path, quotes stripped.
def uc_path: uc_parse | if . == null then null else .path end;
def uc_ext: uc_parse | if . == null then null else .ext end;

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

# A session-recording handler this framework wrote is recognised by CONTENT,
# never by position: the WHOLE command must match (plan/1234#1 v1-F1 — an
# unanchored predicate once took an operator hook that chained its own script
# with `&& bash .../mempalace-transcript.sh` as owned by the framework and
# dropped it).
def sr_env_prefix:
  "\\A\\s*(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)*(?:(?:\\S*/)?env\\s+)?";

# The MemPalace transcript command and its class (spec 0247 R24, delta-01): the
# Bash twin of scripts/lib/transcript-recognition.ts. Both SHALL return the
# same class for every row of
# scripts/tests/fixtures/mempalace-transcript/recognition-corpus.json.
#   - an optional `NAME=value` prefix, an optional `env`, an optional
#     `bash|sh|node`, a path ending in `/mempalace-transcript.sh` or `.ts`
#     (quoted or not, any directory), and one of the four argument forms setup
#     has ever written: (i) none, (ii) one event word, (iii) a CLI identifier,
#     (iv) `antigravity-cli <event>`; or the guarded Windows prefix of spec 0243
#     delta-03 R34 in place of that prefix;
#   - class `foreign-prefix` (an assignment to a name other than
#     MEMPALACE_TRANSCRIPT_ENABLED and MEMPALACE_PYTHON, or a direct shape with
#     any assignment), `direct` (iii)/(iv) bare or guarded, `legacy-enabled`
#     ((i)/(ii) with exactly `MEMPALACE_TRANSCRIPT_ENABLED=1` and at most one
#     non-blank `MEMPALACE_PYTHON=`), `legacy-unmarked` (every other (i)/(ii)),
#     else `no`. Other arguments, and a command carrying `;`, `&`, `|`, `<`,
#     `>`, parentheses, a backquote, `$(`, a backslash or a line break
#     outside its prefix values (sr_tr_safe), are `no`.
def sr_tr_args:
  "(?:\\s*|(?:\\s+[A-Za-z]+|\\s+(?:claude-code|gemini-cli|copilot-cli)|\\s+antigravity-cli\\s+[A-Za-z]+)\\s*)";

def sr_tr_re:
  "\\A(?<pre>\\s*(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)*(?:(?:\\S*/)?env\\s+)?(?:(?:\\S*/)?(?:bash|sh|node)\\s+)?)"
  + "(?<path>\"[^\"]*/mempalace-transcript\\.(?:sh|ts)\""
  + "|\\x27[^\\x27]*/mempalace-transcript\\.(?:sh|ts)\\x27"
  + "|[^\\s\"\\x27]*/mempalace-transcript\\.(?:sh|ts))"
  + "(?<post>" + sr_tr_args + ")\\z";

# Shell syntax a transcript command never carries outside its prefix values
# (security review S1): a command that chains, substitutes, redirects or
# spans lines belongs to the operator, never to the framework. The twin of
# isShellSafe in scripts/lib/transcript-recognition.ts.
def sr_tr_safe_word: "[^\\s;&|<>()$`\\\\\"\\x27*?\\[\\]{}#~]";
def sr_tr_safe($p):
  ($p.pre + $p.path + $p.post | test("[\\n\\r]") | not)
  and ($p.pre | test("\\A[ \\t]*(?:[A-Za-z_][A-Za-z0-9_]*=" + sr_tr_safe_word + "*[ \\t]+)*"
        + "(?:(?:" + sr_tr_safe_word + "*/)?env[ \\t]+)?"
        + "(?:(?:" + sr_tr_safe_word + "*/)?(?:bash|sh|node)[ \\t]+)?\\z"))
  and ($p.path | test("[;&|<>()`\\\\]|\\$\\(") | not);

def sr_tr_guarded_re:
  "\\Aset NoDefaultCurrentDirectoryInExePath=1&& node (?:[A-Za-z]:)?/(?:[^\\s\"\\x27\\\\&|<>^%()$`]*/)?mempalace-transcript\\.ts"
  + "(?<post>" + sr_tr_args + ")\\z";

# The leading `NAME=value` words of a prefix, before any `env` or interpreter.
def sr_tr_assigns:
  if test("\\A\\s*[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+") then
    capture("\\A\\s*(?<n>[A-Za-z_][A-Za-z0-9_]*)=(?<v>\\S*)\\s+(?<rest>.*)\\z"; "s") as $c
    | [{n: $c.n, v: $c.v}] + ($c.rest | sr_tr_assigns)
  else [] end;

def sr_tr_direct_shape:
  [splits("\\s+") | select(. != "")] as $w
  | (($w | length) == 1 and (["claude-code", "gemini-cli", "copilot-cli"] | index($w[0])) != null)
    or (($w | length) == 2 and $w[0] == "antigravity-cli");

# The class of a command string.
def sr_transcript_class_of:
  if test("[\\n\\r]") then "no"
  elif test(sr_tr_guarded_re) then
    (capture(sr_tr_guarded_re).post | if sr_tr_direct_shape then "direct" else "legacy-unmarked" end)
  elif test(sr_tr_re) then
    capture(sr_tr_re) as $p
    | if sr_tr_safe($p) | not then "no" else
    ($p.pre | sr_tr_assigns) as $a
    | if any($a[]; .n != "MEMPALACE_TRANSCRIPT_ENABLED" and .n != "MEMPALACE_PYTHON") then "foreign-prefix"
      elif ($p.post | sr_tr_direct_shape) then (if ($a | length) == 0 then "direct" else "foreign-prefix" end)
      elif ([$a[] | select(.n == "MEMPALACE_TRANSCRIPT_ENABLED")] as $e
            | [$a[] | select(.n == "MEMPALACE_PYTHON")] as $py
            | ($e | length) == 1 and $e[0].v == "1" and ($py | length) <= 1 and all($py[]; .v != ""))
      then "legacy-enabled"
      else "legacy-unmarked" end end
  else "no" end;

# The class of a handler object; `no` for anything that is not a command.
def sr_transcript_class: if uc_is_command then .command | sr_transcript_class_of else "no" end;

# A transcript command this framework owns (spec 0247 R24): `direct`,
# `legacy-enabled` or `legacy-unmarked`. A `foreign-prefix` one belongs to
# the operator and is never stripped.
def sr_is_transcript:
  sr_transcript_class | . == "direct" or . == "legacy-enabled" or . == "legacy-unmarked";

# Any transcript command, a `foreign-prefix` one of the operator included.
def sr_is_transcript_any: sr_transcript_class != "no";

# The worktree git guard (spec 0248 R31, v1-F5): `bash|sh|node`, the `.sh`
# Bash twin or the `.ts` entry, and the `/hooks/` directory the TypeScript
# recognition (scripts/lib/hook-recognition.ts) requires, so `bash
# /opt/tools/worktree-git-guard.sh` is a guard on neither twin.
def sr_is_guard:
  uc_is_command
  and (.command | test(
    sr_env_prefix + "(?:(?:\\S*/)?(?:bash|sh|node)\\s+)?"
    + "(?:\"[^\"]*/hooks/worktree-git-guard\\.(?:sh|ts)\""
    + "|\\x27[^\\x27]*/hooks/worktree-git-guard\\.(?:sh|ts)\\x27"
    + "|[^\\s\"\\x27]*/hooks/worktree-git-guard\\.(?:sh|ts))"
    + "\\s*\\z"));

def sr_is_own: sr_is_transcript or sr_is_guard;

def sr_strip: uc_strip_by(sr_is_own);

# The strip of a run whose manifest carries no guard handler (the render
# refused, or the guard script is missing: `guard render` drops the entry, spec
# 0248 v1-F4). It spares every installed guard handler, so a refused or
# floor-failed run leaves the registered guard byte-identical while the
# `mempalace-transcript` handlers are still refreshed. The two predicates are
# the whole difference: the guard alternative leaves the ownership test.
def sr_strip_sparing_guard: uc_strip_by(sr_is_transcript);

def sr_has_guard: [uc_all_handlers | select(.handler | sr_is_guard)] | length > 0;

def sr_has_transcript: [uc_all_handlers | select(.handler | sr_is_transcript)] | length > 0;

def sr_event_has_transcript($e):
  [uc_all_handlers | select(.event == $e and (.handler | sr_is_transcript_any))] | length > 0;

# Refresh, in place, the session-recording handlers this run owns: strip
# every handler of a kind the manifest $m carries (sr_is_guard,
# sr_is_transcript), then add manifest $m handlers back fresh (uc_add joins the
# existing group at the same selector — matcher on Claude, the sole
# `{hooks:[...]}` group on Gemini — or opens a new one). A kind the manifest
# does not carry (its render refused, or Node.js is below the floor) is spared,
# so the installed commands of that kind stay byte-identical (spec 0248 v1-F4,
# spec 0247 R27). A manifest transcript handler is added only on an event that
# holds no transcript command after the strip — the one left is then an
# `foreign-prefix` command of the operator, which stays alone (spec 0247
# R23(a)).
# Anything the strip does not select is left exactly where it was: a hook an
# operator registered on the same event, and a registered usage-capture
# command, survive without help from uc_reinject (#1234).
def sr_merge($m):
  ($m | sr_has_guard) as $g
  | ($m | sr_has_transcript) as $t
  | uc_strip_by(($g and sr_is_guard) or ($t and sr_is_transcript))
  | reduce ($m | uc_all_handlers) as $x (.;
      if ($x.handler | sr_is_transcript_any) and sr_event_has_transcript($x.event) then .
      else uc_add($x) end);

# keep (a): re-point, in place, a capture handler whose path vanished. Only the
# path token changes (it comes back double-quoted); prefix and argv are kept, and
# so is the form: a `.ts` handler goes to the current checkout'"'"'s `.ts`, a `.sh`
# handler to its `.sh` (spec 0243 R22). A live path left unquoted with a space
# in it (the legacy Gemini form above, which never ran) keeps its path and only
# gains the quotes.
def uc_needs_quotes: uc_parse | . != null and (.quoted | not) and (.path | test("\\s"));

# A command whose prefix opens with a NAME=value word (only those that precede
# any `env`/interpreter: `env NAME=value …` is outside the signature). Windows
# PowerShell, which Gemini CLI and Copilot CLI use there, cannot run one (row
# 37c), so $ps (that target) leaves a vanished path on such a command as it is
# rather than re-pointing it (spec 0243 delta-01, s4-F2). On POSIX the re-point
# keeps the prefix.
def uc_assign_prefixed:
  uc_parse | . != null and (.pre | test("^\\s*[A-Za-z_][A-Za-z0-9_]*="));

def uc_repoint_handler($vanished; $abs_sh; $abs_ts; $ps):
  uc_path as $p
  | if $p == null then .
    elif any($vanished[]; . == $p) then
      if $ps and uc_assign_prefixed then .
      else uc_with_path(if uc_ext == "ts" then $abs_ts else $abs_sh end) end
    elif uc_needs_quotes then uc_with_path($p)
    else . end;

def uc_repoint_event($vanished; $abs_sh; $abs_ts; $ps):
  if $shape == "flat" then map(uc_repoint_handler($vanished; $abs_sh; $abs_ts; $ps))
  else map(if type == "object" and (.hooks | type) == "array"
           then .hooks |= map(uc_repoint_handler($vanished; $abs_sh; $abs_ts; $ps)) else . end)
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

# The vanished-path handlers of the R5 events that uc_keep leaves as they are
# on a PowerShell target, as "path<TAB>NAME=..., NAME=..." lines (names only,
# never values: they may be credentials).
def uc_ps_left($r5; $vanished; $ps):
  if $ps then
    [uc_footprint[] | select(.event as $e | any($r5[]; . == $e)) | .handler
     | select(uc_assign_prefixed)
     | (uc_path) as $p | select(any($vanished[]; . == $p))
     | uc_parse.pre as $pre
     | [$p, ([$pre | match("(?:^|\\s)([A-Za-z_][A-Za-z0-9_]*)=";"g").captures[0].string | . + "=..."] | join(", "))]
     | @tsv]
    | uc_distinct
  else [] end;

def uc_keep($r5; $live; $vanished; $abs_sh; $abs_ts; $fragfp; $target; $ps):
  uc_keep_dedup($r5; $live; $vanished)
  | reduce $r5[] as $e (.;
      if (.hooks | type) == "object" and (.hooks[$e] | type) == "array"
      then .hooks[$e] |= uc_repoint_event($vanished; $abs_sh; $abs_ts; $ps) else . end)
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

# _uc_jq <shape> <jq args…> <program> <file> — run one read-only program.
_uc_jq() {
  local shape="$1"; shift
  jq --arg shape "$shape" "$@"
}

# _uc_powershell_target <cli> — 0 on Gemini CLI and Copilot CLI running on
# Windows, where the hook command line is read by Windows PowerShell 5.1 and a
# NAME=value prefix is not runnable (row 37c).
_uc_powershell_target() {
  case "$1" in
    gemini|copilot)
      case "$(uname -s 2>/dev/null)" in MINGW*|MSYS*|CYGWIN*) return 0 ;; esac ;;
  esac
  return 1
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

# The checkout this library sits in: it owns the floor guard and the wiring
# tool, whatever checkout a <repo_dir> argument names (that one only supplies the
# fragments and the hook scripts to register).
_UC_LIB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"

# usage_capture_require_node_floor — the Node.js floor precondition of every
# write of the direct form (spec 0243 R24, D3). Runs the floor guard of
# spec 0240 R1 with the `node` found on PATH; prints its diagnostic and returns 1
# below the floor. When no `node` is on PATH the guard cannot print anything, so
# this prints the diagnostic itself (v1-F2). Never called by `remove`.
usage_capture_require_node_floor() {
  local guard="$_UC_LIB_ROOT/scripts/lib/node-floor-guard.js"
  if ! command -v node >/dev/null 2>&1; then
    echo "  ERROR: crewrig: Node.js was not found on PATH; usage capture requires Node.js >= 24. Install a supported release from https://nodejs.org/en/download" >&2
    return 1
  fi
  if [ ! -f "$guard" ]; then
    echo "  ERROR: Node.js floor guard not found at $guard." >&2
    return 1
  fi
  node "$guard" || return 1
  return 0
}

# _uc_hook_wiring <repo_dir> <args…> — run scripts/hook-wiring.ts against the
# checkout <repo_dir>. The two flags silence the type-stripping notices of
# Node.js 24.0-24.2 and the typeless package scope; neither hides an error.
_uc_hook_wiring() {
  local repo_dir="$1"; shift
  node --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
    "$_UC_LIB_ROOT/scripts/hook-wiring.ts" "$@" --repo "$repo_dir"
}

# usage_capture_abs <repo_dir> [sh|ts] — the in-repo absolute path of the capture
# script (CAPTURE_ABS), physical (`pwd -P`); the extension defaults to `ts`, the
# direct entry setup registers. Returns 1 when it does not exist, or when the
# checkout path holds a character that would change the meaning of the
# double-quoted hook command (`"`, `$`, backtick, backslash, newline).
usage_capture_abs() {
  local ext="${2:-ts}" src dir abs
  src="$1/hooks/usage-capture.$ext"
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
# (hooks/<cli>-usage-capture-hooks.json) with every command built by
# scripts/hook-wiring.ts render (spec 0243 R16, R26): the direct `node` form
# with the script's physical absolute path, no token left. Returns 1 when the
# Node.js floor is not met, the fragment is missing or unparsable, or a command
# is refused.
usage_capture_fragment() {
  local cli="$1" repo_dir="$2" frag_src out
  _uc_shape "$cli" >/dev/null || return 1
  frag_src="$repo_dir/hooks/${cli}-usage-capture-hooks.json"
  if [ ! -f "$frag_src" ]; then
    echo "  ERROR: capture fragment not found at $frag_src." >&2
    return 1
  fi
  usage_capture_require_node_floor || return 1
  usage_capture_abs "$repo_dir" ts >/dev/null || return 1
  if ! out="$(_uc_hook_wiring "$repo_dir" render "$cli")"; then
    echo "  ERROR: could not render the $cli capture fragment $frag_src." >&2
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

# usage_capture_rewrite <cli> <config> <repo_dir> — rewrite every legacy capture
# command of the configuration to the direct form, one command per event
# (spec 0243 R19, R21, R22), through scripts/hook-wiring.ts. Below the Node.js
# floor it prints the guard's diagnostic and changes nothing (R24). A second run
# writes nothing.
usage_capture_rewrite() {
  local cli="$1" config="$2" repo_dir="$3"
  _uc_shape "$cli" >/dev/null || return 1
  usage_capture_require_node_floor || return 1
  _uc_hook_wiring "$repo_dir" rewrite "$cli" --config "$config"
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
  local cli="$1" config="$2" repo_dir="$3" frag abs events cmds
  # The floor guard comes first: the fragment is rendered through `node`, and a
  # Node.js below the floor must be met with the guard's diagnostic, not a raw
  # Node.js error (v1-F2, spec 0243 R24).
  usage_capture_require_node_floor || return 1
  frag="$(usage_capture_fragment "$cli" "$repo_dir")" || return 1
  abs="$(usage_capture_abs "$repo_dir")" || return 1
  events="$(jq -r '.hooks | keys_unsorted | join(", ")' <<< "$frag")" || return 1
  cmds="$(jq -r '[.. | objects | select(.type? == "command") | .command] | unique | .[]' <<< "$frag")" || return 1
  echo "Enabling usage capture will:"
  echo "  1. Register $abs"
  echo "     on the $events event(s), in $config"
  echo "     as a direct node command (no shell wrapper; needs Node.js 24 or later when the hook fires):"
  printf '%s\n' "$cmds" | sed 's/^/       /'
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
  local cli="$1" config="$2" repo_dir="$3" shape frag abs abs_sh r5 fragfp
  local paths p vanished_list="" live_list="" target="" target_ts="" vanished live missing
  local repointed requoted wrote_abs=0 before after lg ps=false left
  shape="$(_uc_shape "$cli")" || return 1
  if _uc_powershell_target "$cli"; then ps=true; fi
  if [ ! -f "$config" ]; then
    echo "  No usage-capture entry in $config; nothing to keep."
    return 0
  fi
  if ! _uc_is_object "$config"; then
    echo "  ERROR: $config is not a JSON object; usage capture left as it is." >&2
    return 1
  fi
  frag="$(usage_capture_fragment "$cli" "$repo_dir")" || return 1
  abs="$(usage_capture_abs "$repo_dir" ts)" || return 1
  abs_sh="$(usage_capture_abs "$repo_dir" sh)" || return 1
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
  # A handler added to an event that has none is the fragment's (direct) one, so
  # it points at the `.ts` of the checkout the live registered path belongs to
  # when that exists, else at the current checkout (spec 0243 R22).
  target_ts="$abs"
  if [ "$target" != "$abs" ] && [ -f "${target%.*}.ts" ] && ! _uc_unsafe_path "${target%.*}.ts"; then
    target_ts="${target%.*}.ts"
  fi
  vanished="$(printf '%s' "$vanished_list" | jq -R -s -c 'split("\n") | map(select(length > 0))')" || return 1
  live="$(printf '%s' "$live_list" | jq -R -s -c 'split("\n") | map(select(length > 0))')" || return 1
  # Events of R5 with no capture handler before this run: (c) adds one there.
  missing="$(_uc_jq "$shape" -r --argjson r5 "$r5" --argjson uc_legacy_ok "$lg" \
    "$_UC_JQ_DEFS [\$r5[] as \$e | select(any(uc_footprint[]; .event == \$e) | not) | \$e] | length" \
    "$config")" || return 1
  local program="$_UC_JQ_DEFS uc_keep(\$r5; \$live; \$vanished; \$abs_sh; \$abs; \$fragfp; \$target; \$ps)"
  before="$(jq -c '.' "$config")" || return 1
  after="$(_uc_jq "$shape" -c --argjson r5 "$r5" --argjson live "$live" --argjson vanished "$vanished" \
    --arg abs "$abs" --arg abs_sh "$abs_sh" --argjson fragfp "$fragfp" --arg target "$target_ts" \
    --argjson ps "$ps" --argjson uc_legacy_ok "$lg" "$program" "$config")" || return 1
  # A vanished path on an assignment-prefixed command is not re-pointed on a
  # PowerShell target: say so by name (spec 0243 delta-01, s4-F2).
  left="$(_uc_jq "$shape" -r --argjson r5 "$r5" --argjson live "$live" --argjson vanished "$vanished" \
    --argjson ps "$ps" --argjson uc_legacy_ok "$lg" \
    "$_UC_JQ_DEFS uc_keep_dedup(\$r5; \$live; \$vanished) | uc_ps_left(\$r5; \$vanished; \$ps)[]" \
    <<< "$before")" || left=""
  local lp ln
  while IFS=$'\t' read -r lp ln; do
    [ -n "$lp" ] || continue
    echo "  Usage capture left $lp: keeps an environment prefix ($ln) that PowerShell on Windows cannot run; left as it is."
  done <<< "$left"
  if [ "$before" = "$after" ]; then
    echo "  Usage capture kept unchanged in $config"
    return 0
  fi
  backup_file "$config"
  write_json_config_secure "$config" --arg shape "$shape" --argjson r5 "$r5" \
    --argjson live "$live" --argjson vanished "$vanished" --arg abs "$abs" \
    --argjson fragfp "$fragfp" --arg target "$target_ts" --arg abs_sh "$abs_sh" --argjson ps "$ps" --argjson uc_legacy_ok "$lg" "$program" \
    || { echo "  ERROR: could not write $config." >&2; return 1; }
  # Name only the vanished paths a kept handler really carried: one dropped as
  # a duplicate was deleted, not re-pointed.
  repointed="$(_uc_jq "$shape" -r --argjson r5 "$r5" --argjson live "$live" \
    --argjson vanished "$vanished" --argjson ps "$ps" --argjson uc_legacy_ok "$lg" \
    "$_UC_JQ_DEFS uc_keep_dedup(\$r5; \$live; \$vanished) | ([uc_ps_left(\$r5; \$vanished; \$ps)[] | split(\"\\t\")[0]]) as \$left | uc_r5_paths(\$r5) as \$now | \$vanished[] | select(. as \$v | any(\$now[]; . == \$v) and (any(\$left[]; . == \$v) | not))" \
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
    echo "  Usage capture re-registered on $missing event(s) at $target_ts"
    [ "$target_ts" != "$abs" ] || wrote_abs=1
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
#   installed + remove → remove; any other answer, empty included → keep, then
#                        rewrite every legacy command to the direct form
# Every path that writes the direct form first meets the Node.js floor (spec 0243
# R24, D3): below it the guard's diagnostic is printed, nothing is written and
# the status is non-zero. `remove` never depends on Node.js.
# Any other state is rejected (non-zero, nothing written).
usage_capture_apply() {
  local cli="$1" config="$2" repo_dir="$3" state="$4" answer="$5"
  _uc_shape "$cli" >/dev/null || return 1
  case "$state" in
    absent)
      if [ "$answer" = "yes" ]; then
        usage_capture_require_node_floor || return 1
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
      usage_capture_require_node_floor || return 1
      usage_capture_keep "$cli" "$config" "$repo_dir" || return 1
      usage_capture_rewrite "$cli" "$config" "$repo_dir"
      return $?
      ;;
    *)
      echo "  ERROR: unknown usage-capture state '$state'; nothing written." >&2
      return 1
      ;;
  esac
}

# render_session_recording_manifest <cli> <repo_dir> <manifest_src> <out_file> —
# the manifest the session-recording merge reads, with the worktree git guard's
# command rendered by `hook-wiring.ts guard render` (guard_render_manifest, in
# common.sh; spec 0248 R28, R29) and then the MemPalace transcript commands by
# `hook-wiring.ts transcript render` (transcript_render_manifest; spec 0247
# R20, R21): `node "<repo>/hooks/mempalace-transcript.ts" <cli-id>`, final. A
# refusal of either render leaves that kind's handlers absent from <out_file>,
# and merge_session_recording_hooks then spares the installed ones (spec 0248
# v1-F4, spec 0247 R27). Below the Node.js floor (or when the tool fails) the
# diagnostic is printed, nothing is rewritten, and the manifest is written
# WITHOUT the guard and the transcript handlers (the unrendered ones hold a
# `$..._PROJECT_DIR` token), so every installed one stays as it is.
# Sets SR_TRANSCRIPT_WIRED to 1 when <out_file> carries a rendered transcript
# command, else 0: the caller then writes nothing that would start recording
# (Claude Code's env patch included, seat finding v1-F3) and does not report
# recording as active. Returns non-zero only when <manifest_src> is not a JSON
# object.
render_session_recording_manifest() {
  local cli="$1" repo_dir="$2" manifest_src="$3" out="$4" shape guarded
  shape="$(_uc_shape "$cli")" || return 1
  # shellcheck disable=SC2034  # read by the setup scripts after this call
  SR_TRANSCRIPT_WIRED=0
  guarded="$(mktemp)"
  if guard_render_manifest "$cli" "$repo_dir" "$manifest_src" "$guarded" \
     && transcript_render_manifest "$cli" "$repo_dir" "$guarded" "$out"; then
    rm -f "$guarded"
    if _uc_jq "$shape" -e "$_UC_JQ_DEFS sr_has_transcript" "$out" >/dev/null 2>&1; then
      # shellcheck disable=SC2034  # read by the setup scripts after this call
      SR_TRANSCRIPT_WIRED=1
    fi
    return 0
  fi
  rm -f "$guarded"
  echo "  Worktree git guard and session recording not wired this run; installed commands are left as they are." >&2
  _uc_jq "$shape" "$_UC_JQ_DEFS uc_strip_by(sr_is_guard or sr_is_transcript_any)" "$manifest_src" > "$out"
}

# merge_session_recording_hooks <cli> <config> <patched_manifest> [<env_patch_json>]
# The session-recording write of all three CLIs. Each refreshes this
# framework's own session-recording handlers in place (sr_merge) instead of
# replacing the whole per-event array, so an operator's own hook registered on
# the same event survives a run that accepts or re-accepts session recording
# (#1234). Copilot CLI takes the same merge since spec 0247 R23(b), in place of
# its former full replace of the user-level hooks file: its top-level keys other
# than `hooks` keep their value when present and take the manifest's when
# absent, and a kept `"disableAllHooks": true` is reported (SR_ALL_HOOKS_DISABLED
# is then 1, else 0) instead of overwritten. uc_reinject($fp) on top of that
# re-asserts the capture footprint it found canonically, so it never removes,
# duplicates or re-points a registered capture command (R8). Refuses (returns
# 1, writes nothing) on a config that is not a JSON object.
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
    # sr_merge spares the installed guard or transcript handlers when the
    # manifest carries none (a refused render, spec 0248 v1-F4, spec 0247 R27).
    # A file that held nothing takes the manifest's top-level keys in its order.
    copilot) program='. as $cur | sr_merge($m[0]) as $r
        | (if ($cur | length) == 0 then ($m[0] | del(.hooks)) + $r
           else reduce ($m[0] | to_entries[] | select(.key != "hooks")) as $e ($r;
             if has($e.key) then . else .[$e.key] = $e.value end) end)
        | uc_reinject($fp)' ;;
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
  # shellcheck disable=SC2034  # read by the setup scripts after this call
  SR_ALL_HOOKS_DISABLED=0
  if [ "$cli" = "copilot" ] && jq -e '.disableAllHooks == true' "$config" >/dev/null 2>&1; then
    # shellcheck disable=SC2034  # read by the setup scripts after this call
    SR_ALL_HOOKS_DISABLED=1
    echo "  WARNING: $config keeps \"disableAllHooks\": true — no hook in that file fires," >&2
    echo "           session recording included, until you set it to false." >&2
  fi
  return 0
}
