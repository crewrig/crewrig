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
# EVERY R3 FIELD IS ASSERTED AS A WHOLE LINE, against the exact value expected.
# The refusal diagnostic's field values overlap heavily as substrings —
# `>=<min>,<max>` occurs inside the remedy, the ceiling occurs inside both — so a
# `grep -F "$value"` for one field is answered by a neighbour's output and cannot
# fail while any refusal line survives. See `field_line`. For the same reason the
# comparator is always an explicit expected label, never a wildcard: a wildcard
# accepts the literal `not reached`, which is the absence of an answer.
#
# Contract asserted:
#   (a) below-floor version -> non-zero, stdout empty, stderr carries all of
#       R3's four fields (version, range, interpreter, remedy) plus the
#       comparator and R4's restart sentence. The module attribute is IN range,
#       so Phase A is the only gate that can produce the refusal — with the same
#       out-of-range value in both declarations, Phase B alone satisfied the case
#       and deleting Phase A cost nothing.
#   (b) above-ceiling version -> same shape, Phase A likewise isolated.
#   (c) in-range version -> exit 0 and stdout EXACTLY the served sentinel (R6:
#       nothing extra on the session's protocol channel).
#   (d) pin unreadable from the fixture common.sh -> non-zero with the
#       pin-unreadable diagnostic, still carrying R3/R4, and with a remedy that
#       names repairing the DECLARATION — not re-running setup, which rewrites
#       nothing in a checkout that is already complete.
#   (e) mempalace_pin.py unimportable -> non-zero with an EMITTED diagnostic,
#       not a traceback: a guard that cannot load must fail closed and say so,
#       and here the remedy IS re-running setup. (d) and (e) are asserted against
#       each other, so one remedy cannot serve both bound-less paths.
#   (f) no dist-info at all -> non-zero (PackageNotFoundError fails closed), with
#       the same R3/R4 field set as every other refusal path.
#   (g) Phase B: dist-info in range but mempalace.__version__ out of range ->
#       non-zero WITH the full R3/R4 field set, sourced to the module attribute.
#   (h) Phase B: dist-info `.postN` disagreeing with an in-range
#       mempalace.__version__ -> exit 0. Disagreement is NOT a refusal; the two
#       declarations are structurally independent.
#   (i) with `packaging` shielded out: below-floor refuses, in-range serves, and
#       a non-canonical in-range-looking string refuses — all via the fallback
#       comparator, which is the arm that must hold on an interpreter that has
#       no `packaging` at all.
#   (j) R2: with every out-of-process source R2 forbids advertising an in-range
#       version from a REPLACED PATH, a below-floor in-process resolution still
#       refuses — the version came from the interpreter, not from an inventory.
#   (k) the guard's own `sys.path` entry does not outlive its import. Asserted
#       under `-P`, the condition that entry exists for: the interpreter then
#       contributes no script-directory entry, so a module planted beside the
#       wrapper is importable from the served entry point ONLY if `scripts/lib/`
#       leaked into the session. The complement — without `-P` the interpreter's
#       own entry is left untouched — is asserted too, so the claim's boundary is
#       recorded rather than overstated.
#   (l) structural: no pin literal in the wrapper (R5), searched as a bare
#       substring so a bound hidden inside a message is caught; Phase A precedes
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
EXPECTED_REMEDY="pipx install --force 'mempalace>=${PIN_MIN},<${PIN_MAX}'"

# The interpreter the wrapper will report as `Resolved interpreter:`. Asked of
# the interpreter itself rather than shape-matched: a wrapper that reported some
# OTHER interpreter's path — a hardcoded one, a `which python3` lookup, a
# different detector candidate — would satisfy a `[^ ]+` grep, and reporting the
# wrong interpreter is one of the failures spec 0108 exists to make impossible.
#
# Recomputed per launch by `run_guard`, under that launch's OWN interpreter flags,
# because `sys.executable` is flag-sensitive: `-S` skips the `site` resolution
# that turns a symlinked `python3` into its versioned target, so the absence case
# legitimately reports a different path from every other case.
GUARD_EXECUTABLE="$("$PYTHON_BIN" -c 'import sys; print(sys.executable)')"

