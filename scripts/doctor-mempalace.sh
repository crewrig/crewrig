#!/usr/bin/env bash
# scripts/doctor-mempalace.sh — Report which MemPalace will actually answer on
# this machine, and flag any divergence (spec 0108 R7-R10).
#
# Three questions, three labelled sections, all derived from what resolves at
# the moment of invocation — never from an enumeration of known Python package
# managers (R9). A MemPalace placed by a mechanism the framework has never heard
# of is reported like any other.
#
#   1. "What a session actually launches" — for each of the four CLI MCP
#      registration files, the wrapper and interpreter the argv actually names,
#      the checkout that wrapper lives in, the pin that checkout declares, and
#      the version that interpreter serves. The discriminator is the
#      concatenation `[.command] + .args`, NOT a position inside `.args`: some
#      registrations put the interpreter in `.command` with the wrapper as
#      args[0], others put `bash` in `.command` with the tls-exec.sh wrapper and
#      the interpreter inside `.args`.
#   2. "What resolves on your PATH" — for each of `mempalace` and
#      `mempalace-mcp`, the resolved path, its realpath, the interpreter read
#      from its shebang, and the version that interpreter serves.
#   3. "What a fresh setup would select" — the ordered interpreter candidate
#      list, the winner, and an explicit line when the winner is not the
#      highest-priority candidate (R10). This is what the NEXT setup run would
#      pick; it is not what any running session uses.
#
# This script only ever READS. It mutates no install and no CLI config, per the
# spec's "the diagnostic reports; it does not mutate" scope boundary.
#
# Exit status (R8): non-zero when any two reported versions differ, when any
# reported version lies outside the pin it was checked against, or when any two
# reported pins differ. A GUARD ABSENT / UNGUARDED label is reported loudly but
# is not on its own a non-zero condition — a pre-guard checkout is the expected
# state on every machine until setup is re-run.
#
# Usage:
#   bash scripts/doctor-mempalace.sh
#   task mempalace:doctor

# -e intentionally omitted: this is an aggregating diagnostic. Every probe is
# allowed to fail and be reported; the accumulated verdict controls the exit.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
. "${SCRIPT_DIR}/lib/common.sh"

LOCAL_PIN_MODULE="${SCRIPT_DIR}/lib/mempalace_pin.py"
LOCAL_COMMON_SH="${SCRIPT_DIR}/lib/common.sh"
WRAPPER_BASENAME="mempalace-http-wrapper.py"

# R4 — printed unconditionally at the end, on every outcome.
RESTART_NOTE="A memory-server session that is already running keeps serving the
  MemPalace version it started with. Running sessions must be restarted before
  any change to the install takes effect — including a change this report
  prompts you to make."

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required to read the CLI MCP registration files." >&2
  echo "       Install with: brew install jq (macOS) or apt-get install jq" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

# --- Accumulated state -------------------------------------------------------
# Newline-separated, TAB-separated records rather than arrays: a bash-3.2-safe
# shape that needs no empty-array guards under `set -u`.
REPORTED_VERSIONS=""   # <label>\t<version>
REPORTED_PINS=""       # <label>\t<min>,<max>
FAILURE_NOTES=""
FAILURES=0
PROBE_SEQ=0

note_failure() {
  FAILURES=$((FAILURES + 1))
  FAILURE_NOTES="${FAILURE_NOTES}  - $1"$'\n'
}

record_version() {
  REPORTED_VERSIONS="${REPORTED_VERSIONS}$1"$'\t'"$2"$'\n'
}

record_pin() {
  REPORTED_PINS="${REPORTED_PINS}$1"$'\t'"$2"$'\n'
}

tildify() {
  printf '%s' "${1/#$HOME/\~}"
}

field() {
  printf '    %-24s%s\n' "$1" "$2"
}

