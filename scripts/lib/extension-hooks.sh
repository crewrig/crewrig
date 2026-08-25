#!/usr/bin/env bash
# scripts/lib/extension-hooks.sh — the shared neutral-hook translator (spec
# 0179, issue #1005). Sourced by scripts/build-extension.sh; do NOT execute
# directly. Requires: jq.
#
# An extension declares every hook once in the generic top-level `hooks`
# section (R1): an ARRAY of entries, each carrying a stable `id`, exactly one
# neutral `event`, one `command`, and optionally a neutral tool-class
# `matcher`, a `timeLimit` (seconds, the canonical unit) and a human
# `description`. This library owns the WHOLE neutral-to-native translation
# for all four targets, so no per-CLI builder renders its own hooks (0063
# delta-01 R18, 0065 delta-01 R9).
#
# THE CONSTANTS-VS-MAPPING BOUNDARY (read before editing either side). What
# THIS FILE knows about the VOCABULARY — which neutral event/matcher-class
# corresponds to which target's own name — lives in the case-dispatch
# functions below and NOWHERE else. What scripts/lib/extension-targets.json
# knows about each TARGET — its shell-tool name, time unit, root-token form,
# hook file, and match-all form — are per-target CONSTANTS, read from that
# file. The vocabulary mapping stays out of that descriptor for two reasons
# (see its own header for the full statement): (a) R5 obliges the
# correspondence artifact to carry per-column evidence prose that has
# nowhere to live in a terse JSON row; (b) the descriptor is a three-ticket
# additive-only shared file (#1005/#1006/#1007), and folding hook-specific
# vocabulary into it would couple siblings' unrelated columns to it. Keep
# the two representations independent.
#
# CLOSED NEUTRAL VOCABULARY (R4 — evidence-backed; grow only with a matching
# row in docs/extension-hook-events.md and a probe record in
# docs/runbooks/extension-hook-probe.md):
#   Events:  PreToolUse (maps everywhere), UserPromptSubmit (no Antigravity
#            counterpart).
#   Matcher classes: shell (the shell/bash tool on every target).
#
# Public surface:
#   ext_hooks_validate <manifest>                         (R3/R4/R7/R8)
#   ext_hooks_render <target> <manifest> <ext_dir> <out_root>  (R9/R10/R11)
#   ext_hooks_gaps <target> <manifest>                     (R14)
#
# Bash 3.2 only: no associative arrays; case/function dispatch, matching the
# idiom scripts/build-extension.sh already uses.

EXT_HOOKS_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_HOOKS_TARGETS_JSON="$EXT_HOOKS_LIB_DIR/extension-targets.json"

# --- Closed vocabulary (the ONLY place the mapping lives) -------------------
#
# Both literals below are the SINGLE source for their set: the predicate
# functions and the enumeration function each derive from the same literal
# rather than restating it, so scripts/check-extension-hook-map.sh's R6
# agreement check can enumerate "the translator's own closed set at check
# time" (plan step 18) by calling ext_hooks_known_events — growing the set
# here is what a growth mutation (step 24d) actually exercises.
EXT_HOOKS_KNOWN_EVENTS="PreToolUse UserPromptSubmit"
EXT_HOOKS_KNOWN_MATCHER_CLASSES="shell"

_ext_hooks_known_event() {
  local e="$1" known
  for known in $EXT_HOOKS_KNOWN_EVENTS; do
    [ "$e" = "$known" ] && return 0
  done
  return 1
}

_ext_hooks_known_matcher_class() {
  local c="$1" known
  for known in $EXT_HOOKS_KNOWN_MATCHER_CLASSES; do
    [ "$c" = "$known" ] && return 0
  done
  return 1
}

# ext_hooks_known_events — echoes the closed neutral event set, one per line.
# Public precisely so scripts/check-extension-hook-map.sh can enumerate the
# translator's own domain rather than hand-writing a fixture (step 18).
ext_hooks_known_events() {
  local e
  for e in $EXT_HOOKS_KNOWN_EVENTS; do
    echo "$e"
  done
}

# _ext_hooks_matcher_accepting <neutral-event> — does at least one target
# accept a matcher on this neutral event at all (R8, first sentence)?
_ext_hooks_matcher_accepting() {
  case "$1" in
    PreToolUse) return 0 ;;
    *) return 1 ;;
  esac
}

