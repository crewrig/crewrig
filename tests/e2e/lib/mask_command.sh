#!/usr/bin/env bash
# tests/e2e/lib/mask_command.sh - mask value-bearing assignments in a
# harness command before it is embedded in a published verdict (spec 0194
# finding v2-F3; DEV-stage tester audit, #1103).
#
# The effective `command` array for a CLI comes from the developer's own
# tests/e2e/local.toml (gitignored, per-machine) - a shell wrapper that may
# carry an inline secret (`OLLAMA_API_KEY=...`, `--api-key=...`, etc.). Any
# probe that publishes that array verbatim in a forge comment (R11, R15)
# must mask such assignments first; R4 governs credential material and this
# is a harness command putting it on a public forge.
#
# History: the first implementation split each command-array element on
# a plain space and masked whole WORDS matching an identifier-start
# pattern. The DEV-stage tester audit found two bypasses: (a) a
# `--flag=value` shaped secret never matched (the pattern required a bare
# identifier start, not a dash), and (b) a quoted value containing a space
# (`KEY="secret with spaces"`) was split across multiple words by the
# naive space-split, so only the first fragment got masked. This
# implementation replaces per-word splitting with a single regex
# substitution over the WHOLE string, so no tokenization step exists to
# disagree with shell quoting in the first place.
#
# Contract:
#   e2e_mask_command_string <raw-string>
#     Echoes <raw-string> with every value-bearing assignment
#     (an optionally dash-prefixed identifier, then `=`, then a value)
#     replaced by `IDENTIFIER=***`. The value may be unquoted (no
#     whitespace), or single- or double-quoted (may contain spaces).
#     Assignments are recognised at the start of the string or right
#     after whitespace, a quote character, or a shell separator/operator
#     (`;`, `&`, `|`, `(`) - the set of characters that can legitimately
#     precede an assignment inside a `bash -c "..."` wrapper. A flag or
#     word with no `=` (`--model foo`, `ollama launch copilot`) is left
#     untouched - masking targets `=`-joined assignments only, per the
#     finding's own scope.
#
#   e2e_mask_command_json
#     Reads a JSON array of strings on stdin, echoes a JSON array of
#     strings with each element passed through e2e_mask_command_string.
#     Assumes no element contains an embedded newline - the `command`
#     array holds argv-shaped shell strings in this codebase, never
#     multi-line text.

set -o nounset

e2e_mask_command_string() {
  local raw="$1"
  printf '%s' "$raw" | sed -E 's/(^|[[:space:];&|(\"'"'"'])(-{0,2}[A-Za-z_][A-Za-z0-9_-]*)=(\"[^\"]*\"|'"'"'[^'"'"']*'"'"'|[^[:space:]]*)/\1\2=***/g'
}

e2e_mask_command_json() {
  local json
  json="$(cat)"
  local -a elements=()
  local line
  while IFS= read -r line; do
    elements+=("$(e2e_mask_command_string "$line")")
  done < <(jq -r '.[]' <<<"$json")
  # `--` after --args is load-bearing, not decorative: jq re-parses a
  # positional argument that merely LOOKS like a flag (e.g. an element
  # literally "-c") as one of its own options even after --args, silently
  # dropping it from $ARGS.positional (reproduced: `--args bash -c foo sh`
  # yields only 3 elements). `--` stops that re-parsing.
  jq -c -n '$ARGS.positional' --args -- ${elements[@]+"${elements[@]}"}
}
