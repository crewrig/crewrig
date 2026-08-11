#!/bin/bash
# check-gemini-overlay-enrollment.sh — Fail CI when a deployed Gemini overlay
# is not enrolled in the context manifest (spec 0085).
#
# Per spec 0085 (Requirements 1-7), continuous integration MUST fail a pull
# request when a user-level context overlay that
# `scripts/setup-gemini-interactive.sh` deploys to the Gemini home directory is
# absent from the `context.fileName` list in `config/gemini/settings.json` — the
# manifest Gemini actually reads — and MUST name the offending overlay(s). This
# is the class of silent divergence that let the priority-65 and priority-66
# overlays be deployed but never loaded before their fix (#576/#578).
#
# Both sets are DERIVED FROM THE PROJECT'S OWN SOURCES (R2), never hard-coded, so
# a future overlay is covered without editing this guard:
#
#   - Deployed set (forward source): every literal `"$GEMINI_HOME/NN_NAME.md"`
#     token anywhere in the setup script. Grepping the literal token — not the
#     `install_file` argument lists — is deliberate (R3): the user-profile
#     overlay is deployed through an intermediate `$TARGET` variable, so parsing
#     `install_file` call sites would MISS `30_USER_PROFILE.md`. The literal
#     token grep also captures the conditionally-guarded `66_ORG_RULES.md` (R4)
#     for free — no bash control-flow reasoning needed.
#   - Enrolled set: the basenames of `context.fileName` in the settings file,
#     parsed with `python3` (a CI dependency) rather than grepping JSON.
#
# Verdicts:
#   - Forward (R1, hard fail): every deployed overlay MUST be enrolled. Any that
#     is not is named on stderr and the build goes red.
#   - Reverse (R6, non-blocking): an enrolled entry that is not deployed is
#     warned about on stderr but does NOT fail the build on its own.
#   - AGENTS.md exception (R5): the repository-root `AGENTS.md` entry is enrolled
#     by design (Gemini reads it from the repo tree rather than a deployed copy),
#     so it is the sole enrolled-but-not-deployed entry that neither fails nor
#     warns.
#
# Usage:
#   bash scripts/check-gemini-overlay-enrollment.sh
#
# Override the repository root with CREWRIG_REPO_DIR (used by the self-test
# against temporary fixtures), mirroring the sibling check-*.sh guards.
#
# Exits 0 when every deployed overlay is enrolled (prints an OK line), 1 when an
# overlay is deployed but not enrolled (per-offender list on stderr), and 2 on a
# usage or internal error (a missing source file, or a source whose shape the
# guard can no longer parse).

set -euo pipefail

REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/.." && pwd)"}"

SETUP_SCRIPT="$REPO_DIR/scripts/setup-gemini-interactive.sh"
SETTINGS_FILE="$REPO_DIR/config/gemini/settings.json"

# The repository-root agent-rules file: enrolled but never deployed by design
# (Gemini reads it from the repo tree). The sole allowed reverse exception (R5).
AGENTS_EXCEPTION="AGENTS.md"

for src in "$SETUP_SCRIPT" "$SETTINGS_FILE"; do
  if [ ! -f "$src" ]; then
    echo "Error: source not found: $src" >&2
    exit 2
  fi
done

# --- Deployed set (R2, R3, R4) ----------------------------------------------
# Match the literal `"$GEMINI_HOME/NN_NAME.md"` deploy token wherever it appears
# — direct `install_file` targets, `$TARGET=` assignments, guarded blocks alike
# — then reduce each token to its bare overlay basename. An empty result means
# the setup script's deploy shape changed out from under the guard: fail closed
# (exit 2) rather than pass a vacuous forward check.
#
# The name segment class is the permissive `[A-Za-z0-9_]+`, not just uppercase
# (R2): the current overlays happen to be uppercase, but a future overlay named
# with mixed case or a digit (e.g. `67_NewTool.md`) must still land in the
# deployed set and be checked for enrollment — narrowing the class to `[A-Z_]`
# would silently drop such an overlay and defeat the "covered automatically"
# promise. The token stays anchored on `"$GEMINI_HOME/` + a two-digit priority,
# so it can still only ever match a real deploy token.
if ! deployed=$(grep -oE '"\$GEMINI_HOME/[0-9]{2}_[A-Za-z0-9_]+\.md"' "$SETUP_SCRIPT" \
                  | sed -E 's#.*/##; s/"$//' | sort -u) || [ -z "$deployed" ]; then
  echo "Error: no deployed overlays found in $SETUP_SCRIPT — the deploy token" >&2
  echo "shape may have changed; refusing to run a vacuous enrollment check." >&2
  exit 2