# _ext_hooks_target_event <neutral-event> <target> — echoes the target's own
# event name, or nothing (empty stdout) when there is no counterpart. This
# function, and this function alone, is docs/extension-hook-events.md's
# "Correspondence table" expressed as code.
_ext_hooks_target_event() {
  local event="$1" target="$2"
  case "$target:$event" in
    claude:PreToolUse) echo "PreToolUse" ;;
    claude:UserPromptSubmit) echo "UserPromptSubmit" ;;
    gemini:PreToolUse) echo "BeforeTool" ;;
    gemini:UserPromptSubmit) echo "BeforeAgent" ;;
    copilot:PreToolUse) echo "preToolUse" ;;
    copilot:UserPromptSubmit) echo "userPromptSubmitted" ;;
    antigravity:PreToolUse) echo "PreToolUse" ;;
    antigravity:UserPromptSubmit) : ;; # no counterpart
    *) : ;;
  esac
}

# _ext_hooks_matcher_tool <neutral-class> <target> — echoes the target's own
# tool name/pattern for the neutral matcher class, or nothing when the class
# has no counterpart on that target. docs/extension-hook-events.md's
# "Neutral tool-class matcher" table expressed as code; sourced from
# extension-targets.json's shellTool row (a per-target CONSTANT, not part of
# the vocabulary mapping itself — R6's boundary).
_ext_hooks_matcher_tool() {
  local class="$1" target="$2"
  case "$class" in
    shell) jq -r --arg t "$target" '.[$t].shellTool // empty' "$EXT_HOOKS_TARGETS_JSON" ;;
    *) : ;;
  esac
}

_ext_hooks_target_const() {
  # _ext_hooks_target_const <target> <field>
  local target="$1" field="$2"
  jq -r --arg t "$target" --arg f "$field" '.[$t][$f] // empty' "$EXT_HOOKS_TARGETS_JSON"
}

# --- Validation (R3/R4/R7/R8) -----------------------------------------------

ext_hooks_validate() {
  # ext_hooks_validate <manifest> — prints VALIDATION-ERROR lines to stderr
  # and returns non-zero on any offense; silent and returns 0 when clean, or
  # when no `hooks` section is declared at all (R1: omitting it stays valid).
  local manifest="$1" errors=0
  jq -e 'has("hooks") and (.hooks != null)' "$manifest" >/dev/null 2>&1 || return 0

  if ! jq -e '.hooks | type == "array"' "$manifest" >/dev/null 2>&1; then
    echo "VALIDATION-ERROR: $manifest — the generic 'hooks' section must be an array of hook entries" >&2
    return 1
  fi

  local n count
  count="$(jq '.hooks | length' "$manifest")"
  n=0
  while [ "$n" -lt "$count" ]; do
    local entry id event matcher command has_matcher
    entry="$(jq -c ".hooks[$n]" "$manifest")"
    id="$(jq -r '.id // empty' <<< "$entry")"
    event="$(jq -r '.event // empty' <<< "$entry")"
    command="$(jq -r '.command // empty' <<< "$entry")"
    has_matcher="$(jq -e 'has("matcher") and (.matcher != null)' <<< "$entry" >/dev/null 2>&1 && echo true || echo false)"
    matcher="$(jq -r '.matcher // empty' <<< "$entry")"

    if [ -z "$id" ]; then
      echo "VALIDATION-ERROR: $manifest — hooks[$n] is missing required field 'id'" >&2
      errors=$((errors + 1))
    elif ! [[ "$id" =~ ^[A-Za-z0-9._-]+$ ]]; then
      echo "VALIDATION-ERROR: $manifest — hooks[$n].id '$id' must match ^[A-Za-z0-9._-]+\$" >&2
      errors=$((errors + 1))
    fi
    if [ -z "$event" ]; then
      echo "VALIDATION-ERROR: $manifest — hooks[$n] (id '$id') is missing required field 'event'" >&2
      errors=$((errors + 1))
    elif ! _ext_hooks_known_event "$event"; then
      echo "VALIDATION-ERROR: $manifest — hooks[$n] (id '$id') declares event '$event', outside the admissible set {PreToolUse, UserPromptSubmit}" >&2
      errors=$((errors + 1))
    fi
    if [ -z "$command" ]; then
      echo "VALIDATION-ERROR: $manifest — hooks[$n] (id '$id') is missing required field 'command'" >&2
      errors=$((errors + 1))
    fi
    if [ "$has_matcher" = "true" ]; then
      if ! _ext_hooks_known_matcher_class "$matcher"; then
        echo "VALIDATION-ERROR: $manifest — hooks[$n] (id '$id') declares matcher '$matcher', outside the admissible set {shell}" >&2
        errors=$((errors + 1))
      elif [ -n "$event" ] && ! _ext_hooks_matcher_accepting "$event"; then
        echo "VALIDATION-ERROR: $manifest — hooks[$n] (id '$id') declares a matcher on event '$event', which accepts none" >&2
        errors=$((errors + 1))
      fi
    fi
    n=$((n + 1))
  done
  [ "$errors" -eq 0 ]
}

