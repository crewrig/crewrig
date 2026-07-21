#!/bin/bash
# test-mempalace-transcript-hook.sh — Regression tests for hooks/mempalace-transcript.sh.
#
# Pins the contracts surfaced by issues #90–#94:
#
#   #90 — Direct Python import causes SQLite contention.
#         The Python invocation MUST be guarded by the resolved timeout
#         wrapper (`${_HOOK_TIMEOUT:+... 5}`, resolved at init to `timeout`
#         or `gtimeout`) so a hung MemPalace lock cannot stall the calling
#         CLI. Checked structurally against that wrapper shape (PR #211).
#
#   #91 — Hook fires on every PostToolUse — too frequent for parallel agents.
#         When the hook event is `PostToolUse`, the script MUST exit 0
#         WITHOUT spawning the Python subprocess.
#
#   #92 — PROJECT_NAME wrong in git worktrees.
#         PROJECT_DIR derivation MUST use `git rev-parse --show-toplevel`,
#         not `basename "$(pwd)"`, so that worktree paths resolve to the
#         canonical repository root.
#
#   #93 — stderr silently swallowed.
#         The Python invocation MUST NOT merge stderr into stdout via
#         `2>&1` — that hides import errors and MemPalace failures from
#         the log line.
#
#   #94 — No timeout guard at runtime.
#         The timeout applied to the Python call is now conditional and
#         portable (PR #211): the guard fires when a `timeout`/`gtimeout`
#         binary is available, and degrades to a deliberate, logged no-op
#         when neither is on PATH. The check is behavioral — it proves the
#         guard actually kills a hung Python within the 5s budget — and
#         SKIPs gracefully on hosts where no timeout binary exists.
#
#   spec 0073 / issue #508 — Route through the shared ChromaDB HTTP daemon.
#         The heredoc's Python payload MUST route through
#         `chromadb.HttpClient` (ADR-0006) instead of constructing a
#         `chromadb.PersistentClient` against the on-disk palace, and MUST
#         degrade to a soft, logged, non-blocking skip (exit 4,
#         `DAEMON_UNREACHABLE:` on stderr) when the daemon is unreachable —
#         never falling back to `PersistentClient`.
#
# Usage:
#   bash scripts/tests/test-mempalace-transcript-hook.sh
#
# Exit code: 0 if all tests pass, 1 if any test fails.

# -e is intentionally omitted: pass/fail is tracked through counters.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$SCRIPT_DIR/hooks/mempalace-transcript.sh"

if [ ! -f "$HOOK" ]; then
  echo "FATAL: cannot find $HOOK" >&2
  exit 2
fi

pass=0
fail=0
skip=0

record() {
  local outcome="$1"
  local name="$2"
  local detail="${3:-}"
  if [ "$outcome" = "PASS" ]; then
    echo "PASS  $name${detail:+ — $detail}"
    pass=$((pass + 1))
  elif [ "$outcome" = "SKIP" ]; then
    echo "SKIP  $name${detail:+ — $detail}"
    skip=$((skip + 1))
  else
    echo "FAIL  $name${detail:+ — $detail}"
    fail=$((fail + 1))
  fi
}

# -------------------------------------------------------------------------
# Test 1 — Issue #90: Python call must be fronted by the resolved timeout
# wrapper.
#
# Structural check: PR #211 replaced the literal `timeout ` keyword with a
# portable wrapper, `${_HOOK_TIMEOUT:+$_HOOK_TIMEOUT 5}`, resolved at script
# init to `timeout` or `gtimeout` (portable detection). Assert that the
# Python invocation is fronted by that wrapper carrying a numeric budget,
# rather than grepping for a literal `timeout` keyword that no longer exists.
# -------------------------------------------------------------------------
if grep -nE '\$\{_HOOK_TIMEOUT:\+[^}]*[0-9]+[^}]*\}[[:space:]]+"\$MEMPALACE_PYTHON"' "$HOOK" >/dev/null; then
  record PASS "issue-90: Python invocation fronted by resolved timeout wrapper"
else
  record FAIL "issue-90: Python invocation fronted by resolved timeout wrapper" \
    "no \`\${_HOOK_TIMEOUT:+... <n>} \"\$MEMPALACE_PYTHON\"\` pattern found in $HOOK"
