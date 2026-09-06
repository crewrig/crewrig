#!/bin/bash
# test-check-component-metadata-keys.sh — Regression test for
# check-component-metadata-keys.sh (spec 0200 R8-R12, R38's first mutation).
#
# Mirrors the scripts/tests/test-check-agent-profiles.sh idiom: `set -uo
# pipefail` (exit behavior asserted via explicit counters, never -e),
# mktemp -d + trap, render_* fixture generators, a run_case pass/fail
# counter, and a closing `[ "$fail" -eq 0 ]`.
#
# Sections:
#   1. The migrated shape green, the legacy key red (R38's first mutation),
#      a metadata:-less source green, a top-level claude: section green (R9).
#   2. Tier scoping — a community/ and an org/ fixture carrying
#      metadata.claude are green (R8's last clause), placed under a scratch
#      root so the tree offers a live witness (both real tiers hold only
#      empty scaffolds).
#   3. Named-file mode input errors and exit-2 with yq stripped from PATH.
#
# Usage:
#   bash scripts/tests/test-check-component-metadata-keys.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-component-metadata-keys.sh"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi

command -v yq >/dev/null 2>&1 || {
  echo "FATAL: yq is required to build fixtures for this suite." >&2
  exit 2
}

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

run_case() {
  # run_case <name> <expected-exit> "<space-separated expected assertion ids, or empty>" <file...>
  local name="$1" expected_exit="$2" expected_ids="$3"
  shift 3
  local out actual_exit=0 ok=1 id
  out=$(bash "$SCRIPT_UNDER_TEST" "$@" 2>&1) || actual_exit=$?
  if [ "$actual_exit" -ne "$expected_exit" ]; then
    ok=0
  fi
  if [ -n "$expected_ids" ]; then
    for id in $expected_ids; do
      printf '%s\n' "$out" | grep -qF ": ${id} " || ok=0
    done
  fi
  if [ "$ok" -eq 1 ]; then
    echo "PASS  $name (exit $actual_exit${expected_ids:+, saw: $expected_ids})"
    pass=$((pass + 1))
  else
    echo "FAIL  $name (expected exit $expected_exit${expected_ids:+ with: $expected_ids}, got exit $actual_exit)"
    echo "  --- output ---"
    printf '%s\n' "$out" | sed 's/^/  /'
    echo "  --------------"
    fail=$((fail + 1))
  fi
}

# render_fixture <root> <rel-path> — writes the frontmatter+body given on
# stdin to <root>/<rel-path>, creating parent directories, and echoes the
# full path.
render_fixture() {
  local root="$1" rel="$2" f
  f="$root/$rel"
  mkdir -p "$(dirname "$f")"
  cat > "$f"
  echo "$f"
}

echo "=== Section 1 — the migrated shape, the legacy key, and R9's top-level exemption ==="

# --- the migrated shape (metadata: {model, provenance}) is green ------------
f="$(render_fixture "$TMP_ROOT" artifacts/core/agents/probe-migrated/AGENT.md <<'EOF'
---
name: probe
description: "Fixture: the post-migration shape."
metadata:
  model:
    intelligence: high
  provenance:
    canonical: "x"
    version: "1.0.0"
---
Body.
EOF
)"
run_case "migrated shape (metadata: {model, provenance}) is green" 0 "" "$f"

# --- R38's first mutation: the legacy key is rejected, naming metadata.claude
f="$(render_fixture "$TMP_ROOT" artifacts/core/agents/probe-legacy/AGENT.md <<'EOF'
---
name: probe
description: "Fixture: the legacy key re-introduced."
metadata:
  claude:
    model: sonnet
  provenance:
    canonical: "x"
    version: "1.0.0"
---
Body.
EOF
)"
run_case "R38 mutation 1 — metadata.claude is rejected, naming the metadata: path" 1 "K1" "$f"
out="$(bash "$SCRIPT_UNDER_TEST" "$f" 2>&1)" || true
if printf '%s\n' "$out" | grep -qF 'metadata.claude'; then
  echo "PASS  rejection names metadata.claude, not the top-level section"
  pass=$((pass + 1))
else
  echo "FAIL  rejection names metadata.claude, not the top-level section"
  echo "  --- output ---"
  printf '%s\n' "$out" | sed 's/^/  /'
  fail=$((fail + 1))
