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
#   spec 0110 / issue #713 — Survive a concurrently held palace write lock.
#         The heredoc MUST neutralise `mine_palace_lock` in its own
#         subprocess so an entry persists while a peer holds the palace
#         write lock, at EVERY location the write path resolves that
#         primitive from, only AFTER the daemon is established reachable,
#         and MUST refuse to persist with a distinct status (5) and prefix
#         (`LOCK_BYPASS_INEFFECTIVE:`) when it cannot prove the relief is in
#         force. See the section header before test 12 for the full topology
#         and the three resolution modes exercised.
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

# =========================================================================
# spec 0110 / issue #713 — transcript persistence survives a concurrently
# held palace write lock.
#
# Topology under test. `tool_add_drawer` reaches the on-disk per-palace lock
# through `ChromaCollection._write_lock()`, which resolves
# `mine_palace_lock` by a LATE import from `mempalace.palace`. Whenever any
# peer held that lock, every transcript entry failed with
# `ADD_FAILED: palace ... is held by PID ...`. The hook now neutralises the
# primitive in its own subprocess (spec 0110 R1) and refuses to persist when
# it cannot prove the relief is in force on the real write path (R3/R4).
#
# These tests run the REAL shipped Python heredoc — extracted from the hook,
# same technique as test 6 — against a fully mocked `mempalace` package that
# mirrors the shipped topology: a genuine `fcntl.flock` lock keyed by
# sha256(realpath(palace_path)), a `ChromaCollection` whose `_write_lock()`
# resolves the primitive, and a `tool_add_drawer` that goes through it.
#
# Nothing here touches the real palace at ~/.mempalace/palace: the mock's
# lock directory comes from $CREWRIG_TEST_LOCK_DIR and its palace path from
# $CREWRIG_TEST_PALACE, both pointing inside a per-test mktemp sandbox. The
# lock key is a hash of the palace path, so a throwaway path can never
# contend with the real one.
#
# Three resolution modes are generated, because R5 forbids assuming a single
# resolution site:
#
#   late     — today's shipped shape: `_write_lock()` late-imports from
#              `mempalace.palace`.
#   modload  — `mempalace.backends.chroma` binds the symbol at MODULE LOAD,
#              the shape `sync.py` / `miner.py` / `convo_miner.py` already
#              use. The canonical patch alone would not reach it; the hook's
#              second patch target must.
#   elsewhere— `_write_lock()` resolves from a third module the hook does not
#              know about, bound before the patch runs. The relief is
#              genuinely ineffective here, and the hook must say so (R3/R4)
#              rather than persist.
# =========================================================================

SANDBOX_0110="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T2" "$TMPDIR_T5" "$SANDBOX_T6" "$TMPDIR_T7" "$SANDBOX_0110"' EXIT

HEREDOC_0110="$SANDBOX_0110/heredoc.py"
sed -n "/<<.PYEOF./,/^PYEOF$/p" "$HOOK" | sed '1d;$d' > "$HEREDOC_0110"

# -------------------------------------------------------------------------
# Fixture builders
# -------------------------------------------------------------------------