# --- Gaps (R14) --------------------------------------------------------

ext_hooks_gaps() {
  # ext_hooks_gaps <target> <manifest> — echoes one compact JSON object per
  # line to STDOUT for each declared hook whose neutral event, or whose
  # neutral matcher class, has no counterpart on <target> (the caller
  # redirects this to the gap collector, build-extension.sh's fd 3), and
  # prints a human-readable build WARNING to stderr for the same entry (R14
  # scenario: "the build succeeds with a warning naming the hook, the event
  # and the target" — the observed-gap-set entry alone is not that warning).
  local target="$1" manifest="$2"
  jq -e 'has("hooks") and (.hooks != null) and (.hooks | type == "array")' "$manifest" >/dev/null 2>&1 || return 0

  local n count
  count="$(jq '.hooks | length' "$manifest")"
  n=0
  while [ "$n" -lt "$count" ]; do
    local entry id event matcher has_matcher target_event target_tool
    entry="$(jq -c ".hooks[$n]" "$manifest")"
    id="$(jq -r '.id // empty' <<< "$entry")"
    event="$(jq -r '.event // empty' <<< "$entry")"
    has_matcher="$(jq -e 'has("matcher") and (.matcher != null)' <<< "$entry" >/dev/null 2>&1 && echo true || echo false)"
    matcher="$(jq -r '.matcher // empty' <<< "$entry")"
    n=$((n + 1))

    target_event="$(_ext_hooks_target_event "$event" "$target")"
    if [ -z "$target_event" ]; then
      echo "Warning: hook '$id' declares event '$event', which has no counterpart on target '$target'" >&2
      jq -c -n --arg subject hooks --arg target "$target" --arg hook "$id" --arg event "$event" --arg part event \
        --arg reason "neutral event has no counterpart on this target" \
        '{subject: $subject, target: $target, hook: $hook, event: $event, part: $part, reason: $reason}'
      continue
    fi
    if [ "$has_matcher" = "true" ]; then
      target_tool="$(_ext_hooks_matcher_tool "$matcher" "$target")"
      if [ -z "$target_tool" ]; then
        echo "Warning: hook '$id' (event '$event') declares matcher '$matcher', which has no counterpart on target '$target'" >&2
        jq -c -n --arg subject hooks --arg target "$target" --arg hook "$id" --arg event "$event" --arg part matcher \
          --arg reason "neutral matcher class has no counterpart on this target" \
          '{subject: $subject, target: $target, hook: $hook, event: $event, part: $part, reason: $reason}'
      fi
    fi
  done
}

# --- Rendering (R9/R10/R11/R12) -----------------------------------------

# _ext_hooks_resolve_command <command> <target> — substitutes the neutral
# extension-root token GLOBALLY (R11: a command may name it more than once)
# with the target's own resolved form. Antigravity has no path variable, so
# the token (AND a trailing path separator, if any — the token is normally
# written "${extensionRoot}/hooks/handler.sh") is replaced with nothing,
# leaving a working-directory-relative command; a bare trailing token with
# no separator is also handled, so neither shape leaves a stray "/".
EXT_HOOKS_NEUTRAL_ROOT_TOKEN='${extensionRoot}'

_ext_hooks_resolve_command() {
  local command="$1" target="$2" root_token resolved token_with_slash
  root_token="$(_ext_hooks_target_const "$target" rootToken)"
  if [ -n "$root_token" ]; then
    resolved="${command//$EXT_HOOKS_NEUTRAL_ROOT_TOKEN/$root_token}"
  else
    token_with_slash="${EXT_HOOKS_NEUTRAL_ROOT_TOKEN}/"
    resolved="${command//$token_with_slash/}"
    resolved="${resolved//$EXT_HOOKS_NEUTRAL_ROOT_TOKEN/}"
  fi
  printf '%s' "$resolved"
}

