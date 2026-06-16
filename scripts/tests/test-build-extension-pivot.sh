#!/bin/bash
# test-build-extension-pivot.sh — Regression tests for the extension pivot
# renderer (spec 0042).
#
# Cases:
#   1. Round-trip on hello-world: a fresh render of commands/hello.md is
#      byte-identical to the committed commands/hello.toml (drift-gate self-test).
#   2. Carrier round-trip on a SYNTHETIC fixture: an extension whose
#      commands/x.md carries a metadata.provenance block renders to a .toml that
#      (i) parses as valid TOML AND (ii) contains the `# crewrig-provenance:`
#      comment line — the live proof of the format-specific R5 carrier.
#   3. No-op safety: a command with NO provenance renders a .toml that parses as
#      valid TOML and contains NO provenance comment.
#   4. Claude render: build-claude-plugin.sh renders the pivot hello.md to a
#      SKILL.md whose body is NON-EMPTY (regression-locks the empty-prompt bug
#      that the old .toml-sed extraction produced on single-quoted prompts).
#
# Usage:
#   bash scripts/tests/test-build-extension-pivot.sh
#
# -e is intentionally omitted: outcomes are asserted via explicit pass/fail
# counters.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RENDER="$SCRIPT_DIR/build-extension-pivot.sh"
CLAUDE_PLUGIN="$SCRIPT_DIR/build-claude-plugin.sh"

if [ ! -f "$RENDER" ]; then
  echo "FATAL: cannot find $RENDER" >&2
  exit 2
fi

# --- F6 preflight: the carrier round-trip validates TOML via python3/tomllib,
# which requires Python >= 3.11. Mirror the repo's tool-guard idiom rather than
# silently skipping (a skip would let a real carrier regression pass unnoticed).
if ! command -v python3 >/dev/null 2>&1; then
  echo "FATAL: python3 is required for the TOML carrier round-trip test." >&2
  echo "       Install Python >= 3.11 (ships tomllib in the standard library)." >&2
  exit 2
fi
if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
  echo "FATAL: Python >= 3.11 is required (tomllib was added in 3.11)." >&2
  echo "       Found: $(python3 --version 2>&1). Please upgrade." >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

ok()   { echo "PASS  $1"; pass=$((pass + 1)); }
ng()   { echo "FAIL  $1"; fail=$((fail + 1)); }

# Validate a file parses as TOML; echo "ok" or the error.
toml_parses() {
  python3 -c 'import tomllib,sys; tomllib.load(open(sys.argv[1],"rb"))' "$1" 2>&1
}

# -------------------------------------------------------------------------
# Case 1 — round-trip on the live hello-world fixture (drift-gate self-test)
# -------------------------------------------------------------------------
src="$REPO_DIR/extensions/core/hello-world/commands/hello.md"
committed="$REPO_DIR/extensions/core/hello-world/commands/hello.toml"
if [ -f "$src" ] && [ -f "$committed" ]; then
  # A clean --check on the live tree must pass (no drift).
  if ( cd "$REPO_DIR" && bash "$RENDER" hello-world --check ) >/dev/null 2>&1; then
    ok "Case 1 — committed hello.toml matches a fresh render of hello.md"
  else
    ng "Case 1 — committed hello.toml drifts from hello.md"
  fi
else
  ng "Case 1 — hello-world pivot/committed fixture missing (src=$src committed=$committed)"
fi

# -------------------------------------------------------------------------
# Case 2 — carrier round-trip on a SYNTHETIC provenance-bearing fixture
# -------------------------------------------------------------------------
syn="$TMP_ROOT/extensions/core/synth/commands"
mkdir -p "$syn"
cat > "$syn/x.md" <<'EOF'
---
name: x
description: "Synthetic command carrying provenance"
type: command
metadata:
  provenance:
    version: "1.0.0"
    canonical: "https://example.com/owner/repo"
    feedback: "https://example.com/owner/repo"
---

Do the synthetic thing.
EOF

# Render in BUILD mode against the synthetic extension dir.
( cd "$TMP_ROOT" && bash "$RENDER" "$syn/.." ) >/dev/null 2>&1
rendered="$syn/x.toml"

if [ ! -f "$rendered" ]; then
  ng "Case 2 — renderer did not emit $rendered"
else
  parse_err="$(toml_parses "$rendered")"
  if [ -z "$parse_err" ]; then
    ok "Case 2a — provenance-bearing .toml parses as valid TOML"
  else
    ng "Case 2a — provenance-bearing .toml is INVALID TOML: $parse_err"
  fi

  if grep -q '^# crewrig-provenance: version="1.0.0" canonical="https://example.com/owner/repo" feedback="https://example.com/owner/repo"$' "$rendered"; then
    ok "Case 2b — .toml carries the # crewrig-provenance: comment line"
  else
    ng "Case 2b — .toml is missing the # crewrig-provenance: comment line"
  fi

  # The provenance line must NOT leak into the prompt string.
  prompt_val="$(python3 -c 'import tomllib,sys; print(tomllib.load(open(sys.argv[1],"rb"))["prompt"])' "$rendered" 2>/dev/null)"
  case "$prompt_val" in
    *crewrig-provenance*) ng "Case 2c — provenance leaked into the prompt body" ;;
    *) ok "Case 2c — prompt body is free of the provenance comment" ;;
  esac
fi

# -------------------------------------------------------------------------
# Case 3 — no-op safety: a command WITHOUT provenance renders valid TOML with
# no provenance comment
# -------------------------------------------------------------------------
noprov="$TMP_ROOT/extensions/core/plain/commands"
mkdir -p "$noprov"
cat > "$noprov/y.md" <<'EOF'
---
name: y
description: "Plain command, no provenance"
type: command
---

Just a plain prompt.
EOF
( cd "$TMP_ROOT" && bash "$RENDER" "$noprov/.." ) >/dev/null 2>&1
rendered_plain="$noprov/y.toml"
if [ -f "$rendered_plain" ] && [ -z "$(toml_parses "$rendered_plain")" ] \
   && ! grep -q 'crewrig-provenance' "$rendered_plain"; then
  ok "Case 3 — no-provenance command renders valid TOML with no carrier comment"
else
  ng "Case 3 — no-provenance command render is wrong (file=$rendered_plain)"
fi

# -------------------------------------------------------------------------
# Case 4 — Claude render of the pivot hello.md yields a NON-EMPTY SKILL.md body
# -------------------------------------------------------------------------
if [ -f "$CLAUDE_PLUGIN" ]; then
  out="$TMP_ROOT/plugin-out"
  ( cd "$REPO_DIR" && bash "$CLAUDE_PLUGIN" hello-world "$out" ) >/dev/null 2>&1
  skill="$out/skills/hello/SKILL.md"
  if [ -f "$skill" ]; then
    # Body = everything after the second --- fence. Must contain the prompt text.
    body="$(awk 'BEGIN{c=0} /^---$/{c++; if(c==2){found=1; next}} found{print}' "$skill" | tr -d '[:space:]')"
    if [ -n "$body" ] && grep -q "This prompt comes from the hello-world extension" "$skill"; then
      ok "Case 4 — Claude SKILL.md body is non-empty (empty-prompt bug fixed)"
    else
      ng "Case 4 — Claude SKILL.md body is empty or missing the prompt text"
    fi
  else
    ng "Case 4 — Claude plugin did not emit skills/hello/SKILL.md"
  fi
else
  ng "Case 4 — build-claude-plugin.sh not found"
fi

# -------------------------------------------------------------------------
echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
