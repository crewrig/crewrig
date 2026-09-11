#!/usr/bin/env bash
# tests/e2e/lib/probe_spawn_markers.sh — CLI-generated spawn-result marker
# detection for probe A (05-copilot-model-routing) and probe B
# (06-agent-surface-consumption), spec 0194 R14 hardening (issue #1107 fix
# 1; analysis comment on #1103, comment 5510288859).
#
# Why this exists: the prior observable greps the per-leg/per-cell nonce in
# an orchestrator-writable file (leg.txt / consumed.txt) or in raw
# transcript text anywhere. Live run 20260902T132406Z-088f proved that
# forgeable: on two failing legs, the orchestrating session read the nonce
# straight out of the agent declaration after the subagent produced no
# response, and wrote it itself — `nonce_observed: true` was recorded on
# legs whose own spawn markers read
#   ✗ Probe-router(<model>) … Agent completed but produced no response.
# Anything the orchestrator can read (the declaration), it can fake. This
# module moves the primary observable to the CLI-generated spawn-result
# markers in the session transcript, which the orchestrating model does
# not control:
#
#   ● <AgentName>(<model>) <title>
#     └ <verbatim subagent reply>
#
# renders on a successful spawn whose subagent actually answered; a failed
# one renders
#
#   ✗ <AgentName>(<model>) <title>
#     └ Agent completed but produced no response.
#
# Also observed live: a `●` "Agent started in background with agent_id:
# …" acknowledgement — a scheduling ack, not a reply — and `└ idle` under a
# "Read (<AgentName> agent — …)" status block, neither of which is this
# module's spawn-marker shape (the latter doesn't match `<AgentName>(`) and
# neither counts as a response even when it does.
#
# Gold fixtures for all three shapes — one genuine success, two genuine
# orchestrator-forged failures, captured from the run above — live under
# scripts/tests/fixtures/probe-a-transcripts/. scripts/tests/test-e2e-
# probes.sh exercises this function directly against them.
#
# e2e_probe_spawn_signals <transcript-file> <agent-display-name> <nonce>
#   Pure function over the given file's content — no other I/O, no env-var
#   preconditions, safe to call with a missing/unreadable file. Echoes on
#   stdout:
#     "<spawn_observed>|<subagent_responded>|<nonce_in_spawn_result>|<model>"
#
#   spawn_observed        — a `●`/`✗ <agent-display-name>(<model>) …` line
#                            was found (case-insensitive on the agent
#                            name).
#   subagent_responded    — true if ANY such spawn block's result line
#                            carries content other than a known
#                            no-response placeholder ("Agent completed but
#                            produced no response.", "idle", "Agent
#                            started in background…").
#   nonce_in_spawn_result — <nonce> appears inside a spawn block's OWN
#                            result line — never credited from anywhere
#                            else in the transcript. This is the fix: the
#                            prior implementation credited the nonce from
#                            leg.txt, which the orchestrator can write by
#                            hand after a failed spawn.
#   model                 — the LAST spawn block's captured model label, or
#                            "" if no spawn was observed.
#
#   All three boolean outputs are the literal strings "true"/"false".
#
# Portability: no `mapfile`, no bracket-expression matching on the
# multi-byte glyphs (locale-sensitive matching under a C/POSIX locale) —
# glyph checks are plain `case` prefix globs, which compare bytes
# literally regardless of locale. Verified against bash 3.2 (macOS system
# /bin/bash) and under LC_ALL=C.

set -o nounset

# _e2e_probe_spawn_trim <string> — strip leading whitespace. Plain
# parameter-expansion glob trimming (no extglob needed) — portable to
# bash 3.2.
_e2e_probe_spawn_trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  printf '%s' "$s"
}

