#!/usr/bin/env bash
# scripts/lib/usage-capture-optin.sh — forwarding FUNCTION shim of the usage-capture
# opt-in (spec 0256 requirement 33, Decision D3). Sourced by the Bash suites that
# exercise the opt-in in-process (test-setup-usage-capture-optin.sh,
# test-setup-{claude,gemini,copilot}-transcript.sh and the TypeScript suites that
# run them through scripts/tests/lib/bash-libs.ts). The setup scripts themselves no
# longer source it: they are shims of the TypeScript entries. Do NOT execute directly.
#
# Every public function keeps its name, arguments, standard output, standard error
# and return code and forwards to scripts/usage-capture-optin.ts (logic in
# scripts/lib/setup/usage-capture-cli.ts), one `node` process per call, with the
# Node.js floor guard (scripts/lib/node-floor-guard.js) preloaded into that process
# (`node -r`), so below the floor the guard's diagnostic is printed and the entry is
# not run. With `node` absent the diagnostic of usage_capture_require_node_floor is
# printed and the status is 1. Standard input is never forwarded: the node process
# reads /dev/null, as the shell functions never read standard input.
#
# The shell variables the originals set travel back through a side channel: the two
# functions that set any (render_session_recording_manifest, merge_session_recording_hooks)
# pass `--result <file>` to the entry, which writes `NAME=0|1` lines; after the call
# the shim reads the file and sets ONLY the variables of a closed whitelist
# (SR_TRANSCRIPT_WIRED, SR_ALL_HOOKS_DISABLED, wrote), each with a value of 0 or 1,
# and removes the file on every return path.
#
# The PowerShell-target decision of usage_capture_keep (a vanished path behind a
# NAME=value prefix on Gemini CLI and Copilot CLI) was made here from `uname -s`; the
# entry makes it from the platform of its node process, which is `win32` on a real
# Windows host. A shell that reports MINGW*, MSYS* or CYGWIN* (the suites stub `uname`
# to simulate that on POSIX) passes `--platform win32` to the entry for `keep`, the
# one subcommand that read `uname` in the original.
#
# The original description follows. The opt-in of Claude Code, Gemini CLI and
# Copilot CLI (spec 0211), decoupled from the MemPalace session-recording opt-in.
# It owns every read and every write of a capture entry in a CLI's hook
# configuration: detection, enable, keep, remove, and the preservation step the
# session-recording writer runs (merge_session_recording_hooks). Ownership is
# decided by CONTENT, never by position: a capture entry is a command that
# invokes a script path ending in `/hooks/usage-capture.sh` (the legacy shell
# entry) or `/hooks/usage-capture.ts` (the direct `node` entry, spec 0243) with
# the argv `<cli-id> <Event>` crewrig writes, wherever that path points (R10,
# spec 0243 R20). The TypeScript twin of this predicate is
# scripts/lib/hook-recognition.ts.
#
# <cli> is one of `claude`, `gemini`, `copilot`.
#
# Contracts shared by every function: a failure is a non-zero return, never an
# `exit`, never a `trap`; the functions are safe under `set -u` and `set -e` called
# from `||` / `if !` contexts, and run on Bash 3.2.
#
# _UC_JQ_DEFS below is no longer used by the functions: the Bash suites and the
# corpus tests read it as the jq oracle of the capture signature, so it stays.

# --- jq definitions -----------------------------------------------------------
# Every program is compiled with `--arg shape grouped|flat`.
# shellcheck disable=SC2016,SC2034  # jq program text, not shell expansions; read by the suites
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
#     else `no`. Other arguments are `no`; a command that chains, substitutes
#     or redirects, or whose prefix is outside the grammar setup writes, is
#     `foreign-prefix` (sr_tr_safety, sr_tr_shaped_unsafe; i1-F5).
def sr_tr_args:
  "(?:\\s*|(?:\\s+[A-Za-z]+|\\s+(?:claude-code|gemini-cli|copilot-cli)|\\s+antigravity-cli\\s+[A-Za-z]+)\\s*)";