fi

# -------------------------------------------------------------------------
# Test 2 — Issue #91: PostToolUse events must NOT spawn Python.
#
# Behavioral test. We point MEMPALACE_PYTHON to a wrapper that creates a
# marker file whenever it is invoked, then feed a `PostToolUse` hook event
# to the script on stdin. If the wrapper ran, the marker exists → FAIL
# (the hook is still firing Python on PostToolUse).
# -------------------------------------------------------------------------
TMPDIR_T2="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T2"' EXIT

MARKER="$TMPDIR_T2/python-was-called"
FAKE_PY="$TMPDIR_T2/fake-python"
cat > "$FAKE_PY" <<EOF
#!/bin/bash
touch "$MARKER"
# Drain stdin so the heredoc does not deadlock.
cat >/dev/null
echo "OK"
exit 0
EOF
chmod +x "$FAKE_PY"

POST_TOOL_JSON='{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}'

(
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  export MEMPALACE_PYTHON="$FAKE_PY"
  printf '%s' "$POST_TOOL_JSON" | bash "$HOOK" >/dev/null 2>&1
) || true

if [ -f "$MARKER" ]; then
  record FAIL "issue-91: PostToolUse skipped (no Python spawn)" \
    "marker file was created — Python ran on PostToolUse"
else
  record PASS "issue-91: PostToolUse skipped (no Python spawn)"
fi

# -------------------------------------------------------------------------
# Test 3 — Issue #92: PROJECT_DIR derivation must use git rev-parse.
#
# Static check: the script must reference `git rev-parse --show-toplevel`
# so that worktree paths resolve to the canonical repo root rather than
# the worktree directory basename.
# -------------------------------------------------------------------------
if grep -nE 'git[[:space:]]+rev-parse[[:space:]]+--show-toplevel' "$HOOK" >/dev/null; then
  record PASS "issue-92: PROJECT_DIR uses git rev-parse --show-toplevel"
else
  record FAIL "issue-92: PROJECT_DIR uses git rev-parse --show-toplevel" \
    "no \`git rev-parse --show-toplevel\` call found in $HOOK"
fi

# -------------------------------------------------------------------------
# Test 4 — Issue #93: stderr must not be merged into stdout.
#
# Static check: the line that invokes "$MEMPALACE_PYTHON" must NOT carry
# a `2>&1` redirection. Merging stderr into stdout hides MemPalace import
# errors behind the captured "STATUS" string and breaks log triage.
# -------------------------------------------------------------------------
PY_LINE="$(grep -nE '"\$MEMPALACE_PYTHON"' "$HOOK" || true)"
if [ -z "$PY_LINE" ]; then
  record FAIL "issue-93: stderr not merged with stdout on Python call" \
    "cannot locate \$MEMPALACE_PYTHON invocation line"
elif echo "$PY_LINE" | grep -q '2>&1'; then
  record FAIL "issue-93: stderr not merged with stdout on Python call" \
    "found '2>&1' on Python invocation: $PY_LINE"
else
  record PASS "issue-93: stderr not merged with stdout on Python call"
fi

# -------------------------------------------------------------------------
# Test 5 — Issue #94: the timeout guard must actually fire at runtime.
#
# Behavioral test (replaces the old static `timeout <n>` grep, which PR #211
# invalidated by resolving the guard through the `${_HOOK_TIMEOUT:+... 5}`
# wrapper instead of a literal keyword). We prove the guard behaviorally,
# modeled on test 2's fake-python + stdin feed and test 6's `date +%s`
# timing:
#
#   - Point MEMPALACE_PYTHON at a fake that drains stdin then sleeps 15s —
#     well past the hook's 5s budget.
#   - Feed a `Stop` event so CONTENT is set and the Python call is reached.
#   - When a `timeout`/`gtimeout` binary is available, measure wall-clock:
#     the guard must return in well under the sleep → PASS; otherwise FAIL
#     with the elapsed time.
#   - When neither binary is on PATH, the runtime guard is intentionally
#     absent (logged degradation — PR #211), so SKIP rather than run the
#     15s sleep and hang the suite.
# -------------------------------------------------------------------------
TMPDIR_T5="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T2" "$TMPDIR_T5"' EXIT