# Which comparator `check()` will select under THIS interpreter. Computed, not
# accepted as "whatever it says": an `any` comparator assertion is satisfied by
# the literal `not reached`, so it cannot distinguish a named comparator from the
# absence of one.
if "$PYTHON_BIN" -c 'import packaging.version' >/dev/null 2>&1; then
  EXPECTED_COMPARATOR="packaging"
else
  EXPECTED_COMPARATOR="stdlib-whitelist"
fi

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

  # Optional 5th argument: plant a module that is importable ONLY from the
  # wrapper's own directory, and have the served entry point report whether it
  # resolved. That answers "did `scripts/lib/` stay on `sys.path` for the serving
  # session?" behaviourally rather than by grepping the wrapper for a call.
  if [ "${5:-no}" = "yes" ]; then
    printf 'MARKER = "crewrig-syspath-probe"\n' > "$root/lib/crewrig_syspath_probe.py"
    cat > "$root/site/mempalace/mcp_server.py" <<EOF
import sys

_REAL_STDOUT = sys.stdout
sys.stdout = sys.stderr


def main():
    sys.stdout = _REAL_STDOUT
    try:
        import crewrig_syspath_probe  # noqa: F401
    except ImportError:
        print("${SENTINEL}")
    else:
        print("LIB_DIR_STILL_ON_SYS_PATH")
EOF
  fi

  printf '%s' "$root"
}

# run_guard <fixture-root> [interpreter-flag ...]
# Executes the fixture's wrapper; leaves stdout in <root>/stdout, stderr in
# <root>/stderr, and returns the wrapper's exit status.
#
# A fixture site on PYTHONPATH SHADOWS a real install (PYTHONPATH precedes
# site-packages), which is why fabricating a version needs nothing installed.
# Shadowing cannot fabricate an ABSENCE, though: on an interpreter that carries a
# real MemPalace, `importlib.metadata.version()` still resolves it out of
# site-packages. The case that asserts absence therefore passes `-S` — the same
# lesson as "asserting a console script is absent needs PATH replaced, not
# prepended", one dimension over. `-S` suppresses site-packages only; PYTHONPATH
# is still honoured, so the fixture's own stubs keep winning.
run_guard() {
  local root="$1"
  shift
  # Same flags as the launch below, so the expected `Resolved interpreter:` value
  # is this interpreter's own answer under this launch's conditions.
  GUARD_EXECUTABLE="$("$PYTHON_BIN" "$@" -c 'import sys; print(sys.executable)')"
  local pythonpath="$root/site"
  [ -d "$root/shield" ] && pythonpath="$root/shield:$pythonpath"
  PYTHONPATH="$pythonpath" PYTHONDONTWRITEBYTECODE=1 \
    "$PYTHON_BIN" "$@" "$root/lib/mempalace-http-wrapper.py" \
    >"$root/stdout" 2>"$root/stderr" </dev/null
}

# field_line <label> <value>
# Reproduces one R3 diagnostic line exactly as `_refuse` formats it
# (`"  {0:<26}{1}"`). Every field below is asserted as a WHOLE LINE against this,
# never as a bare substring: `>=3.6.0,<3.7` is a substring of the remedy line, and
# `3.7` is a substring of both the range and the remedy, so substring greps for
# those values collapse onto a neighbour's output and cannot fail while any one
# refusal line survives. Whole-line matching makes each field independently
# load-bearing — redacting one value fails exactly one assertion.
field_line() {
  printf '  %-26s%s' "$1" "$2"
}

