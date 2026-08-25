#!/bin/bash
# probe-extension-mcp-token.sh — re-establish, against the INSTALLED vendor
# binaries, how each of the four supported CLIs resolves an extension-scoped
# MCP server's neutral path token and how each resolves a name collision
# between an extension-declared server and one already configured at another
# scope (spec 0180 R9/R13, issue #1006, PLAN v5 step 1).
#
# WHY THIS EXISTS. Spec 0180 R9 forbids assuming a resolution form works: it
# must be "pinned with recorded evidence obtained from that installed tool
# against a rendered tree, before the first built MCP declaration for that
# tool is delivered." `copilot mcp list`/`get` and `agy mcp list` both echo
# the DECLARED configuration, not the LAUNCHED process — observing them alone
# settles nothing about token expansion inside `command`/`args`. Only a live
# session that actually spawns the stdio server settles it.
#
# WHAT IT DOES. Four questions, one run:
#   Q1 — Copilot: does a plugin-root token expand inside `command`, and does
#        a bare relative command resolve via Copilot's own `cwd` default?
#        Installs a probe plugin into an ISOLATED HOME three times (one
#        command form each), drives one non-interactive `copilot -p` session
#        per form, and inspects a sentinel invocation log the stub server
#        writes OUTSIDE the isolated HOME.
#   Q2 — Antigravity: does a RELATIVE command/args resolve against the
#        plugin's own directory? Installs a probe plugin into the REAL
#        Antigravity customization root (spec 0123's own precedent: a
#        uniquely-named artifact, collision-checked before write, removed on
#        exit) and drives one non-interactive `agy -p` session that asks for
#        the full MCP tool-name list. Absence of the probe tool from that
#        list, with an empty invocation log, is the negative verdict — no
#        error ever surfaces to the operator, which is exactly why this must
#        be measured rather than assumed.
#   Q3 — Antigravity: where does `agy plugin install <dir>` copy the plugin,
#        and does it rewrite anything inside `mcp_config.json`? Read directly
#        off the installed tree Q2 already produced.
#   Q4 — Collision resolution, one cell per tool. Gemini and Antigravity are
#        CITATIONS (already recorded in spec 0180's own Open Questions from
#        the vendor's own documentation) and are not re-probed here. Claude
#        and Copilot are live probes: load a plugin declaring a server name,
#        separately declare the SAME name at user/local scope, and inspect
#        which the CLI's own `mcp list`/`get` resolves to.
#
# NOT A CI GATE, for the same reason scripts/probe-antigravity-discovery.sh
# is not one: this needs the vendor binaries, live non-interactive model
# calls (billed against the operator's own subscription), and real
# credentials (`gh auth token` for Copilot). Invoked deliberately by a human
# or an agent, and its result is recorded by hand in
# docs/runbooks/extension-mcp-token-probe.md, not asserted in a test.
#
# Usage:
#   bash scripts/probe-extension-mcp-token.sh [q1|q2q3|q4|all]
#     (default: all)
#
# Preconditions: jq, copilot, agy, claude, gh (all authenticated already —
# this probe borrows the operator's own `gh auth token` for Copilot and the
# operator's own Antigravity/Claude session credentials; it isolates HOME for
# Copilot and Claude so their PLUGIN/USER config never touches the real
# ~/.copilot or ~/.claude, but it deliberately writes into and cleans up the
# REAL Antigravity customization root for Q2/Q3, mirroring
# scripts/probe-antigravity-discovery.sh's own precedent, because Antigravity
# plugin discovery has no per-invocation --plugin-dir equivalent that also
# exercises `agy plugin install`'s copy/rewrite behavior.
#
# Exit status:
#   0 — every requested question produced a definite (non-empty) answer
#   1 — precondition failure (a required binary is missing, or a probe name
#       already exists where this script needs to write)
#   2 — a probe ran but produced no definite answer (e.g. a session timed
#       out) — re-run before recording anything, do not guess

set -euo pipefail

WHAT="${1:-all}"

command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required." >&2; exit 1; }

EXIT_OK=0
EXIT_PRECONDITION=1
EXIT_INCONCLUSIVE=2
FAILED=0

# --- shared scratch -----------------------------------------------------
WORK="$(mktemp -d)"
cleanup_work() { rm -rf "$WORK"; }
trap cleanup_work EXIT

