#!/bin/bash
# probe-extension-hooks.sh — re-runnable, four-target probe of the extension
# (plugin-level) hook surface for Claude Code, Gemini CLI, GitHub Copilot CLI
# and Antigravity CLI (spec 0179 issue #1005, plan step 1).
#
# WHY THIS EXISTS. Three of the four targets are already grounded by spec
# 0179's own authoring-time probe (Notes -> "Probe record"). The fourth,
# Copilot, is explicitly recorded as ungrounded: "the installed binary
# ... yields no readable hook strings, and the one installed plugin
# declares no hook" (0065 delta-01 R12's whole reason for existing). This
# script makes the grounding RE-RUNNABLE rather than trusted from a single
# authoring session, modelled on scripts/probe-antigravity-discovery.sh /
# docs/runbooks/antigravity-discovery-probe.md (the precedent
# docs/cli-matrix.md row 10 cites).
#
# WHAT IT DOES, PER TARGET.
#   - Claude Code, Antigravity CLI: read the installed tool's OWN shipped
#     evidence (embedded reference doc strings / bundled hooks.md) rather
#     than vendor prose, settling the two named divergences (Copilot
#     version, Claude envelope shape) from the installed tool.
#   - Gemini CLI: records the already-grounded probe record (spec 0179
#     Notes) plus the installed version, since its evidence method
#     (documentation shipped in the installed bundle, plus the bundle's own
#     extension-hook loader) is not re-derivable by a byte grep of a
#     minified bundle.
#   - GitHub Copilot CLI (the R12 branch point): a LIVE functional test.
#     Installs a synthetic plugin via --plugin-dir carrying a candidate
#     hook file at each plausible placement, with the SAME envelope shape
#     already grounded for the user-level manifest
#     (hooks/copilot-transcript-hooks.json), then runs one real
#     tool-invoking session and asserts, from a side-channel log file the
#     candidate hook command writes, whether the hook actually fired.
#     Classifies the outcome as exactly one of B1A / B1B / B2 / B3 per the
#     plan's four-way branch (step 2).
#
# NOT A CI GATE (spec 0179 -> Risk R5): all four CLIs must be installed and
# authenticated, and the Copilot arm spends real AI credits on one live
# tool-invoking turn. Invoked deliberately by a human or an agent, its
# OUTPUT (docs/extension-hook-events.md, scripts/lib/extension-targets.json)
# is what ships and what CI checks.
#
# Usage:
#   bash scripts/probe-extension-hooks.sh
#
# Environment seams:
#   COPILOT_BIN            — the vendor binary (default `copilot`).
#   CLAUDE_BIN              — the vendor binary (default `claude`).
#   PROBE_COPILOT_TIMEOUT  — bound in seconds for the one live Copilot call
#                             (default 120).
#
# Exit status:
#   0 — every arm completed (Copilot classified B1A, B1B, B2 or B3 — ALL
#       four are valid probe OUTCOMES, not probe failures; only B1A licenses
#       DEV to proceed per the plan, which this script does not decide)
#   1 — precondition failure (a required binary is missing)

set -uo pipefail

COPILOT_BIN="${COPILOT_BIN:-copilot}"
CLAUDE_BIN_NAME="${CLAUDE_BIN:-claude}"
PROBE_COPILOT_TIMEOUT="${PROBE_COPILOT_TIMEOUT:-120}"

EXIT_OK=0
EXIT_PRECONDITION=1

echo "=========================================================="
echo "  Extension hook probe (spec 0179 issue #1005, plan steps 1-2)"
echo "=========================================================="
echo ""

missing=0
for bin in "$CLAUDE_BIN_NAME" gemini agy "$COPILOT_BIN"; do
  command -v "$bin" >/dev/null 2>&1 || { echo "ERROR: '$bin' not found in PATH." >&2; missing=1; }
done
[ "$missing" -eq 0 ] || exit "$EXIT_PRECONDITION"

# --- Claude Code ------------------------------------------------------------
echo "--- Claude Code ---"
CLAUDE_VERSION="$("$CLAUDE_BIN_NAME" --version 2>&1 | head -1)"
CLAUDE_RESOLVED_BIN="$(readlink -f "$(command -v "$CLAUDE_BIN_NAME")" 2>/dev/null || command -v "$CLAUDE_BIN_NAME")"
echo "  Version (self-reported): $CLAUDE_VERSION"
echo "  Resolved binary: $CLAUDE_RESOLVED_BIN"
# The R9 envelope divergence: does the installed binary's own embedded
# reference doc show the hooks section as an ENVELOPE ({"hooks": {...}}) or
# flat ({EVENT: [...]})? grep the binary's own strings for its "Hook
# Structure" reference block rather than trusting either the vendor prose
# or the incumbent builder's assumption.
#
# The strings dump is snapshotted to a file BEFORE grep -q runs against it —
# never `strings ... | grep -q ...` directly. grep -q exits the instant it
# finds a match, closing its read end; under `pipefail` that SIGPIPEs the
# still-writing `strings` process, and pipefail then reports the PIPELINE's
# status from that non-zero-exiting left side even though grep itself found
# the match — turning a real match into a false "not found" `if` branch.
# Measured live on this exact line during authoring (issue #1005).
CLAUDE_STRINGS="$(mktemp)"
strings -a "$CLAUDE_RESOLVED_BIN" 2>/dev/null > "$CLAUDE_STRINGS" || true
if grep -q '"hooks": {' "$CLAUDE_STRINGS"; then
  echo "  R9 envelope check: installed binary's own embedded doc shows"
  echo "    an ENVELOPE ('\"hooks\": {') — build-claude-plugin.sh's incumbent"
  echo "    {\"hooks\": ...} wrapper is confirmed, not merely inherited."