fi

# --- Enrolled set ------------------------------------------------------------
# Read context.fileName with python3 (a CI dependency) and take basenames.
#
# A malformed settings file must NOT masquerade as "everything unenrolled": a
# structurally-absent or wrong-typed `context` / `context.fileName` (or JSON
# that does not parse at all) is an internal error (exit 2), distinct from a
# key that is PRESENT but an empty list — that stays a legitimate forward
# failure (the deployed overlays are simply unenrolled, exit 1). The python
# helper exits 2 on the malformed cases; that non-zero propagates through the
# pipeline (pipefail) into the `if !` guard below.
if ! enrolled=$(python3 -c '
import json, os, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    data = json.load(fh)
context = data.get("context")
if not isinstance(context, dict):
    sys.stderr.write("context key is absent or not an object\n")
    sys.exit(2)
file_names = context.get("fileName")
if not isinstance(file_names, list):
    sys.stderr.write("context.fileName is absent or not an array\n")
    sys.exit(2)
for name in file_names:
    print(os.path.basename(name))
' "$SETTINGS_FILE" | sort -u); then
  echo "Error: could not read a well-formed context.fileName list from $SETTINGS_FILE" >&2
  echo "(malformed JSON, or a missing/wrong-typed context.fileName key)." >&2
  exit 2
fi

# --- Forward check (R1) — every deployed overlay must be enrolled ------------
missing=()
while IFS= read -r overlay; do
  [ -z "$overlay" ] && continue
  grep -qxF "$overlay" <<<"$enrolled" || missing+=("$overlay")
done <<<"$deployed"

# --- Reverse check (R6) — enrolled-but-not-deployed, warn only ---------------
warnings=()
while IFS= read -r entry; do
  [ -z "$entry" ] && continue
  [ "$entry" = "$AGENTS_EXCEPTION" ] && continue   # R5: the sole exception
  grep -qxF "$entry" <<<"$deployed" || warnings+=("$entry")
done <<<"$enrolled"

# Reverse warnings are non-blocking (R6): emit them, but they never set the exit
# code on their own.
if [ "${#warnings[@]}" -gt 0 ]; then
  echo "WARNING: ${#warnings[@]} overlay(s) enrolled in context.fileName but not deployed by the setup script:" >&2
  for w in ${warnings[@]+"${warnings[@]}"}; do
    echo "  - $w" >&2
  done
  echo "This is drift, not a failure — either enroll a deploy for it or remove it" >&2
  echo "from config/gemini/settings.json (spec 0085 R6)." >&2
  echo "" >&2
fi

# Forward failures are blocking (R1).
if [ "${#missing[@]}" -gt 0 ]; then
  echo "FAILED: ${#missing[@]} deployed Gemini overlay(s) not enrolled in context.fileName (spec 0085):" >&2
  for m in ${missing[@]+"${missing[@]}"}; do
    echo "  - $m" >&2
  done
  echo "" >&2
  echo "scripts/setup-gemini-interactive.sh deploys the overlay(s) above to the" >&2
  echo "Gemini home directory, but config/gemini/settings.json does not enroll them" >&2
  echo "in context.fileName, so Gemini would silently never load them. Add each to" >&2
  echo "the context.fileName array." >&2
  exit 1
fi

deployed_count=$(printf '%s\n' "$deployed" | grep -c .)
echo "OK: all $deployed_count deployed Gemini overlays are enrolled in context.fileName."