section() {
  echo ""
  echo "=========================================================="
  echo "  $1"
  echo "=========================================================="
}

# =========================================================================
# Q1 — Copilot: plugin-root token expansion inside command/args
# =========================================================================
probe_q1_copilot() {
  section "Q1 — Copilot CLI: token expansion inside command (isolated HOME)"
  command -v copilot >/dev/null 2>&1 || { echo "SKIP: copilot not on PATH"; FAILED=1; return; }
  command -v gh >/dev/null 2>&1 || { echo "SKIP: gh not on PATH (needed for a non-interactive Copilot token)"; FAILED=1; return; }

  local gh_token
  gh_token="$(gh auth token 2>/dev/null || true)"
  if [ -z "$gh_token" ]; then
    echo "SKIP: 'gh auth token' produced nothing — Copilot needs GH_TOKEN for a non-interactive session."
    FAILED=1
    return
  fi

  local plugin_dir="$WORK/copilot-plugin" log="$WORK/copilot-invocation.log"
  mkdir -p "$plugin_dir/dist"
  cat > "$plugin_dir/plugin.json" <<'EOF'
{"name":"crewrig-probe-plugin","version":"1.0.0","description":"crewrig spec 0180 probe — safe to delete"}
EOF
  cat > "$plugin_dir/dist/stub.sh" <<EOF
#!/bin/bash
{
  echo "ARGV: \$*"
  echo "CWD: \$(pwd)"
} >> "$log"
sleep 0.2
exit 0
EOF
  chmod +x "$plugin_dir/dist/stub.sh"

  local isolated_home
  local -a forms labels
  forms=('${PLUGIN_ROOT}/dist/stub.sh' '${COPILOT_PLUGIN_ROOT}/dist/stub.sh' 'dist/stub.sh')
  labels=('PLUGIN_ROOT' 'COPILOT_PLUGIN_ROOT' 'bare-relative-cwd-default')

  isolated_home="$WORK/copilot-home"
  mkdir -p "$isolated_home/.copilot"

  local i=0
  while [ "$i" -lt 3 ]; do
    local cmd="${forms[$i]}" label="${labels[$i]}"
    HOME="$isolated_home" copilot plugin uninstall crewrig-probe-plugin >/dev/null 2>&1 || true
    cat > "$plugin_dir/.mcp.json" <<EOF
{"mcpServers":{"probe-args":{"type":"stdio","command":"$cmd","args":["variant-$i"]}}}
EOF
    HOME="$isolated_home" copilot plugin install "$plugin_dir" >/dev/null 2>&1
    rm -f "$log"
    local sess_out="$WORK/copilot-session-$i.log"
    if HOME="$isolated_home" GH_TOKEN="$gh_token" timeout 60 copilot \
        -p "reply with the single word OK and call no tools" --allow-all-tools --no-color \
        </dev/null >"$sess_out" 2>&1; then :; else true; fi
    if [ -s "$log" ]; then
      echo "  form='$label' ($cmd)  ->  SPAWNED"
      sed 's/^/    /' "$log"
    else
      echo "  form='$label' ($cmd)  ->  NOT SPAWNED — session output:"
      sed 's/^/    /' "$sess_out"
      FAILED=1
    fi
    i=$((i + 1))
  done
  HOME="$isolated_home" copilot plugin uninstall crewrig-probe-plugin >/dev/null 2>&1 || true
}

