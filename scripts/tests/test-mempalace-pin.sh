#!/bin/bash
# test-mempalace-pin.sh — Regression tests for the pin parser and range
# comparator shared by the MemPalace launch guard and the operator diagnostic
# (spec 0108, issue #623).
#
# Unit under test: scripts/lib/mempalace_pin.py, driven directly — no wrapper,
# no MCP session, no MemPalace install required.
#
# TWO DISTINCT CLAIMS, ASSERTED SEPARATELY.
#
#   (1) THE RANGE COMPARISON — `check()` returns the right verdict for a version
#       against `[min, max)`. Asserted in section 4 by running boundary rows
#       through `check()` and comparing ITS OWN returned verdict to an expected
#       boolean. Never to a re-derived expression, and never by reading only the
#       comparator label off the result: a driver that calls `check()` and then
#       throws the verdict away certifies nothing about the branch it selected.
#       Every row runs under THREE comparator branches (below), because the
#       expected verdict is a property of the range, not of the comparator.
#
#   (2) THE FALLBACK'S SAFETY — "the stdlib whitelist fallback is never more
#       permissive than `packaging`" — a claim over ALL strings that a handful of
#       hand-picked rows cannot certify. Asserted in section 5 over a generated
#       corpus, in two arms.
#
# THREE COMPARATOR BRANCHES, ALL EXERCISED ON EVERY INTERPRETER. `check()`
# selects its branch by whether `packaging` is importable, so a suite that took
# the interpreter as given would leave one branch untested on every machine —
# and the untested one would be `packaging`, the branch in force on every real
# serving interpreter that has it. All three are therefore forced:
#
#   - `stdlib-whitelist`, via the SHIELD — a stub `packaging` whose `version`
#     submodule raises ImportError, so the fallback provably decides.
#   - `packaging`, via the PROVIDER — an independently authored stand-in
#     `packaging.version` that orders plain releases, so the `packaging` BRANCH
#     of `check()` executes even where the real library is absent. The provider
#     is a branch selector, NOT an oracle: it is never used to certify what
#     `packaging` would accept, only to make `check()` take that branch.
#   - `packaging`, via the REAL library on an interpreter that carries one. This
#     is the arm the differential of section 5 needs, and its absence is a
#     COUNTED FAILURE rather than a skip scored as a pass — a green summary must
#     mean the primary comparator was exercised against the real thing.
#
# The section-5 corpus is a release x suffix cross-product plus adversarial
# hand-adds, and it is checked in two arms:
#
#   Arm A — ALWAYS RUNS, and needs no `packaging` at all. `packaging` is actively
#     shielded out (a stub on PYTHONPATH whose `version` submodule raises
#     ImportError), so the fallback is provably the comparator in force — the
#     corpus driver reports the comparator it OBSERVED, and the shield's ability
#     to shadow a real `packaging` is proved separately against the one
#     interpreter on the machine that has one. Every
#     string the fallback accepts is then re-checked against an INDEPENDENTLY
#     AUTHORED expression of the grammar — deliberately not the module's own
#     regex, so a mistake in that regex cannot certify itself — and against the
#     ordering property the invariant's proof rests on: no epoch, no
#     pre-release, no dev-release, hence an ordering position that is the
#     release tuple nudged only upward.
#
#   Arm B — the differential, asserting zero strings where the fallback accepts
#     and `packaging` refuses. It needs the REAL library as its oracle, so it can
#     only run on an interpreter that carries one; when none is resolvable the
#     suite fails rather than skipping, so the count is never invariant to
#     whether the differential ran.
#
# Also asserted: the exact regression rows that broke an earlier blacklist-shaped
# comparator, `read_pin`'s single-declaration contract against fixtures, and the
# `InvalidVersion`-refuses branch.
#
# HERMETIC: everything runs against mktemp -d fixtures and the repo's own
# committed common.sh. No network, no writes outside the temp root, no CLI home
# touched. No pin literal is written into this file — both bounds are read from
# scripts/lib/common.sh at run time, so the guard test cannot drift from the pin.
#
# Usage:
#   bash scripts/tests/test-mempalace-pin.sh
#
# Override the interpreter with CREWRIG_TEST_PYTHON (default: python3).

# -e intentionally omitted: pass/fail counters control the harness, and several
# probes intentionally assert a non-zero exit.
set -uo pipefail

REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/../.." && pwd)"}"
LIB_DIR="$REPO_DIR/scripts/lib"
PIN_MODULE="$LIB_DIR/mempalace_pin.py"
COMMON_SH="$LIB_DIR/common.sh"
PYTHON_BIN="${CREWRIG_TEST_PYTHON:-python3}"

if [ ! -f "$PIN_MODULE" ]; then
  echo "FATAL: missing $PIN_MODULE" >&2
  exit 2
fi
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "FATAL: interpreter not found: $PYTHON_BIN" >&2
  exit 2
fi

