#!/usr/bin/env bash
# test-chroma-health-race.sh — Regression test for issue #138.
#
# The health-check block at the tail of `install_chroma_daemon`
# (scripts/lib/common.sh, around lines 170-180) runs a SINGLE
# invocation of `scripts/status-chroma-server.sh` immediately after
# launchctl/systemctl has loaded the daemon unit. The daemon needs a
# few seconds to bind 127.0.0.1:8001, so the one-shot check almost
# always fails on first run; rerunning the setup succeeds because by
# then the daemon is up.
#
# This test locks in the contract that the health check MUST poll the
# status script (mirroring the 15s / 0.3s pattern of
# `scripts/start-chroma-server.sh` lines 65-80) instead of relying on
# a single invocation.
#
# Strategy
# --------
# 1. Stand up a sandbox `$repo_dir` containing a stub
#    `scripts/status-chroma-server.sh` that returns non-zero for the
#    first ~2 seconds (using a timestamp marker file) and exits 0
#    afterwards — a deterministic simulation of the real race.
# 2. Extract the health-check block from the live `common.sh` source
#    (between the `# Health check` marker and the `else` branch of
#    the surrounding `if [ -x ... ]`). This guarantees the test
#    exercises the actual shipped logic, not a paraphrase.
# 3. Execute the extracted block with `repo_dir` pointing at the
#    sandbox. Assert exit code 0.
#
# Expected behaviour:
#   - Against current main (one-shot check) → block exits 1. FAIL.
#   - After the developer adds a polling loop                → block exits 0. PASS.

set -uo pipefail

PASS=0
FAIL=0

note_pass() { echo "PASS  $1"; PASS=$((PASS + 1)); }
note_fail() { echo "FAIL  $1 — $2"; FAIL=$((FAIL + 1)); }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMMON_SH="${REPO_DIR}/scripts/lib/common.sh"

if [[ ! -f "$COMMON_SH" ]]; then
  note_fail "setup" "missing $COMMON_SH"
  echo "Results: $PASS passed, $FAIL failed"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# Build sandbox repo_dir with a slow-start stub status script.
# ─────────────────────────────────────────────────────────────────────────────
SANDBOX="$(mktemp -d -t chroma-health-race.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT INT TERM

mkdir -p "${SANDBOX}/scripts"
MARKER="${SANDBOX}/started_at"
date +%s > "$MARKER"

# Slow-start stub: exits 1 until 2 seconds have elapsed since marker,
# then exits 0. Mirrors the real race where chroma needs a moment to
# bind its port before the heartbeat endpoint answers.
cat > "${SANDBOX}/scripts/status-chroma-server.sh" <<'STUB'
#!/usr/bin/env bash
set -u
marker_file="$(dirname "$0")/../started_at"
if [[ ! -f "$marker_file" ]]; then
  echo "stub: missing marker $marker_file" >&2
  exit 2
fi
started_at="$(cat "$marker_file")"
now="$(date +%s)"
elapsed=$((now - started_at))
if (( elapsed < 2 )); then
  echo "stub: daemon not ready yet (elapsed=${elapsed}s)" >&2
  exit 1
fi
echo "stub: daemon healthy (elapsed=${elapsed}s)"
exit 0
STUB
chmod +x "${SANDBOX}/scripts/status-chroma-server.sh"

# ─────────────────────────────────────────────────────────────────────────────
# Extract the health-check block from the live common.sh.
#
# We grab the lines from the `# Health check` comment marker up to
# (and including) the closing brace of `install_chroma_daemon`. Using
# the function's closing `}` as the terminator is robust against the
# fix introducing additional `return 0` statements inside a polling
# loop body.
# ─────────────────────────────────────────────────────────────────────────────
BLOCK="$(awk '
  /^  # Health check/ { capture = 1 }
  capture && /^}$/    { exit }
  capture             { print }
' "$COMMON_SH")"

if [[ -z "$BLOCK" ]]; then
  note_fail "extract health-check block" \
    "could not locate '# Health check' marker in $COMMON_SH"
  echo ""
  echo "Results: $PASS passed, $FAIL failed"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# Test 1 — Behavioural: the health-check block must survive a 2-second
# slow start. Against the one-shot code on main this fails; once the
# developer adds a retry loop (mirroring start-chroma-server.sh lines
# 65-80), it passes.
# ─────────────────────────────────────────────────────────────────────────────
HARNESS="$(mktemp -t chroma-health-race-harness.XXXXXX.sh)"
trap 'rm -rf "$SANDBOX" "$HARNESS"' EXIT INT TERM
{
  echo '#!/usr/bin/env bash'
  echo 'set -uo pipefail'
  # Wrap the extracted block in a function so the literal `return N`
  # statements inside it behave as in the real `install_chroma_daemon`
  # (which IS a function). Outside a function, `return` is either a
  # no-op or an error depending on the bash version, which would mask
  # the bug under test.
  echo 'health_check() {'
  echo '  local repo_dir="$1"'
  echo "${BLOCK}"
  echo '}'
  echo 'health_check "$1"'
  echo 'exit $?'
} > "$HARNESS"
chmod +x "$HARNESS"

block_out="$(bash "$HARNESS" "$SANDBOX" 2>&1)"
block_rc=$?

if (( block_rc == 0 )); then
  note_pass "health-check polls slow-starting daemon (race-tolerant)"
else
  note_fail "health-check polls slow-starting daemon (race-tolerant)" \
    "block exited rc=${block_rc} on a daemon that becomes healthy after 2s. Output:
${block_out}"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Test 2 — Static: the health-check block must contain a retry loop
# construct. A grep guard so a future refactor cannot regress to a
# single-shot check while still passing Test 1 on a fast machine.
#
# We accept any of:
#   - a `while`/`until` loop in the health-check block
#   - a `for` loop in the health-check block
#   - a recognisable `deadline=` / `SECONDS` budget marker
#     (matches the convention used by scripts/start-chroma-server.sh)
# ─────────────────────────────────────────────────────────────────────────────
if echo "$BLOCK" | grep -Eq '(\bwhile\b|\buntil\b|\bfor\b|deadline=|SECONDS)'; then
  note_pass "health-check block contains a polling construct"
else
  note_fail "health-check block contains a polling construct" \
    "no while/until/for/deadline/SECONDS marker in the extracted block — \
the health check is still a one-shot invocation. Block was:
${BLOCK}"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
if (( FAIL > 0 )); then
  exit 1
fi
exit 0