# =========================================================================
# Q2/Q3 — Antigravity: relative resolution, install destination, rewriting
# =========================================================================
probe_q2q3_antigravity() {
  section "Q2/Q3 — Antigravity CLI: relative resolution, install destination (REAL customization root)"
  command -v agy >/dev/null 2>&1 || { echo "SKIP: agy not on PATH"; FAILED=1; return; }

  # Deliberately NOT `local`: cleanup_agy() below is invoked from the
  # top-level EXIT trap, which runs in the script's global scope after this
  # function has already returned — a `local` here would be unbound by the
  # time the trap fires under `set -u`, aborting cleanup before it starts and
  # leaving the real Antigravity config permanently dirtied (caught live
  # while authoring this probe: exactly that happened once).
  AGY_PROBE_NAME="crewrig-probe-mcp-token"
  AGY_PROBE_INSTALL_ROOT="$HOME/.gemini/config/plugins/$AGY_PROBE_NAME"
  if [ -e "$AGY_PROBE_INSTALL_ROOT" ]; then
    echo "ERROR: $AGY_PROBE_INSTALL_ROOT already exists — refusing to touch it." >&2
    FAILED=1
    return
  fi

  local src="$WORK/agy-plugin" log="$WORK/agy-invocation.log"
  mkdir -p "$src/dist"
  cat > "$src/plugin.json" <<EOF
{"name": "$AGY_PROBE_NAME"}
EOF
  cat > "$src/dist/stub.sh" <<EOF
#!/bin/bash
{
  echo "ARGV: \$*"
  echo "CWD: \$(pwd)"
} >> "$log"
sleep 0.2
exit 0
EOF
  chmod +x "$src/dist/stub.sh"
  cat > "$src/mcp_config.json" <<'EOF'
{"mcpServers":{"probe-args":{"command":"dist/stub.sh","args":["relative-form"],"cwd":""}}}
EOF

  # Global function (not nested), reachable from the trap in any scope.
  # shellcheck disable=SC2317  # invoked via trap, not a dead call
  cleanup_agy() {
    agy plugin uninstall "$AGY_PROBE_NAME" >/dev/null 2>&1 || true
    rm -rf "$AGY_PROBE_INSTALL_ROOT"
    if [ -f "$HOME/.gemini/config/config.json" ]; then
      local tmp
      tmp="$(mktemp)"
      jq --arg n "$AGY_PROBE_NAME" 'del(.plugins[$n])' "$HOME/.gemini/config/config.json" > "$tmp" \
        && /bin/mv -f "$tmp" "$HOME/.gemini/config/config.json" \
        || rm -f "$tmp"
    fi
  }
  trap 'cleanup_agy; cleanup_work' EXIT

  echo "Installing probe plugin '$AGY_PROBE_NAME'..."
  agy plugin install "$src" >/dev/null 2>&1
  agy plugin enable "$AGY_PROBE_NAME" >/dev/null 2>&1 || true

  echo ""
  echo "-- Q3: installed location and rewrite check --"
  if [ -f "$AGY_PROBE_INSTALL_ROOT/mcp_config.json" ]; then
    echo "  installed at: $AGY_PROBE_INSTALL_ROOT  (matches the documented plugins/<name>/mcp_config.json root)"
    if diff -q "$src/mcp_config.json" "$AGY_PROBE_INSTALL_ROOT/mcp_config.json" >/dev/null 2>&1; then
      echo "  VERDICT: agy plugin install copies mcp_config.json VERBATIM — no token/path rewriting at install."
    else
      echo "  VERDICT: installed mcp_config.json DIFFERS from source — agy DID rewrite something:"
      diff "$src/mcp_config.json" "$AGY_PROBE_INSTALL_ROOT/mcp_config.json" | sed 's/^/    /' || true
    fi
  else
    echo "  FAIL: $AGY_PROBE_INSTALL_ROOT/mcp_config.json was not created by the install."
    FAILED=1
  fi

  echo ""
  echo "-- Q2: relative command resolution (live session, forced tool-name listing) --"
  rm -f "$log"
  local sess_out="$WORK/agy-session.log"
  if timeout 90 agy -p "List the names of every MCP tool available to you in this session, one per line, exactly as they are named, and nothing else." \
      </dev/null >"$sess_out" 2>&1; then :; else true; fi
  if grep -q "probe-args" "$sess_out" 2>/dev/null; then
    echo "  VERDICT: 'probe-args' IS in the tool list with a bare relative command — relative resolution WORKS."
    if [ -s "$log" ]; then echo "  (and the stub actually ran — spawn confirmed)"; fi
  else
    echo "  VERDICT: 'probe-args' is ABSENT from the tool list — relative resolution FAILS SILENTLY"
    echo "           (no error surfaced to the operator; the tool is simply missing)."
    if [ -s "$log" ]; then
      echo "  UNEXPECTED: the invocation log is non-empty even though the tool was not listed:"
      sed 's/^/    /' "$log"
    fi
  fi
  echo "  (full tool listing saved for inspection: $sess_out)"
  sed 's/^/    /' "$sess_out"
}