def sr_tr_re:
  "\\A(?<pre>\\s*(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)*(?:(?:\\S*/)?env\\s+)?(?:(?:\\S*/)?(?:bash|sh|node)\\s+)?)"
  + "(?<path>\"[^\"]*/mempalace-transcript\\.(?:sh|ts)\""
  + "|\\x27[^\\x27]*/mempalace-transcript\\.(?:sh|ts)\\x27"
  + "|[^\\s\"\\x27]*/mempalace-transcript\\.(?:sh|ts))"
  + "(?<post>" + sr_tr_args + ")\\z";

# Shell syntax and the transcript class (security review S1; review i1-F5,
# spec 0247 delta-03), the twin of shellSafety in
# scripts/lib/transcript-recognition.ts:
#   - `chained`: a `;`, `$(`, a backquote or a line break anywhere (tested on
#     the whole command by sr_transcript_class_of), or shell syntax inside the
#     script path: `foreign-prefix` (owner ruling, i1-F5);
#   - `unsafe-prefix`: any other prefix outside the grammar setup writes (a
#     quote, `$`, a backslash, a glob or brace character, `#`, `~`, `&`, `|`,
#     `<`, `>` or a parenthesis): `foreign-prefix`, left byte-identical,
#     reported, nothing added to its event;
#   - `safe`: classed by the prefix names and the argument shape.
def sr_tr_safe_word: "[^\\s;&|<>()$`\\\\\"\\x27*?\\[\\]{}#~]";
def sr_tr_safety($p):
  if ($p.path | test("[;&|<>()`\\\\]|\\$\\(")) then "chained"
  elif ($p.pre | test("\\A[ \\t]*(?:[A-Za-z_][A-Za-z0-9_]*=" + sr_tr_safe_word + "*[ \\t]+)*"
        + "(?:(?:" + sr_tr_safe_word + "*/)?env[ \\t]+)?"
        + "(?:(?:" + sr_tr_safe_word + "*/)?(?:bash|sh|node)[ \\t]+)?\\z")) then "safe"
  else "unsafe-prefix" end;

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
# A command outside the signature is still transcript-shaped when it carries
# shell syntax and names `.../mempalace-transcript.sh|ts` as a whole path word
# (i1-F5); the guarded Windows prefix setup writes is not counted as syntax.
def sr_tr_shaped_unsafe:
  sub("\\Aset NoDefaultCurrentDirectoryInExePath=1&& "; "")
  | test("[;&|<>()`\\n\\r]|\\$\\(")
    and test("/mempalace-transcript\\.(?:sh|ts)(?=[\"\\x27\\s;&|<>()`]|\\z)");

# The class of a command string. Owner rulings of 2026-10-07 (i1-F5, spec 0247
# delta-03): a transcript-shaped command that fails S1 — a chain, a
# substitution, a redirection, or a prefix outside the grammar setup writes —
# is `foreign-prefix`: left byte-identical, reported, nothing added.
def sr_transcript_class_of:
  if test(sr_tr_guarded_re) then
    (if test("[;`\\n\\r]|\\$\\(") then "foreign-prefix"
     else capture(sr_tr_guarded_re).post | if sr_tr_direct_shape then "direct" else "legacy-unmarked" end end)
  elif test(sr_tr_re) then
    capture(sr_tr_re) as $p
    | if test("[;`\\n\\r]|\\$\\(") or sr_tr_safety($p) != "safe" then "foreign-prefix" else
    ($p.pre | sr_tr_assigns) as $a
    | if any($a[]; .n != "MEMPALACE_TRANSCRIPT_ENABLED" and .n != "MEMPALACE_PYTHON") then "foreign-prefix"
      elif ($p.post | sr_tr_direct_shape) then (if ($a | length) == 0 then "direct" else "foreign-prefix" end)
      elif ([$a[] | select(.n == "MEMPALACE_TRANSCRIPT_ENABLED")] as $e
            | [$a[] | select(.n == "MEMPALACE_PYTHON")] as $py
            | ($e | length) == 1 and $e[0].v == "1" and ($py | length) <= 1 and all($py[]; .v != ""))
      then "legacy-enabled"
      else "legacy-unmarked" end end
  elif sr_tr_shaped_unsafe then "foreign-prefix"
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