# Both bounds come from the single source of truth, never from a literal here.
PIN_MIN="$(sed -n 's|^MEMPALACE_MIN_VERSION="\([^"]*\)"$|\1|p' "$COMMON_SH")"
PIN_MAX="$(sed -n 's|^MEMPALACE_MAX_VERSION_EXCLUSIVE="\([^"]*\)"$|\1|p' "$COMMON_SH")"
if [ -z "$PIN_MIN" ] || [ -z "$PIN_MAX" ]; then
  echo "FATAL: could not read the pin from $COMMON_SH" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

# --- `packaging` shield: makes the fallback provably the comparator in force --
SHIELD="$TMP_ROOT/shield"
mkdir -p "$SHIELD/packaging"
: > "$SHIELD/packaging/__init__.py"
cat > "$SHIELD/packaging/version.py" <<'EOF'
raise ImportError("shielded by scripts/tests/test-mempalace-pin.sh")
EOF

# --- `packaging` provider: makes the PRIMARY branch executable everywhere ------
# The mirror image of the shield. `check()` picks its comparator by whether
# `packaging.version` imports, so on an interpreter without the real library the
# primary branch is unreachable and its range comparison — the branch in force on
# every serving interpreter that HAS `packaging` — would go unasserted.
#
# This stand-in makes that branch executable anywhere. It is deliberately NOT an
# oracle and is never used as one: it certifies nothing about what the real
# `packaging` accepts (section 5's Arm B does that, against the real library
# only). Its single job is branch selection, so it is written to be obviously
# minimal — plain releases ordered by zero-padded integer tuple, everything else
# an `InvalidVersion` — and it is authored independently of `mempalace_pin`'s own
# regex so a mistake there cannot be reflected back as agreement.
PROVIDER="$TMP_ROOT/provider"
mkdir -p "$PROVIDER/packaging"
: > "$PROVIDER/packaging/__init__.py"
cat > "$PROVIDER/packaging/version.py" <<'EOF'
"""Stand-in `packaging.version` — see scripts/tests/test-mempalace-pin.sh.

NOT the real library, and not a substitute for it. It exists so that
`mempalace_pin.check()` takes its `packaging` branch on an interpreter that has
no `packaging` installed, and nothing more.
"""
import re

_PLAIN_RELEASE = re.compile(r"\A[0-9]+(\.[0-9]+)*\Z")


class InvalidVersion(ValueError):
    """Same name and same base class as the real library's."""


class Version:
    def __init__(self, text):
        if not isinstance(text, str) or _PLAIN_RELEASE.match(text) is None:
            raise InvalidVersion(text)
        # `int()` here raises a bare ValueError on a release segment longer than
        # CPython's 4300-digit conversion limit — the real library does exactly
        # the same, from its own `tuple(map(int, ...))`.
        self._release = tuple(int(part) for part in text.split("."))

    def _aligned(self, other):
        width = max(len(self._release), len(other._release))
        return (
            self._release + (0,) * (width - len(self._release)),
            other._release + (0,) * (width - len(other._release)),
        )

    def __le__(self, other):
        mine, theirs = self._aligned(other)
        return mine <= theirs

    def __lt__(self, other):
        mine, theirs = self._aligned(other)
        return mine < theirs
EOF

# --- An interpreter that CAN import the REAL packaging, for the differential ---
# The primary interpreter first, then the one the framework's own detector
# returns (a pipx venv carries `packaging` transitively). When neither has it,
# section 5's Arm B and the shield-effectiveness proof cannot run at all, and
# that is a counted FAILURE below — not a skip scored as a pass.
PACKAGING_PYTHON=""
if "$PYTHON_BIN" -c "import packaging.version" >/dev/null 2>&1; then
  PACKAGING_PYTHON="$PYTHON_BIN"
elif [ -f "$COMMON_SH" ]; then
  # shellcheck source=scripts/lib/common.sh
  . "$COMMON_SH"
  detected="$(detect_mempalace_python 2>/dev/null || true)"
  if [ -n "$detected" ] && "$detected" -c "import packaging.version" >/dev/null 2>&1; then
    PACKAGING_PYTHON="$detected"
  fi
fi

# check_version <version> [shielded]
# Runs the module's CLI; echoes its stdout, returns its exit status.
check_version() {
  if [ "${2:-}" = "shielded" ]; then
    PYTHONPATH="$SHIELD" "$PYTHON_BIN" "$PIN_MODULE" \
      --common-sh "$COMMON_SH" --check "$1" 2>&1
  else
    "${PACKAGING_PYTHON:-$PYTHON_BIN}" "$PIN_MODULE" \
      --common-sh "$COMMON_SH" --check "$1" 2>&1
  fi
}

# expect_verdict <version> <IN_RANGE|OUT_OF_RANGE> <comparator>
expect_verdict() {
  local version="$1" want="$2" comparator="$3" out rc
  out="$(check_version "$version" shielded)"
  rc=$?
  local want_rc=1
  [ "$want" = "IN_RANGE" ] && want_rc=0
  if [ "$rc" -ne "$want_rc" ]; then
    bad "fallback '$version': exit $rc, expected $want_rc ($out)"
    return
  fi
  case "$out" in
    "$want "*"comparator=$comparator"*) ok "fallback '$version' -> $want" ;;
    *) bad "fallback '$version': unexpected verdict line '$out'" ;;
  esac
}

# ---------------------------------------------------------------------------
echo "1. read_pin against the repository's real common.sh"
# ---------------------------------------------------------------------------

out="$("$PYTHON_BIN" "$PIN_MODULE" --common-sh "$COMMON_SH" --print-pin 2>&1)"
rc=$?
if [ "$rc" -eq 0 ] && [ "$out" = "min=${PIN_MIN} max=${PIN_MAX}" ]; then
  ok "read_pin returns the pin declared in common.sh (min=${PIN_MIN} max=${PIN_MAX})"
else
  bad "read_pin on the real common.sh: exit $rc, output '$out'"
fi

# Searched as a BARE substring, not as a quoted literal: a bound reintroduced
# inside a message or a comparison expression never appears in quoted form, and
# that is the regression R5 exists to prevent. Matching lines are echoed, so a
# false positive is legible from the failure alone.
#
# `grep`'s exit status is discriminated three ways rather than tested for
# truthiness: exit 2 means the scan did not happen (unreadable file, broken
# binary), and an `if grep …; then bad; else ok; fi` would score that silent
# non-event as a pass.
pin_literal_hits=0
pin_literal_scan_failed=0
for bound in "$PIN_MIN" "$PIN_MAX"; do
  grep -nF "$bound" "$PIN_MODULE" >&2
  grep_rc=$?
  case "$grep_rc" in
    0)
      echo "    ^ bound literal '$bound' present in $PIN_MODULE" >&2
      pin_literal_hits=$((pin_literal_hits + 1))
      ;;
    1) ;;
    *)
      bad "the R5 literal scan for '$bound' could not run against $PIN_MODULE (grep exit $grep_rc)"
      pin_literal_scan_failed=1
      ;;
  esac
