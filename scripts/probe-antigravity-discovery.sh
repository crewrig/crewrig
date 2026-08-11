#!/bin/bash
# probe-antigravity-discovery.sh — re-establish which locations Antigravity CLI
# discovers, for each component kind and each on-disk shape (spec 0123 R13/R14).
#
# WHY THIS EXISTS. Spec 0123 was written because the framework installed skills
# where the assistant never looks, and the mistake was made by reading the
# vendor's documentation instead of observing the assistant. The vendor guide
# lists `~/.gemini/config/` as the only machine-local customization root and does
# not mention `~/.gemini/antigravity-cli/` at all — yet agents ARE discovered
# from the latter. Documentation-only reasoning got that half wrong. R13 keeps
# the observation re-runnable so the record can be re-established rather than
# trusted, and R14 makes a transient non-answer distinguishable from an absence.
#
# WHAT IT DOES. Installs uniquely-named sentinels across the candidate discovery
# locations x component kinds x on-disk shapes, then asks `agy` twice per kind:
#   1. an OPEN listing  — `agy -p "list your skills"` / `agy agents`;
#   2. a FORCED-CHOICE prompt — one `<name>=YES|NO` line per sentinel, plus a
#      real installed component as a positive control.
# The forced-choice shape is what makes R14's third verdict possible: a sentinel
# with no `<name>=` line in the answer is a NON-ANSWER, not an absence. An open
# listing cannot tell those apart, and reading omission as absence is exactly the
# error R14 exists to prevent — it was made once on this ticket already.
#
# THE DUPLICATE-NAME CELL. One agent name is installed at TWO proven agent roots
# simultaneously. Every sentinel in the first probe was uniquely named, so
# nothing observed said whether a duplicate shadows, doubles, or is refused — and
# the framework's own fix creates that condition, since `harness-curator` is
# shipped as a library agent and `~/.gemini/agents/harness-curator.md` already
# exists on any machine that ran the Gemini setup.
#
# NOT A CI GATE. Spec 0123 -> "Out of scope" rules out automated enforcement of
# the discovery claim: this needs the vendor binary, a model-driven session and
# minutes of wall time. It is invoked deliberately by a human or an agent. The
# CLASSIFIER, however, is hermetically tested — see
# scripts/tests/test-antigravity-discovery-probe.sh.
#
# Usage:
#   bash scripts/probe-antigravity-discovery.sh
#
# Environment seams:
#   AGY_BIN               — the vendor binary (default `agy`). Stubbed by the test.
#   AGY_PROBE_TIMEOUT     — per-call bound in seconds (default 300). The bound must
#                           exceed the two-minute hang it exists to survive, so the
#                           hermetic test overrides it rather than burning that long.
#   AGY_PROBE_ASK_SHAPE   — `captured` (default) or `direct`. Test seam, and the
#                           reason it exists is in probe_ask() below: the two call
#                           shapes have DIFFERENT `set -e` behaviour on the timeout
#                           path, and both must stay covered.
#
# Exit status:
#   0 — every sentinel classified FOUND or NOT-FOUND
#   1 — precondition failure (missing binary, a sentinel name already on disk)
#   3 — at least one sentinel classified INDETERMINATE (R14's third verdict)

set -euo pipefail

AGY_BIN="${AGY_BIN:-agy}"
AGY_PROBE_TIMEOUT="${AGY_PROBE_TIMEOUT:-300}"
AGY_PROBE_ASK_SHAPE="${AGY_PROBE_ASK_SHAPE:-captured}"

EXIT_OK=0
EXIT_PRECONDITION=1
EXIT_INDETERMINATE=3

# Positive control for the skills query: a builtin skill the assistant always
# carries. A run in which the control answers NO tells you the model, not the
# placement, is what failed.
SKILL_CONTROL="agy-customizations"