if command -v timeout >/dev/null 2>&1 || command -v gtimeout >/dev/null 2>&1; then
  MARKER_T5="$TMPDIR_T5/python-was-called"
  SLOW_PY="$TMPDIR_T5/slow-python"
  cat > "$SLOW_PY" <<EOF
#!/bin/bash
touch "$MARKER_T5"          # prove the hung Python path was actually reached
cat >/dev/null   # drain the heredoc so it does not deadlock
sleep 15
echo "OK"
EOF
  chmod +x "$SLOW_PY"

  STOP_JSON='{"hook_event_name":"Stop"}'
  START_T5=$(date +%s)
  (
    export MEMPALACE_TRANSCRIPT_ENABLED=1
    export MEMPALACE_PYTHON="$SLOW_PY"
    printf '%s' "$STOP_JSON" | bash "$HOOK" >/dev/null 2>&1
  ) || true
  ELAPSED_T5=$(( $(date +%s) - START_T5 ))

  # Two-sided assertion: the marker proves the slow Python was actually
  # invoked (guards against a regression that stops the Stop event from
  # reaching the Python call — which would return in ~0s and otherwise
  # PASS a bare upper bound, a silent false-positive). The lower bound
  # (>=4s) proves the 5s budget was genuinely waited out; the upper bound
  # proves the guard then fired instead of hanging for the full 15s sleep.
  # The ceiling is set to 12s (not a tight 8s): the discriminating property
  # is "well before the 15s sleep", so the extra headroom absorbs fork/exec
  # and scheduling jitter on a loaded CI runner without weakening the test
  # (a non-firing guard still lands at ~15s > 12s). The >=4s floor stays the
  # meaningful half.
  if [ -f "$MARKER_T5" ] && [ "$ELAPSED_T5" -ge 4 ] && [ "$ELAPSED_T5" -le 12 ]; then
    record PASS "issue-94: timeout guard fires at runtime (5s budget)"
  else
    record FAIL "issue-94: timeout guard fires at runtime (5s budget)" \
      "marker=$([ -f "$MARKER_T5" ] && echo yes || echo no) elapsed=${ELAPSED_T5}s (want marker=yes, 4<=elapsed<=12: the slow Python must be reached AND the 5s timeout must fire before the 15s sleep)"
  fi
else
  record SKIP "issue-94: timeout guard fires at runtime (5s budget)" \
    "no timeout/gtimeout on PATH; runtime guard intentionally absent per hook fallback (PR #211)"
fi

# -------------------------------------------------------------------------
# Test 6 — spec 0073 / issue #508: daemon-unreachable path must degrade
# gracefully through the shared ChromaDB HTTP daemon (ADR-0006 routing).
#
# Behavioral test against the REAL, shipped Python heredoc — not a
# paraphrase of it. We extract the live heredoc body from the hook (same
# "extract the live source" technique
# scripts/tests/test-chroma-health-race.sh uses on scripts/lib/common.sh)
# and execute it under a fully-mocked `chromadb` module on PYTHONPATH
# whose `HttpClient.heartbeat()` always raises (simulating an unreachable
# daemon) and whose `PersistentClient` is a poison pill that fails the
# test the moment it is ever constructed. Assert: exit code 4,
# `DAEMON_UNREACHABLE:` on stderr, no `POISON` marker, and a bounded
# runtime (the daemon-unreachable path must not hang).
# -------------------------------------------------------------------------
SANDBOX_T6="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T2" "$TMPDIR_T5" "$SANDBOX_T6"' EXIT

# Extract the real heredoc (between <<'PYEOF' and the closing PYEOF).
sed -n "/<<.PYEOF./,/^PYEOF$/p" "$HOOK" | sed '1d;$d' > "$SANDBOX_T6/heredoc.py"