done
if [ "$pin_literal_scan_failed" -eq 1 ]; then
  : # already reported; do not also claim the bound is absent
elif [ "$pin_literal_hits" -eq 0 ]; then
  ok "mempalace_pin.py carries neither bound as a literal (R5)"
else
  bad "mempalace_pin.py carries $pin_literal_hits pin-bound literal(s) — the pin must live only in common.sh (R5)"
fi

# ---------------------------------------------------------------------------
echo "2. read_pin's single-declaration contract, against fixtures"
# ---------------------------------------------------------------------------

# make_pin_fixture <name> <sed-program>
# Derives a fixture common.sh from the real one so no pin literal is authored
# here, then reports whether read_pin refuses it.
make_pin_fixture() {
  local name="$1"
  local program="$2"
  local path="$TMP_ROOT/$name.sh"
  sed "$program" "$COMMON_SH" > "$path"
  printf '%s' "$path"
}

expect_pin_error() {
  local label="$1" path="$2" out rc
  out="$("$PYTHON_BIN" "$PIN_MODULE" --common-sh "$path" --print-pin 2>&1)"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    bad "$label: read_pin accepted an ambiguous pin ('$out')"
  elif [ "${out#PIN_ERROR}" = "$out" ]; then
    bad "$label: refused with exit $rc but no PIN_ERROR diagnostic ('$out')"
  else
    ok "$label: refused with a PIN_ERROR diagnostic"
  fi
}

expect_pin_error "min-version line deleted" \
  "$(make_pin_fixture pin-deleted '/^MEMPALACE_MIN_VERSION=/d')"
expect_pin_error "min-version line duplicated" \
  "$(make_pin_fixture pin-duplicated 's|^MEMPALACE_MIN_VERSION="\(.*\)"$|MEMPALACE_MIN_VERSION="\1"\nMEMPALACE_MIN_VERSION="\1"|')"
expect_pin_error "export-prefixed declaration" \
  "$(make_pin_fixture pin-exported 's|^MEMPALACE_MIN_VERSION=|export MEMPALACE_MIN_VERSION=|')"
