#!/bin/bash
# test-mempalace-pin.sh — Regression tests for the pin parser and range
# comparator shared by the MemPalace launch guard and the operator diagnostic
# (spec 0108, issue #623).
#
# Unit under test: scripts/lib/mempalace_pin.py, driven directly — no wrapper,
# no MCP session, no MemPalace install required.
#
# THE ORACLE IS A GENERATED CORPUS, NOT A ROW LIST. The comparator's central
# claim is an invariant over ALL strings — "the stdlib whitelist fallback is
# never more permissive than `packaging`" — and a handful of hand-picked rows
# cannot certify it. The corpus is a release x suffix cross-product plus
# adversarial hand-adds, and it is checked in two arms:
#
#   Arm A — ALWAYS RUNS, and needs no `packaging` at all. `packaging` is actively
#     shielded out (a stub on PYTHONPATH whose `version` submodule raises
#     ImportError), so the fallback is provably the comparator in force. Every
#     string the fallback accepts is then re-checked against an INDEPENDENTLY
#     AUTHORED expression of the grammar — deliberately not the module's own
#     regex, so a mistake in that regex cannot certify itself — and against the
#     ordering property the invariant's proof rests on: no epoch, no
#     pre-release, no dev-release, hence an ordering position that is the
#     release tuple nudged only upward.
#
#   Arm B — runs only when `packaging` is importable: the differential, asserting
#     zero strings where the fallback accepts and `packaging` refuses. It is a
#     bonus, not the load-bearing arm: Arm A already checks the property
#     structurally, so a machine without `packaging` still runs a test that
#     verifies the invariant rather than one that merely passes.
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

# --- An interpreter that CAN import packaging, for the differential arm -------
# Arm B is a bonus, so this resolution is best-effort: the primary interpreter
# first, then the one the framework's own detector returns (a pipx venv carries
# `packaging` transitively). When neither has it, Arm B is skipped and says so.
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

if grep -qE "\"(${PIN_MIN//./\\.}|${PIN_MAX//./\\.})\"" "$PIN_MODULE"; then
  bad "mempalace_pin.py carries a pin literal — the pin must live only in common.sh (R5)"
else
  ok "mempalace_pin.py carries neither bound as a literal (R5)"
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
echo "4. The invariant, over a generated corpus"
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
    for candidate in corpus:
        verdict, comparator = mempalace_pin.check(candidate, MIN, MAX)
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
    print("comparator=%s" % mempalace_pin.COMPARATOR_FALLBACK)
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
    _, comparator = mempalace_pin.check(MIN, MIN, MAX)
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
  echo "      no interpreter on this machine can import packaging — Arm B skipped."
  echo "      Arm A already checked the invariant structurally; the skip does not"
  echo "      hollow this test out."
  ok "Arm B skip is sound (Arm A carries the invariant)"
fi

# ---------------------------------------------------------------------------
echo "5. InvalidVersion refuses on the packaging branch"
# ---------------------------------------------------------------------------

if [ -n "$PACKAGING_PYTHON" ]; then
  out="$(check_version "${PIN_MIN}-git")"
  rc=$?
  case "$rc:$out" in
    1:OUT_OF_RANGE*comparator=packaging*)
      ok "packaging branch refuses an InvalidVersion string rather than ignoring it" ;;
    *) bad "packaging branch on an InvalidVersion string: exit $rc, output '$out'" ;;
  esac
else
  echo "      no interpreter can import packaging — branch not exercisable here."
  ok "InvalidVersion branch skip is explicit (no packaging on this machine)"
fi

# ---------------------------------------------------------------------------
echo "6. Structural: the module is import-safe inside a JSON-RPC process"
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
if sed -n "1,${main_line:-1}p" "$PIN_MODULE" | grep -nE '^(import|from) (packaging|chromadb|mempalace)\b'; then
  bad "mempalace_pin.py imports a third-party module at module scope"
else
  ok "mempalace_pin.py imports nothing third-party at module scope"
fi

# ---------------------------------------------------------------------------
echo ""
echo "Summary: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