# spec 0088: the mock's Settings class + HttpClient(settings=...) kwarg
# capture proves R8 (bounded ceiling) and R10 (soft-skip unaffected)
# together, on the same execution of the real shipped heredoc source. The
# mock HttpClient must accept `settings=None` — without it the real
# heredoc's calls (which now always pass `settings=`) raise TypeError the
# instant they run under this mock.
CAPTURED_SETTINGS="$SANDBOX_T6/captured-settings.txt"
mkdir -p "$SANDBOX_T6/chromadb"
cat > "$SANDBOX_T6/chromadb/__init__.py" <<MOCK
class Settings:
    def __init__(self, chroma_http_max_connections=None, chroma_http_max_keepalive_connections=None):
        self.chroma_http_max_connections = chroma_http_max_connections
        self.chroma_http_max_keepalive_connections = chroma_http_max_keepalive_connections
        with open(r"$CAPTURED_SETTINGS", "a") as f:
            f.write(f"{chroma_http_max_connections},{chroma_http_max_keepalive_connections}\n")


class HttpClient:
    def __init__(self, host=None, port=None, settings=None):
        pass

    def heartbeat(self):
        raise ConnectionError("mock: connection refused")


def PersistentClient(*a, **kw):
    import sys
    print("POISON: PersistentClient constructed", file=sys.stderr)
    raise AssertionError("PersistentClient must never be constructed")
MOCK

if [ ! -s "$SANDBOX_T6/heredoc.py" ]; then
  record FAIL "spec-0073-r6: daemon-unreachable path exits 4, never constructs PersistentClient, stays bounded" \
    "could not extract Python heredoc from $HOOK"
else
  START_T6=$(date +%s)
  PYTHONPATH="$SANDBOX_T6" TRANSCRIPT_ROOM=x TRANSCRIPT_CONTENT=x TRANSCRIPT_AGENT=x \
    python3 "$SANDBOX_T6/heredoc.py" >"$SANDBOX_T6/stdout" 2>"$SANDBOX_T6/stderr"
  RC_T6=$?
  ELAPSED_T6=$(( $(date +%s) - START_T6 ))

  if [ "$RC_T6" -eq 4 ] && grep -q "DAEMON_UNREACHABLE:" "$SANDBOX_T6/stderr" \
     && ! grep -q "POISON" "$SANDBOX_T6/stderr" && [ "$ELAPSED_T6" -le 3 ]; then
    record PASS "spec-0073-r6: daemon-unreachable path exits 4, never constructs PersistentClient, stays bounded"
  else
    record FAIL "spec-0073-r6: daemon-unreachable path exits 4, never constructs PersistentClient, stays bounded" \
      "rc=$RC_T6 elapsed=${ELAPSED_T6}s stderr=$(cat "$SANDBOX_T6/stderr" 2>/dev/null)"
  fi

  # Test — spec 0088 R8: the Settings the real heredoc constructs (via the
  # heartbeat probe, the only HttpClient call site this daemon-unreachable
  # path reaches before exiting) carry the documented default ceiling.
  # Assert the two count fields individually, not full object equality —
  # mirrors the wrapper suite's own reasoning (chromadb's Settings defaults
  # a field, chroma_http_keepalive_secs, this spec never constrains).
  if [ -s "$CAPTURED_SETTINGS" ]; then
    CAPTURED_LINE="$(head -1 "$CAPTURED_SETTINGS")"
    CAPTURED_MAX_CONN="$(echo "$CAPTURED_LINE" | cut -d, -f1)"
    CAPTURED_MAX_KEEPALIVE="$(echo "$CAPTURED_LINE" | cut -d, -f2)"
    if [ "$CAPTURED_MAX_CONN" = "8" ] && [ "$CAPTURED_MAX_KEEPALIVE" = "4" ]; then
      record PASS "spec-0088-r8: hook's heartbeat-probe Settings carry the default ceiling (8/4)"
    else
      record FAIL "spec-0088-r8: hook's heartbeat-probe Settings carry the default ceiling (8/4)" \
        "captured max_connections=$CAPTURED_MAX_CONN max_keepalive_connections=$CAPTURED_MAX_KEEPALIVE"
    fi
  else
    record FAIL "spec-0088-r8: hook's heartbeat-probe Settings carry the default ceiling (8/4)" \
      "no Settings(...) construction captured — real heredoc never built one"
  fi
fi