expect_pin_error "unquoted value" \
  "$(make_pin_fixture pin-unquoted 's|^MEMPALACE_MIN_VERSION="\([^"]*\)"$|MEMPALACE_MIN_VERSION=\1|')"

# The pin file must be readable at all — an unreadable path is a refusal, not a
# silently skipped check.
expect_pin_error "absent common.sh" "$TMP_ROOT/does-not-exist.sh"

# ---------------------------------------------------------------------------
echo "3. Regression rows — the strings that broke a blacklist-shaped comparator"
# ---------------------------------------------------------------------------
# Every one of these is `InvalidVersion` to `packaging`, so a fallback that
# accepted any of them would be MORE permissive than its own primary comparator
# — reachable whenever an unrecognised installer writes a non-canonical
# `Version:` field, which importlib.metadata returns verbatim and unnormalised.

for v in \
  "${PIN_MIN}-git" \
  "${PIN_MIN}-nightly" \
  "${PIN_MIN}.unknown" \
  "${PIN_MIN}_1" \
  "${PIN_MIN}~1" \
  "${PIN_MIN}+" \
  "${PIN_MIN}:1"; do
  expect_verdict "$v" OUT_OF_RANGE stdlib-whitelist
done

echo "   ... and the rows the grammar must keep serving"
for v in "${PIN_MIN}" "${PIN_MIN}.post1" "${PIN_MIN}+local" "${PIN_MIN}.0"; do
  expect_verdict "$v" IN_RANGE stdlib-whitelist
done

echo "   ... and the rows it must refuse in the safe direction"
# `-1` normalises to `.post1` under packaging and is accepted there; the
# whitelist refuses it deliberately, which is one extra refusal, never one extra
# acceptance.
for v in "${PIN_MAX}" "${PIN_MAX}.0" "${PIN_MIN}-1" "1!${PIN_MIN}"; do
  expect_verdict "$v" OUT_OF_RANGE stdlib-whitelist
done

# ---------------------------------------------------------------------------
echo "4. The range comparison itself — check()'s OWN verdict, on every branch"
# ---------------------------------------------------------------------------
# What broke before: a driver called `check()` only to read the comparator LABEL
# off the result and discarded the verdict, so hardcoding the floor inside
# `check()` — `Version("0") <= Version(found) < Version(maximum)`, which accepts
# every below-floor MemPalace, the exact issue-#623 defect — cost zero
# assertions. This section asserts the verdict `check()` itself returned.
#
# The rows are DERIVED from the pin, never authored: `predecessor(min)`,
# `min`, `predecessor(max)`, `max`, `successor(max)`, plus a far-below anchor.
# Each carries a hardcoded expected verdict (the intent) AND a construction
# cross-check by zero-padded integer tuple comparison, computed inside the driver
# from neither comparator. A future pin that made a row's construction unsound
# fails as a named CONSTRUCTION error rather than quietly inverting an
# expectation.

cat > "$TMP_ROOT/verdict_rows.py" <<'PYEOF'
"""Boundary-row verdict driver for test-mempalace-pin.sh — see that header.

argv: <lib-dir> <min> <max> <expected-comparator>
Prints one line per row plus `key=value` summary lines; exits non-zero when any
row's verdict, any row's construction, or the comparator label is wrong.
"""
import sys

LIB_DIR, MIN, MAX, WANT_COMPARATOR = (
    sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
)
sys.path.insert(0, LIB_DIR)
import mempalace_pin  # noqa: E402


def release_tuple(text):
    return tuple(int(part) for part in text.split("."))


def aligned(left, right):
    width = max(len(left), len(right))
    return left + (0,) * (width - len(left)), right + (0,) * (width - len(right))


def in_range_by_tuple(text):
    """`min <= text < max` by integer tuple comparison — the construction oracle.

    Independent of BOTH comparators: no `packaging`, no `_fallback_in_range`, no
    regex from the module under test. Every row below is a plain release, and a
    plain release's PEP 440 ordering position IS its zero-padded release tuple,
    so this is exact for the row set it is applied to.
    """
    candidate = release_tuple(text)
    low, high = release_tuple(MIN), release_tuple(MAX)
    c1, l1 = aligned(candidate, low)
    c2, h2 = aligned(candidate, high)
    return l1 <= c1 and c2 < h2


def predecessor(text):
    """The next plain release strictly below *text*.

    Decrements the last non-zero component, turning each trailing zero it
    borrows through into 9999 — so `3.6.0` yields `3.5.9999`, strictly below the
    floor while staying adjacent to it, and `3.7` yields `3.6`, the highest
    release the range still admits.
    """
    parts = list(release_tuple(text))
    index = len(parts) - 1
    while index >= 0 and parts[index] == 0:
        parts[index] = 9999
        index -= 1
    if index < 0:
        return None
    parts[index] -= 1
    return ".".join(str(part) for part in parts)


def successor(text):
    parts = list(release_tuple(text))
    parts[-1] += 1
    return ".".join(str(part) for part in parts)


ROWS = [
    ("far below the floor", "0", False),
    ("immediately below the floor", predecessor(MIN), False),
    ("the floor exactly (inclusive bound)", MIN, True),
    ("immediately below the ceiling", predecessor(MAX), True),
    ("the ceiling exactly (EXCLUSIVE bound)", MAX, False),
    ("immediately above the ceiling", successor(MAX), False),
]

failures = 0
for label, text, expected in ROWS:
    if text is None:
        print("CONSTRUCTION FAILURE: %s has no derivable row for pin %s..%s"
              % (label, MIN, MAX))
        failures += 1
        continue
    # (i) the construction is sound for THIS pin, judged by integer tuples.
    if in_range_by_tuple(text) is not expected:
        print("CONSTRUCTION FAILURE: %s -> %r is %s by tuple comparison but the "
              "table expects %s; the row set needs revisiting for pin >=%s,<%s"
              % (label, text, in_range_by_tuple(text), expected, MIN, MAX))
        failures += 1
        continue
    # (ii) check()'s OWN verdict, and the branch that produced it.
    verdict, comparator = mempalace_pin.check(text, MIN, MAX)
    status = "ok"
    if verdict is not expected:
        status = "WRONG VERDICT"
        failures += 1
    elif comparator != WANT_COMPARATOR:
        status = "WRONG COMPARATOR"
        failures += 1
    print("  %-38s %-14s -> verdict=%-5s comparator=%-16s %s"
          % (label, text, verdict, comparator, status))

# check() must be TOTAL: a release segment longer than CPython's int-conversion
# limit raises from inside `int()` on BOTH branches (the real `packaging` maps
# `int()` over the release segment exactly as the fallback does), and a traceback
# on the launch path would kill the guard WITHOUT the R3 field set.
overlong = MIN + "." + "1" * 4301
try:
    verdict, comparator = mempalace_pin.check(overlong, MIN, MAX)
except Exception as exc:  # noqa: BLE001 — the point is that nothing escapes
    print("TOTALITY FAILURE: check() raised %s on a %d-digit release segment"
          % (type(exc).__name__, 4301))
    failures += 1
else:
    limited = getattr(sys, "get_int_max_str_digits", lambda: 0)() in range(1, 4301)
    if comparator != WANT_COMPARATOR:
        print("TOTALITY FAILURE: overlong row decided by %s, expected %s"
              % (comparator, WANT_COMPARATOR))
        failures += 1
    elif limited and verdict is not False:
        print("TOTALITY FAILURE: an unorderable version was ACCEPTED (%r)" % verdict)
        failures += 1
    else:
        print("  %-38s %-14s -> verdict=%-5s comparator=%-16s ok"
              % ("overlong release segment (totality)", "<4301 digits>", verdict,
                 comparator))

print("rows=%d" % len(ROWS))
print("comparator=%s" % WANT_COMPARATOR)
print("failures=%d" % failures)
sys.exit(1 if failures else 0)
PYEOF

# run_verdict_rows <label> <interpreter> <pythonpath|-> <expected-comparator>
run_verdict_rows() {
  local label="$1" interp="$2" pythonpath="$3" comparator="$4" out rc
  if [ "$pythonpath" = "-" ]; then
    out="$("$interp" "$TMP_ROOT/verdict_rows.py" "$LIB_DIR" "$PIN_MIN" "$PIN_MAX" "$comparator" 2>&1)"
  else
    out="$(PYTHONPATH="$pythonpath" "$interp" "$TMP_ROOT/verdict_rows.py" \
      "$LIB_DIR" "$PIN_MIN" "$PIN_MAX" "$comparator" 2>&1)"
  fi
  rc=$?
  printf '%s\n' "$out" | sed 's/^/      /'
  if [ "$rc" -ne 0 ]; then
    bad "$label: check() returned a wrong verdict, a wrong comparator, or an unsound row (see above)"
    return
  fi
  case "$out" in
    *"comparator=$comparator"*) ok "$label: every boundary row's verdict is check()'s own, via $comparator" ;;
    *) bad "$label: the driver did not report the $comparator comparator" ;;
  esac
}