# _ext_hooks_resolved_entries <target> <manifest> — echoes one compact JSON
# object per line, one per hook entry that HAS a counterpart on <target>:
# {event, hasMatcher, matcher, command}. `hasMatcher` is false when the
# neutral event never carries a matcher on any target (no key emitted at
# all downstream); true otherwise, with `matcher` set either to the
# author's declared tool class resolved to this target's own tool name, OR
# — when the author omitted the matcher on a matcher-accepting event — to
# the target's own MATCH-ALL form (R8, second sentence: an omitted matcher
# on a matcher-accepting event matches every tool, expressed in each
# target's own match-all spelling, e.g. "" for Claude, ".*" elsewhere).
# Entries with no event counterpart, or whose declared matcher class has no
# counterpart, are silently omitted here (ext_hooks_gaps is what records
# them as observed gaps).
_ext_hooks_resolved_entries() {
  local target="$1" manifest="$2"
  jq -e 'has("hooks") and (.hooks != null) and (.hooks | type == "array")' "$manifest" >/dev/null 2>&1 || return 0

  local n count
  count="$(jq '.hooks | length' "$manifest")"
  n=0
  while [ "$n" -lt "$count" ]; do
    local entry event command has_matcher matcher target_event target_tool resolved_cmd
    entry="$(jq -c ".hooks[$n]" "$manifest")"
    event="$(jq -r '.event // empty' <<< "$entry")"
    command="$(jq -r '.command // empty' <<< "$entry")"
    has_matcher="$(jq -e 'has("matcher") and (.matcher != null)' <<< "$entry" >/dev/null 2>&1 && echo true || echo false)"
    matcher="$(jq -r '.matcher // empty' <<< "$entry")"
    n=$((n + 1))

    target_event="$(_ext_hooks_target_event "$event" "$target")"
    [ -n "$target_event" ] || continue

    if ! _ext_hooks_matcher_accepting "$event"; then
      resolved_cmd="$(_ext_hooks_resolve_command "$command" "$target")"
      jq -c -n --arg event "$target_event" --arg command "$resolved_cmd" \
        '{event: $event, hasMatcher: false, matcher: null, command: $command}'
      continue
    fi

    if [ "$has_matcher" = "true" ]; then
      target_tool="$(_ext_hooks_matcher_tool "$matcher" "$target")"
      [ -n "$target_tool" ] || continue # matcher-class gap on this target
    else
      target_tool="$(_ext_hooks_target_const "$target" matchAll)"
    fi

    resolved_cmd="$(_ext_hooks_resolve_command "$command" "$target")"
    jq -c -n --arg event "$target_event" --arg matcher "$target_tool" --arg command "$resolved_cmd" \
      '{event: $event, hasMatcher: true, matcher: $matcher, command: $command}'
  done
}

# ext_hooks_render <target> <manifest> <ext_dir> <out_root> — writes the
# target's own hook file into <out_root> when at least one declared hook has
# a counterpart on <target>. Writes nothing (not even an empty file) when no
# hooks are declared, or none map on this target (a pure-gap declaration).
ext_hooks_render() {
  local target="$1" manifest="$2" ext_dir="$3" out_root="$4"
  local resolved_file hook_file
  resolved_file="$(mktemp)"
  _ext_hooks_resolved_entries "$target" "$manifest" > "$resolved_file"

  if [ ! -s "$resolved_file" ]; then
    rm -f "$resolved_file"
    return 0
  fi

  hook_file="$(_ext_hooks_target_const "$target" hookFile)"
  mkdir -p "$out_root/$(dirname "$hook_file")"

  case "$target" in
    claude|gemini)
      # Envelope, grouped by event: one matcher-group per resolved entry
      # (R9 — the incumbent grouped shape). `hasMatcher: false` (a
      # non-tool event, e.g. UserPromptSubmit) omits the `matcher` key
      # entirely — Gemini's own convention. `hasMatcher: true` always
      # emits the key, even when its value is Claude's own empty-string
      # match-all spelling (its transcript-hook convention).
      jq -s '
        reduce .[] as $e ({};
          .[$e.event] += [
            ($e | {hooks: [{type: "command", command: .command}]}
                  + (if .hasMatcher then {matcher: .matcher} else {} end))
          ]
        ) | {hooks: .}
      ' "$resolved_file" > "$out_root/$hook_file"
      ;;
    antigravity)
      # Named-hook map; PreToolUse is the only neutral event with an
      # Antigravity counterpart today, so only the grouped tool-event form
      # is exercised (R9: "Antigravity groups tool events with a matcher
      # and writes lifecycle events flat" — the flat form has no live
      # caller in the current closed vocabulary).
      jq -s --arg id "$(jq -r '.name' "$manifest")-hooks" '
        reduce .[] as $e ({};
          .[$id][$e.event] += [
            ($e | {matcher: .matcher, hooks: [{type: "command", command: .command}]})
          ]
        )
      ' "$resolved_file" > "$out_root/$hook_file"
      ;;
    copilot)
      # Flat: hooks.<event> is an array of handler objects, each carrying
      # its own inline matcher (R9 — Copilot's own confirmed shape, distinct
      # from the grouped form of the other three targets).
      jq -s '
        reduce .[] as $e ({};
          .[$e.event] += [
            ($e | {type: "command"}
                  + (if .hasMatcher then {matcher: .matcher} else {} end)
                  + {command: .command})
          ]
        ) | {version: 1, disableAllHooks: false, hooks: .}
      ' "$resolved_file" > "$out_root/$hook_file"
      ;;
  esac
  rm -f "$resolved_file"
}
