#!/bin/bash
# test-mempalace-runtime-guard.sh — Regression tests for the launch-time
# MemPalace version guard in scripts/lib/mempalace-http-wrapper.py
# (spec 0108 R1-R6, issue #623).
#
# Unit under test: the wrapper, executed for real, end to end — both guard
# phases, the refusal emitter, and the happy path — against a fabricated
# interpreter environment.
#
# HOW IT IS HERMETIC. A fake `mempalace-<version>.dist-info/METADATA` placed on
# PYTHONPATH wins over any real install for `importlib.metadata.version()`, and a
# stub `mempalace/` package alongside it wins for `import mempalace`. So a full
# launch — including "MemPalace reports version X" — is drivable with no venv, no
# network, no MemPalace of any version installed, and no ChromaDB daemon: the
# fixture also stubs `chromadb`. Each case gets its OWN mktemp fixture tree
# rather than a mutated shared one, because Python's .pyc invalidation keys on
# (mtime-seconds, size) and two same-size rewrites inside one second would
# silently serve a stale module.
#
# Every fixture carries a COPY of the real wrapper, the real mempalace_pin.py and
# the real common.sh, so the pin under test is always the committed one — this
# test authors no pin literal, and the below-floor version it uses is asserted to
# be below the real floor before it is relied upon.
#
# Contract asserted:
#   (a) below-floor version -> non-zero, stdout empty, stderr carries all of
#       R3's four fields (version, range, interpreter, remedy) plus the
#       comparator and R4's restart sentence.
#   (b) above-ceiling version -> same shape.
#   (c) in-range version -> exit 0 and stdout EXACTLY the served sentinel (R6:
#       nothing extra on the session's protocol channel).
#   (d) pin unreadable from the fixture common.sh -> non-zero with the
#       pin-unreadable diagnostic, still carrying R3/R4.
#   (e) mempalace_pin.py unimportable -> non-zero with an EMITTED diagnostic,
#       not a traceback: a guard that cannot load must fail closed and say so.
#   (f) no dist-info at all -> non-zero (PackageNotFoundError fails closed).
#   (g) Phase B: dist-info in range but mempalace.__version__ out of range ->
#       non-zero WITH the full R3/R4 field set, sourced to the module attribute.
#   (h) Phase B: dist-info `.postN` disagreeing with an in-range
#       mempalace.__version__ -> exit 0. Disagreement is NOT a refusal; the two
#       declarations are structurally independent.
#   (i) with `packaging` shielded out: below-floor refuses, in-range serves, and
#       a non-canonical in-range-looking string refuses — all via the fallback
#       comparator, which is the arm that must hold on an interpreter that has
#       no `packaging` at all.
#   (j) structural: no pin literal in the wrapper (R5); Phase A precedes
#       `import chromadb`; Phase B follows the mempalace import.
#
# Usage:
#   bash scripts/tests/test-mempalace-runtime-guard.sh
#
# Override the interpreter with CREWRIG_TEST_PYTHON (default: python3).

# -e intentionally omitted: pass/fail counters control the harness, and most
# cases intentionally assert a non-zero exit.
set -uo pipefail

REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/../.." && pwd)"}"
LIB_DIR="$REPO_DIR/scripts/lib"
WRAPPER="$LIB_DIR/mempalace-http-wrapper.py"
PIN_MODULE="$LIB_DIR/mempalace_pin.py"
COMMON_SH="$LIB_DIR/common.sh"
PYTHON_BIN="${CREWRIG_TEST_PYTHON:-python3}"
SENTINEL="MEMPALACE_STUB_IS_SERVING"

for required in "$WRAPPER" "$PIN_MODULE" "$COMMON_SH"; do
  if [ ! -f "$required" ]; then
    echo "FATAL: missing $required" >&2
    exit 2
  fi
done
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "FATAL: interpreter not found: $PYTHON_BIN" >&2
  exit 2
fi