# --- Sentinel matrix ---------------------------------------------------------
# Record fields, `|`-separated: kind | name | path relative to $HOME | label.
#
# Three candidate locations:
#   .gemini/antigravity-cli/  — application data; where the framework installed
#                               until spec 0123. Undocumented as a customization
#                               root, but observed to serve agents.
#   .gemini/config/           — the machine-local customization root the vendor
#                               documents.
#   .gemini/                  — the Gemini CLI roots. `agy agents` was observed
#                               listing `harness-curator` from here.
#
# Two agent shapes, because the build stages `<name>/AGENT.md` directories while
# the superseded installer copied flat `<name>.md` files — a cell no probe has
# ever covered, and the one that decides the installed shape under R3.
SENTINELS=(
  "skill|crewrig-probe-skill-appdata|.gemini/antigravity-cli/skills/crewrig-probe-skill-appdata|skill, application-data root"
  "skill|crewrig-probe-skill-config|.gemini/config/skills/crewrig-probe-skill-config|skill, documented customization root"
  "skill|crewrig-probe-skill-gemini|.gemini/skills/crewrig-probe-skill-gemini|skill, Gemini CLI root"
  "agent|crewrig-probe-agent-flat-appdata|.gemini/antigravity-cli/agents/crewrig-probe-agent-flat-appdata.md|agent, flat file, application-data root"
  "agent|crewrig-probe-agent-flat-config|.gemini/config/agents/crewrig-probe-agent-flat-config.md|agent, flat file, documented customization root"
  "agent|crewrig-probe-agent-flat-gemini|.gemini/agents/crewrig-probe-agent-flat-gemini.md|agent, flat file, Gemini CLI root"
  "agent|crewrig-probe-agent-dir-appdata|.gemini/antigravity-cli/agents/crewrig-probe-agent-dir-appdata|agent, directory shape, application-data root"
  "agent|crewrig-probe-agent-dir-config|.gemini/config/agents/crewrig-probe-agent-dir-config|agent, directory shape, documented customization root"
  "agent|crewrig-probe-agent-dir-gemini|.gemini/agents/crewrig-probe-agent-dir-gemini|agent, directory shape, Gemini CLI root"
)

# The duplicate-name cell: ONE name, TWO placements, both at roots already proven
# to serve agents. Its unique-named siblings above sit at the same two roots, so
# a listing that shows both siblings and only one `-dup` entry is an unambiguous
# de-duplication rather than a discovery failure.
DUP_NAME="crewrig-probe-agent-dup"
DUP_PATHS=(
  ".gemini/config/agents/${DUP_NAME}.md"
  ".gemini/agents/${DUP_NAME}.md"
)

# --- Sentinel materialisation ------------------------------------------------

sentinel_field() {
  # sentinel_field <record> <1-based field index>
  printf '%s\n' "$1" | cut -d'|' -f"$2"
}