# What sr_merge($m) leaves alone, reported before the write (spec 0247 R23,
# R25): one line per foreign-prefix transcript command on an event the
# manifest registers a transcript command for. The line names the event, the
# script path, the names of the prefix assignments (never their values: they
# may be credentials) and how many own transcript commands the merge removes
# there; nothing is added on such an event.
def sr_report($m):
  if ($m | sr_has_transcript) | not then empty else
    . as $cfg
    | ([$m | uc_all_handlers | select(.handler | sr_is_transcript) | .event] | unique)[] as $e
    | [$cfg | uc_all_handlers | select(.event == $e) | .handler] as $hs
    | ([$hs[] | select(sr_is_transcript)] | length) as $own
    | $hs[] | select(sr_transcript_class == "foreign-prefix") | .command
    | (if test(sr_tr_re) then (capture(sr_tr_re).pre | sr_tr_assigns | map(.n + "=...") | join(", ")) else "" end) as $names
    | (capture("(?<p>\"[^\"]*/mempalace-transcript\\.(?:sh|ts)\"|\\x27[^\\x27]*/mempalace-transcript\\.(?:sh|ts)\\x27|[^\\s\"\\x27]*/mempalace-transcript\\.(?:sh|ts))").p
       | gsub("^[\"\\x27]|[\"\\x27]$"; "")) as $path
    | (if $names == "" then "keeps a command line the framework does not write"
       else "keeps an environment prefix the framework does not own (\($names))" end) as $why
    | "  Session recording: left \($path) on \($e) (\($why)); removed \($own) own transcript command(s) there and added none."
  end;

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

# --- forwarding internals ---------------------------------------------------------

# _uc_run_node <result-file|""> <subcommand> <args…> — run one subcommand of
# scripts/usage-capture-optin.ts; the status is the entry's. Standard input is /dev/null.
# `--` ends the options, so an argument that starts with `--` reaches the entry as data.
# The Node.js floor guard is preloaded (`node -r`), so below the floor its diagnostic is
# printed and the entry is not run — except for the two functions that take a result file
# (render_session_recording_manifest, merge_session_recording_hooks): below the floor
# they still run, as they did in jq, the entry deciding for itself (it refuses the
# direct form and renders the guard-free manifest). They need only a node that can run
# the entry (type stripping); any other node gets the guard's diagnostic.
_uc_run_node() {
  local res="$1" sub="$2" guard entry
  local -a plat=()
  shift 2
  guard="$_UC_LIB_ROOT/scripts/lib/node-floor-guard.js"
  entry="$_UC_LIB_ROOT/scripts/usage-capture-optin.ts"
  if ! command -v node >/dev/null 2>&1 || [ ! -f "$guard" ]; then
    # Prints the diagnostic of the missing node or of the missing guard.
    usage_capture_require_node_floor || return 1
    return 1
  fi
  if [ ! -f "$entry" ]; then
    echo "  ERROR: usage-capture entry not found at $entry." >&2
    return 1
  fi
  if [ -n "$res" ]; then
    if ! node -e 'process.exitCode = process.features.typescript ? 0 : 1' >/dev/null 2>&1 </dev/null; then
      usage_capture_require_node_floor || return 1
      return 1
    fi
    node "$entry" "$sub" --result "$res" -- "$@" </dev/null
  else
    if [ "$sub" = keep ]; then
      case "$(uname -s 2>/dev/null)" in MINGW*|MSYS*|CYGWIN*) plat=(--platform win32) ;; esac
    fi
    node -r "$guard" "$entry" ${plat[@]+"${plat[@]}"} "$sub" -- "$@" </dev/null
  fi
}

# _uc_forward <subcommand> <args…> — a function that sets no shell variable.
_uc_forward() {
  local sub="$1"
  shift
  _uc_run_node "" "$sub" "$@"
}