PIN_MIN="$(sed -n 's|^MEMPALACE_MIN_VERSION="\([^"]*\)"$|\1|p' "$COMMON_SH")"
PIN_MAX="$(sed -n 's|^MEMPALACE_MAX_VERSION_EXCLUSIVE="\([^"]*\)"$|\1|p' "$COMMON_SH")"
if [ -z "$PIN_MIN" ] || [ -z "$PIN_MAX" ]; then
  echo "FATAL: could not read the pin from $COMMON_SH" >&2
  exit 2
fi

# The spec's own below-floor scenario version. Asserted to actually be below the
# committed floor further down, so a future pin change fails loudly here rather
# than turning case (a) into a second in-range case.
BELOW_FLOOR="3.3.5"
IN_RANGE="$PIN_MIN"
ABOVE_CEILING="$PIN_MAX"
EXPECTED_RANGE=">=${PIN_MIN},<${PIN_MAX}"
EXPECTED_REMEDY="mempalace>=${PIN_MIN},<${PIN_MAX}"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

# build_fixture <case-name> <dist-version|none> <attr-version|none> <shield: yes|no>
# Creates a self-contained fixture tree and echoes its root.
#   <root>/lib/    — copies of the wrapper, the pin module and common.sh
#   <root>/site/   — stub mempalace + chromadb + fake dist-info
#   <root>/shield/ — a `packaging` whose `version` submodule raises ImportError
#
# The case name is an explicit argument rather than a counter: this function runs
# inside a command substitution, so a counter incremented here would never reach
# the parent shell and every case would silently share one tree — dist-info
# directories from earlier cases would then decide later ones.
build_fixture() {
  local name="$1"
  local dist="$2"
  local attr="$3"
  local shield="$4"
  local root="$TMP_ROOT/$name"
  rm -rf "$root"
  mkdir -p "$root/lib" "$root/site/mempalace" "$root/site/chromadb"
  cp "$WRAPPER" "$root/lib/mempalace-http-wrapper.py"
  cp "$PIN_MODULE" "$root/lib/mempalace_pin.py"
  cp "$COMMON_SH" "$root/lib/common.sh"

  cat > "$root/site/chromadb/__init__.py" <<'EOF'
"""Minimal chromadb stand-in: enough surface for the wrapper's patch + probe."""


class Settings:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class _Client:
    def heartbeat(self):
        return 1


def HttpClient(host=None, port=None, settings=None, **kwargs):
    return _Client()


def PersistentClient(path=None, settings=None, **kwargs):
    return _Client()
EOF

  if [ "$attr" = "none" ]; then
    : > "$root/site/mempalace/__init__.py"
  else
    printf '__version__ = "%s"\n' "$attr" > "$root/site/mempalace/__init__.py"
  fi

  # Mirrors upstream's own shape: the real channel is captured and stdout is
  # swapped to stderr at IMPORT time, and restored only inside main(). That is
  # what makes assertion (c) — stdout exactly the sentinel — meaningful.
  cat > "$root/site/mempalace/mcp_server.py" <<EOF
import sys

_REAL_STDOUT = sys.stdout
sys.stdout = sys.stderr


def main():
    sys.stdout = _REAL_STDOUT
    print("${SENTINEL}")
EOF

  if [ "$dist" != "none" ]; then
    mkdir -p "$root/site/mempalace-${dist}.dist-info"
    printf 'Metadata-Version: 2.1\nName: mempalace\nVersion: %s\n' "$dist" \
      > "$root/site/mempalace-${dist}.dist-info/METADATA"
  fi

  if [ "$shield" = "yes" ]; then
    mkdir -p "$root/shield/packaging"
    : > "$root/shield/packaging/__init__.py"
    cat > "$root/shield/packaging/version.py" <<'EOF'
raise ImportError("shielded by scripts/tests/test-mempalace-runtime-guard.sh")
EOF
  fi

  printf '%s' "$root"
}

# run_guard <fixture-root>
# Executes the fixture's wrapper; leaves stdout in <root>/stdout, stderr in
# <root>/stderr, and returns the wrapper's exit status.
run_guard() {
  local root="$1"
  local pythonpath="$root/site"
  [ -d "$root/shield" ] && pythonpath="$root/shield:$pythonpath"
  PYTHONPATH="$pythonpath" PYTHONDONTWRITEBYTECODE=1 \
    "$PYTHON_BIN" "$root/lib/mempalace-http-wrapper.py" \
    >"$root/stdout" 2>"$root/stderr" </dev/null
}

# assert_refusal_fields <label> <root> <expected-version> <expected-comparator|any>
# Every refusal must carry R3's four fields, the comparator, and R4's sentence.
assert_refusal_fields() {
  local label="$1"
  local root="$2"
  local version="$3"
  local comparator="$4"
  local err="$root/stderr"

  if [ -s "$root/stdout" ]; then
    bad "$label: wrote to stdout on a refusal — the protocol channel must stay clean"
  else
    ok "$label: stdout empty on refusal"
  fi
  if grep -qF "$version" "$err"; then
    ok "$label: names the version found ($version)"
  else
    bad "$label: stderr does not name the version found ($version)"
  fi
  if grep -qF "$EXPECTED_RANGE" "$err"; then
    ok "$label: names the supported range ($EXPECTED_RANGE)"
  else
    bad "$label: stderr does not name the supported range ($EXPECTED_RANGE)"
  fi
  if grep -qE '^  Resolved interpreter: +[^ ]+' "$err"; then
    ok "$label: names the resolved interpreter"
  else
    bad "$label: stderr does not name the resolved interpreter"
  fi
  if grep -qF "$EXPECTED_REMEDY" "$err"; then
    ok "$label: names the remedy that brings the install into range"
  else
    bad "$label: stderr does not name the remedy ($EXPECTED_REMEDY)"
  fi
  if [ "$comparator" = "any" ]; then
    if grep -qE '^  Comparator: +[^ ]+' "$err"; then
      ok "$label: names the comparator that produced the verdict"
    else
      bad "$label: stderr does not name the comparator"
    fi
  elif grep -qE "^  Comparator: +${comparator}\$" "$err"; then
    ok "$label: comparator is $comparator"
  else
    bad "$label: comparator is not $comparator ($(grep -E '^  Comparator:' "$err" || true))"
  fi
  if grep -qF "must be restarted" "$err"; then
    ok "$label: carries R4's restart sentence"
  else
    bad "$label: stderr omits R4's restart sentence"
  fi
  if grep -qF "Traceback (most recent call last)" "$err"; then
    bad "$label: leaked a Python traceback instead of an emitted diagnostic"
  else
    ok "$label: no traceback leaked"
  fi
}

# ---------------------------------------------------------------------------
echo "0. Preconditions"
# ---------------------------------------------------------------------------

if "$PYTHON_BIN" "$PIN_MODULE" --common-sh "$COMMON_SH" --check "$BELOW_FLOOR" >/dev/null 2>&1; then
  bad "the below-floor fixture version $BELOW_FLOOR is INSIDE the committed pin $EXPECTED_RANGE"
else
  ok "below-floor fixture version $BELOW_FLOOR is outside the committed pin $EXPECTED_RANGE"
fi
if "$PYTHON_BIN" "$PIN_MODULE" --common-sh "$COMMON_SH" --check "$IN_RANGE" >/dev/null 2>&1; then
  ok "in-range fixture version $IN_RANGE is inside the committed pin"
else
  bad "the in-range fixture version $IN_RANGE is OUTSIDE the committed pin"
fi

# ---------------------------------------------------------------------------
echo "1. Below-floor MemPalace refuses to serve"
# ---------------------------------------------------------------------------

root="$(build_fixture below-floor "$BELOW_FLOOR" "$BELOW_FLOOR" no)"
run_guard "$root"
rc=$?
if [ "$rc" -ne 0 ]; then
  ok "below-floor: terminates unsuccessfully (exit $rc)"
else
  bad "below-floor: exited 0 — an out-of-range MemPalace began serving"
fi
assert_refusal_fields "below-floor" "$root" "$BELOW_FLOOR" any

# ---------------------------------------------------------------------------
echo "2. Above-ceiling MemPalace refuses with the same diagnostic shape"
# ---------------------------------------------------------------------------

root="$(build_fixture above-ceiling "$ABOVE_CEILING" "$ABOVE_CEILING" no)"
run_guard "$root"
rc=$?
if [ "$rc" -ne 0 ]; then
  ok "above-ceiling: terminates unsuccessfully (exit $rc)"
else
  bad "above-ceiling: exited 0 — an out-of-range MemPalace began serving"
fi
assert_refusal_fields "above-ceiling" "$root" "$ABOVE_CEILING" any

# ---------------------------------------------------------------------------
echo "3. In-range MemPalace serves unchanged (R6)"
# ---------------------------------------------------------------------------

root="$(build_fixture in-range "$IN_RANGE" "$IN_RANGE" no)"
run_guard "$root"
rc=$?
if [ "$rc" -eq 0 ]; then
  ok "in-range: exits 0"
else
  bad "in-range: exit $rc — a supported install was refused ($(cat "$root/stderr"))"
fi
if [ "$(cat "$root/stdout")" = "$SENTINEL" ]; then
  ok "in-range: stdout is EXACTLY the served sentinel — nothing added to the protocol channel"
else
  bad "in-range: stdout is '$(cat "$root/stdout")', expected exactly '$SENTINEL'"
fi
if [ -s "$root/stderr" ]; then
  bad "in-range: wrote to stderr on the happy path ($(cat "$root/stderr"))"
else
  ok "in-range: stderr silent on the happy path"
fi

# ---------------------------------------------------------------------------
echo "4. Pin unreadable from the launch path's own common.sh"
# ---------------------------------------------------------------------------

root="$(build_fixture pin-unreadable "$IN_RANGE" "$IN_RANGE" no)"
sed -i.bak '/^MEMPALACE_MIN_VERSION=/d' "$root/lib/common.sh" && rm -f "$root/lib/common.sh.bak"
run_guard "$root"
rc=$?
if [ "$rc" -ne 0 ]; then
  ok "pin-unreadable: terminates unsuccessfully (exit $rc)"
else
  bad "pin-unreadable: exited 0 — an unverifiable install began serving"
fi
if grep -qF "the supported-version pin could not be read" "$root/stderr"; then
  ok "pin-unreadable: names the cause"
else
  bad "pin-unreadable: no pin-unreadable diagnostic ($(cat "$root/stderr"))"
fi
if grep -qF "must be restarted" "$root/stderr"; then
  ok "pin-unreadable: still carries R4's restart sentence"
else
  bad "pin-unreadable: omits R4's restart sentence"
fi
if grep -qF "Traceback (most recent call last)" "$root/stderr"; then
  bad "pin-unreadable: leaked a traceback"
else
  ok "pin-unreadable: no traceback leaked"
fi

# ---------------------------------------------------------------------------
echo "5. The guard module itself unimportable — fails closed, not with a trace"
# ---------------------------------------------------------------------------

root="$(build_fixture guard-unimportable "$IN_RANGE" "$IN_RANGE" no)"
cat > "$root/lib/mempalace_pin.py" <<'EOF'
raise ImportError("deliberately broken by test-mempalace-runtime-guard.sh")
EOF
run_guard "$root"
rc=$?
if [ "$rc" -ne 0 ]; then
  ok "guard-unimportable: terminates unsuccessfully (exit $rc)"
else
  bad "guard-unimportable: exited 0 — a session started with no version guard at all"
fi
if grep -qF "could not be imported" "$root/stderr"; then
  ok "guard-unimportable: emits a diagnostic naming the cause"
else
  bad "guard-unimportable: no emitted diagnostic ($(cat "$root/stderr"))"
fi
if grep -qF "Traceback (most recent call last)" "$root/stderr"; then
  bad "guard-unimportable: leaked a traceback instead of the emitted diagnostic"
else
  ok "guard-unimportable: no traceback leaked"
fi
if grep -qF "must be restarted" "$root/stderr"; then
  ok "guard-unimportable: still carries R4's restart sentence"
else
  bad "guard-unimportable: omits R4's restart sentence"
fi

# ---------------------------------------------------------------------------
echo "6. No distribution metadata at all — fails closed"
# ---------------------------------------------------------------------------

root="$(build_fixture no-dist-info none "$IN_RANGE" no)"
run_guard "$root"
rc=$?
if [ "$rc" -ne 0 ]; then
  ok "no-dist-info: terminates unsuccessfully (exit $rc)"
else
  bad "no-dist-info: exited 0 — a version-less install began serving"
fi
if grep -qF "no mempalace distribution metadata is resolvable" "$root/stderr"; then
  ok "no-dist-info: names the cause"
else
  bad "no-dist-info: no diagnostic naming the cause ($(cat "$root/stderr"))"
fi

# ---------------------------------------------------------------------------
echo "7. Phase B: an out-of-range module attribute refuses, with R3/R4 intact"
# ---------------------------------------------------------------------------

root="$(build_fixture phase-b-refuse "$IN_RANGE" "$BELOW_FLOOR" no)"
run_guard "$root"
rc=$?
if [ "$rc" -ne 0 ]; then
  ok "phase-B: terminates unsuccessfully (exit $rc)"
else
  bad "phase-B: exited 0 — an out-of-range module attribute was ignored"
fi
if grep -qF "source: mempalace.__version__" "$root/stderr"; then
  ok "phase-B: attributes the refusal to the module attribute, not to the metadata"
else
  bad "phase-B: refusal is not sourced to mempalace.__version__ ($(cat "$root/stderr"))"
fi
assert_refusal_fields "phase-B" "$root" "$BELOW_FLOOR" any

# ---------------------------------------------------------------------------
echo "8. Phase B: in-range disagreement is NOT a refusal"
# ---------------------------------------------------------------------------
# `mempalace/version.py` is a hand-maintained literal, structurally independent
# of the dist-info field. A `.postN` rebuild disagrees with it legitimately, and
# refusing that would brick a valid install from a stderr nobody reads.

root="$(build_fixture post-release "${PIN_MIN}.post1" "$PIN_MIN" no)"
run_guard "$root"
rc=$?
if [ "$rc" -eq 0 ]; then
  ok "post-release: dist-info ${PIN_MIN}.post1 vs attribute ${PIN_MIN} still serves"
else
  bad "post-release: exit $rc — an in-range disagreement was refused ($(cat "$root/stderr"))"
fi
if [ "$(cat "$root/stdout")" = "$SENTINEL" ]; then
  ok "post-release: stdout is exactly the served sentinel"
else
  bad "post-release: stdout is '$(cat "$root/stdout")'"
fi

# A missing attribute makes Phase B a no-op, never a refusal.
root="$(build_fixture absent-attr "$IN_RANGE" none no)"
run_guard "$root"
rc=$?
if [ "$rc" -eq 0 ]; then
  ok "absent attribute: Phase B is a no-op, not a refusal"
else
  bad "absent attribute: exit $rc ($(cat "$root/stderr"))"
fi

# ---------------------------------------------------------------------------
echo "9. With packaging shielded out — the fallback comparator carries the guard"
# ---------------------------------------------------------------------------
# This arm is unconditional: `packaging` is actively made unimportable rather
# than merely assumed absent, so the fallback is provably what decided.

root="$(build_fixture fallback-below-floor "$BELOW_FLOOR" "$BELOW_FLOOR" yes)"
run_guard "$root"
rc=$?
if [ "$rc" -ne 0 ]; then
  ok "fallback below-floor: terminates unsuccessfully (exit $rc)"
else
  bad "fallback below-floor: exited 0"
fi
assert_refusal_fields "fallback below-floor" "$root" "$BELOW_FLOOR" stdlib-whitelist

root="$(build_fixture fallback-in-range "$IN_RANGE" "$IN_RANGE" yes)"
run_guard "$root"
rc=$?
if [ "$rc" -eq 0 ] && [ "$(cat "$root/stdout")" = "$SENTINEL" ]; then
  ok "fallback in-range: serves, and stdout is exactly the sentinel"
else
  bad "fallback in-range: exit $rc, stdout '$(cat "$root/stdout")' ($(cat "$root/stderr"))"
fi

# The reachability case: importlib.metadata returns the METADATA `Version:` field
# verbatim and unnormalised, so an unrecognised installer really can hand the
# guard a non-canonical string that looks in-range. A blacklist-shaped comparator
# accepted this; the whitelist grammar refuses it.
root="$(build_fixture fallback-noncanonical "${PIN_MIN}-git" "$PIN_MIN" yes)"
run_guard "$root"
rc=$?
if [ "$rc" -ne 0 ]; then
  ok "fallback non-canonical (${PIN_MIN}-git): refuses (exit $rc)"
else
  bad "fallback non-canonical (${PIN_MIN}-git): exited 0 — the fallback was more permissive than packaging"
fi
assert_refusal_fields "fallback non-canonical" "$root" "${PIN_MIN}-git" stdlib-whitelist

# ---------------------------------------------------------------------------
echo "10. Structural assertions on the wrapper"
# ---------------------------------------------------------------------------

# R5 — no second copy of either bound anywhere on the launch path.
literal_hits=0
for bound in "$PIN_MIN" "$PIN_MAX"; do
  if grep -nF "\"$bound\"" "$WRAPPER" >/dev/null 2>&1; then
    echo "    bound literal '$bound' present in $WRAPPER" >&2
    literal_hits=$((literal_hits + 1))
  fi
done
if [ "$literal_hits" -eq 0 ]; then
  ok "wrapper carries no copy of either pin bound (R5)"
else
  bad "wrapper carries $literal_hits pin-bound literal(s) (R5)"
fi

line_of() { grep -n "$1" "$WRAPPER" | head -1 | cut -d: -f1; }

phase_a_line="$(line_of '^    import mempalace_pin')"
chromadb_line="$(line_of '^import chromadb as _chromadb')"
handoff_line="$(line_of '^from mempalace.mcp_server import main')"
phase_b_line="$(line_of '^_MP_ATTR = getattr')"

if [ -n "$phase_a_line" ] && [ -n "$chromadb_line" ] && [ "$phase_a_line" -lt "$chromadb_line" ]; then
  ok "Phase A (line $phase_a_line) precedes 'import chromadb' (line $chromadb_line)"
else
  bad "Phase A does not precede 'import chromadb' (A=${phase_a_line:-none}, chromadb=${chromadb_line:-none})"
fi
if [ -n "$phase_b_line" ] && [ -n "$handoff_line" ] && [ "$phase_b_line" -gt "$handoff_line" ]; then
  ok "Phase B (line $phase_b_line) follows the mempalace import (line $handoff_line)"
else
  bad "Phase B does not follow the mempalace import (B=${phase_b_line:-none}, import=${handoff_line:-none})"
fi

# The refusal emitter must be defined before the sibling import, or the
# unimportable-guard branch of case 5 would have nothing to emit with.
refuse_def_line="$(line_of '^def _refuse')"
if [ -n "$refuse_def_line" ] && [ -n "$phase_a_line" ] && [ "$refuse_def_line" -lt "$phase_a_line" ]; then
  ok "_refuse is defined (line $refuse_def_line) before the sibling import (line $phase_a_line)"
else
  bad "_refuse is not defined before the sibling import"
fi

# ---------------------------------------------------------------------------
echo ""
echo "Summary: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