# The PRIMARY branch, forced with the provider so it runs on every interpreter.
echo "   a. the \`packaging\` branch, forced via the provider stand-in"
run_verdict_rows "packaging branch (provider)" "$PYTHON_BIN" "$PROVIDER" packaging

# The DEGRADED branch, forced with the shield.
echo "   b. the fallback branch, forced via the shield"
run_verdict_rows "fallback branch (shielded)" "$PYTHON_BIN" "$SHIELD" stdlib-whitelist

# The PRIMARY branch against the REAL library — the strongest form of the same
# rows, and the one an interpreter without `packaging` cannot run.
echo "   c. the \`packaging\` branch, against the real library"
if [ -n "$PACKAGING_PYTHON" ]; then
  echo "      real-packaging interpreter: $PACKAGING_PYTHON"
  run_verdict_rows "packaging branch (real library)" "$PACKAGING_PYTHON" - packaging
else
  bad "no interpreter here can import the real \`packaging\`, so the PRIMARY comparator was never exercised against the real library (install it: python3 -m pip install packaging, or make CREWRIG_TEST_PYTHON an interpreter that carries it)"
fi

# ---------------------------------------------------------------------------
echo "5. The invariant, over a generated corpus"
# ---------------------------------------------------------------------------

cat > "$TMP_ROOT/corpus_driver.py" <<'PYEOF'
"""Corpus driver for test-mempalace-pin.sh — see that script's header.

argv: <lib-dir> <arm: a|b> <min> <max>
Prints `key=value` summary lines plus one line per violation; exits non-zero
when any violation was found.
"""
import re
import sys

LIB_DIR, ARM, MIN, MAX = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
sys.path.insert(0, LIB_DIR)
import mempalace_pin  # noqa: E402