# _uc_forward_result <subcommand> <args…> — a function that sets variables: the
# entry writes `NAME=0|1` lines to a temporary file, read here after the call.
# Only the whitelisted names take a value, and only `0` or `1`; the file is
# removed on every path out.
_uc_forward_result() {
  local sub="$1" res line rc=0
  shift
  if ! res="$(mktemp 2>/dev/null)" || [ -z "$res" ]; then
    echo "  ERROR: could not create a temporary file for $sub." >&2
    return 1
  fi
  _uc_run_node "$res" "$sub" "$@" || rc=$?
  if [ -f "$res" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      # shellcheck disable=SC2034  # read by the callers after the call
      case "$line" in
        SR_TRANSCRIPT_WIRED=0) SR_TRANSCRIPT_WIRED=0 ;;
        SR_TRANSCRIPT_WIRED=1) SR_TRANSCRIPT_WIRED=1 ;;
        SR_ALL_HOOKS_DISABLED=0) SR_ALL_HOOKS_DISABLED=0 ;;
        SR_ALL_HOOKS_DISABLED=1) SR_ALL_HOOKS_DISABLED=1 ;;
        wrote=0) wrote=0 ;;
        wrote=1) wrote=1 ;;
      esac
    done < "$res"
  fi
  rm -f "$res"
  return "$rc"
}

# --- public API: forwarding shims --------------------------------------------------

# usage_capture_abs <repo_dir> [sh|ts] — the in-repo absolute path of the capture script.
usage_capture_abs() { _uc_forward abs "$@"; }

# usage_capture_fragment <cli> <repo_dir> — the CLI's capture fragment, rendered.
usage_capture_fragment() { _uc_forward fragment "$@"; }

# usage_capture_rewrite <cli> <config> <repo_dir> — legacy commands to the direct form.
usage_capture_rewrite() { _uc_forward rewrite "$@"; }

# usage_capture_footprint <cli> <config> — the JSON array of capture handlers; 2 on unparsable JSON.
usage_capture_footprint() { _uc_forward footprint "$@"; }

# usage_capture_paths <cli> <config> — the registered capture script paths, one per line.
usage_capture_paths() { _uc_forward paths "$@"; }

# usage_capture_state <cli> <config> — `absent` or `installed`.
usage_capture_state() { _uc_forward state "$@"; }

# usage_capture_reinject <cli> <config> <footprint_json> — strip, then add back the footprint.
usage_capture_reinject() { _uc_forward reinject "$@"; }

# usage_capture_disclose <cli> <config> <repo_dir> — the pre-write disclosure.
usage_capture_disclose() { _uc_forward disclose "$@"; }

# usage_capture_enable <cli> <config> <repo_dir> — register the fragment.
usage_capture_enable() { _uc_forward enable "$@"; }

# usage_capture_keep <cli> <config> <repo_dir> — one capture handler per event, re-pointed.
usage_capture_keep() { _uc_forward keep "$@"; }

# usage_capture_remove <cli> <config> — delete every capture handler.
usage_capture_remove() { _uc_forward remove "$@"; }

# usage_capture_apply <cli> <config> <repo_dir> <state> <answer> — the mapping of a prompt answer.
usage_capture_apply() { _uc_forward apply "$@"; }

# render_session_recording_manifest <cli> <repo_dir> <manifest_src> <out_file> — sets
# SR_TRANSCRIPT_WIRED. A stale 1 must never survive a run that rendered nothing, so it
# is reset to 0 first, as the original did.
render_session_recording_manifest() {
  # shellcheck disable=SC2034  # read by the setup scripts after this call
  SR_TRANSCRIPT_WIRED=0
  _uc_forward_result render-session-recording-manifest "$@"
}

# merge_session_recording_hooks <cli> <config> <patched_manifest> [<env_patch_json>] —
# sets SR_ALL_HOOKS_DISABLED when the entry ran.
merge_session_recording_hooks() { _uc_forward_result merge-session-recording-hooks "$@"; }