# =========================================================================
# Q4 — collision resolution: Claude and Copilot (live); Gemini/Antigravity
# are citations, recorded in the runbook, not re-probed here.
# =========================================================================
probe_q4_claude() {
  section "Q4 (Claude) — extension-declared vs user-scope name collision"
  command -v claude >/dev/null 2>&1 || { echo "SKIP: claude not on PATH"; FAILED=1; return; }

  local plugin_dir="$WORK/claude-plugin" isolated_home="$WORK/claude-home"
  mkdir -p "$plugin_dir/.claude-plugin" "$isolated_home"
  cat > "$plugin_dir/.claude-plugin/plugin.json" <<'EOF'
{"name": "crewrig-probe-plugin", "description": "probe", "version": "1.0.0"}
EOF
  cat > "$plugin_dir/.mcp.json" <<'EOF'
{"mcpServers":{"probe-args":{"command":"echo","args":["plugin-scope"]}}}
EOF

  HOME="$isolated_home" claude mcp add --scope user probe-args -- echo user-scope-command >/dev/null 2>&1

  local out
  out="$(HOME="$isolated_home" claude --plugin-dir "$plugin_dir" mcp list 2>&1 || true)"
  echo "$out" | sed 's/^/  /'
  if echo "$out" | grep -q "^plugin:crewrig-probe-plugin:probe-args:" && echo "$out" | grep -qE "^probe-args:"; then
    echo "  VERDICT: Claude NAMESPACES the plugin server as plugin:<pluginName>:<serverName> — it never collides"
    echo "           with a same-named user/project-scope entry; both remain independently addressable."
  else
    echo "  INCONCLUSIVE: expected both a namespaced 'plugin:...' line and a bare 'probe-args:' line."
    FAILED=1
  fi
}

probe_q4_copilot() {
  section "Q4 (Copilot) — extension-declared vs user-scope name collision"
  command -v copilot >/dev/null 2>&1 || { echo "SKIP: copilot not on PATH"; FAILED=1; return; }

  local plugin_dir="$WORK/copilot-plugin-q4" isolated_home="$WORK/copilot-home-q4"
  mkdir -p "$plugin_dir/dist" "$isolated_home/.copilot"
  cat > "$plugin_dir/plugin.json" <<'EOF'
{"name":"crewrig-probe-plugin-q4","version":"1.0.0","description":"probe"}
EOF
  cat > "$plugin_dir/.mcp.json" <<'EOF'
{"mcpServers":{"probe-args":{"type":"stdio","command":"echo","args":["plugin-scope"]}}}
EOF
  HOME="$isolated_home" copilot plugin install "$plugin_dir" >/dev/null 2>&1
  HOME="$isolated_home" copilot mcp add probe-args -- echo user-scope-command >/dev/null 2>&1 || true

  local out
  out="$(HOME="$isolated_home" copilot mcp get probe-args --json 2>&1 || true)"
  echo "$out" | sed 's/^/  /'
  if echo "$out" | grep -q '"source": "plugin"'; then
    echo "  VERDICT: Copilot resolves the collision in favour of the PLUGIN-sourced entry —"
    echo "           the user-scope declaration is shadowed, not merged and not an error."
  elif echo "$out" | grep -q '"source": "user"'; then
    echo "  VERDICT: Copilot resolves the collision in favour of the USER-scope entry."
  else
    echo "  INCONCLUSIVE: could not determine which entry won."
    FAILED=1
  fi
  HOME="$isolated_home" copilot plugin uninstall crewrig-probe-plugin-q4 >/dev/null 2>&1 || true
}

case "$WHAT" in
  q1) probe_q1_copilot ;;
  q2q3) probe_q2q3_antigravity ;;
  q4) probe_q4_claude; probe_q4_copilot ;;
  all)
    probe_q1_copilot
    probe_q2q3_antigravity
    probe_q4_claude
    probe_q4_copilot
    ;;
  *)
    echo "Usage: $0 [q1|q2q3|q4|all]" >&2
    exit "$EXIT_PRECONDITION"
    ;;
esac

echo ""
echo "Record the verdicts above in docs/runbooks/extension-mcp-token-probe.md,"
echo "stamped with each CLI's version and the date."

if [ "$FAILED" -ne 0 ]; then
  exit "$EXIT_INCONCLUSIVE"
fi
exit "$EXIT_OK"