RELEASES = [
    "3", "3.6", "3.6.0", "3.6.1", "3.6.12", "3.6.0.0", "3.6.0.1", "3.5.9",
    "3.7", "3.7.0", "3.7.1", "4.0.0", "2.9.9", "10.0.0", "0.1.0",
]
SUFFIXES = [
    "", ".post0", ".post1", ".post", "post1", "+local", "+local.1", "+1",
    "+local_1", "+LOCAL", "+", "rc", "rc1", "rc1.dev0", "a1", "b1", "c1",
    ".dev", ".dev0", ".POST1", "-git", "-nightly", "-1", "-", "_1", "~1",
    ":1", ".unknown", ".rev1", ".r1", "..1", ".0.post1", " ",
]
ADVERSARIAL = [
    "", " ", "abc", "v3.6.0", "3.6.0.post1+local", "3.6.0+local.post1",
    "3.6.0rc1+local", "3.6.0-git+x", "3.6.0.post1.post2", "1!3.6.0",
    "0!3.6.0", "1!3.6.0.post1", "3.6.0+", "3.6.0++local", "3.6.0.",
    ".3.6.0", "3..6.0", "3.6.0\t", "\t3.6.0", " 3.6.0 ", "03.06.00",
]

corpus = []
seen = set()
for release in RELEASES:
    for suffix in SUFFIXES:
        candidate = release + suffix
        if candidate not in seen:
            seen.add(candidate)
            corpus.append(candidate)
for candidate in ADVERSARIAL:
    if candidate not in seen:
        seen.add(candidate)
        corpus.append(candidate)

# Independently authored expression of the grammar the fallback is supposed to
# admit. Deliberately NOT mempalace_pin's own regex: a module whose regex is
# wrong must not be allowed to certify itself.
GRAMMAR = re.compile(
    r"\A[0-9]+(\.[0-9]+)*(\.post[0-9]+)?(\+[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*)?\Z"
)
PLAIN_RELEASE = re.compile(r"\A[0-9]+(\.[0-9]+)*\Z")
POST_TAIL = re.compile(r"\.post[0-9]+\Z")
LOCAL_LABEL = re.compile(r"\A[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*\Z")


def ordering_position_is_release(text):
    """True iff *text* carries no epoch, pre-release or dev-release.

    Such a string's ordering position under PEP 440 is its release tuple,
    possibly nudged upward by a post or local segment, never downward — the
    property step (ii) of the invariant's proof relies on.
    """
    if "!" in text:
        return False
    parts = text.split("+", 1)
    public = parts[0]
    if len(parts) == 2 and LOCAL_LABEL.match(parts[1]) is None:
        return False
    public = POST_TAIL.sub("", public)
    return PLAIN_RELEASE.match(public) is not None


violations = 0
print("corpus_size=%d" % len(corpus))

if ARM == "a":
    accepted = 0
    grammar_violations = 0
    ordering_violations = 0
    # The OBSERVED label, never the constant: the caller asserts on this line to
    # prove the shield worked, and printing COMPARATOR_FALLBACK here would make
    # that assertion pass whether or not `packaging` was actually shielded out.
    observed = "none-observed"
    for candidate in corpus:
        verdict, comparator = mempalace_pin.check(candidate, MIN, MAX)
        observed = comparator
        if comparator != mempalace_pin.COMPARATOR_FALLBACK:
            print("SHIELD FAILURE: comparator=%s for %r" % (comparator, candidate))
            violations += 1
            break
        if not verdict:
            continue
        accepted += 1
        stripped = candidate.strip()
        if GRAMMAR.match(stripped) is None:
            print("GRAMMAR VIOLATION: %r accepted but not release[.postN][+local]"
                  % candidate)
            grammar_violations += 1
        if not ordering_position_is_release(stripped):
            print("ORDERING VIOLATION: %r accepted but carries an epoch, "
                  "pre-release or dev-release marker" % candidate)
            ordering_violations += 1
    print("comparator=%s" % observed)
    print("fallback_accepted=%d" % accepted)
    print("grammar_violations=%d" % grammar_violations)
    print("ordering_violations=%d" % ordering_violations)
    violations += grammar_violations + ordering_violations
else:
    from packaging.version import InvalidVersion, Version

    def packaging_accepts(text):
        try:
            return Version(MIN) <= Version(text) < Version(MAX)
        except InvalidVersion:
            return False

    breaches = 0
    both = 0
    packaging_only = 0
    for candidate in corpus:
        fallback = mempalace_pin._fallback_in_range(candidate, MIN, MAX)
        primary = packaging_accepts(candidate)
        if fallback and not primary:
            print("INVARIANT BREACH: fallback accepts %r, packaging refuses it"
                  % candidate)
            breaches += 1
        elif primary and fallback:
            both += 1
        elif primary and not fallback:
            packaging_only += 1
    # The verdict is asserted, not discarded. Reading only the label off a
    # `check()` result is what let a hardcoded floor inside `check()` survive a
    # green differential; section 4 carries the boundary rows, and even this
    # incidental call states what it expects.
    floor_verdict, comparator = mempalace_pin.check(MIN, MIN, MAX)
    if floor_verdict is not True:
        print("ARM B FAILURE: check() refuses the floor itself (%r)" % floor_verdict)
        violations += 1
    print("comparator=%s" % comparator)
    print("accepted_by_both=%d" % both)
    print("packaging_only=%d" % packaging_only)
    print("fallback_accept_packaging_refuse=%d" % breaches)
    violations += breaches
    if comparator != mempalace_pin.COMPARATOR_PACKAGING:
        print("ARM B FAILURE: packaging was importable but comparator=%s"
              % comparator)
        violations += 1