# -------------------------------------------------------------------------
# Test 7/8 — spec 0074 / issue #510 (R1/R2): success logging is gated by
# MEMPALACE_TRANSCRIPT_QUIET.
#
# Behavioral test, modeled on test 2's fake-python + stdin feed. We point
# MEMPALACE_PYTHON at a fake that drains stdin, prints "OK", and exits 0 so
# the hook reaches the success branch (STATUS_RC == 0). A `Stop` event sets
# CONTENT so the Python call is reached.
#
#   - R1: with MEMPALACE_TRANSCRIPT_QUIET=1, the "persisted ..." success
#     line MUST be ABSENT from stderr.
#   - R2: with MEMPALACE_TRANSCRIPT_QUIET unset, the "persisted ..." success
#     line MUST be PRESENT on stderr (default behavior preserved).
# -------------------------------------------------------------------------
TMPDIR_T7="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T2" "$TMPDIR_T5" "$SANDBOX_T6" "$TMPDIR_T7"' EXIT

OK_PY="$TMPDIR_T7/ok-python"
cat > "$OK_PY" <<'EOF'
#!/bin/bash
cat >/dev/null   # drain the heredoc so it does not deadlock
echo "OK"
exit 0
EOF
chmod +x "$OK_PY"

STOP_JSON_T7='{"hook_event_name":"Stop"}'

# R1 — quiet enabled: success line suppressed.
STDERR_QUIET="$TMPDIR_T7/stderr-quiet"
(
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  export MEMPALACE_TRANSCRIPT_QUIET=1
  export MEMPALACE_PYTHON="$OK_PY"
  printf '%s' "$STOP_JSON_T7" | bash "$HOOK" >/dev/null 2>"$STDERR_QUIET"
) || true

if grep -q 'mempalace-transcript: persisted' "$STDERR_QUIET"; then
  record FAIL "issue-510-r1: success log suppressed when MEMPALACE_TRANSCRIPT_QUIET=1" \
    "found 'persisted' line on stderr: $(grep 'mempalace-transcript: persisted' "$STDERR_QUIET")"
else
  record PASS "issue-510-r1: success log suppressed when MEMPALACE_TRANSCRIPT_QUIET=1"
fi

# R2 — quiet unset: success line present (default preserved).
STDERR_DEFAULT="$TMPDIR_T7/stderr-default"
(
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  unset MEMPALACE_TRANSCRIPT_QUIET
  export MEMPALACE_PYTHON="$OK_PY"
  printf '%s' "$STOP_JSON_T7" | bash "$HOOK" >/dev/null 2>"$STDERR_DEFAULT"
) || true

if grep -q 'mempalace-transcript: persisted' "$STDERR_DEFAULT"; then
  record PASS "issue-510-r2: success log present when MEMPALACE_TRANSCRIPT_QUIET unset"
else
  record FAIL "issue-510-r2: success log present when MEMPALACE_TRANSCRIPT_QUIET unset" \
    "no 'persisted' line on stderr: $(cat "$STDERR_DEFAULT")"
fi

# -------------------------------------------------------------------------
# Test 9 — spec 0074 / issue #510 (R3): failure logging is UNCONDITIONAL.
#
# Behavioral test. We point MEMPALACE_PYTHON at a fake that drains stdin
# then exits non-zero so the hook reaches the failure branch
# (STATUS_RC != 0). Even with MEMPALACE_TRANSCRIPT_QUIET=1, the
# "FAILED to persist" line MUST still be emitted — the quiet flag gates
# ONLY the success log, never failures.
# -------------------------------------------------------------------------
FAIL_PY="$TMPDIR_T7/fail-python"
cat > "$FAIL_PY" <<'EOF'
#!/bin/bash
cat >/dev/null   # drain the heredoc so it does not deadlock
exit 3
EOF
chmod +x "$FAIL_PY"

STDERR_FAIL="$TMPDIR_T7/stderr-fail"
(
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  export MEMPALACE_TRANSCRIPT_QUIET=1
  export MEMPALACE_PYTHON="$FAIL_PY"
  printf '%s' "$STOP_JSON_T7" | bash "$HOOK" >/dev/null 2>"$STDERR_FAIL"
) || true