e2e_probe_spawn_signals() {
  local file="$1" agent="$2" nonce="$3"
  local spawn_observed=false subagent_responded=false nonce_in_result=false model=""

  if [[ ! -r "$file" ]]; then
    printf 'false|false|false|\n'
    return 0
  fi

  local agent_lc
  agent_lc="$(printf '%s' "$agent" | tr '[:upper:]' '[:lower:]')"

  # Fast path for Claude Code structured JSON output (--output-format json).
  # Claude Code's engine populates .subagent_stats.by_type[<agent>] directly,
  # which cannot be forged or hallucinated by the model.
  if command -v jq >/dev/null 2>&1; then
    if jq -e '.subagent_stats' "$file" >/dev/null 2>&1; then
      local spawned completed errored
      spawned="$(jq -r --arg a "$agent_lc" '
        [(.subagent_stats.by_type // {}) | to_entries[] | select((.key | ascii_downcase) == $a) | if (.value | type) == "object" then (.value.spawned // 0) else (.value // 0) end] | add // 0
      ' "$file" 2>/dev/null || echo 0)"
      completed="$(jq -r --arg a "$agent_lc" '
        . as $root
        | [(.subagent_stats.by_type // {}) | to_entries[] | select((.key | ascii_downcase) == $a) | if (.value | type) == "object" then (.value.completed // 0) else (if (($root.subagent_stats.completed // $root.subagent_stats.total_completed // 0) > 0 and ($root.subagent_stats.failed // $root.subagent_stats.total_errored // 0) == 0) then (.value // 0) else 0 end) end] | add // 0
      ' "$file" 2>/dev/null || echo 0)"
      errored="$(jq -r --arg a "$agent_lc" '
        . as $root
        | [(.subagent_stats.by_type // {}) | to_entries[] | select((.key | ascii_downcase) == $a) | if (.value | type) == "object" then (.value.errored // 0) else ($root.subagent_stats.failed // $root.subagent_stats.total_errored // 0) end] | add // 0
      ' "$file" 2>/dev/null || echo 0)"
      if [[ "${spawned:-0}" -gt 0 ]]; then
        spawn_observed=true
      fi
      if [[ "${completed:-0}" -gt 0 && "${errored:-0}" -eq 0 ]]; then
        subagent_responded=true
      fi
      if [[ "$spawn_observed" == "true" && "$subagent_responded" == "true" ]]; then
        if grep -Fq "$nonce" "$file" 2>/dev/null; then
          nonce_in_result=true
        fi
      fi
      model="$(jq -r '(.modelUsage // {}) | keys | .[0] // "claude"' "$file" 2>/dev/null || echo "claude")"
      printf '%s|%s|%s|%s\n' "$spawn_observed" "$subagent_responded" "$nonce_in_result" "$model"
      return 0
    fi
  fi

  # Split any marker glued mid-line onto its own line — observed live:
  # "...output.✗ Probe-router(sonnet) ..." with no newline between the
  # prior sentence and the glyph — so a line-oriented walk cannot miss it.
  # Literal-byte substitution (not a bracket expression), safe under any
  # locale.
  local normalized
  normalized="$(sed -e 's/✗/\'$'\n''✗/g' -e 's/●/\'$'\n''●/g' "$file" 2>/dev/null || true)"

  local expect_result=false line
  while IFS= read -r line || [[ -n "$line" ]]; do
    local trimmed
    trimmed="$(_e2e_probe_spawn_trim "$line")"
    case "$trimmed" in
      ✗*|●*)
        local trimmed_lc
        trimmed_lc="$(printf '%s' "$trimmed" | tr '[:upper:]' '[:lower:]')"
        case "$trimmed_lc" in
          *"${agent_lc}("*)
            spawn_observed=true
            expect_result=true
            model="${trimmed#*(}"
            model="${model%%)*}"
            ;;
          *)
            expect_result=false
            ;;
        esac
        ;;
      *"└"*)
        if [[ "$expect_result" == "true" ]]; then
          local result
          result="${trimmed#*└}"
          result="$(_e2e_probe_spawn_trim "$result")"
          case "$result" in
            "Agent completed but produced no response."|idle|"Agent started in background"*) ;;
            *) subagent_responded=true ;;
          esac
          case "$trimmed" in
            *"$nonce"*) nonce_in_result=true ;;
          esac
        fi
        expect_result=false
        ;;
      *)
        expect_result=false
        ;;
    esac
  done <<EOF
$normalized
EOF

  printf '%s|%s|%s|%s\n' "$spawn_observed" "$subagent_responded" "$nonce_in_result" "$model"
}