write_skill_sentinel() {
  local dir="$1" name="$2"
  ensure_dir "$dir"
  cat > "$dir/SKILL.md" <<EOF
---
name: $name
description: Discovery probe sentinel for crewrig spec 0123. Safe to delete.
---

# $name

This file is a throwaway discovery sentinel written by
\`scripts/probe-antigravity-discovery.sh\`. It teaches nothing and does nothing.
EOF
}

write_agent_sentinel() {
  # write_agent_sentinel <target> <name> <marker>
  # <target> ends in `.md` for the flat shape, otherwise it is a directory that
  # receives an AGENT.md — the shape `scripts/build-components.sh` stages.
  local target="$1" name="$2" marker="$3" file
  case "$target" in
    *.md) ensure_dir "$(dirname "$target")"; file="$target" ;;
    *)    ensure_dir "$target"; file="$target/AGENT.md" ;;
  esac
  cat > "$file" <<EOF
---
name: $name
description: "Discovery probe sentinel for crewrig spec 0123 ($marker). Safe to delete."
---

Throwaway discovery sentinel written by
\`scripts/probe-antigravity-discovery.sh\`. Do nothing; report the marker
$marker if asked.
EOF
}

CREATED_PATHS=()
CREATED_DIRS=()

# ensure_dir <path> — mkdir -p, remembering ONLY the levels that did not exist,
# so cleanup can restore the pre-probe tree exactly. Removing a root that was
# already there — `~/.gemini/antigravity-cli/agents/` exists and is empty on a
# machine set up by the superseded installer — would be a state change the probe
# has no business making.
ensure_dir() {
  local path="$1" missing=() p
  p="$path"
  while [ ! -d "$p" ] && [ "$p" != "/" ] && [ "$p" != "$HOME" ]; do
    missing=("$p" ${missing[@]+"${missing[@]}"})
    p="$(dirname "$p")"
  done
  mkdir -p "$path"
  for p in ${missing[@]+"${missing[@]}"}; do
    CREATED_DIRS+=("$p")
  done
}

cleanup() {
  local p i
  for p in ${CREATED_PATHS[@]+"${CREATED_PATHS[@]}"}; do
    rm -rf "$p"
  done
  # Deepest-first, and only when empty: a directory the probe created but that
  # something else has since populated stays.
  if [ ${#CREATED_DIRS[@]} -gt 0 ]; then
    for (( i = ${#CREATED_DIRS[@]} - 1; i >= 0; i-- )); do
      rmdir "${CREATED_DIRS[$i]}" 2>/dev/null || true
    done
  fi
}

# --- The bounded call --------------------------------------------------------
#
# THREE TRAPS SIT ON THIS FUNCTION, all of them measured on Bash 3.2.57:
#
# 1. `kill "$pid"` reaches the backgrounded WRAPPER, not the process it forked.
#    A timed-out `agy` therefore outlives the EXIT trap that removes the
#    sentinels, and keeps reading them. `set -m` gives the job its own process
#    group and `kill -TERM -- "-$pid"` takes the whole tree down.
# 2. `wait "$pid"` on a job the watchdog killed returns 143. Reaching `set -e`
#    at top level, that ABORTS the script — losing the classification before
#    INDETERMINATE can be recorded.
# 3. The same `wait`, inside a command substitution (`ans="$(probe_ask ...)"`),
#    completes and returns 0 instead. That is not safety, it is blindness: a
#    bare `false` in the same position would pass just as silently.
#
# `wait "$pid" || st=$?` closes all three: the status is captured deliberately
# and branched on, and never reaches `set -e` in either call shape.
run_bounded() {
  # run_bounded <output-file> <command> [args...]
  # Returns the command's status, or 124 when the bound was hit.
  local out_file="$1"; shift
  local pid watchdog st=0 job_control_was_on=0

  case "$-" in *m*) job_control_was_on=1 ;; esac
  set -m
  "$@" > "$out_file" 2>/dev/null &
  pid=$!
  ( sleep "$AGY_PROBE_TIMEOUT"; kill -TERM -- "-$pid" 2>/dev/null; ) &
  watchdog=$!
  [ "$job_control_was_on" -eq 1 ] || set +m

  # `2>/dev/null` suppresses only the shell's own "Terminated: 15" job notice,
  # which `set -m` makes it print on the bounded-out path. It does not touch $st.
  wait "$pid" 2>/dev/null || st=$?

  # Kill the watchdog's whole group too: killing the subshell alone would orphan
  # its `sleep`, which is the same defect one level up.
  kill -TERM -- "-$watchdog" 2>/dev/null || true
  wait "$watchdog" 2>/dev/null || true

  # 143 = SIGTERM, i.e. the watchdog fired. Report it as a bound, not a failure.
  if [ "$st" -eq 143 ]; then
    return 124
  fi
  return "$st"
}

# probe_ask <prompt> — run one model call, print the answer on stdout, and write
# `OK`, `TIMEOUT` or `EMPTY` to $ASK_STATUS_FILE.
#
# The status travels through a FILE rather than a return value on purpose: in the
# `captured` call shape the function runs in a subshell, so a variable it sets is
# lost and its exit status is the one `set -e` would have to see. The file is the
# only channel that behaves identically in both shapes.
ASK_STATUS_FILE=""

probe_ask() {
  local prompt="$1" out st=0
  out="$(mktemp)"
  run_bounded "$out" "$AGY_BIN" -p "$prompt" || st=$?
  if [ "$st" -eq 124 ]; then
    printf 'TIMEOUT\n' > "$ASK_STATUS_FILE"
  elif [ ! -s "$out" ]; then
    printf 'EMPTY\n' > "$ASK_STATUS_FILE"
  else
    printf 'OK\n' > "$ASK_STATUS_FILE"
  fi
  cat "$out"
  rm -f "$out"
}

# ask_shaped <destination-file> <prompt> — drive probe_ask through whichever of
# the two call shapes AGY_PROBE_ASK_SHAPE selects. Both are exercised by
# scripts/tests/test-antigravity-discovery-probe.sh, because the `set -e`
# behaviour of the timeout path differs between them (see run_bounded above) and
# no reader should have to predict which symptom a given call site will show.
ask_shaped() {
  local dest="$1" prompt="$2" answer
  if [ "$AGY_PROBE_ASK_SHAPE" = "direct" ]; then
    probe_ask "$prompt" > "$dest"
  else
    answer="$(probe_ask "$prompt")"
    printf '%s\n' "$answer" > "$dest"
  fi
}

# --- R14 classification ------------------------------------------------------

classify() {
  # classify <answer-file> <status> <name> -> FOUND | NOT-FOUND | INDETERMINATE
  #
  # A missing `<name>=` line is INDETERMINATE, never NOT-FOUND. That is the whole
  # point of R14: an assistant that failed to answer must not be recorded as an
  # assistant that answered "absent".
  local answer_file="$1" status="$2" name="$3" line value

  if [ "$status" != "OK" ]; then
    printf 'INDETERMINATE\n'
    return 0
  fi

  line="$(grep -E "^[[:space:]]*${name}[[:space:]]*=" "$answer_file" 2>/dev/null | head -1 || true)"
  if [ -z "$line" ]; then
    printf 'INDETERMINATE\n'
    return 0
  fi

  value="${line#*=}"
  # Trim surrounding whitespace and any trailing punctuation the model adds.
  value="$(printf '%s' "$value" | tr -d '[:space:]' | tr -d '.,;:' | tr '[:lower:]' '[:upper:]')"
  case "$value" in
    YES) printf 'FOUND\n' ;;
    NO)  printf 'NOT-FOUND\n' ;;
    *)   printf 'INDETERMINATE\n' ;;
  esac
}

# --- Main --------------------------------------------------------------------

command -v "$AGY_BIN" >/dev/null 2>&1 || {
  echo "ERROR: '$AGY_BIN' not found in PATH. This probe needs the vendor binary." >&2
  exit "$EXIT_PRECONDITION"
}

echo "=========================================================="
echo "  Antigravity discovery probe (spec 0123 R13/R14)"
echo "  binary: $AGY_BIN   bound: ${AGY_PROBE_TIMEOUT}s   shape: $AGY_PROBE_ASK_SHAPE"
echo "=========================================================="
echo ""

# Refuse to start if any sentinel name is already on disk: the probe must never
# remove something it did not write.
collisions=()
for record in ${SENTINELS[@]+"${SENTINELS[@]}"}; do
  rel="$(sentinel_field "$record" 3)"
  if [ -e "$HOME/$rel" ]; then collisions+=("$HOME/$rel"); fi
done
for rel in ${DUP_PATHS[@]+"${DUP_PATHS[@]}"}; do
  if [ -e "$HOME/$rel" ]; then collisions+=("$HOME/$rel"); fi
done
if [ ${#collisions[@]} -gt 0 ]; then
  echo "ERROR: sentinel paths already exist — refusing to run, and refusing to" >&2
  echo "       remove anything this probe did not write:" >&2
  for c in ${collisions[@]+"${collisions[@]}"}; do echo "  - $c" >&2; done
  exit "$EXIT_PRECONDITION"
fi

trap cleanup EXIT

echo "Installing sentinels..."
for record in ${SENTINELS[@]+"${SENTINELS[@]}"}; do
  kind="$(sentinel_field "$record" 1)"
  name="$(sentinel_field "$record" 2)"
  rel="$(sentinel_field "$record" 3)"
  label="$(sentinel_field "$record" 4)"
  if [ "$kind" = "skill" ]; then
    write_skill_sentinel "$HOME/$rel" "$name"
  else
    write_agent_sentinel "$HOME/$rel" "$name" "$name"
  fi
  CREATED_PATHS+=("$HOME/$rel")
  echo "  $name  ($label)"
done
for rel in ${DUP_PATHS[@]+"${DUP_PATHS[@]}"}; do
  write_agent_sentinel "$HOME/$rel" "$DUP_NAME" "$rel"
  CREATED_PATHS+=("$HOME/$rel")
  echo "  $DUP_NAME  (duplicate-name cell -> $rel)"
done
echo ""

WORK="$(mktemp -d)"
CREATED_PATHS+=("$WORK")
ASK_STATUS_FILE="$WORK/status"

skill_names=""
agent_names=""
for record in ${SENTINELS[@]+"${SENTINELS[@]}"}; do
  kind="$(sentinel_field "$record" 1)"
  name="$(sentinel_field "$record" 2)"
  if [ "$kind" = "skill" ]; then
    skill_names="${skill_names}${name}"$'\n'
  else
    agent_names="${agent_names}${name}"$'\n'
  fi
done
agent_names="${agent_names}${DUP_NAME}"$'\n'

# --- Query 1: open listings --------------------------------------------------
echo "--- Open listing: skills ---"
ask_shaped "$WORK/skills-open.txt" \
  "List the names of every skill available to you in this session, one per line, and nothing else."
skills_open_status="$(cat "$ASK_STATUS_FILE")"
cat "$WORK/skills-open.txt"
echo "(status: $skills_open_status)"
echo ""

echo "--- Open listing: agents (deterministic, no model call) ---"
agents_open_status="OK"
if run_bounded "$WORK/agents-open.txt" "$AGY_BIN" agents; then
  :
else
  agents_open_status="TIMEOUT"
fi
[ -s "$WORK/agents-open.txt" ] || agents_open_status="EMPTY"
cat "$WORK/agents-open.txt"
echo "(status: $agents_open_status)"
echo ""

# --- Query 2: forced choice --------------------------------------------------
forced_prompt() {
  local kind="$1" names="$2"
  printf '%s\n' \
    "For each name listed below, output exactly one line of the form NAME=YES or" \
    "NAME=NO, where YES means that $kind is available to you in this session and NO" \
    "means it is not. Emit one line for EVERY name, in the order given. Output" \
    "nothing else — no prose, no preamble, no code fences." \
    "" \
    "$names"
}

echo "--- Forced choice: skills ---"
ask_shaped "$WORK/skills-forced.txt" \
  "$(forced_prompt skill "${skill_names}${SKILL_CONTROL}")"
skills_forced_status="$(cat "$ASK_STATUS_FILE")"
cat "$WORK/skills-forced.txt"
echo "(status: $skills_forced_status)"
echo ""

echo "--- Forced choice: agents ---"
ask_shaped "$WORK/agents-forced.txt" \
  "$(forced_prompt agent "$agent_names")"
agents_forced_status="$(cat "$ASK_STATUS_FILE")"
cat "$WORK/agents-forced.txt"
echo "(status: $agents_forced_status)"
echo ""

# --- Verdicts ----------------------------------------------------------------
echo "=========================================================="
echo "  Verdicts (R14: FOUND / NOT-FOUND / INDETERMINATE)"
echo "=========================================================="
indeterminate=0
for record in ${SENTINELS[@]+"${SENTINELS[@]}"}; do
  kind="$(sentinel_field "$record" 1)"
  name="$(sentinel_field "$record" 2)"
  label="$(sentinel_field "$record" 4)"
  if [ "$kind" = "skill" ]; then
    verdict="$(classify "$WORK/skills-forced.txt" "$skills_forced_status" "$name")"
  else
    verdict="$(classify "$WORK/agents-forced.txt" "$agents_forced_status" "$name")"
  fi
  if [ "$verdict" = "INDETERMINATE" ]; then indeterminate=$((indeterminate + 1)); fi
  printf '  %-14s %s  (%s)\n' "$verdict" "$name" "$label"
done

dup_verdict="$(classify "$WORK/agents-forced.txt" "$agents_forced_status" "$DUP_NAME")"
if [ "$dup_verdict" = "INDETERMINATE" ]; then indeterminate=$((indeterminate + 1)); fi
dup_listed="$(grep -c "^[[:space:]]*${DUP_NAME}[[:space:]]*$" "$WORK/agents-open.txt" 2>/dev/null || true)"
dup_listed="${dup_listed//[^0-9]/}"
printf '  %-14s %s  (duplicate name at %s roots; listed %s time(s) by `%s agents`)\n' \
  "$dup_verdict" "$DUP_NAME" "${#DUP_PATHS[@]}" "${dup_listed:-0}" "$AGY_BIN"
echo ""
echo "  Duplicate-name reading: listed 2 = doubled; 1 = de-duplicated (one copy"
echo "  shadows the other); 0 = refused or not discovered. The unique-named"
echo "  siblings at the SAME two roots are the control — if they are FOUND and"
echo "  the duplicate is listed once, the de-duplication is unambiguous."
echo ""

echo "  Positive control ($SKILL_CONTROL): $(classify "$WORK/skills-forced.txt" "$skills_forced_status" "$SKILL_CONTROL")"
echo "  A control that is not FOUND means the MODEL failed, not the placement."
echo ""
echo "Record the table in docs/runbooks/antigravity-discovery-probe.md, stamped"
echo "with the \`$AGY_BIN\` version and the date."

if [ "$indeterminate" -gt 0 ]; then
  echo "" >&2
  echo "INDETERMINATE: $indeterminate sentinel(s) got no usable answer. This is NOT" >&2
  echo "an absence — re-run before recording anything (R14)." >&2
  exit "$EXIT_INDETERMINATE"
fi
exit "$EXIT_OK"