if grep -q 'mempalace-transcript: FAILED to persist' "$STDERR_FAIL"; then
  record PASS "issue-510-r3: failure log still emitted when MEMPALACE_TRANSCRIPT_QUIET=1"
else
  record FAIL "issue-510-r3: failure log still emitted when MEMPALACE_TRANSCRIPT_QUIET=1" \
    "no 'FAILED to persist' line on stderr: $(cat "$STDERR_FAIL")"
fi

# -------------------------------------------------------------------------
# Test 10 — spec 0088 R3/R9: the hook's connection-pool ceiling env vars
# carry their literal defaults, shared verbatim with
# scripts/lib/mempalace-http-wrapper.py. Static check, same style as the
# wrapper suite's own default-literal assertions: the literal default and
# the literal env-var name must appear on the same source line, so a
# refactor cannot silently change the default or rename the override
# variable without also breaking this assertion.
# -------------------------------------------------------------------------
MAX_CONN_LINE="$(grep -n "MEMPALACE_CHROMA_MAX_CONNECTIONS" "$HOOK" | grep "os.environ.get" || true)"
if [ -z "$MAX_CONN_LINE" ]; then
  record FAIL "spec-0088: hook max-connections env var carries default" \
    "no 'MEMPALACE_CHROMA_MAX_CONNECTIONS' os.environ.get() line found in $HOOK"
elif echo "$MAX_CONN_LINE" | grep -q '"8"'; then
  record PASS "spec-0088: hook max-connections env var carries default (8)"
else
  record FAIL "spec-0088: hook max-connections env var carries default" \
    "line lacks literal default '8': $MAX_CONN_LINE"
fi

MAX_KEEPALIVE_LINE="$(grep -n "MEMPALACE_CHROMA_MAX_KEEPALIVE_CONNECTIONS" "$HOOK" | grep "os.environ.get" || true)"
if [ -z "$MAX_KEEPALIVE_LINE" ]; then
  record FAIL "spec-0088: hook max-keepalive-connections env var carries default" \
    "no 'MEMPALACE_CHROMA_MAX_KEEPALIVE_CONNECTIONS' os.environ.get() line found in $HOOK"
elif echo "$MAX_KEEPALIVE_LINE" | grep -q '"4"'; then
  record PASS "spec-0088: hook max-keepalive-connections env var carries default (4)"
else
  record FAIL "spec-0088: hook max-keepalive-connections env var carries default" \
    "line lacks literal default '4': $MAX_KEEPALIVE_LINE"
fi

# -------------------------------------------------------------------------
# Test 11 — spec 0088 R4/R8: `settings=` MUST appear on BOTH
# chromadb.HttpClient(...) call sites inside the hook's heredoc — the
# _http_factory stand-in's return statement and the heartbeat probe. This
# is the regression lock: a future refactor that drops `settings=` from
# either call site re-introduces an unbounded connection pool on that code
# path.
# -------------------------------------------------------------------------
FACTORY_RETURN_LINE="$(grep -n "return chromadb\.HttpClient(" "$HOOK" | head -1)"
PROBE_LINE="$(grep -n "chromadb\.HttpClient(.*)\.heartbeat()" "$HOOK" | head -1)"
if [ -z "$FACTORY_RETURN_LINE" ]; then
  record FAIL "spec-0088: settings= applied at both hook HttpClient call sites" \
    "no 'return chromadb.HttpClient(...)' line found in $HOOK"
elif [ -z "$PROBE_LINE" ]; then
  record FAIL "spec-0088: settings= applied at both hook HttpClient call sites" \
    "no heartbeat-probe 'chromadb.HttpClient(...).heartbeat()' line found in $HOOK"
elif echo "$FACTORY_RETURN_LINE" | grep -q "settings=" && echo "$PROBE_LINE" | grep -q "settings="; then
  record PASS "spec-0088: settings= applied at both hook HttpClient call sites"
else
  record FAIL "spec-0088: settings= applied at both hook HttpClient call sites" \
    "factory_return=[$FACTORY_RETURN_LINE] probe=[$PROBE_LINE]"
fi

# -------------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------------
echo
echo "Summary: $pass passed, $fail failed, $skip skipped"

if [ "$fail" -gt 0 ]; then
  exit 1
fi
exit 0