else
  echo "  R9 envelope check: no '\"hooks\": {' envelope string found in the"
  echo "    installed binary — INCONCLUSIVE, do not assume either shape."
fi
if grep -q 'CLAUDE_PLUGIN_ROOT' "$CLAUDE_STRINGS"; then
  echo "  R11 root-token check: CLAUDE_PLUGIN_ROOT confirmed present in the"
  echo "    installed binary."
fi
rm -f "$CLAUDE_STRINGS"
echo ""

# --- Gemini CLI ---------------------------------------------------------
echo "--- Gemini CLI ---"
GEMINI_VERSION="$(gemini --version 2>&1 | head -1)"
echo "  Version (self-reported): $GEMINI_VERSION"
echo "  Evidence: already grounded by spec 0179's own probe record (Notes ->"
echo "  Probe record), method 'documentation shipped in the installed"
echo "  bundle, plus the bundle's own extension-hook loader'. Re-derivable"
echo "  only by re-running that authoring-time probe against the bundle in"
echo "  \$(command -v gemini)'s install tree, not by a byte grep of the"
echo "  minified bundle (attempted; no plain-text event tokens survive"
echo "  minification)."
echo ""

# --- Antigravity CLI ---------------------------------------------------
echo "--- Antigravity CLI ---"
AGY_VERSION="$(agy --version 2>&1 | head -1)"
echo "  Version (self-reported): $AGY_VERSION"
AGY_HOOKS_DOC="$HOME/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md"
if [ -f "$AGY_HOOKS_DOC" ]; then
  echo "  Evidence: $AGY_HOOKS_DOC (vendor hook and plugin contract shipped"
  echo "    on disk with the CLI)."
  grep -q 'The working directory is set to the directory containing' "$AGY_HOOKS_DOC" \
    && echo "  R11 root-token check: confirmed — no path variable; working" \
    && echo "    directory is the directory holding hooks.json."
  grep -q 'Defaults to \`30\`' "$AGY_HOOKS_DOC" \
    && echo "  R10 time-unit check: confirmed — seconds, default 30."
else
  echo "  WARNING: $AGY_HOOKS_DOC not found on this machine — cannot"
  echo "    re-confirm from disk; falling back to spec 0179's Notes record."
fi
echo ""

# --- GitHub Copilot CLI (the R12 branch point) --------------------------
echo "--- GitHub Copilot CLI (R12 branch point) ---"
COPILOT_SELF_VERSION="$("$COPILOT_BIN" --version 2>&1 | head -1)"
COPILOT_RESOLVED_BIN="$(readlink -f "$(command -v "$COPILOT_BIN")" 2>/dev/null || command -v "$COPILOT_BIN")"
echo "  Version (self-reported): $COPILOT_SELF_VERSION"
echo "  Resolved binary path:    $COPILOT_RESOLVED_BIN"
echo "  (The spec's own Notes record self-reported 1.0.80 against a"
echo "   resolved binary of 1.0.49 — both readings are carried, per step 1.)"
echo ""

WORK="$(mktemp -d)"
LOG="$WORK/hook-fired.log"
trap 'rm -rf "$WORK"' EXIT

write_probe_plugin() {
  # write_probe_plugin <dir> <name> <hook-file-relative-path> <marker>
  local dir="$1" name="$2" relpath="$3" marker="$4"
  mkdir -p "$dir/$(dirname "$relpath")"
  cat > "$dir/plugin.json" <<EOF
{"name":"$name","version":"0.0.1","description":"crewrig extension-hook probe: $marker"}
EOF
  cat > "$dir/$relpath" <<EOF
{
  "version": 1,
  "disableAllHooks": false,
  "hooks": {
    "preToolUse": [
      {"type": "command", "matcher": ".*", "command": "echo $marker >> $LOG"}
    ]
  }
}
EOF
}

ROOT_DIR="$WORK/plugin-root-hooks"
SUBDIR_DIR="$WORK/plugin-subdir-hooks"
write_probe_plugin "$ROOT_DIR" "crewrig-probe-root" "hooks.json" "MARKER_ROOT"
write_probe_plugin "$SUBDIR_DIR" "crewrig-probe-subdir" "hooks/hooks.json" "MARKER_SUBDIR"

echo "  Installing a synthetic plugin at two candidate placements via"
echo "  --plugin-dir (root hooks.json, and hooks/hooks.json), envelope"
echo "  shape identical to the already-grounded user-level manifest"
echo "  (hooks/copilot-transcript-hooks.json), and running ONE live"
echo "  tool-invoking session (bound: ${PROBE_COPILOT_TIMEOUT}s)..."
echo ""