sys.exit(1 if violations else 0)
PYEOF

# Arm A — unconditional, with `packaging` shielded out.
arm_a_out="$(PYTHONPATH="$SHIELD" "$PYTHON_BIN" "$TMP_ROOT/corpus_driver.py" \
  "$LIB_DIR" a "$PIN_MIN" "$PIN_MAX" 2>&1)"
arm_a_rc=$?
echo "$arm_a_out" | sed 's/^/      /'
if [ "$arm_a_rc" -eq 0 ]; then
  ok "Arm A: every fallback-accepted string matches the grammar and orders by release tuple"
else
  bad "Arm A: the fallback accepted a string outside its own grammar (see above)"
fi
case "$arm_a_out" in
  *"comparator=stdlib-whitelist"*) ok "Arm A ran with packaging shielded out — the fallback WAS the comparator" ;;
  *) bad "Arm A did not report the fallback comparator; the shield may have failed" ;;
esac
corpus_size="$(printf '%s\n' "$arm_a_out" | sed -n 's/^corpus_size=//p')"
if [ -n "$corpus_size" ] && [ "$corpus_size" -ge 400 ]; then
  ok "Arm A corpus is a real cross-product (${corpus_size} strings)"
else
  bad "Arm A corpus degenerated to '${corpus_size:-none}' strings — the oracle would be vacuous"
fi
accepted_count="$(printf '%s\n' "$arm_a_out" | sed -n 's/^fallback_accepted=//p')"
if [ -n "$accepted_count" ] && [ "$accepted_count" -gt 0 ]; then
  ok "Arm A exercised the accept path (${accepted_count} accepted)"
else
  bad "Arm A accepted nothing — a comparator that refuses everything would pass vacuously"
fi

# The shield must be PROVED to shadow a real `packaging`, not assumed to: a stub
# that silently failed to shadow it would leave Arm A asserting nothing about the
# degraded mode. On an interpreter that has no `packaging` at all the shield is a
# no-op and the flip is unobservable, so the proof runs where it is decisive — the
# differential interpreter, which has one.
if [ -n "$PACKAGING_PYTHON" ]; then
  unshielded="$("$PACKAGING_PYTHON" "$PIN_MODULE" --common-sh "$COMMON_SH" --check "$PIN_MIN" 2>&1)"
  shielded="$(PYTHONPATH="$SHIELD" "$PACKAGING_PYTHON" "$PIN_MODULE" \
    --common-sh "$COMMON_SH" --check "$PIN_MIN" 2>&1)"
  case "$unshielded:$shielded" in
    *comparator=packaging*:*comparator=stdlib-whitelist*)
      ok "the shield provably shadows a real packaging (packaging -> stdlib-whitelist)" ;;
    *)
      bad "the shield did not flip the comparator on an interpreter that HAS packaging (unshielded='$unshielded', shielded='$shielded')" ;;
  esac
else
  echo "      SKIPPED (not counted): no interpreter here can import the real"
  echo "      \`packaging\`, so shielding it is a no-op and the flip is unobservable."
  echo "      The missing coverage is already reported as a failure in section 4c —"
  echo "      it is deliberately NOT scored as a pass here, so that the summary"
  echo "      count differs between a machine that ran this proof and one that did not."
fi

# Arm B — the differential, when `packaging` is importable.
if [ -n "$PACKAGING_PYTHON" ]; then
  echo "      differential interpreter: $PACKAGING_PYTHON"
  arm_b_out="$("$PACKAGING_PYTHON" "$TMP_ROOT/corpus_driver.py" \
    "$LIB_DIR" b "$PIN_MIN" "$PIN_MAX" 2>&1)"
  arm_b_rc=$?
  echo "$arm_b_out" | sed 's/^/      /'
  if [ "$arm_b_rc" -eq 0 ]; then
    ok "Arm B: zero strings where the fallback accepts and packaging refuses"
  else
    bad "Arm B: the fallback is more permissive than packaging (see above)"
  fi
else
  echo "      SKIPPED (not counted): no interpreter on this machine can import the"
  echo "      real \`packaging\`, so the differential has no oracle. Arm A still"
  echo "      checked the invariant structurally, but the missing differential is"
  echo "      reported as a failure in section 4c rather than scored as a pass."
fi