fi

# --- the legacy key alongside a migrated model: mapping is still rejected ---
f="$(render_fixture "$TMP_ROOT" artifacts/core/agents/probe-both/AGENT.md <<'EOF'
---
name: probe
description: "Fixture: the legacy key re-introduced alongside a migrated profile."
metadata:
  claude:
    model: sonnet
  model:
    intelligence: high
  provenance:
    canonical: "x"
    version: "1.0.0"
---
Body.
EOF
)"
run_case "metadata.claude alongside metadata.model is still rejected" 1 "K1" "$f"

# --- a metadata:-less source is green ----------------------------------------
f="$(render_fixture "$TMP_ROOT" artifacts/core/skills/probe-none/SKILL.md <<'EOF'
---
name: probe
description: "Fixture: no metadata: block at all."
---
Body.
EOF
)"
run_case "no metadata: block at all is green" 0 "" "$f"

# --- R9: a top-level claude: section survives, never named -----------------
f="$(render_fixture "$TMP_ROOT" artifacts/core/agents/probe-toplevel/AGENT.md <<'EOF'
---
name: probe
description: "Fixture: a top-level claude: section, a legal override surface."
metadata:
  model:
    intelligence: high
  provenance:
    canonical: "x"
    version: "1.0.0"
claude:
  allowed-tools:
    - Bash
---
Body.
EOF
)"
run_case "R9 — a top-level claude: section is green (legal override surface)" 0 "" "$f"

echo ""
echo "=== Section 2 — tier scoping (R8's last clause) ==="

# --- community/ tier: the legacy key is never rejected there ---------------
f="$(render_fixture "$TMP_ROOT" artifacts/community/agents/probe/AGENT.md <<'EOF'
---
name: probe
description: "Fixture: an adopter-owned community/ source carrying the legacy key."
metadata:
  claude:
    model: sonnet
  provenance:
    canonical: "x"
    version: "1.0.0"
---
Body.
EOF
)"
run_case "community/ carrying metadata.claude is green (R8 last clause)" 0 "" "$f"

# --- org/ tier: same -----------------------------------------------------
f="$(render_fixture "$TMP_ROOT" artifacts/org/agents/probe/AGENT.md <<'EOF'
---
name: probe
description: "Fixture: an adopter-owned org/ source carrying the legacy key."
metadata:
  claude:
    model: sonnet
  provenance:
    canonical: "x"
    version: "1.0.0"
---
Body.
EOF
)"
run_case "org/ carrying metadata.claude is green (R8 last clause)" 0 "" "$f"

echo ""
echo "=== Section 3 — default-glob mode over the real tree, and prerequisite failures ==="

# --- default-glob mode over the real repository: 45 sources, currently clean
out="$(bash "$SCRIPT_UNDER_TEST" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -qE '^OK: 45 source\(s\) checked'; then
  echo "PASS  default-glob mode reports 45 sources, clean"
  pass=$((pass + 1))
else
  echo "FAIL  default-glob mode reports 45 sources, clean (exit $rc)"
  printf '%s\n' "$out" | sed 's/^/  /'
  fail=$((fail + 1))
fi

# --- a named argument that does not exist is a prerequisite failure (exit 2)
out="$(bash "$SCRIPT_UNDER_TEST" "$TMP_ROOT/does-not-exist.md" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ]; then
  echo "PASS  exit 2 — named argument does not exist"
  pass=$((pass + 1))
else
  echo "FAIL  exit 2 — named argument does not exist (got exit $rc): $out"
  fail=$((fail + 1))
fi

# --- exit 2, yq absent from PATH --------------------------------------------
f="$(render_fixture "$TMP_ROOT" artifacts/core/agents/probe-noyq/AGENT.md <<'EOF'
---
name: probe
description: "Fixture."
---
Body.
EOF
)"
BASH_ABS="$(command -v bash)"
out="$(PATH=/nonexistent-dir-for-this-test "$BASH_ABS" "$SCRIPT_UNDER_TEST" "$f" 2>&1)"; rc=$?
if [ "$rc" -eq 2 ]; then
  echo "PASS  exit 2 — yq absent from PATH"
  pass=$((pass + 1))
else
  echo "FAIL  exit 2 — yq absent from PATH (got exit $rc): $out"
  fail=$((fail + 1))
fi

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