# assert_refusal_fields <label> <root> <version> <source> <comparator>
# Every refusal must carry R3's four fields, the comparator, and R4's sentence.
# <comparator> is always an explicit expected value — including the literal
# `not reached` for the paths that refuse before any comparison happens. There is
# no wildcard: a wildcard accepts `not reached` as an answer everywhere, which is
# precisely what stops it from noticing a comparator that went missing.
assert_refusal_fields() {
  local label="$1"
  local root="$2"
  local version="$3"
  local source="$4"
  local comparator="$5"
  local err="$root/stderr"

  if [ -s "$root/stdout" ]; then
    bad "$label: wrote to stdout on a refusal — the protocol channel must stay clean"
  else
    ok "$label: stdout empty on refusal"
  fi
  local want
  want="$(field_line "MemPalace version found:" "$version  (source: $source)")"
  if grep -qxF "$want" "$err"; then
    ok "$label: names the version found ($version) and its source ($source)"
  else
    bad "$label: no exact version-found field '$want' ($(grep -F 'MemPalace version found:' "$err" || true))"
  fi
  want="$(field_line "Supported range:" "$EXPECTED_RANGE")"
  if grep -qxF "$want" "$err"; then
    ok "$label: names the supported range ($EXPECTED_RANGE)"
  else
    bad "$label: no exact supported-range field '$want' ($(grep -F 'Supported range:' "$err" || true))"
  fi
  want="$(field_line "Resolved interpreter:" "$GUARD_EXECUTABLE")"
  if grep -qxF "$want" "$err"; then
    ok "$label: names the resolved interpreter ($GUARD_EXECUTABLE)"
  else
    bad "$label: does not name THIS interpreter ($(grep -F 'Resolved interpreter:' "$err" || true))"
  fi
  want="$(field_line "To bring into range:" "$EXPECTED_REMEDY")"
  if grep -qxF "$want" "$err"; then
    ok "$label: names the remedy that brings the install into range"
  else
    bad "$label: no exact remedy field '$want' ($(grep -F 'To bring into range:' "$err" || true))"
  fi
  want="$(field_line "Comparator:" "$comparator")"
  if grep -qxF "$want" "$err"; then
    ok "$label: comparator is $comparator"
  else
    bad "$label: comparator is not '$comparator' ($(grep -F 'Comparator:' "$err" || true))"
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

# The module attribute is deliberately IN range, so Phase A is the ONLY gate
# that can produce this refusal. With the same out-of-range value in both
# declarations, deleting Phase A outright left this case passing on Phase B's
# refusal — the case then asserted the guard, not the phase its label names.
root="$(build_fixture below-floor "$BELOW_FLOOR" "$IN_RANGE" no)"
run_guard "$root"
rc=$?
if [ "$rc" -ne 0 ]; then
  ok "below-floor: terminates unsuccessfully (exit $rc)"
else
  bad "below-floor: exited 0 — an out-of-range MemPalace began serving"
fi
assert_refusal_fields "below-floor" "$root" "$BELOW_FLOOR" importlib.metadata "$EXPECTED_COMPARATOR"

# ---------------------------------------------------------------------------
echo "2. Above-ceiling MemPalace refuses with the same diagnostic shape"
# ---------------------------------------------------------------------------

# Attribute in range: Phase A in isolation, as in case 1.
root="$(build_fixture above-ceiling "$ABOVE_CEILING" "$IN_RANGE" no)"
run_guard "$root"
rc=$?
if [ "$rc" -ne 0 ]; then
  ok "above-ceiling: terminates unsuccessfully (exit $rc)"
else
  bad "above-ceiling: exited 0 — an out-of-range MemPalace began serving"
fi
assert_refusal_fields "above-ceiling" "$root" "$ABOVE_CEILING" importlib.metadata "$EXPECTED_COMPARATOR"

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
# R3's remedy field must name an action that would actually repair THIS cause.
# The checkout here is complete — every file the guard needs is present — so
# "re-run the framework setup from a complete checkout" repairs nothing: setup
# rewrites no declaration inside a common.sh it finds. The two bound-less refusal
# paths therefore must NOT share one remedy, which is why they are asserted
# against each other rather than each in isolation.
if grep -qF "repair the pin declaration in" "$root/stderr"; then
  ok "pin-unreadable: the remedy names repairing the declaration"
else
  bad "pin-unreadable: remedy does not name the declaration repair ($(grep -F 'To bring into range:' "$root/stderr" || true))"
fi
if grep -qF "re-run the framework setup" "$root/stderr"; then
  bad "pin-unreadable: remedy points at re-running setup, which repairs nothing here"
else
  ok "pin-unreadable: the remedy does NOT point at re-running setup"
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
# The other side of the pin-unreadable remedy assertion: here the checkout really
# IS incomplete, so re-running setup IS the repair, and the declaration-repair
# wording would be wrong. One remedy for both paths cannot satisfy both halves.
if grep -qF "re-run the framework setup" "$root/stderr"; then
  ok "guard-unimportable: the remedy names re-running setup from a complete checkout"
else
  bad "guard-unimportable: remedy does not name re-running setup ($(grep -F 'To bring into range:' "$root/stderr" || true))"
fi
if grep -qF "repair the pin declaration in" "$root/stderr"; then
  bad "guard-unimportable: remedy points at repairing a declaration, but the pin was never reached"
else
  ok "guard-unimportable: the remedy does NOT point at repairing a declaration"
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
# `-S`: see run_guard. Without it this case asserts nothing on an interpreter
# that carries a real MemPalace — the very interpreter a real session serves on.
run_guard "$root" -S
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
# This is the third of the wrapper's five refusal paths, and R3/R4 bind to every
# one of them — including the one whose "version found" is the absence itself.
assert_refusal_fields "no-dist-info" "$root" "none resolvable" importlib.metadata "not reached"

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
assert_refusal_fields "phase-B" "$root" "$BELOW_FLOOR" mempalace.__version__ "$EXPECTED_COMPARATOR"

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

# Attribute in range: Phase A in isolation, as in case 1.
root="$(build_fixture fallback-below-floor "$BELOW_FLOOR" "$IN_RANGE" yes)"
run_guard "$root"
rc=$?
if [ "$rc" -ne 0 ]; then
  ok "fallback below-floor: terminates unsuccessfully (exit $rc)"
else
  bad "fallback below-floor: exited 0"
fi
assert_refusal_fields "fallback below-floor" "$root" "$BELOW_FLOOR" importlib.metadata stdlib-whitelist

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
assert_refusal_fields "fallback non-canonical" "$root" "${PIN_MIN}-git" importlib.metadata stdlib-whitelist

# ---------------------------------------------------------------------------
echo "10. R2 — no out-of-process source is allowed to decide"
# ---------------------------------------------------------------------------
# Delta-01's R2 permits the serving interpreter's own in-process resolution and
# forbids a package manager's inventory queried out of process, a `mempalace`
# executable resolved from the operator's search path, and a value recorded at
# setup time. Asserted by making every forbidden source LIE in the direction that
# would let the launch through: PATH is REPLACED — prepending cannot un-find the
# real machine's own `mempalace` — by a directory whose `mempalace`,
# `mempalace-mcp`, `pipx` and `uv` all advertise an in-range version, while the
# dist-info the interpreter actually resolves is below the floor. A guard that
# consulted any of them would serve. The #623 incident is exactly this shape:
# `pipx list` said one thing, the interpreter that served resolved another.

# The module attribute is deliberately IN range: Phase B must not be able to
# produce the refusal, or a guard that had been rewritten to trust the PATH
# executable would still refuse here and the case would pass for the wrong reason
# (observed while mutation-testing this very case).
PY_ABS="$(command -v "$PYTHON_BIN")"
root="$(build_fixture lying-out-of-process "$BELOW_FLOOR" "$IN_RANGE" no)"
mkdir -p "$root/liarbin"
for liar in mempalace mempalace-mcp pipx uv pip; do
  cat > "$root/liarbin/$liar" <<EOF
#!/bin/sh
# Every out-of-process source R2 forbids, all agreeing on a version that is in
# range — and all wrong about what this interpreter will actually load.
echo "mempalace ${IN_RANGE}"
exit 0
EOF
  chmod +x "$root/liarbin/$liar"
done
# `sh` and `env`, and nothing else, alongside the liars. CREWRIG_TEST_PYTHON may
# legitimately name a wrapper script — that is how one simulates a CI interpreter
# locally — and a `#!/bin/sh` + `exec env …` wrapper cannot start at all on a PATH
# that carries neither. Neither can advertise a MemPalace version, so the claim
# this case makes is unchanged: every source on PATH that COULD answer "which
# MemPalace?" is a liar.
for external in sh env; do
  resolved="$(command -v "$external" 2>/dev/null || true)"
  [ -n "$resolved" ] && ln -s "$resolved" "$root/liarbin/$external"
done
PYTHONPATH="$root/site" PYTHONDONTWRITEBYTECODE=1 PATH="$root/liarbin" \
  "$PY_ABS" "$root/lib/mempalace-http-wrapper.py" \
  >"$root/stdout" 2>"$root/stderr" </dev/null
rc=$?
if [ "$rc" -ne 0 ]; then
  ok "lying out-of-process sources: still refuses (exit $rc)"
else
  bad "lying out-of-process sources: exited 0 — a forbidden source decided the verdict"
fi
if grep -qxF "$(field_line "MemPalace version found:" "$BELOW_FLOOR  (source: importlib.metadata)")" "$root/stderr"; then
  ok "lying out-of-process sources: the verdict is the in-process version ($BELOW_FLOOR), sourced to importlib.metadata"
else
  bad "lying out-of-process sources: the decided version is not the in-process one ($(grep -F 'MemPalace version found:' "$root/stderr" || true))"
fi

# ---------------------------------------------------------------------------
echo "11. The guard leaves sys.path as it found it"
# ---------------------------------------------------------------------------
# The wrapper puts its own directory on `sys.path` to reach `mempalace_pin`,
# because the script-directory default that would otherwise supply it is defeated
# by PYTHONSAFEPATH=1 and by `python3 -P`. That entry must not outlive the import:
# `scripts/lib/` left on `sys.path` for the whole serving session would let any
# future module dropped there shadow a same-named import for `mempalace` or
# `chromadb`, inside a file whose entire premise is not perturbing the process it
# hands off to.
#
# Asserted under `-P`, which is exactly the condition the insert exists for: the
# interpreter contributes no script-directory entry, so the wrapper's own insert
# is the ONLY thing that could make the planted probe module importable, and the
# served entry point reports whether it was.

root="$(build_fixture syspath-neutral "$IN_RANGE" "$IN_RANGE" no yes)"
if "$PYTHON_BIN" -P -c pass >/dev/null 2>&1; then
  run_guard "$root" -P
  rc=$?
  if [ "$rc" -eq 0 ] && [ "$(cat "$root/stdout")" = "$SENTINEL" ]; then
    ok "under -P the guard's own sys.path entry does not outlive its import"
  else
    bad "under -P: exit $rc, stdout '$(cat "$root/stdout")' — expected exactly '$SENTINEL' (LIB_DIR_STILL_ON_SYS_PATH means scripts/lib/ leaked into the serving session)"
  fi
else
  bad "this interpreter does not support -P, so sys.path neutrality could not be asserted (needs CPython >= 3.11, which CI pins)"
fi

# The complement, and the boundary of the claim: WITHOUT `-P` the interpreter puts
# the script's own directory on `sys.path` itself. That entry is the
# interpreter's, not the guard's, and the guard deliberately does not remove what
# it did not add — so the probe resolves here, and that is correct behaviour
# rather than the leak above.
root="$(build_fixture syspath-default "$IN_RANGE" "$IN_RANGE" no yes)"
run_guard "$root"
rc=$?
if [ "$rc" -eq 0 ] && [ "$(cat "$root/stdout")" = "LIB_DIR_STILL_ON_SYS_PATH" ]; then
  ok "without -P the interpreter's own script-directory entry is left untouched"
else
  bad "without -P: exit $rc, stdout '$(cat "$root/stdout")' — the guard removed an entry it did not add"
fi

# ---------------------------------------------------------------------------
echo "12. Structural assertions on the wrapper"
# ---------------------------------------------------------------------------

# R5 — no second copy of either bound anywhere on the launch path. Searched as a
# BARE substring, NOT as a quoted literal: the regression that matters is a bound
# reintroduced inside a message — `"pipx install 'mempalace>=3.6.0,<3.7'"` — and
# there the bound never appears in quoted form. Matching lines are echoed, so a
# false positive (a bound-shaped substring that is not a pin copy) is legible
# from the failure alone.
#
# `grep`'s status is discriminated three ways rather than tested for truthiness:
# exit 2 means the scan never happened (unreadable file, broken binary), and an
# `if grep …; then bad; else ok; fi` would score that non-event as a clean pass.
literal_hits=0
literal_scan_failed=0
for bound in "$PIN_MIN" "$PIN_MAX"; do
  grep -nF "$bound" "$WRAPPER" >&2
  grep_rc=$?
  case "$grep_rc" in
    0)
      echo "    ^ bound literal '$bound' present in $WRAPPER" >&2
      literal_hits=$((literal_hits + 1))
      ;;
    1) ;;
    *)
      bad "the R5 literal scan for '$bound' could not run against $WRAPPER (grep exit $grep_rc)"
      literal_scan_failed=1
      ;;
  esac
done
if [ "$literal_scan_failed" -eq 1 ]; then
  : # already reported; do not also claim the bound is absent
elif [ "$literal_hits" -eq 0 ]; then
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