: > "$LOG"
copilot_out="$WORK/copilot-out.txt"
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_CMD=(timeout "${PROBE_COPILOT_TIMEOUT}s")
else
  TIMEOUT_CMD=()
fi
${TIMEOUT_CMD[@]+"${TIMEOUT_CMD[@]}"} "$COPILOT_BIN" \
  --plugin-dir "$ROOT_DIR" \
  --plugin-dir "$SUBDIR_DIR" \
  -p "Run the shell command: echo hello-world-probe" \
  --allow-all-tools --add-dir "$WORK" \
  > "$copilot_out" 2>&1
copilot_rc=$?

echo "  copilot exit status: $copilot_rc"
root_fired=0
subdir_fired=0
grep -q "MARKER_ROOT" "$LOG" 2>/dev/null && root_fired=1
grep -q "MARKER_SUBDIR" "$LOG" 2>/dev/null && subdir_fired=1

echo "  hooks.json at plugin root fired:  $([ "$root_fired" -eq 1 ] && echo yes || echo no)"
echo "  hooks/hooks.json (subdir) fired:  $([ "$subdir_fired" -eq 1 ] && echo yes || echo no)"
echo ""

if [ "$root_fired" -eq 1 ] || [ "$subdir_fired" -eq 1 ]; then
  echo "  R11 root-token check: probing \$COPILOT_PLUGIN_ROOT and \$PWD..."
  : > "$LOG"
  ROOT_TOKEN_DIR="$WORK/plugin-root-token"
  mkdir -p "$ROOT_TOKEN_DIR"
  cat > "$ROOT_TOKEN_DIR/plugin.json" <<EOF
{"name":"crewrig-probe-root-token","version":"0.0.1","description":"probe root token"}
EOF
  cat > "$ROOT_TOKEN_DIR/hooks.json" <<EOF
{"version":1,"disableAllHooks":false,"hooks":{"preToolUse":[{"type":"command","matcher":".*","command":"echo \"CWD=\$(pwd) ROOT=\${COPILOT_PLUGIN_ROOT:-unset}\" >> $LOG"}]}}
EOF
  ${TIMEOUT_CMD[@]+"${TIMEOUT_CMD[@]}"} "$COPILOT_BIN" --plugin-dir "$ROOT_TOKEN_DIR" \
    -p "Run the shell command: echo hello-world-probe-2" \
    --allow-all-tools --add-dir "$WORK" > /dev/null 2>&1
  echo "  $(cat "$LOG" 2>/dev/null || echo '(no output captured)')"
  echo ""

  echo "  Matcher form check: does a non-matching regex suppress the hook,"
  echo "  and a shell-tool regex match it? (confirms 'regex over tool"
  echo "  names', shell tool identifier 'bash')..."
  : > "$LOG"
  MATCHER_DIR="$WORK/plugin-matcher"
  mkdir -p "$MATCHER_DIR"
  cat > "$MATCHER_DIR/plugin.json" <<EOF
{"name":"crewrig-probe-matcher","version":"0.0.1","description":"probe matcher form"}
EOF
  cat > "$MATCHER_DIR/hooks.json" <<EOF
{"version":1,"disableAllHooks":false,"hooks":{"preToolUse":[
  {"type":"command","matcher":"no-such-tool-xyz","command":"echo MARKER_NOMATCH >> $LOG"},
  {"type":"command","matcher":"bash","command":"echo MARKER_BASH >> $LOG"}
]}}
EOF
  ${TIMEOUT_CMD[@]+"${TIMEOUT_CMD[@]}"} "$COPILOT_BIN" --plugin-dir "$MATCHER_DIR" \
    -p "Run the shell command: echo hello-world-probe-3" \
    --allow-all-tools --add-dir "$WORK" > /dev/null 2>&1
  echo "  $(cat "$LOG" 2>/dev/null || echo '(no output captured — re-run)')"
  echo ""
fi

echo "=========================================================="
echo "  Verdict (step 2's four-way branch)"
echo "=========================================================="
if [ "$root_fired" -eq 1 ] || [ "$subdir_fired" -eq 1 ]; then
  echo "  B1A — a Copilot plugin-level hook surface EXISTS and preToolUse is"
  echo "  observed to fire, which is in the grounded three-way intersection"
  echo "  (Claude PreToolUse / Gemini BeforeTool / Antigravity PreToolUse)."
  echo "  -> Proceed with the full plan; write the Copilot column."
elif [ "$copilot_rc" -ne 0 ]; then
  echo "  B3 — INCONCLUSIVE: the probe call itself failed (rc=$copilot_rc)."
  echo "  Re-run before recording anything as an absence."
  cat "$copilot_out" >&2
else
  echo "  B2 — absence demonstrated: neither candidate placement fired for"
  echo "  a well-formed hook using the already-grounded user-level schema."
  echo "  Escalate per the plan's Risk R1."
fi
echo ""
echo "Record the outcome in docs/runbooks/extension-hook-probe.md, stamped"
echo "with each CLI's version and the date."

exit "$EXIT_OK"