# ---------------------------------------------------------------------------
echo "6. InvalidVersion refuses on the packaging branch"
# ---------------------------------------------------------------------------
# Exercised unconditionally via the provider — the branch, not the library, is
# what is under test here — and additionally against the real library when one is
# resolvable.

provider_invalid="$(PYTHONPATH="$PROVIDER" "$PYTHON_BIN" "$PIN_MODULE" \
  --common-sh "$COMMON_SH" --check "${PIN_MIN}-git" 2>&1)"
rc=$?
case "$rc:$provider_invalid" in
  1:OUT_OF_RANGE*comparator=packaging*)
    ok "packaging branch refuses an InvalidVersion string rather than ignoring it (provider)" ;;
  *) bad "packaging branch on an InvalidVersion string (provider): exit $rc, output '$provider_invalid'" ;;
esac

if [ -n "$PACKAGING_PYTHON" ]; then
  out="$(check_version "${PIN_MIN}-git")"
  rc=$?
  case "$rc:$out" in
    1:OUT_OF_RANGE*comparator=packaging*)
      ok "the real packaging library refuses the same InvalidVersion string" ;;
    *) bad "real packaging branch on an InvalidVersion string: exit $rc, output '$out'" ;;
  esac
else
  echo "      SKIPPED (not counted): the real-library form of this row needs an"
  echo "      interpreter carrying \`packaging\`; reported in section 4c."
fi

# ---------------------------------------------------------------------------
echo "7. Structural: the module is import-safe inside a JSON-RPC process"
# ---------------------------------------------------------------------------
# A stray module-scope `print` or argv read would corrupt the MCP handshake of
# the wrapper that imports this module, so every one of them must sit under the
# `if __name__ == "__main__":` guard.

# Parsed with `ast`, not grepped: a grep cannot tell a real call from the same
# characters inside a docstring, and this module's own docstring documents the
# very rule being checked.
cat > "$TMP_ROOT/import_safety.py" <<'PYEOF'
"""Report print()/sys.argv occurrences outside the `__main__` guard."""
import ast
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    tree = ast.parse(handle.read())

guard = None
for node in tree.body:
    if isinstance(node, ast.If) and "__main__" in ast.dump(node.test):
        guard = node
if guard is None:
    print("NO_GUARD")
    sys.exit(1)
print("guard_line=%d" % guard.lineno)

strays = []
for node in ast.walk(tree):
    label = None
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "print"
    ):
        label = "print()"
    elif (
        isinstance(node, ast.Attribute)
        and node.attr == "argv"
        and isinstance(node.value, ast.Name)
        and node.value.id == "sys"
    ):
        label = "sys.argv"
    if label is not None and node.lineno < guard.lineno:
        strays.append("STRAY %s at line %d" % (label, node.lineno))
for stray in strays:
    print(stray)
print("strays=%d" % len(strays))
sys.exit(1 if strays else 0)
PYEOF

safety_out="$("$PYTHON_BIN" "$TMP_ROOT/import_safety.py" "$PIN_MODULE" 2>&1)"
safety_rc=$?
main_line="$(printf '%s\n' "$safety_out" | sed -n 's/^guard_line=//p')"
if [ -z "$main_line" ]; then
  bad "mempalace_pin.py has no '__main__' guard ($safety_out)"
  main_line=1
else
  ok "mempalace_pin.py has a '__main__' guard at line $main_line"
fi
if [ "$safety_rc" -eq 0 ]; then
  ok "no print() call and no sys.argv access before the '__main__' guard"
else
  printf '%s\n' "$safety_out" | sed -n 's/^STRAY/    STRAY/p' >&2
  bad "print()/sys.argv occurrence(s) outside the '__main__' guard"
fi

# A third-party import at module scope would make the guard fail on any
# interpreter that lacks it — the exact failure mode the fallback exists for.
#
# The extraction and the search are separated, and each status is discriminated
# three ways. Leaving them as one `sed | grep` pipeline hides an extraction
# failure even under `pipefail`: a `sed` that exits 2 feeds `grep` no input, and
# `pipefail` reports the RIGHTMOST non-zero status — `grep`'s 1 — so "the file
# could not be read" arrives indistinguishable from "the file is clean".
scope_head="$(sed -n "1,${main_line:-1}p" "$PIN_MODULE")"
sed_rc=$?
if [ "$sed_rc" -ne 0 ]; then
  bad "the module-scope import scan could not read $PIN_MODULE (sed exit $sed_rc)"
else
  printf '%s\n' "$scope_head" \
    | grep -nE '^(import|from) (packaging|chromadb|mempalace)\b'
  scope_rc=$?
  case "$scope_rc" in
    0) bad "mempalace_pin.py imports a third-party module at module scope" ;;
    1) ok "mempalace_pin.py imports nothing third-party at module scope" ;;
    *) bad "the module-scope third-party import scan could not run (grep exit $scope_rc)" ;;
  esac
fi

# ---------------------------------------------------------------------------
echo ""
echo "Summary: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