# run_probe <interpreter> <pin_module>
# Runs the pin module's --probe mode under the given interpreter and echoes the
# path of the captured output. Failure yields an empty capture, which every
# probe_get below reports as "unknown".
run_probe() {
  PROBE_SEQ=$((PROBE_SEQ + 1))
  local out="${TMP_ROOT}/probe.${PROBE_SEQ}"
  : > "$out"
  "$1" "$2" --probe >"$out" 2>/dev/null || true
  printf '%s' "$out"
}

probe_get() {
  local value
  value="$(grep -E "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2-)"
  if [ -z "$value" ]; then
    printf 'unknown'
  else
    printf '%s' "$value"
  fi
}

# resolve_symlink <path>
# Prints the path with every symlink hop followed and the directory component
# normalised. Hand-rolled rather than `readlink -f`, which BSD readlink lacks on
# older macOS — the two supported platforms must report the same fact.
resolve_symlink() {
  local target="$1" link hops=0
  while [ -L "$target" ] && [ "$hops" -lt 32 ]; do
    link="$(readlink "$target")"
    case "$link" in
      /*) target="$link" ;;
      *)  target="$(dirname "$target")/${link}" ;;
    esac
    hops=$((hops + 1))
  done
  local dir
  dir="$(cd "$(dirname "$target")" 2>/dev/null && pwd -P)"
  if [ -z "$dir" ]; then
    printf '%s' "$target"
  else
    printf '%s/%s' "$dir" "$(basename "$target")"
  fi
}

# shebang_interpreter <console-script-path>
# Reads the interpreter out of a console script's shebang as TEXT — the same
# read detect_mempalace_python performs — and never execs the script itself.
# An `#!/usr/bin/env python3` form is resolved to its second token, since the
# first one would otherwise swallow the script argument.
shebang_interpreter() {
  local first second line
  line="$(head -1 "$1" 2>/dev/null)"
  case "$line" in
    '#!'*) ;;
    *) return 1 ;;
  esac
  line="${line#\#!}"
  # shellcheck disable=SC2086  # deliberate word split of the shebang line
  set -- $line
  first="${1:-}"
  second="${2:-}"
  case "$(basename "${first:-none}")" in
    env)
      [ -n "$second" ] || return 1
      printf '%s' "$second"
      ;;
    *)
      [ -n "$first" ] || return 1
      printf '%s' "$first"
      ;;
  esac
}

# evaluate <label> <interpreter> <pin_module> <common_sh> <probe_capture>
# Prints the pin, the served version, the __version__ agreement note, whether
# packaging is importable, and the range verdict — then records the version and
# the pin for the cross-source divergence check, and notes a failure when the
# version is out of range or a fact could not be obtained.
evaluate() {
  local label="$1" interp="$2" pin_module="$3" common_sh="$4" probe="$5"
  local dist attr has_packaging pin_line verdict rc

  dist="$(probe_get "$probe" dist)"
  attr="$(probe_get "$probe" attr)"
  has_packaging="$(probe_get "$probe" packaging)"

  pin_line="$("$interp" "$pin_module" --common-sh "$common_sh" --print-pin 2>&1)"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    field "pin:" "UNREADABLE from $(tildify "$common_sh") — $pin_line"
    note_failure "$label: the supported-version pin could not be read from $(tildify "$common_sh")"
    return
  fi
  local pin_min pin_max
  pin_min="${pin_line#min=}"
  pin_min="${pin_min%% *}"
  pin_max="${pin_line##*max=}"
  field "supported range:" ">=${pin_min},<${pin_max}"
  field "pin declared by:" "$(tildify "$common_sh")"
  record_pin "$label" "${pin_min},${pin_max}"

  field "version served:" "${dist}  (dist-info, resolved in-process)"
  if [ "$attr" = "absent" ] || [ "$attr" = "unknown" ]; then
    field "mempalace.__version__:" "$attr  (no second declaration to compare)"
  elif [ "$attr" = "$dist" ]; then
    field "mempalace.__version__:" "$attr  (agrees with dist-info)"
  else
    field "mempalace.__version__:" "$attr  (DISAGREES with dist-info ${dist})"
    echo "                            note: the module literal is hand-maintained and independent"
    echo "                            of the dist-info field; a .postN rebuild disagrees legitimately."
    echo "                            The launch guard range-checks each on its own and refuses"
    echo "                            neither for disagreeing."
  fi
  field "packaging importable:" "$has_packaging"

  if [ "$dist" = "absent" ] || [ "$dist" = "unknown" ]; then
    field "verdict:" "NO VERSION — this interpreter resolves no mempalace distribution"
    note_failure "$label: no mempalace version is resolvable from ${interp}"
    return
  fi

  verdict="$("$interp" "$pin_module" --common-sh "$common_sh" --check "$dist" 2>&1)"
  rc=$?
  field "verdict:" "$verdict"
  record_version "$label" "$dist"
  if [ "$rc" -ne 0 ]; then
    note_failure "$label: ${dist} lies outside >=${pin_min},<${pin_max} (${interp})"
  fi
}

# ---------------------------------------------------------------------------
echo "MemPalace doctor — which MemPalace will actually answer on this machine"
echo "======================================================================"
echo ""
echo "1. What a session actually launches"
echo "   (the MCP registration each CLI would start a memory server from)"
echo ""

# inspect_registration <cli-label> <config-path>
inspect_registration() {
  local cli="$1" config="$2"
  echo "  ${cli}"
  field "config file:" "$(tildify "$config")"

  if [ ! -f "$config" ]; then
    field "status:" "NOT PRESENT — this CLI has no MCP configuration on this machine"
    echo ""
    return
  fi

  local entry
  entry="$(jq -c '.mcpServers.mempalace // empty' "$config" 2>/dev/null)"
  if [ -z "$entry" ]; then
    field "status:" "NO MEMPALACE ENTRY — this CLI would start no memory server"
    echo ""
    return
  fi

  local argv_display
  argv_display="$(printf '%s' "$entry" | jq -r '([.command] + (.args // [])) | join(" ")' 2>/dev/null)"
  field "argv:" "$argv_display"

  # The invariant is over the whole `[.command] + .args` concatenation: the
  # interpreter is whichever element immediately precedes the wrapper, wherever
  # that pair happens to sit.
  local element prev="" wrapper="" interp=""
  while IFS= read -r element; do
    case "$element" in
      *"/${WRAPPER_BASENAME}"|"${WRAPPER_BASENAME}")
        wrapper="$element"
        interp="$prev"
        break
        ;;
    esac
    prev="$element"
  done < <(printf '%s' "$entry" | jq -r '([.command] + (.args // [])) | .[]' 2>/dev/null)

  if [ -z "$wrapper" ]; then
    field "status:" "UNGUARDED — this argv routes through no MemPalace wrapper at all,"
    echo "                            so no launch-time version guard can run for it"
    echo ""
    return
  fi
  if [ -z "$interp" ]; then
    field "status:" "MALFORMED — the wrapper is the first argv element, so no interpreter"
    echo "                            precedes it; this registration cannot start"
    echo ""
    return
  fi

  # The wrapper file itself, not its grandparent directory: a registration
  # naming a checkout whose `scripts/lib/` survived while the wrapper was
  # deleted leaves the `cd` below perfectly satisfiable, and a session started
  # from that argv cannot launch at all. That breakage shape is exactly what
  # this section exists to surface, so it is tested for directly.
  if [ ! -f "$wrapper" ]; then
    field "status:" "WRAPPER MISSING — ${wrapper} does not resolve on this machine"
    note_failure "${cli}: the registered wrapper ${wrapper} does not exist"
    echo ""
    return
  fi

  local checkout registered_common_sh registered_pin pin_module
  checkout="$(cd "$(dirname "$wrapper")/../.." 2>/dev/null && pwd)"
  # Defensive, and unreachable while the `-f` test above holds: a readable file
  # implies every component of its path is traversable, so this `cd` cannot fail.
  # Kept — rather than letting an empty `checkout` interpolate `/scripts/lib/...`
  # into the paths below — so that a future refactor which drops or weakens that
  # test degrades into a legible status instead of probing the filesystem root.
  if [ -z "$checkout" ]; then
    field "status:" "CHECKOUT UNRESOLVABLE — ${wrapper} exists but its checkout root"
    echo "                            (its grandparent directory) does not resolve"
    note_failure "${cli}: the checkout root above the registered wrapper ${wrapper} does not resolve"
    echo ""
    return
  fi
  registered_common_sh="${checkout}/scripts/lib/common.sh"
  registered_pin="${checkout}/scripts/lib/mempalace_pin.py"

  field "launch wrapper:" "$(tildify "$wrapper")"
  field "registered checkout:" "$(tildify "$checkout")"
  field "registered interpreter:" "$interp"

  if [ ! -x "$interp" ] && ! command -v "$interp" >/dev/null 2>&1; then
    field "status:" "INTERPRETER MISSING — ${interp} does not resolve on this machine"
    note_failure "${cli}: the registered interpreter ${interp} does not resolve"
    echo ""
    return
  fi

  if [ -f "$registered_pin" ]; then
    pin_module="$registered_pin"
    field "guard status:" "PRESENT (evaluated with the registered checkout's own parser)"
  else
    pin_module="$LOCAL_PIN_MODULE"
    field "guard status:" "GUARD ABSENT (pre-guard checkout) — that checkout carries a wrapper"
    echo "                            but no scripts/lib/mempalace_pin.py, so a session it starts"
    echo "                            runs NO launch-time version guard. Evaluated below with THIS"
    echo "                            checkout's parser, under the REGISTERED interpreter and"
    echo "                            against the REGISTERED pin — only the parser code is local."
  fi

  local probe
  probe="$(run_probe "$interp" "$pin_module")"
  evaluate "$cli" "$interp" "$pin_module" "$registered_common_sh" "$probe"
  echo ""
}

inspect_registration "Claude Code"       "${HOME}/.claude.json"
inspect_registration "Gemini CLI"        "${HOME}/.gemini/settings.json"
inspect_registration "GitHub Copilot CLI" "${HOME}/.copilot/mcp-config.json"
inspect_registration "Antigravity CLI"   "${HOME}/.gemini/config/mcp_config.json"

echo "  Files consulted for this section: ~/.claude.json, ~/.gemini/settings.json,"
echo "  ~/.copilot/mcp-config.json, ~/.gemini/config/mcp_config.json. A memory server"
echo "  registered by hand anywhere else is invisible here."
echo ""

# ---------------------------------------------------------------------------
echo "2. What resolves on your PATH"
echo "   (the MemPalace commands an operator would reach from a shell)"
echo ""

inspect_console_script() {
  local name="$1"
  echo "  ${name}"
  local resolved
  resolved="$(command -v "$name" 2>/dev/null)"
  if [ -z "$resolved" ]; then
    field "status:" "ABSENT — not on PATH (reported as absent, not as an error)"
    echo ""
    return
  fi
  field "resolves to:" "$(tildify "$resolved")"
  local real
  real="$(resolve_symlink "$resolved")"
  field "realpath:" "$(tildify "$real")"

  local interp
  interp="$(shebang_interpreter "$real")"
  if [ -z "$interp" ]; then
    field "status:" "NO SHEBANG INTERPRETER — cannot tell which interpreter would run it"
    note_failure "PATH:${name}: no interpreter could be read from its shebang"
    echo ""
    return
  fi
  field "shebang interpreter:" "$interp"

  local probe
  probe="$(run_probe "$interp" "$LOCAL_PIN_MODULE")"
  evaluate "PATH:${name}" "$interp" "$LOCAL_PIN_MODULE" "$LOCAL_COMMON_SH" "$probe"
  echo ""
}

inspect_console_script mempalace
inspect_console_script mempalace-mcp

# ---------------------------------------------------------------------------
echo "3. What a fresh setup would select"
echo "   (what the NEXT setup run would pick — NOT what any running session uses)"
echo ""

CANDIDATE_INDEX=0
FIRST_CANDIDATE=""
WINNER_INDEX=0
WINNER="$(detect_mempalace_python || true)"

while IFS= read -r candidate; do
  [ -n "$candidate" ] || continue
  CANDIDATE_INDEX=$((CANDIDATE_INDEX + 1))
  [ "$CANDIDATE_INDEX" -eq 1 ] && FIRST_CANDIDATE="$candidate"
  if [ -n "$WINNER" ] && [ "$candidate" = "$WINNER" ] && [ "$WINNER_INDEX" -eq 0 ]; then
    WINNER_INDEX="$CANDIDATE_INDEX"
  fi
  if command -v "$candidate" >/dev/null 2>&1; then
    printf '    %d. %s  (resolves)\n' "$CANDIDATE_INDEX" "$candidate"
  else
    printf '    %d. %s  (does not resolve)\n' "$CANDIDATE_INDEX" "$candidate"
  fi
done < <(mempalace_python_candidates)
echo ""

if [ -z "$WINNER" ]; then
  field "selection:" "NONE — no candidate could import mempalace.mcp_server"
  note_failure "fresh setup: detect_mempalace_python selects no interpreter on this machine"
else
  field "selection:" "candidate ${WINNER_INDEX}: ${WINNER}"
  if [ "$WINNER" != "$FIRST_CANDIDATE" ]; then
    # R10 — a fallback to a lower-priority candidate is never silent.
    field "fallback selected:" "YES"
    echo "                            highest-priority candidate 1 (${FIRST_CANDIDATE}) was NOT"
    echo "                            selected; candidate ${WINNER_INDEX} (${WINNER}) was, and the"
    echo "                            version it serves is reported immediately below."
  fi
  SETUP_PROBE="$(run_probe "$WINNER" "$LOCAL_PIN_MODULE")"
  evaluate "fresh-setup-selection" "$WINNER" "$LOCAL_PIN_MODULE" "$LOCAL_COMMON_SH" "$SETUP_PROBE"
fi
echo ""

# ---------------------------------------------------------------------------
echo "Verdict"
echo "-------"
echo ""

DISTINCT_VERSIONS="$(printf '%s' "$REPORTED_VERSIONS" | grep -v '^$' | cut -f2 | sort -u)"
DISTINCT_VERSION_COUNT="$(printf '%s' "$DISTINCT_VERSIONS" | grep -c '^..*$')"
if [ "$DISTINCT_VERSION_COUNT" -gt 1 ]; then
  note_failure "reported versions DIVERGE — $(printf '%s' "$DISTINCT_VERSIONS" | tr '\n' ' ')"
  echo "  Versions reported, by source:"
  printf '%s' "$REPORTED_VERSIONS" | grep -v '^$' | while IFS=$'\t' read -r label version; do
    printf '    %-28s %s\n' "$label" "$version"
  done
  echo ""
fi

DISTINCT_PINS="$(printf '%s' "$REPORTED_PINS" | grep -v '^$' | cut -f2 | sort -u)"
DISTINCT_PIN_COUNT="$(printf '%s' "$DISTINCT_PINS" | grep -c '^..*$')"
if [ "$DISTINCT_PIN_COUNT" -gt 1 ]; then
  note_failure "declared pins DIVERGE — $(printf '%s' "$DISTINCT_PINS" | tr '\n' ' ')"
  echo "  Pins declared, by source:"
  printf '%s' "$REPORTED_PINS" | grep -v '^$' | while IFS=$'\t' read -r label pin; do
    printf '    %-28s %s\n' "$label" "$pin"
  done
  echo ""
fi

if [ "$FAILURES" -eq 0 ]; then
  echo "  OK — every source reports the same MemPalace version against the same pin,"
  echo "  and every reported version lies inside it."
else
  echo "  NOT OK — ${FAILURES} finding(s):"
  printf '%s' "$FAILURE_NOTES"
fi

echo ""
echo "  NOTE: ${RESTART_NOTE}"
echo ""

[ "$FAILURES" -eq 0 ]