# mp_sandbox <dir> <mode>
# Materialises a mock `chromadb` (reachable daemon, poison PersistentClient)
# and a mock `mempalace` package in <dir>, with `_write_lock()` resolving the
# lock primitive per <mode> (late | modload | elsewhere).
mp_sandbox() {
  local mp_dir="$1"
  local mp_mode="$2"

  mkdir -p "$mp_dir/chromadb" "$mp_dir/mempalace/backends"

  # Reachable daemon. `PersistentClient` stays a poison pill (spec 0073): the
  # relief must not become an excuse to touch the on-disk palace directly.
  cat > "$mp_dir/chromadb/__init__.py" <<'MOCK'
import sys


class Settings:
    def __init__(self, chroma_http_max_connections=None,
                 chroma_http_max_keepalive_connections=None):
        self.chroma_http_max_connections = chroma_http_max_connections
        self.chroma_http_max_keepalive_connections = chroma_http_max_keepalive_connections


class HttpClient:
    def __init__(self, host=None, port=None, settings=None):
        pass

    def heartbeat(self):
        return 1


def PersistentClient(*a, **kw):
    print("POISON: PersistentClient constructed", file=sys.stderr)
    raise AssertionError("PersistentClient must never be constructed")
MOCK

  # Import marker: proves whether the hook loaded mempalace at all. Test 21
  # (R2 ordering) turns on its absence.
  cat > "$mp_dir/mempalace/__init__.py" <<'MOCK'
import os

_marker = os.environ.get("CREWRIG_TEST_MP_IMPORT_MARKER")
if _marker:
    with open(_marker, "a") as _f:
        _f.write("mempalace imported\n")
MOCK

  # Faithful stand-in for the shipped `mine_palace_lock`: a real
  # non-blocking fcntl.flock, keyed by sha256 of the normalised realpath, so
  # a throwaway palace path cannot contend with the real palace's lock.
  cat > "$mp_dir/mempalace/palace.py" <<'MOCK'
import contextlib
import fcntl
import hashlib
import os


class MineAlreadyRunning(RuntimeError):
    pass


@contextlib.contextmanager
def mine_palace_lock(palace_path):
    lock_dir = os.environ["CREWRIG_TEST_LOCK_DIR"]
    os.makedirs(lock_dir, exist_ok=True)
    resolved = os.path.normcase(os.path.realpath(os.path.expanduser(palace_path)))
    key = hashlib.sha256(resolved.encode()).hexdigest()[:16]
    lf = open(os.path.join(lock_dir, "mine_palace_%s.lock" % key), "a+b")
    try:
        try:
            fcntl.flock(lf, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise MineAlreadyRunning(
                "palace %s is held by another writer" % resolved
            ) from exc
        yield
    finally:
        lf.close()
MOCK

  echo "" > "$mp_dir/mempalace/backends/__init__.py"

  if [ "$mp_mode" = "late" ]; then
    # Today's shipped shape (backends/chroma.py:1348).
    cat > "$mp_dir/mempalace/backends/chroma.py" <<'MOCK'
import contextlib


class ChromaCollection:
    def __init__(self, collection, palace_path=None):
        self._collection = collection
        self._palace_path = palace_path

    @contextlib.contextmanager
    def _write_lock(self):
        if self._palace_path is None:
            yield
            return
        # Late import — resolved at call time.
        from ..palace import mine_palace_lock

        with mine_palace_lock(self._palace_path):
            yield
MOCK
  elif [ "$mp_mode" = "modload" ]; then
    # R5's fragility, made real: the symbol is bound at module load, the way
    # sync.py / miner.py / convo_miner.py already bind it. Patching
    # `mempalace.palace` alone leaves this binding pointing at the original.
    cat > "$mp_dir/mempalace/backends/chroma.py" <<'MOCK'
import contextlib

from ..palace import mine_palace_lock


class ChromaCollection:
    def __init__(self, collection, palace_path=None):
        self._collection = collection
        self._palace_path = palace_path

    @contextlib.contextmanager
    def _write_lock(self):
        if self._palace_path is None:
            yield
            return
        # Module-load binding — resolved before the hook could patch it.
        with mine_palace_lock(self._palace_path):
            yield
MOCK
  else
    # A resolution site the hook does not cover. `_relocated` is imported at
    # chroma module load — i.e. while the hook is importing the modules it is
    # about to patch — so its binding is the ORIGINAL primitive and neither
    # patch target reaches it.
    cat > "$mp_dir/mempalace/_relocated.py" <<'MOCK'
from .palace import mine_palace_lock  # noqa: F401
MOCK
    cat > "$mp_dir/mempalace/backends/chroma.py" <<'MOCK'
import contextlib

from .. import _relocated  # binds the original before any patch can land


class ChromaCollection:
    def __init__(self, collection, palace_path=None):
        self._collection = collection
        self._palace_path = palace_path

    @contextlib.contextmanager
    def _write_lock(self):
        if self._palace_path is None:
            yield
            return
        with _relocated.mine_palace_lock(self._palace_path):
            yield
MOCK
  fi

  # `tool_add_drawer` stand-in: reaches the lock exactly the way the shipped
  # one does (mcp_server.py:1177 constructs ChromaCollection with the
  # configured palace_path), and records the write so a test can prove the
  # entry was stored rather than merely "not errored".
  cat > "$mp_dir/mempalace/mcp_server.py" <<'MOCK'
import os

from .backends.chroma import ChromaCollection
from .palace import MineAlreadyRunning


def tool_add_drawer(wing=None, room=None, content=None, added_by=None, **kwargs):
    coll = ChromaCollection(object(), palace_path=os.environ["CREWRIG_TEST_PALACE"])
    try:
        with coll._write_lock():
            with open(os.environ["CREWRIG_TEST_WRITE_MARKER"], "a") as f:
                f.write("%s|%s|%s|%s\n" % (wing, room, content, added_by))
    except MineAlreadyRunning as exc:
        return {"success": False, "error": str(exc)}
    return {"success": True, "drawer_id": "test-drawer"}
MOCK
}

# Holder process: takes the mock lock on the test palace and keeps it.
# Mirrors the SPECS-stage reproduction topology (one process holds, another
# replays the write path).
mp_holder_script() {
  cat > "$1" <<'MOCK'
import os
import sys
import time

sys.path.insert(0, os.environ["CREWRIG_TEST_SANDBOX"])
from mempalace.palace import mine_palace_lock

with mine_palace_lock(os.environ["CREWRIG_TEST_PALACE"]):
    with open(os.environ["CREWRIG_TEST_READY"], "w") as f:
        f.write("held\n")
    time.sleep(float(os.environ.get("CREWRIG_TEST_HOLD_SECS", "25")))
MOCK
}

# mp_wait_ready <ready-file> — poll up to ~10s for the holder to signal.
mp_wait_ready() {
  local mp_i=0
  while [ "$mp_i" -lt 100 ]; do
    if [ -f "$1" ]; then
      return 0
    fi
    sleep 0.1
    mp_i=$((mp_i + 1))
  done
  return 1
}

# -------------------------------------------------------------------------
# Test 12/13 — spec 0110 R1, scenario "an entry persists while a peer holds
# the lock".
#
# Two-sided, so the test cannot pass vacuously. A CONTROL run first replays
# the same mocked write path WITHOUT the hook's relief and must FAIL with the
# lock-contention error — that is what proves the fixture actually reproduces
# the defect. Only then is the real shipped heredoc run against the identical
# fixture, and it must succeed and store the entry.
# -------------------------------------------------------------------------
S12="$SANDBOX_0110/s12"
mkdir -p "$S12/palace"
mp_sandbox "$S12" late
mp_holder_script "$S12/holder.py"

cat > "$S12/control.py" <<'MOCK'
import os
import sys

sys.path.insert(0, os.environ["CREWRIG_TEST_SANDBOX"])
from mempalace.mcp_server import tool_add_drawer

r = tool_add_drawer(wing="transcripts", room="r", content="c", added_by="a")
print("CONTROL_SUCCESS" if r.get("success") else "CONTROL_REFUSED: %s" % r.get("error"))
MOCK

# Env is passed per invocation, never exported: every fixture below shares
# the same variable names, so a global export would silently hand a later
# test the wrong sandbox.
CREWRIG_TEST_SANDBOX="$S12" CREWRIG_TEST_LOCK_DIR="$S12/locks" \
  CREWRIG_TEST_PALACE="$S12/palace" CREWRIG_TEST_READY="$S12/holder-ready" \
  CREWRIG_TEST_HOLD_SECS=25 \
  python3 "$S12/holder.py" >"$S12/holder.log" 2>&1 &
HOLDER_PID_12=$!

if ! mp_wait_ready "$S12/holder-ready"; then
  record FAIL "spec-0110-r1: entry persists while a peer holds the palace write lock" \
    "lock holder never signalled ready: $(cat "$S12/holder.log" 2>/dev/null)"
  record FAIL "spec-0110-r1: fixture reproduces the defect without the relief (control)" \
    "lock holder never signalled ready"
else
  CONTROL_OUT_12="$(CREWRIG_TEST_SANDBOX="$S12" CREWRIG_TEST_LOCK_DIR="$S12/locks" \
    CREWRIG_TEST_PALACE="$S12/palace" CREWRIG_TEST_WRITE_MARKER="$S12/control-writes.txt" \
    python3 "$S12/control.py" 2>&1)"
  if echo "$CONTROL_OUT_12" | grep -q "CONTROL_REFUSED"; then
    record PASS "spec-0110-r1: fixture reproduces the defect without the relief (control)"
  else
    record FAIL "spec-0110-r1: fixture reproduces the defect without the relief (control)" \
      "expected the unrelieved write path to be refused while the peer holds the lock, got: $CONTROL_OUT_12"
  fi

  PYTHONPATH="$S12" CREWRIG_TEST_LOCK_DIR="$S12/locks" CREWRIG_TEST_PALACE="$S12/palace" \
    CREWRIG_TEST_WRITE_MARKER="$S12/writes.txt" \
    TRANSCRIPT_ROOM=room-12 TRANSCRIPT_CONTENT="[USER] held-lock entry" \
    TRANSCRIPT_AGENT=transcript-hook \
    python3 "$HEREDOC_0110" >"$S12/stdout" 2>"$S12/stderr"
  RC_12=$?

  if [ "$RC_12" -eq 0 ] && grep -q "^OK$" "$S12/stdout" \
     && grep -q "held-lock entry" "$S12/writes.txt" 2>/dev/null \
     && ! grep -q "POISON" "$S12/stderr"; then
    record PASS "spec-0110-r1: entry persists while a peer holds the palace write lock"
  else
    record FAIL "spec-0110-r1: entry persists while a peer holds the palace write lock" \
      "rc=$RC_12 stdout=$(cat "$S12/stdout" 2>/dev/null) stderr=$(cat "$S12/stderr" 2>/dev/null) writes=$(cat "$S12/writes.txt" 2>/dev/null)"
  fi
fi

kill "$HOLDER_PID_12" 2>/dev/null
wait "$HOLDER_PID_12" 2>/dev/null

# -------------------------------------------------------------------------
# Test 14 — spec 0110, scenario "nothing changes when no peer holds the
# lock". The relief must not be a behaviour change on the uncontended path:
# same fixture, no holder, entry still stored and success still reported.
# -------------------------------------------------------------------------
S14="$SANDBOX_0110/s14"
mkdir -p "$S14/palace"
mp_sandbox "$S14" late

if PYTHONPATH="$S14" CREWRIG_TEST_LOCK_DIR="$S14/locks" CREWRIG_TEST_PALACE="$S14/palace" \
   CREWRIG_TEST_WRITE_MARKER="$S14/writes.txt" \
   TRANSCRIPT_ROOM=room-14 TRANSCRIPT_CONTENT="[USER] uncontended entry" \
   TRANSCRIPT_AGENT=transcript-hook \
   python3 "$HEREDOC_0110" >"$S14/stdout" 2>"$S14/stderr" \
   && grep -q "^OK$" "$S14/stdout" \
   && grep -q "uncontended entry" "$S14/writes.txt" 2>/dev/null; then
  record PASS "spec-0110: uncontended path unchanged — entry stored, success reported"
else
  record FAIL "spec-0110: uncontended path unchanged — entry stored, success reported" \
    "stdout=$(cat "$S14/stdout" 2>/dev/null) stderr=$(cat "$S14/stderr" 2>/dev/null) writes=$(cat "$S14/writes.txt" 2>/dev/null)"
fi

# -------------------------------------------------------------------------
# Test 15 — spec 0110 R5: the relief covers a MODULE-LOAD resolution site,
# not only the late import the shipped library happens to use today.
#
# This is the regression that a single-location patch cannot pass. The
# fixture binds `mine_palace_lock` inside `mempalace.backends.chroma` at
# module load — the shape three sibling modules in the real library already
# use — so patching `mempalace.palace` alone leaves the write path holding
# the original primitive. With a peer holding the lock, a single-location
# relief fails; the hook's second patch target is what makes this pass.
# -------------------------------------------------------------------------
S15="$SANDBOX_0110/s15"
mkdir -p "$S15/palace"
mp_sandbox "$S15" modload
mp_holder_script "$S15/holder.py"

CREWRIG_TEST_SANDBOX="$S15" CREWRIG_TEST_LOCK_DIR="$S15/locks" \
  CREWRIG_TEST_PALACE="$S15/palace" CREWRIG_TEST_READY="$S15/holder-ready" \
  CREWRIG_TEST_HOLD_SECS=25 \
  python3 "$S15/holder.py" >"$S15/holder.log" 2>&1 &
HOLDER_PID_15=$!

if ! mp_wait_ready "$S15/holder-ready"; then
  record FAIL "spec-0110-r5: relief covers a module-load resolution site (not one location)" \
    "lock holder never signalled ready: $(cat "$S15/holder.log" 2>/dev/null)"
else
  PYTHONPATH="$S15" CREWRIG_TEST_LOCK_DIR="$S15/locks" CREWRIG_TEST_PALACE="$S15/palace" \
    CREWRIG_TEST_WRITE_MARKER="$S15/writes.txt" \
    TRANSCRIPT_ROOM=room-15 TRANSCRIPT_CONTENT="[USER] modload entry" \
    TRANSCRIPT_AGENT=transcript-hook \
    python3 "$HEREDOC_0110" >"$S15/stdout" 2>"$S15/stderr"
  RC_15=$?
  if [ "$RC_15" -eq 0 ] && grep -q "modload entry" "$S15/writes.txt" 2>/dev/null; then
    record PASS "spec-0110-r5: relief covers a module-load resolution site (not one location)"
  else
    record FAIL "spec-0110-r5: relief covers a module-load resolution site (not one location)" \
      "rc=$RC_15 stderr=$(cat "$S15/stderr" 2>/dev/null) writes=$(cat "$S15/writes.txt" 2>/dev/null)"
  fi
fi

kill "$HOLDER_PID_15" 2>/dev/null
wait "$HOLDER_PID_15" 2>/dev/null

# -------------------------------------------------------------------------
# Test 16/17 — spec 0110 R3/R4, scenario "an ineffective relief is reported,
# not silently absorbed".
#
# The fixture resolves the lock from a module the hook does not patch, bound
# before the patch could land. The hook must DECLINE to persist (nothing in
# the write marker — R3) and report a failure whose exit status and stderr
# prefix are used by no other failure it reports (R4): not 2/IMPORT_ERROR:,
# not 3/ADD_FAILED:, not 4/DAEMON_UNREACHABLE:.
# -------------------------------------------------------------------------
S16="$SANDBOX_0110/s16"
mkdir -p "$S16/palace"
mp_sandbox "$S16" elsewhere

PYTHONPATH="$S16" CREWRIG_TEST_LOCK_DIR="$S16/locks" CREWRIG_TEST_PALACE="$S16/palace" \
  CREWRIG_TEST_WRITE_MARKER="$S16/writes.txt" \
  TRANSCRIPT_ROOM=room-16 TRANSCRIPT_CONTENT="[USER] must not be stored" \
  TRANSCRIPT_AGENT=transcript-hook \
  python3 "$HEREDOC_0110" >"$S16/stdout" 2>"$S16/stderr"
RC_16=$?

if [ "$RC_16" -eq 5 ] && grep -q "LOCK_BYPASS_INEFFECTIVE:" "$S16/stderr" \
   && [ ! -f "$S16/writes.txt" ]; then
  record PASS "spec-0110-r3: ineffective relief declines to persist and exits 5"
else
  record FAIL "spec-0110-r3: ineffective relief declines to persist and exits 5" \
    "rc=$RC_16 (want 5) stderr=$(cat "$S16/stderr" 2>/dev/null) stored=$([ -f "$S16/writes.txt" ] && cat "$S16/writes.txt" || echo '(nothing)')"
fi

# R4 — the status AND the prefix must both be unused by every other failure
# the hook reports. Asserted against the hook source itself, so the claim is
# about the shipped contract and not just about this one run: each of the
# three pre-existing prefixes must pair with its own distinct exit code, and
# neither `5` nor `LOCK_BYPASS_INEFFECTIVE:` may appear on any of them.
R4_CLASH=""
for pair in "IMPORT_ERROR:2" "ADD_FAILED:3" "DAEMON_UNREACHABLE:4"; do
  prefix="${pair%%:*}:"
  code="${pair##*:}"
  if grep -q "LOCK_BYPASS_INEFFECTIVE" "$S16/stderr" \
     && echo "$prefix" | grep -q "LOCK_BYPASS_INEFFECTIVE"; then
    R4_CLASH="$R4_CLASH prefix-collision:$prefix"
  fi
  if [ "$code" = "5" ]; then
    R4_CLASH="$R4_CLASH status-collision:$prefix=$code"
  fi
  if ! grep -q "sys.exit($code)" "$HOOK"; then
    R4_CLASH="$R4_CLASH missing-exit:$prefix->$code"
  fi
done
if grep -q "LOCK_BYPASS_INEFFECTIVE" "$S16/stderr" \
   && grep -qE 'IMPORT_ERROR|ADD_FAILED|DAEMON_UNREACHABLE' "$S16/stderr"; then
  R4_CLASH="$R4_CLASH reported-alongside-another-prefix"
fi
if [ -z "$R4_CLASH" ] && grep -q "sys.exit(5)" "$HOOK"; then
  record PASS "spec-0110-r4: status 5 + LOCK_BYPASS_INEFFECTIVE: collide with no existing failure"
else
  record FAIL "spec-0110-r4: status 5 + LOCK_BYPASS_INEFFECTIVE: collide with no existing failure" \
    "clashes=[$R4_CLASH] exit5_present=$(grep -c 'sys.exit(5)' "$HOOK")"
fi

# -------------------------------------------------------------------------
# Test 18 — spec 0110 R7, through the REAL bash hook: an ineffective relief
# must still let the calling session's turn succeed. Runs the whole hook end
# to end (Stop event on stdin, the ineffective fixture on PYTHONPATH) and
# asserts hook exit 0 plus the failure surfaced on stderr the same way every
# other failure is — `FAILED to persist ... (rc=5)` with the Python stderr
# appended.
# -------------------------------------------------------------------------
STDERR_18="$S16/hook-stderr"
(
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  export MEMPALACE_PYTHON=python3
  export PYTHONPATH="$S16"
  export CREWRIG_TEST_LOCK_DIR="$S16/locks"
  export CREWRIG_TEST_PALACE="$S16/palace"
  export CREWRIG_TEST_WRITE_MARKER="$S16/writes-hook.txt"
  printf '%s' '{"hook_event_name":"Stop"}' | bash "$HOOK" >/dev/null 2>"$STDERR_18"
)
RC_18=$?

if [ "$RC_18" -eq 0 ] && grep -q 'FAILED to persist' "$STDERR_18" \
   && grep -q '(rc=5)' "$STDERR_18" && grep -q 'LOCK_BYPASS_INEFFECTIVE:' "$STDERR_18"; then
  record PASS "spec-0110-r7: hook still exits 0 and reports rc=5 like every other failure"
else
  record FAIL "spec-0110-r7: hook still exits 0 and reports rc=5 like every other failure" \
    "hook_rc=$RC_18 (want 0) stderr=$(cat "$STDERR_18" 2>/dev/null)"
fi

# -------------------------------------------------------------------------
# Test 19/20 — spec 0110 R2, scenario "an unreachable service keeps its
# existing behaviour".
#
# Ordering is normative: the relief must be installed only AFTER the daemon
# has been established reachable, so a persistence attempt whose remote
# routing is not established keeps the lock's protection. Proven by absence:
# `mempalace/__init__.py` appends to $CREWRIG_TEST_MP_IMPORT_MARKER on
# import, so if the file never appears, the hook exited at the heartbeat
# without loading — let alone patching — the locking library. Test 6 already
# pins the exit-4 / DAEMON_UNREACHABLE: behaviour itself; this pair adds the
# ordering guarantee and the R7 tail.
# -------------------------------------------------------------------------
S19="$SANDBOX_0110/s19"
mkdir -p "$S19/palace"
mp_sandbox "$S19" late
# Same fixture, unreachable daemon.
cat > "$S19/chromadb/__init__.py" <<'MOCK'
import sys


class Settings:
    def __init__(self, chroma_http_max_connections=None,
                 chroma_http_max_keepalive_connections=None):
        pass


class HttpClient:
    def __init__(self, host=None, port=None, settings=None):
        pass

    def heartbeat(self):
        raise ConnectionError("mock: connection refused")


def PersistentClient(*a, **kw):
    print("POISON: PersistentClient constructed", file=sys.stderr)
    raise AssertionError("PersistentClient must never be constructed")
MOCK

PYTHONPATH="$S19" CREWRIG_TEST_LOCK_DIR="$S19/locks" CREWRIG_TEST_PALACE="$S19/palace" \
  CREWRIG_TEST_WRITE_MARKER="$S19/writes.txt" \
  CREWRIG_TEST_MP_IMPORT_MARKER="$S19/mempalace-imported" \
  TRANSCRIPT_ROOM=room-19 TRANSCRIPT_CONTENT="[USER] unreachable" \
  TRANSCRIPT_AGENT=transcript-hook \
  python3 "$HEREDOC_0110" >"$S19/stdout" 2>"$S19/stderr"
RC_19=$?

if [ "$RC_19" -eq 4 ] && grep -q "DAEMON_UNREACHABLE:" "$S19/stderr" \
   && [ ! -f "$S19/mempalace-imported" ] && [ ! -d "$S19/locks" ]; then
  record PASS "spec-0110-r2: relief not installed before the daemon is established reachable"
else
  record FAIL "spec-0110-r2: relief not installed before the daemon is established reachable" \
    "rc=$RC_19 (want 4) mempalace_loaded=$([ -f "$S19/mempalace-imported" ] && echo yes || echo no) (want no) locks_dir=$([ -d "$S19/locks" ] && echo yes || echo no) (want no) stderr=$(cat "$S19/stderr" 2>/dev/null)"
fi

STDERR_20="$S19/hook-stderr"
(
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  export MEMPALACE_PYTHON=python3
  export PYTHONPATH="$S19"
  export CREWRIG_TEST_LOCK_DIR="$S19/locks"
  export CREWRIG_TEST_PALACE="$S19/palace"
  export CREWRIG_TEST_WRITE_MARKER="$S19/writes-hook.txt"
  printf '%s' '{"hook_event_name":"Stop"}' | bash "$HOOK" >/dev/null 2>"$STDERR_20"
)
RC_20=$?

if [ "$RC_20" -eq 0 ] && grep -q '(rc=4)' "$STDERR_20" \
   && grep -q 'DAEMON_UNREACHABLE:' "$STDERR_20"; then
  record PASS "spec-0110-r7: hook still exits 0 on the unreachable-service path"
else
  record FAIL "spec-0110-r7: hook still exits 0 on the unreachable-service path" \
    "hook_rc=$RC_20 (want 0) stderr=$(cat "$STDERR_20" 2>/dev/null)"
fi

# -------------------------------------------------------------------------
# Test 21 — spec 0110 R6, scenario "a peer's lock protection is unaffected".
#
# The relief is an in-memory rebind inside the hook's own subprocess, so it
# must leave the lock every other process takes exactly as it was. After the
# hook has persisted an entry under the relief (test 14's fixture, replayed
# here), a separate process must still be able to ACQUIRE the lock — proving
# the relief neither wedged nor consumed it — and while that process holds
# it, a third acquisition must still be REFUSED, proving the protection
# still bites for everyone but the hook.
# -------------------------------------------------------------------------
S21="$SANDBOX_0110/s21"
mkdir -p "$S21/palace"
mp_sandbox "$S21" late
mp_holder_script "$S21/holder.py"

cat > "$S21/acquire.py" <<'MOCK'
import os
import sys

sys.path.insert(0, os.environ["CREWRIG_TEST_SANDBOX"])
from mempalace.palace import MineAlreadyRunning, mine_palace_lock

try:
    with mine_palace_lock(os.environ["CREWRIG_TEST_PALACE"]):
        print("ACQUIRED")
except MineAlreadyRunning:
    print("REFUSED")
MOCK

PYTHONPATH="$S21" CREWRIG_TEST_LOCK_DIR="$S21/locks" CREWRIG_TEST_PALACE="$S21/palace" \
  CREWRIG_TEST_WRITE_MARKER="$S21/writes.txt" \
  TRANSCRIPT_ROOM=room-21 TRANSCRIPT_CONTENT="[USER] relieved entry" \
  TRANSCRIPT_AGENT=transcript-hook \
  python3 "$HEREDOC_0110" >"$S21/stdout" 2>"$S21/stderr"
RC_21=$?

AFTER_FREE_21="$(CREWRIG_TEST_SANDBOX="$S21" CREWRIG_TEST_LOCK_DIR="$S21/locks" \
  CREWRIG_TEST_PALACE="$S21/palace" python3 "$S21/acquire.py" 2>&1)"

CREWRIG_TEST_SANDBOX="$S21" CREWRIG_TEST_LOCK_DIR="$S21/locks" \
  CREWRIG_TEST_PALACE="$S21/palace" CREWRIG_TEST_READY="$S21/holder-ready" \
  CREWRIG_TEST_HOLD_SECS=25 \
  python3 "$S21/holder.py" >"$S21/holder.log" 2>&1 &
HOLDER_PID_21=$!
if mp_wait_ready "$S21/holder-ready"; then
  AFTER_HELD_21="$(CREWRIG_TEST_SANDBOX="$S21" CREWRIG_TEST_LOCK_DIR="$S21/locks" \
    CREWRIG_TEST_PALACE="$S21/palace" python3 "$S21/acquire.py" 2>&1)"
else
  AFTER_HELD_21="holder-never-ready: $(cat "$S21/holder.log" 2>/dev/null)"
fi
kill "$HOLDER_PID_21" 2>/dev/null
wait "$HOLDER_PID_21" 2>/dev/null

if [ "$RC_21" -eq 0 ] && [ "$AFTER_FREE_21" = "ACQUIRED" ] && [ "$AFTER_HELD_21" = "REFUSED" ]; then
  record PASS "spec-0110-r6: a peer's lock protection is unaffected by the relief"
else
  record FAIL "spec-0110-r6: a peer's lock protection is unaffected by the relief" \
    "hook_rc=$RC_21 after_relief_uncontended=[$AFTER_FREE_21] (want ACQUIRED) while_peer_holds=[$AFTER_HELD_21] (want REFUSED)"
fi

# -------------------------------------------------------------------------
# Test 22 — spec 0110 R2/R5, static regression locks on the shipped source.
#
# The behavioural tests above prove the contract on the fixtures they build;
# these two locks pin the two properties a fixture cannot observe:
#
#   R2 — the relief installation must appear AFTER the heartbeat probe's
#        `sys.exit(4)` in source order. A reorder would relieve the lock on a
#        path whose HTTP routing is not established, and no mock can catch
#        that because the reordered code still passes every fixture that has
#        a reachable daemon.
#   R5 — both resolution sites must be named in the heredoc. Test 15 proves
#        the module-load site is covered; this pins that the canonical
#        `mempalace.palace` site was not dropped in the process.
# -------------------------------------------------------------------------
EXIT4_LINE="$(grep -n 'sys.exit(4)' "$HOOK" | head -1 | cut -d: -f1)"
RELIEF_LINE="$(grep -n 'mine_palace_lock = _relieved_palace_lock' "$HOOK" | head -1 | cut -d: -f1)"
if [ -z "$EXIT4_LINE" ] || [ -z "$RELIEF_LINE" ]; then
  record FAIL "spec-0110-r2: relief installed after the daemon-reachability probe (source order)" \
    "exit4_line=[$EXIT4_LINE] relief_line=[$RELIEF_LINE] — one of the two anchors is missing from $HOOK"
elif [ "$RELIEF_LINE" -gt "$EXIT4_LINE" ]; then
  record PASS "spec-0110-r2: relief installed after the daemon-reachability probe (source order)"
else
  record FAIL "spec-0110-r2: relief installed after the daemon-reachability probe (source order)" \
    "relief installed at line $RELIEF_LINE, before the DAEMON_UNREACHABLE exit at line $EXIT4_LINE"
fi

if grep -q 'import mempalace.palace' "$HOOK" && grep -q 'import mempalace.backends.chroma' "$HOOK"; then
  record PASS "spec-0110-r5: both known resolution sites named in the hook source"
else
  record FAIL "spec-0110-r5: both known resolution sites named in the hook source" \
    "expected both 'import mempalace.palace' and 'import mempalace.backends.chroma' in $HOOK"
fi

# -------------------------------------------------------------------------
# Test 23/24 — spec 0161 / issue #866: prompt submissions distinguish
# genuine human prompts from automated harness injections.
#
# Behavioral tests:
#   - Human prompt ("Run tests") -> CONTENT starts with "[USER]"
#   - Harness injections (<task-notification>..., <system-reminder>...)
#     -> CONTENT starts with "[HARNESS]"
# -------------------------------------------------------------------------
TMPDIR_T23="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_T2" "$TMPDIR_T5" "$SANDBOX_T6" "$TMPDIR_T7" "$SANDBOX_0110" "$TMPDIR_T23"' EXIT

RECORD_PY="$TMPDIR_T23/record-python"
CONTENT_OUT="$TMPDIR_T23/captured-content.txt"
cat > "$RECORD_PY" <<'EOF'
#!/bin/bash
cat >/dev/null   # drain the heredoc so it does not deadlock
echo "$TRANSCRIPT_CONTENT" >> "$CAPTURED_CONTENT_FILE"
echo "OK"
exit 0
EOF
chmod +x "$RECORD_PY"

# Test 23: Human prompt
USER_PROMPT_JSON='{"hook_event_name":"UserPromptSubmit","prompt":"Run the test suite"}'
(
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  export MEMPALACE_PYTHON="$RECORD_PY"
  export CAPTURED_CONTENT_FILE="$CONTENT_OUT"
  printf '%s' "$USER_PROMPT_JSON" | bash "$HOOK" >/dev/null 2>&1
) || true

if [ -f "$CONTENT_OUT" ] && grep -q '^\[USER\] Run the test suite' "$CONTENT_OUT"; then
  record PASS "spec-0161-r1/r2: human prompt classified as [USER] (user-prompt)"
else
  record FAIL "spec-0161-r1/r2: human prompt classified as [USER] (user-prompt)" \
    "captured content: $(cat "$CONTENT_OUT" 2>/dev/null)"
fi

# Test 24: Harness injections (<task-notification> and <system-reminder>)
rm -f "$CONTENT_OUT"
HARNESS_TASK_JSON='{"hook_event_name":"UserPromptSubmit","prompt":"<task-notification>\n<task-id>bqhfosl1o</task-id>\n<summary>CI pass</summary>\n</task-notification>"}'
(
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  export MEMPALACE_PYTHON="$RECORD_PY"
  export CAPTURED_CONTENT_FILE="$CONTENT_OUT"
  printf '%s' "$HARNESS_TASK_JSON" | bash "$HOOK" >/dev/null 2>&1
) || true

HARNESS_REMINDER_JSON='{"hook_event_name":"UserPromptSubmit","prompt":"<system-reminder>Remember to verify CI</system-reminder>"}'
(
  export MEMPALACE_TRANSCRIPT_ENABLED=1
  export MEMPALACE_PYTHON="$RECORD_PY"
  export CAPTURED_CONTENT_FILE="$CONTENT_OUT"
  printf '%s' "$HARNESS_REMINDER_JSON" | bash "$HOOK" >/dev/null 2>&1
) || true

if [ -f "$CONTENT_OUT" ] && grep -q '^\[HARNESS\] <task-notification>' "$CONTENT_OUT" \
   && grep -q '^\[HARNESS\] <system-reminder>' "$CONTENT_OUT"; then
  record PASS "spec-0161-r1/r3: harness injections reclassified as [HARNESS] (harness-injection)"
else
  record FAIL "spec-0161-r1/r3: harness injections reclassified as [HARNESS] (harness-injection)" \
    "captured content: $(cat "$CONTENT_OUT" 2>/dev/null)"
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
