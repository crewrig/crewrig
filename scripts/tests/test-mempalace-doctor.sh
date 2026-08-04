#!/bin/bash
# test-mempalace-doctor.sh — Regression tests for the operator diagnostic
# scripts/doctor-mempalace.sh (spec 0108 R7-R11, issue #623).
#
# Unit under test: the doctor, executed for real against a fabricated machine —
# a temp HOME carrying all four CLI MCP registration files, a temp PATH carrying
# fake `mempalace` / `mempalace-mcp` console scripts, and several fake checkouts.
#
# HOW IT IS HERMETIC. Two devices do all the work:
#   - A fake `mempalace-<version>.dist-info/METADATA` on PYTHONPATH wins over any
#     real install for `importlib.metadata.version()`, so an arbitrary version is
#     fabricable without installing anything.
#   - An "interpreter" is a tiny shell shim that execs the real interpreter with
#     PYTHONPATH pointed at one of those fake sites. Registering a shim as the
#     interpreter therefore pins exactly which version that registration serves.
#     This is sound because the doctor READS a console script's shebang as text
#     and then invokes that interpreter itself — it never execs the console
#     script, so no shebang-length or exec semantics are involved.
#
# Contract asserted:
#   (a) both registration argv shapes are resolved to the same interpreter: the
#       discriminator is the `[.command] + .args` concatenation, not a position
#       inside `.args`. `bash tls-exec.sh <py> <wrapper>` and `<py> <wrapper>`
#       must both name <py>.
#   (b) divergence: `mempalace` serving one version while `mempalace-mcp` serves
#       another is reported for BOTH paths, exits non-zero, and names which path
#       carries the out-of-range version.
#   (c) a registration whose checkout has no mempalace_pin.py reports GUARD
#       ABSENT — a label DISTINCT from the UNGUARDED a wrapper-less argv gets.
#   (d) a registration pointing at a checkout whose common.sh declares a
#       different pin is reported as a pin divergence.
#   (e) R10: candidate 1 absent -> an explicit fallback-selected line naming both
#       the skipped candidate and the winner, plus the winner's version;
#       candidate 1 present -> no fallback line at all.
#   (f) R9: an install under a directory named after no known installer is still
#       fully reported.
#   (g) R4: the restart sentence prints on every outcome, clean or not.
#   (h) a clean machine exits 0.
#   (h2) a dist-info / `mempalace.__version__` disagreement is REPORTED and is
#       neither a divergence nor a non-zero outcome — the doctor half of the
#       wrapper's decision not to refuse on disagreement.
#   (h3) R8's second trigger on its own: every source agreeing on the SAME
#       out-of-range version still exits non-zero, with no divergence involved.
#       Same machine covers the `#!/usr/bin/env python3` shebang form, whose
#       interpreter is the second token.
#   (h4) R8's FIRST trigger on its own — the mirror image of (h3), and the spec's
#       headline "Divergent installs are reported and flagged" scenario. Two
#       sources report DIFFERENT versions, both INSIDE the pin, against ONE pin:
#       so neither the range trigger nor the pin-divergence trigger can produce
#       the outcome, and only the version-divergence detection can. Scenario 1
#       fires all three triggers at once, which is why a bare `DIVERGE` grep there
#       is answered by the pin-divergence line and proves nothing about this one.
#   (i) a registration whose wrapper FILE is gone while its `scripts/lib/`
#       directory survives is reported as WRAPPER MISSING — a verdict that must
#       come from the wrapper's own existence, not from whether a `cd` two levels
#       above it succeeds.
#   (j) a registration whose interpreter resolves NO mempalace distribution at
#       all is reported as NO VERSION and is a non-successful outcome — and the
#       report says only that. Neither divergence trigger nor the range trigger
#       may stand in for the finding, because such a source contributes no
#       version to compare and none to range-check.
#   (k) R11 (structural): every CLI's launch path names the wrapper — for two
#       CLIs in the setup script, for the other two in the committed MCP template
#       the setup script patches. The assertion spans script AND template, or it
#       would fail on a correct tree.
#
# Usage:
#   bash scripts/tests/test-mempalace-doctor.sh
#
# Override the interpreter with CREWRIG_TEST_PYTHON (default: python3).

# -e intentionally omitted: pass/fail counters control the harness, and several
# scenarios intentionally assert a non-zero exit.
set -uo pipefail

REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/../.." && pwd)"}"
DOCTOR="$REPO_DIR/scripts/doctor-mempalace.sh"
LIB_DIR="$REPO_DIR/scripts/lib"
WRAPPER="$LIB_DIR/mempalace-http-wrapper.py"
PIN_MODULE="$LIB_DIR/mempalace_pin.py"
COMMON_SH="$LIB_DIR/common.sh"
TLS_EXEC="$LIB_DIR/tls-exec.sh"
PYTHON_BIN="${CREWRIG_TEST_PYTHON:-python3}"

for required in "$DOCTOR" "$WRAPPER" "$PIN_MODULE" "$COMMON_SH"; do
  if [ ! -f "$required" ]; then
    echo "FATAL: missing $required" >&2
    exit 2
  fi
done
if ! command -v jq >/dev/null 2>&1; then
  echo "FATAL: jq is required by the unit under test" >&2
  exit 2
fi
PYTHON_ABS="$(command -v "$PYTHON_BIN" 2>/dev/null || true)"
if [ -z "$PYTHON_ABS" ]; then
  echo "FATAL: interpreter not found: $PYTHON_BIN" >&2
  exit 2
fi

PIN_MIN="$(sed -n 's|^MEMPALACE_MIN_VERSION="\([^"]*\)"$|\1|p' "$COMMON_SH")"
PIN_MAX="$(sed -n 's|^MEMPALACE_MAX_VERSION_EXCLUSIVE="\([^"]*\)"$|\1|p' "$COMMON_SH")"
if [ -z "$PIN_MIN" ] || [ -z "$PIN_MAX" ]; then
  echo "FATAL: could not read the pin from $COMMON_SH" >&2
  exit 2
fi

# The spec's own divergence scenario: `mempalace` on an old install while
# `mempalace-mcp` resolves elsewhere on a supported one.
OLD_VERSION="3.0.0"
GOOD_VERSION="$PIN_MIN"
# A SECOND version that is also inside the pin, for the version-divergence
# scenario that must fire with nothing else wrong. Derived from the pin rather
# than authored, and asserted to be in range further down — if a future pin ever
# made it out of range, the scenario would silently become a range test instead.
SECOND_GOOD_VERSION="${PIN_MIN}.1"

# The comparator and the `packaging importable:` answer the fixture interpreters
# will report. Every fixture "interpreter" is a shim that execs PYTHON_ABS, so
# both facts are PYTHON_ABS's, computed here rather than matched by shape: a
# `Comparator: <something>` grep is satisfied by the literal `not reached`, and a
# `packaging importable: <something>` grep by either answer.
if "$PYTHON_ABS" -c 'import packaging.version' >/dev/null 2>&1; then
  DOCTOR_COMPARATOR="packaging"
  DOCTOR_HAS_PACKAGING="yes"
else
  DOCTOR_COMPARATOR="stdlib-whitelist"
  DOCTOR_HAS_PACKAGING="no"
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

# --- Fixture builders --------------------------------------------------------

# make_fakesite <dir> <version> [attr-version]
# <attr-version> defaults to <version>. Passing a different one fabricates the
# legitimate disagreement a `.postN` rebuild produces: the dist-info field and the
# hand-maintained `mempalace.__version__` literal are structurally independent.
make_fakesite() {
  local dir="$1"
  local version="$2"
  local attr="${3:-$2}"
  mkdir -p "$dir/mempalace" "$dir/mempalace-${version}.dist-info"
  printf '__version__ = "%s"\n' "$attr" > "$dir/mempalace/__init__.py"
  printf 'def main():\n    return None\n' > "$dir/mempalace/mcp_server.py"
  printf 'Metadata-Version: 2.1\nName: mempalace\nVersion: %s\n' "$version" \
    > "$dir/mempalace-${version}.dist-info/METADATA"
}

# make_interpreter <path> <fakesite-dir>
# A shim that IS an interpreter as far as the doctor is concerned.
#
# The real interpreter is named by ABSOLUTE path, never by the possibly-relative
# CREWRIG_TEST_PYTHON: a shim installed under the name `python3` on a fixture PATH
# would otherwise exec itself forever.
make_interpreter() {
  local path="$1"
  local site="$2"
  mkdir -p "$(dirname "$path")"
  cat > "$path" <<EOF
#!/bin/sh
exec env PYTHONPATH="${site}" PYTHONDONTWRITEBYTECODE=1 "${PYTHON_ABS}" "\$@"
EOF
  chmod +x "$path"
}

# make_absent_interpreter <path>
# An "interpreter" that genuinely resolves NO mempalace distribution, for the
# no-version branch.
#
# `-S` rather than an empty fixture site, because a fixture on PYTHONPATH can only
# SHADOW an install, never establish its absence: on an interpreter carrying a real
# MemPalace, `importlib.metadata.version()` still resolves it out of site-packages.
# `-S` suppresses site-packages and `env -u PYTHONPATH` drops whatever the ambient
# environment supplies, so nothing is left to answer. The pin module imports only
# the stdlib, so `--print-pin` still works under those flags — which is what lets
# the row get as far as the verdict at all.
make_absent_interpreter() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
  cat > "$path" <<EOF
#!/bin/sh
exec env -u PYTHONPATH PYTHONDONTWRITEBYTECODE=1 "${PYTHON_ABS}" -S "\$@"
EOF
  chmod +x "$path"
}

# make_checkout <dir>
# A fake CrewRig checkout carrying a wrapper, a common.sh and a pin module.
make_checkout() {
  local dir="$1"
  mkdir -p "$dir/scripts/lib"
  cp "$WRAPPER" "$dir/scripts/lib/mempalace-http-wrapper.py"
  cp "$COMMON_SH" "$dir/scripts/lib/common.sh"
  cp "$PIN_MODULE" "$dir/scripts/lib/mempalace_pin.py"
}

# make_console_script <path> <interpreter>
# A console script whose SHEBANG names the interpreter — the only part of it the
# doctor reads.
make_console_script() {
  local path="$1"
  local interp="$2"
  mkdir -p "$(dirname "$path")"
  printf '#!%s\n# fake console script — never executed by the doctor\n' "$interp" > "$path"
  chmod +x "$path"
}

# write_reg_bash <file> <interpreter> <wrapper>
# The spec-0084 shape: `bash tls-exec.sh <py> <wrapper>` — interpreter INSIDE args.
write_reg_bash() {
  mkdir -p "$(dirname "$1")"
  jq -n --arg tls "$TLS_EXEC" --arg py "$2" --arg wrapper "$3" \
    '{mcpServers: {mempalace: {type: "stdio", command: "bash", args: [$tls, $py, $wrapper]}}}' \
    > "$1"
}

# write_reg_direct <file> <interpreter> <wrapper>
# The pre-0084 / shipped-template shape: interpreter in `.command`, wrapper as
# args[0] — NO element precedes the wrapper inside `.args` at all.
write_reg_direct() {
  mkdir -p "$(dirname "$1")"
  jq -n --arg py "$2" --arg wrapper "$3" \
    '{mcpServers: {mempalace: {command: $py, args: [$wrapper]}}}' \
    > "$1"
}

# write_reg_unguarded <file> <interpreter>
# An argv that routes through no wrapper at all.
write_reg_unguarded() {
  mkdir -p "$(dirname "$1")"
  jq -n --arg py "$2" \
    '{mcpServers: {mempalace: {command: $py, args: ["-m", "mempalace.mcp_server"]}}}' \
    > "$1"
}

# make_toolbin <dir>
# Symlinks just the externals the doctor needs, so a scenario can run with a PATH
# that is EXACTLY the fixture — the only way to assert the "console script is
# absent" branch without the real machine's own `mempalace` answering instead.
make_toolbin() {
  local dir="$1"
  mkdir -p "$dir"
  local tool resolved
  for tool in bash sh env jq grep sed head cut sort tr wc cat rm mktemp dirname \
              basename readlink find uname python3 "$(basename "$PYTHON_BIN")"; do
    resolved="$(command -v "$tool" 2>/dev/null || true)"
    if [ -n "$resolved" ] && [ ! -e "$dir/$tool" ]; then
      ln -s "$resolved" "$dir/$tool"
    fi
  done
}

# run_doctor <fake-home> <fake-path-dir> <output-file>
# PATH is PREPENDED, so the fixture's console scripts win while the real machine
# still supplies the doctor's tools.
run_doctor() {
  HOME="$1" PATH="$2:$PATH" bash "$DOCTOR" >"$3" 2>&1
}

# run_doctor_isolated <fake-home> <fake-path-dir> <toolbin> <output-file>
# PATH is REPLACED, so nothing outside the fixture and the tool symlinks resolves.
run_doctor_isolated() {
  HOME="$1" PATH="$2:$3" bash "$DOCTOR" >"$4" 2>&1
}

# --- Assertion helpers -------------------------------------------------------

has() {
  if grep -qF "$2" "$1"; then
    ok "$3"
  else
    bad "$3 (not found in the report: '$2')"
  fi
}

lacks() {
  if grep -qF "$2" "$1"; then
    bad "$3 (unexpectedly present: '$2')"
  else
    ok "$3"
  fi
}

# doctor_field_line <label> <value>
# Reproduces one per-source report line exactly as the doctor's `field()` helper
# formats it (`printf '    %-24s%s\n'`). Used with `has_exact` below so each
# reported FIELD is independently load-bearing: the doctor echoes the supported
# range unconditionally, and `>=<min>,<max>` contains the floor, so a substring
# grep for the version is answered by the range line of any row and cannot fail
# while the pin is readable.
doctor_field_line() {
  printf '    %-24s%s' "$1" "$2"
}

has_exact() {
  if grep -qxF "$2" "$1"; then
    ok "$3"
  else
    bad "$3 (no line exactly '$2')"
  fi
}

# ---------------------------------------------------------------------------
echo "1. Divergent installs, both argv shapes, and the three guard labels"
# ---------------------------------------------------------------------------
# One machine exercising, at once: an out-of-range install on PATH beside an
# in-range one, the two registration argv shapes, a pre-guard checkout, a
# wrapper-less argv, and a checkout declaring a different pin.

S1="$TMP_ROOT/s1"
S1_HOME="$S1/home"
S1_PATHDIR="$S1/bin"
# R9 — the old install lives under a directory named after no installer the
# framework has ever heard of, and must still be fully reported.
S1_OLD_SITE="$S1/an-unrecognised-mechanism/site"
S1_GOOD_SITE="$S1/good/site"
make_fakesite "$S1_OLD_SITE" "$OLD_VERSION"
make_fakesite "$S1_GOOD_SITE" "$GOOD_VERSION"
make_interpreter "$S1/an-unrecognised-mechanism/python-old" "$S1_OLD_SITE"
make_interpreter "$S1/good/python-good" "$S1_GOOD_SITE"

make_checkout "$S1/checkout-guarded"
make_checkout "$S1/checkout-preguard"
rm -f "$S1/checkout-preguard/scripts/lib/mempalace_pin.py"
make_checkout "$S1/checkout-altpin"
# A checkout declaring a DIFFERENT ceiling. Derived by editing the copied
# declaration, so no pin literal is authored in this test.
sed -i.bak 's|^MEMPALACE_MAX_VERSION_EXCLUSIVE=.*|MEMPALACE_MAX_VERSION_EXCLUSIVE="9.9"|' \
  "$S1/checkout-altpin/scripts/lib/common.sh"
rm -f "$S1/checkout-altpin/scripts/lib/common.sh.bak"

write_reg_bash   "$S1_HOME/.claude.json" \
  "$S1/good/python-good" "$S1/checkout-guarded/scripts/lib/mempalace-http-wrapper.py"
write_reg_direct "$S1_HOME/.gemini/settings.json" \
  "$S1/good/python-good" "$S1/checkout-preguard/scripts/lib/mempalace-http-wrapper.py"
write_reg_unguarded "$S1_HOME/.copilot/mcp-config.json" "$S1/good/python-good"
write_reg_bash   "$S1_HOME/.gemini/config/mcp_config.json" \
  "$S1/good/python-good" "$S1/checkout-altpin/scripts/lib/mempalace-http-wrapper.py"

make_console_script "$S1_PATHDIR/mempalace"     "$S1/an-unrecognised-mechanism/python-old"
make_console_script "$S1_PATHDIR/mempalace-mcp" "$S1/good/python-good"

S1_OUT="$S1/report.txt"
run_doctor "$S1_HOME" "$S1_PATHDIR" "$S1_OUT"
s1_rc=$?

if [ "$s1_rc" -ne 0 ]; then
  ok "divergent machine: exits non-zero ($s1_rc)"
else
  bad "divergent machine: exited 0 despite a reported divergence"
fi

has "$S1_OUT" "$OLD_VERSION" "reports the out-of-range version ($OLD_VERSION)"
has "$S1_OUT" "$GOOD_VERSION" "reports the in-range version ($GOOD_VERSION)"
has "$S1_OUT" "$S1_PATHDIR/mempalace" "names the resolved path of \`mempalace\`"
has "$S1_OUT" "mempalace-mcp" "names \`mempalace-mcp\` as its own row"
has "$S1_OUT" "an-unrecognised-mechanism" \
  "R9: reports an install placed by a mechanism it does not recognise"
# Deliberately the FULL trigger sentence, not a bare `DIVERGE`. This fixture
# fires three triggers at once (out-of-range, version divergence, pin
# divergence), and `DIVERGE` alone is satisfied by the PIN-divergence line —
# so deleting version-divergence detection outright cost nothing here. The
# version trigger in isolation is scenario 6; this row keeps the combined
# machine honest about WHICH divergence it is reporting.
has "$S1_OUT" "reported versions DIVERGE" \
  "R8: reports the VERSION divergence explicitly (not merely some divergence)"
has "$S1_OUT" "declared pins DIVERGE" \
  "R8: reports the PIN divergence explicitly, as a separate finding"
has "$S1_OUT" "must be restarted" "R4: carries the restart sentence"

# R8 — which path carries the out-of-range version must be identifiable without
# further investigation, so the offending PATH entry and the version appear on
# one line together.
if grep -F "PATH:mempalace" "$S1_OUT" | grep -qF "$OLD_VERSION"; then
  ok "R8: names WHICH path carries the out-of-range version"
else
  bad "R8: the out-of-range version is not attributed to a named path"
fi

# (a) Both argv shapes must resolve to the same interpreter.
shape_hits="$(grep -cF "registered interpreter: $S1/good/python-good" "$S1_OUT")"
if [ "$shape_hits" -ge 3 ]; then
  ok "both argv shapes resolved the interpreter (${shape_hits} registrations)"
else
  bad "argv-shape resolution found the interpreter in only ${shape_hits} registration(s)"
fi

# (c) GUARD ABSENT and UNGUARDED are distinct labels for distinct conditions.
has "$S1_OUT" "GUARD ABSENT (pre-guard checkout)" \
  "pre-guard checkout is labelled GUARD ABSENT"
has "$S1_OUT" "UNGUARDED" "wrapper-less argv is labelled UNGUARDED"
if [ "$(grep -cF "GUARD ABSENT" "$S1_OUT")" -eq 1 ] \
   && [ "$(grep -cF "UNGUARDED" "$S1_OUT")" -eq 1 ]; then
  ok "the two labels apply to exactly one registration each"
else
  bad "GUARD ABSENT / UNGUARDED counts are not 1 and 1"
fi

# (d) A checkout declaring a different pin is a pin divergence.
if grep -qF "Pins declared, by source" "$S1_OUT"; then
  ok "a checkout with a different pin is reported as a pin divergence"
else
  bad "the alternate-pin checkout did not produce a pin-divergence report"
fi

# (e) R10 — candidate 1 (the pipx venv path under this fake HOME) does not exist,
# so the selection falls back and must say so, with the winner's version.
has "$S1_OUT" "fallback selected:" "R10: a fallback selection is announced, not silent"
if grep -A3 "fallback selected:" "$S1_OUT" | grep -qF ".local/pipx/venvs/mempalace/bin/python"; then
  ok "R10: names the highest-priority candidate that was skipped"
else
  bad "R10: does not name the skipped candidate 1"
fi

# ---------------------------------------------------------------------------
echo "2. A clean machine: exits 0, no fallback line, still says restart"
# ---------------------------------------------------------------------------

S2="$TMP_ROOT/s2"
S2_HOME="$S2/home"
S2_PATHDIR="$S2/bin"
S2_SITE="$S2/site"
make_fakesite "$S2_SITE" "$GOOD_VERSION"
# Candidate 1 of the detector's order, present and serving an in-range version.
S2_PY="$S2_HOME/.local/pipx/venvs/mempalace/bin/python"
make_interpreter "$S2_PY" "$S2_SITE"
make_checkout "$S2/checkout"
S2_WRAPPER="$S2/checkout/scripts/lib/mempalace-http-wrapper.py"

write_reg_bash   "$S2_HOME/.claude.json"                 "$S2_PY" "$S2_WRAPPER"
write_reg_direct "$S2_HOME/.gemini/settings.json"         "$S2_PY" "$S2_WRAPPER"
write_reg_direct "$S2_HOME/.copilot/mcp-config.json"      "$S2_PY" "$S2_WRAPPER"
write_reg_bash   "$S2_HOME/.gemini/config/mcp_config.json" "$S2_PY" "$S2_WRAPPER"
make_console_script "$S2_PATHDIR/mempalace"     "$S2_PY"
make_console_script "$S2_PATHDIR/mempalace-mcp" "$S2_PY"

S2_OUT="$S2/report.txt"
run_doctor "$S2_HOME" "$S2_PATHDIR" "$S2_OUT"
s2_rc=$?

if [ "$s2_rc" -eq 0 ]; then
  ok "clean machine: exits 0"
else
  bad "clean machine: exit $s2_rc — $(grep -A6 'NOT OK' "$S2_OUT" | head -8)"
fi
lacks "$S2_OUT" "fallback selected:" "R10: no fallback line when candidate 1 wins"
has   "$S2_OUT" "selection:" \
  "R7: the report names the interpreter the launch path would itself select"
lacks "$S2_OUT" "GUARD ABSENT" "no GUARD ABSENT label when every checkout carries the guard"
lacks "$S2_OUT" "DIVERGE" "no divergence reported on a consistent machine"
has   "$S2_OUT" "must be restarted" "R4: the restart sentence prints on a clean run too"
has   "$S2_OUT" "OK — every source reports the same MemPalace version" \
  "clean machine states the successful outcome"

# R7's per-source report fields, each as a WHOLE LINE. The doctor echoes
# `supported range: >=<min>,<max>` for every row unconditionally, and the fixture's
# in-range version IS the floor, so `grep -F "$GOOD_VERSION"` is answered by the
# range line of any row and cannot fail while the pin is readable. Redacting the
# served version, or deleting the verdict or packaging-importable field outright,
# has to cost an assertion — these are the assertions it costs.
has_exact "$S2_OUT" \
  "$(doctor_field_line "version served:" "${GOOD_VERSION}  (dist-info, resolved in-process)")" \
  "R7: reports the served version as its own field, sourced to dist-info"
has_exact "$S2_OUT" \
  "$(doctor_field_line "mempalace.__version__:" "${GOOD_VERSION}  (agrees with dist-info)")" \
  "R7: reports the module literal and that it agrees with dist-info"
has_exact "$S2_OUT" \
  "$(doctor_field_line "supported range:" ">=${PIN_MIN},<${PIN_MAX}")" \
  "R7: reports the pin the row was checked against"
has_exact "$S2_OUT" \
  "$(doctor_field_line "verdict:" "IN_RANGE version=${GOOD_VERSION} range=>=${PIN_MIN},<${PIN_MAX} comparator=${DOCTOR_COMPARATOR}")" \
  "R7: reports the range verdict, naming the comparator that produced it (${DOCTOR_COMPARATOR})"
has_exact "$S2_OUT" \
  "$(doctor_field_line "packaging importable:" "$DOCTOR_HAS_PACKAGING")" \
  "R7: reports whether the probed interpreter can import packaging (${DOCTOR_HAS_PACKAGING})"

# ---------------------------------------------------------------------------
echo "3. Absent surfaces are reported as absent, not as errors"
# ---------------------------------------------------------------------------

S3="$TMP_ROOT/s3"
S3_HOME="$S3/home"
S3_PATHDIR="$S3/bin"
S3_TOOLBIN="$S3/toolbin"
mkdir -p "$S3_HOME" "$S3_PATHDIR"
make_toolbin "$S3_TOOLBIN"
S3_OUT="$S3/report.txt"
# Isolated PATH: on the authoring machine a real `mempalace` sits on PATH, and a
# prepended fixture dir cannot un-find it.
run_doctor_isolated "$S3_HOME" "$S3_PATHDIR" "$S3_TOOLBIN" "$S3_OUT"
s3_rc=$?

# A machine with no MemPalace anywhere is legitimately a non-successful outcome —
# the doctor has nothing to confirm.
if [ "$s3_rc" -ne 0 ]; then
  ok "empty machine: exits non-zero (nothing to confirm)"
else
  bad "empty machine: exited 0 with no MemPalace resolvable anywhere"
fi

has "$S3_OUT" "NOT PRESENT" "a CLI with no MCP config is reported as not present"
has "$S3_OUT" "ABSENT — not on PATH" "an absent console script is reported as absent"
has "$S3_OUT" "must be restarted" "R4: the restart sentence prints on an empty machine too"
if grep -qF "Files consulted for this section" "$S3_OUT"; then
  ok "the doctor names the registration files it read, so its blind spot is visible"
else
  bad "the doctor does not name the files it consulted"
fi

# ---------------------------------------------------------------------------
echo "4. A dist-info / __version__ disagreement is REPORTED, not treated as a fault"
# ---------------------------------------------------------------------------
# This is the other half of a design decision made in the wrapper: Phase B of the
# launch guard deliberately does NOT refuse when the two declarations disagree,
# because a `.postN` rebuild disagrees legitimately with both values in range. The
# justification for not refusing is that the doctor reports the disagreement
# instead — so the doctor must actually report it, and must not inflate it into a
# version divergence across sources or a non-zero outcome.

S4="$TMP_ROOT/s4"
S4_HOME="$S4/home"
S4_PATHDIR="$S4/bin"
S4_SITE="$S4/site"
S4_DIST="${PIN_MIN}.post1"
make_fakesite "$S4_SITE" "$S4_DIST" "$PIN_MIN"
S4_PY="$S4_HOME/.local/pipx/venvs/mempalace/bin/python"
make_interpreter "$S4_PY" "$S4_SITE"
make_checkout "$S4/checkout"
S4_WRAPPER="$S4/checkout/scripts/lib/mempalace-http-wrapper.py"
write_reg_bash   "$S4_HOME/.claude.json"                   "$S4_PY" "$S4_WRAPPER"
write_reg_direct "$S4_HOME/.gemini/settings.json"           "$S4_PY" "$S4_WRAPPER"
write_reg_direct "$S4_HOME/.copilot/mcp-config.json"        "$S4_PY" "$S4_WRAPPER"
write_reg_bash   "$S4_HOME/.gemini/config/mcp_config.json"  "$S4_PY" "$S4_WRAPPER"
make_console_script "$S4_PATHDIR/mempalace"     "$S4_PY"
make_console_script "$S4_PATHDIR/mempalace-mcp" "$S4_PY"

S4_OUT="$S4/report.txt"
run_doctor "$S4_HOME" "$S4_PATHDIR" "$S4_OUT"
s4_rc=$?

has "$S4_OUT" "DISAGREES with dist-info ${S4_DIST}" \
  "the hand-maintained literal disagreeing with dist-info is reported"
has "$S4_OUT" "a .postN rebuild disagrees legitimately" \
  "the report says why a disagreement is not by itself a fault"
lacks "$S4_OUT" "DIVERGE" \
  "two declarations disagreeing is NOT a version divergence across sources"
if [ "$s4_rc" -eq 0 ]; then
  ok "a legitimate disagreement is reported without a non-successful outcome"
else
  bad "disagreement machine: exit $s4_rc — a legitimate .postN rebuild was flagged as a fault ($(grep -A6 'NOT OK' "$S4_OUT" | head -8))"
fi

# ---------------------------------------------------------------------------
echo "5. R8 — out of range WITHOUT divergence is still a non-successful outcome"
# ---------------------------------------------------------------------------
# R8 has two independent triggers: versions that differ, and a version outside the
# pin. Scenario 1 fires both at once, so a regression that dropped the range check
# and kept only the divergence check would still pass it. Here every source agrees
# on the SAME out-of-range version, so only the range trigger can produce the
# non-zero exit.
#
# The same machine carries the `#!/usr/bin/env python3` shebang form on
# `mempalace-mcp`, whose interpreter is the SECOND token — a branch no other
# scenario reaches. PATH is REPLACED (not prepended) so that `python3` resolves to
# the fixture's own shim: a prepended PATH could not stop the real `python3` from
# answering, and the row would then report the authoring machine's version.

S5="$TMP_ROOT/s5"
S5_HOME="$S5/home"
S5_PATHDIR="$S5/bin"
S5_TOOLBIN="$S5/toolbin"
S5_SITE="$S5/site"
make_fakesite "$S5_SITE" "$OLD_VERSION"
S5_PY="$S5_HOME/.local/pipx/venvs/mempalace/bin/python"
make_interpreter "$S5_PY" "$S5_SITE"
# Pre-seeded so make_toolbin's `[ ! -e ]` guard leaves it alone: inside this
# fixture's PATH, `python3` IS the shim, which is what makes the env-form shebang
# resolvable to a known version.
mkdir -p "$S5_TOOLBIN"
make_interpreter "$S5_TOOLBIN/python3" "$S5_SITE"
make_toolbin "$S5_TOOLBIN"
make_console_script "$S5_PATHDIR/mempalace" "$S5_PY"
printf '#!/usr/bin/env python3\n# fake console script — never executed by the doctor\n' \
  > "$S5_PATHDIR/mempalace-mcp"
chmod +x "$S5_PATHDIR/mempalace-mcp"

S5_OUT="$S5/report.txt"
run_doctor_isolated "$S5_HOME" "$S5_PATHDIR" "$S5_TOOLBIN" "$S5_OUT"
s5_rc=$?

if [ "$s5_rc" -ne 0 ]; then
  ok "uniformly out-of-range machine: exits non-zero ($s5_rc)"
else
  bad "uniformly out-of-range machine: exited 0 — ${OLD_VERSION} is outside the pin everywhere"
fi
lacks "$S5_OUT" "DIVERGE" \
  "R8: the non-zero outcome came from the range trigger alone, with no divergence"
has "$S5_OUT" "PATH:mempalace: ${OLD_VERSION} lies outside" \
  "R8: names which path carries the out-of-range version"
if grep -qE '^ +shebang interpreter: +python3$' "$S5_OUT"; then
  ok "an \`#!/usr/bin/env python3\` shebang resolves to its second token, not to \`env\`"
else
  bad "the env-form shebang was not resolved ($(grep -E 'shebang interpreter:' "$S5_OUT" || true))"
fi
has "$S5_OUT" "PATH:mempalace-mcp: ${OLD_VERSION} lies outside" \
  "the env-form row was probed under the interpreter it named"

# ---------------------------------------------------------------------------
echo "6. R8 — version divergence ALONE is a non-successful outcome"
# ---------------------------------------------------------------------------
# The mirror image of scenario 5, and the spec's headline scenario: "Divergent
# installs are reported and flagged". R8 has three independent triggers — versions
# that differ, a version outside the pin, and pins that differ. Scenario 1 fires
# all three on one machine, so its `DIVERGE` grep was answered by the PIN
# divergence and its non-zero exit by the range failure: deleting the
# version-divergence detection entirely cost zero assertions there.
#
# Here only the version trigger can fire. Two sources report DIFFERENT versions,
# both INSIDE the pin, and every source reads the same pin from a checkout copied
# out of this repository — so no range failure and no pin divergence exist to
# stand in for the finding. `mempalace-mcp` resolves to an install one micro
# release above the floor while everything else resolves to the floor itself: the
# #623 shape, with the drift small enough to be invisible without this report.
#
# PATH is REPLACED, not prepended: on the authoring machine a real `mempalace`
# sits on PATH and a prepended fixture directory cannot un-find it, which would
# introduce a third version and make the assertion about the wrong thing.

# Guard the derivation before relying on it: the scenario is meaningless if the
# second version is not actually inside the pin.
if "$PYTHON_BIN" "$PIN_MODULE" --common-sh "$COMMON_SH" --check "$SECOND_GOOD_VERSION" >/dev/null 2>&1; then
  ok "the second in-range version ${SECOND_GOOD_VERSION} is inside the committed pin"
else
  bad "the second version ${SECOND_GOOD_VERSION} is OUTSIDE the pin >=${PIN_MIN},<${PIN_MAX} — scenario 6 would test the range trigger, not the divergence trigger"
fi

S6="$TMP_ROOT/s6"
S6_HOME="$S6/home"
S6_PATHDIR="$S6/bin"
S6_TOOLBIN="$S6/toolbin"
S6_SITE_A="$S6/site-a"
S6_SITE_B="$S6/site-b"
make_fakesite "$S6_SITE_A" "$GOOD_VERSION"
make_fakesite "$S6_SITE_B" "$SECOND_GOOD_VERSION"
# Candidate 1 of the detector's order, so section 3 selects a KNOWN interpreter
# and does not report the authoring machine's own install as a third version.
S6_PY_A="$S6_HOME/.local/pipx/venvs/mempalace/bin/python"
make_interpreter "$S6_PY_A" "$S6_SITE_A"
make_interpreter "$S6/other/python-b" "$S6_SITE_B"
make_toolbin "$S6_TOOLBIN"
make_checkout "$S6/checkout"
S6_WRAPPER="$S6/checkout/scripts/lib/mempalace-http-wrapper.py"

write_reg_bash   "$S6_HOME/.claude.json"                   "$S6_PY_A" "$S6_WRAPPER"
write_reg_direct "$S6_HOME/.gemini/settings.json"           "$S6_PY_A" "$S6_WRAPPER"
write_reg_direct "$S6_HOME/.copilot/mcp-config.json"        "$S6_PY_A" "$S6_WRAPPER"
write_reg_bash   "$S6_HOME/.gemini/config/mcp_config.json"  "$S6_PY_A" "$S6_WRAPPER"
make_console_script "$S6_PATHDIR/mempalace"     "$S6_PY_A"
make_console_script "$S6_PATHDIR/mempalace-mcp" "$S6/other/python-b"

S6_OUT="$S6/report.txt"
run_doctor_isolated "$S6_HOME" "$S6_PATHDIR" "$S6_TOOLBIN" "$S6_OUT"
s6_rc=$?

if [ "$s6_rc" -ne 0 ]; then
  ok "divergent-versions-only machine: exits non-zero ($s6_rc)"
else
  bad "divergent-versions-only machine: exited 0 — two sources report different MemPalace versions"
fi
has "$S6_OUT" "reported versions DIVERGE" \
  "R8: the version-divergence trigger fires on its own, with nothing else wrong"
has "$S6_OUT" "Versions reported, by source:" \
  "R8: tabulates every source with the version it reports"
# Which source carries which version, identifiable without further investigation.
if grep -A8 "Versions reported, by source:" "$S6_OUT" \
   | grep -E "^ +PATH:mempalace-mcp +${SECOND_GOOD_VERSION//./\\.}$" >/dev/null; then
  ok "R8: attributes ${SECOND_GOOD_VERSION} to PATH:mempalace-mcp in the divergence table"
else
  bad "R8: the divergence table does not attribute ${SECOND_GOOD_VERSION} to a named source ($(grep -A8 'Versions reported, by source:' "$S6_OUT" || true))"
fi
# The three triggers must be independent, so the two that are NOT under test here
# must be provably absent — otherwise this scenario is scenario 1 again.
lacks "$S6_OUT" "lies outside" \
  "R8: no range failure exists here, so the outcome came from divergence alone"
lacks "$S6_OUT" "declared pins DIVERGE" \
  "R8: every source reads one pin, so no pin divergence stands in for the finding"

# ---------------------------------------------------------------------------
echo "7. A registered wrapper that no longer exists is reported as missing"
# ---------------------------------------------------------------------------
# The verdict must come from the WRAPPER's own existence. Deriving it from whether
# `dirname <wrapper>/../..` can be entered makes a registration whose
# `scripts/lib/` survived — the shape a partial delete or a botched update leaves
# behind — report as present, and a session started from that argv cannot launch
# at all. PATH is replaced with an empty fixture directory so the only finding on
# this machine is the one under test.

S7="$TMP_ROOT/s7"
S7_HOME="$S7/home"
S7_PATHDIR="$S7/bin"
S7_TOOLBIN="$S7/toolbin"
mkdir -p "$S7_PATHDIR"
make_toolbin "$S7_TOOLBIN"
make_checkout "$S7/checkout"
S7_WRAPPER="$S7/checkout/scripts/lib/mempalace-http-wrapper.py"
S7_SITE="$S7/site"
make_fakesite "$S7_SITE" "$GOOD_VERSION"
S7_PY="$S7_HOME/.local/pipx/venvs/mempalace/bin/python"
make_interpreter "$S7_PY" "$S7_SITE"
write_reg_bash "$S7_HOME/.claude.json" "$S7_PY" "$S7_WRAPPER"
# The wrapper alone is deleted; its directory, its sibling common.sh and its
# sibling pin module all survive, so `cd <wrapper>/../..` still succeeds.
rm -f "$S7_WRAPPER"
if [ -d "$S7/checkout/scripts/lib" ] && [ ! -f "$S7_WRAPPER" ]; then
  ok "fixture: the wrapper is gone while its scripts/lib/ directory survives"
else
  bad "fixture: could not construct the surviving-directory shape"
fi

S7_OUT="$S7/report.txt"
run_doctor_isolated "$S7_HOME" "$S7_PATHDIR" "$S7_TOOLBIN" "$S7_OUT"
s7_rc=$?

has "$S7_OUT" "WRAPPER MISSING — ${S7_WRAPPER}" \
  "a deleted wrapper is reported as WRAPPER MISSING, naming the path"
lacks "$S7_OUT" "guard status:" \
  "a registration whose wrapper is gone is not evaluated as if it could launch"
if [ "$s7_rc" -ne 0 ]; then
  ok "missing-wrapper machine: exits non-zero ($s7_rc)"
else
  bad "missing-wrapper machine: exited 0 — a registration that cannot launch was reported as healthy"
fi

# ---------------------------------------------------------------------------
echo "8. A registration whose interpreter resolves no MemPalace at all"
# ---------------------------------------------------------------------------
# `evaluate`'s third outcome, alongside in-range and out-of-range: a source that
# serves NOTHING. It is the doctor's only path to reporting "this interpreter
# answers with no MemPalace version", and it owns the `note_failure` that makes
# such a machine exit non-zero — the #623 shape one dimension over, where a
# registration's interpreter lost its install rather than drifting off the pin.
#
# The negative assertions are the point of the scenario, not decoration. A source
# with no version contributes none to compare and none to range-check, so neither
# divergence trigger nor the range trigger can produce this outcome — and the
# report must not claim they did. The machine is built so exactly ONE finding
# exists, which is asserted: it is what makes deleting the `note_failure` show up
# as an exit-0 failure rather than being absorbed by some other row's finding.
#
# Section 3 is pinned to a KNOWN in-range interpreter (candidate 1 under the fake
# HOME) rather than left to the authoring machine's own install, which would
# otherwise contribute a second, machine-dependent version and could make
# `lacks "lies outside"` a property of the machine instead of the branch.

S8="$TMP_ROOT/s8"
S8_HOME="$S8/home"
S8_PATHDIR="$S8/bin"
S8_TOOLBIN="$S8/toolbin"
S8_SITE="$S8/site"
mkdir -p "$S8_PATHDIR"
make_toolbin "$S8_TOOLBIN"
make_fakesite "$S8_SITE" "$GOOD_VERSION"
S8_PY_GOOD="$S8_HOME/.local/pipx/venvs/mempalace/bin/python"
make_interpreter "$S8_PY_GOOD" "$S8_SITE"
S8_PY_ABSENT="$S8/no-mempalace-here/python-absent"
make_absent_interpreter "$S8_PY_ABSENT"
make_checkout "$S8/checkout"
S8_WRAPPER="$S8/checkout/scripts/lib/mempalace-http-wrapper.py"
# Exactly one registration, so exactly one row can reach the branch. The other
# three CLIs have no config file at all and report NOT PRESENT.
write_reg_bash "$S8_HOME/.claude.json" "$S8_PY_ABSENT" "$S8_WRAPPER"

# Guard the fixture before relying on it: absence is the one fact this suite's
# usual shadowing device cannot fabricate, so it is proved rather than assumed.
s8_probe_dist="$("$S8_PY_ABSENT" "$PIN_MODULE" --probe 2>/dev/null \
  | grep '^dist=' | cut -d= -f2-)"
if [ "$s8_probe_dist" = "absent" ]; then
  ok "fixture: the registered interpreter resolves no mempalace distribution (dist=absent)"
else
  bad "fixture: the registered interpreter reports dist='${s8_probe_dist:-<no probe output>}' — absence was not established, so this scenario would never reach the no-version branch"
fi

S8_OUT="$S8/report.txt"
run_doctor_isolated "$S8_HOME" "$S8_PATHDIR" "$S8_TOOLBIN" "$S8_OUT"
s8_rc=$?

if [ "$s8_rc" -ne 0 ]; then
  ok "no-version machine: exits non-zero ($s8_rc)"
else
  bad "no-version machine: exited 0 — a registration that serves no MemPalace version was reported as healthy"
fi
has_exact "$S8_OUT" \
  "$(doctor_field_line "version served:" "absent  (dist-info, resolved in-process)")" \
  "the doctor itself reports the absence, sourced to dist-info"
has_exact "$S8_OUT" \
  "$(doctor_field_line "verdict:" "NO VERSION — this interpreter resolves no mempalace distribution")" \
  "the verdict for a source that serves nothing is NO VERSION"
has_exact "$S8_OUT" \
  "  - Claude Code: no mempalace version is resolvable from ${S8_PY_ABSENT}" \
  "the finding names both the source and the interpreter that answered with nothing"
# The report must claim what happened and nothing else. A source with no version
# cannot be out of range and cannot diverge from anything, so any such claim here
# would be the doctor describing a machine other than this one.
lacks "$S8_OUT" "lies outside" \
  "no range failure is claimed — there is no version to lie outside the pin"
lacks "$S8_OUT" "OUT_OF_RANGE" \
  "no range verdict is reported for a row that never reached the comparator"
lacks "$S8_OUT" "DIVERGE" \
  "no divergence is claimed — a source serving nothing contributes no version to compare"
has_exact "$S8_OUT" "  NOT OK — 1 finding(s):" \
  "the absent version is the ONLY finding, so it alone carries the non-zero exit"

# ---------------------------------------------------------------------------
echo "9. R11 — every CLI's launch path names the wrapper"
# ---------------------------------------------------------------------------
# Asserted against the surface that actually carries the path per CLI. Two setups
# name the wrapper in the script; the other two never do — their path lives in the
# committed MCP template the script patches. An assertion against the four setup
# scripts alone would fail on a correct tree.

wrapper_ref="scripts/lib/mempalace-http-wrapper.py"

check_names_wrapper() {
  local label="$1"
  local file="$2"
  local want="$3"
  local got
  got="$(grep -cF "$wrapper_ref" "$file" 2>/dev/null || true)"
  if [ "$got" = "$want" ]; then
    ok "$label names the wrapper $want time(s)"
  else
    bad "$label names the wrapper $got time(s), expected $want ($file)"
  fi
}

check_names_wrapper "setup-claude-interactive.sh" \
  "$REPO_DIR/scripts/setup-claude-interactive.sh" 1
check_names_wrapper "setup-antigravity-interactive.sh" \
  "$REPO_DIR/scripts/setup-antigravity-interactive.sh" 1
check_names_wrapper "setup-gemini-interactive.sh (path lives in its template)" \
  "$REPO_DIR/scripts/setup-gemini-interactive.sh" 0
check_names_wrapper "config/gemini/settings.json (Gemini's carrier)" \
  "$REPO_DIR/config/gemini/settings.json" 1
check_names_wrapper "setup-copilot-interactive.sh (path lives in its template)" \
  "$REPO_DIR/scripts/setup-copilot-interactive.sh" 0
check_names_wrapper "config/copilot/mcp-config.json.template (Copilot's carrier)" \
  "$REPO_DIR/config/copilot/mcp-config.json.template" 1

# The guard lands in the wrapper, which all four CLIs share — that shared file is
# what makes R11's uniformity structural rather than four parallel implementations.
if [ "$(grep -cF "mempalace_pin" "$WRAPPER")" -ge 1 ]; then
  ok "the shared wrapper is where the guard lives, so all four CLIs inherit it (R11)"
else
  bad "the shared wrapper does not reference the guard module"
fi

# The doctor evaluates FOREIGN checkouts against THEIR OWN declared pin, and its
# pin-divergence verdict is only meaningful if it holds no bound of its own.
# Searched as a bare substring: a bound baked into a message would never appear in
# quoted form. Matching lines are echoed so a false positive is legible.
#
# `grep`'s status is discriminated three ways rather than tested for truthiness:
# exit 2 means the scan never happened, and `if grep …; then bad; else ok; fi`
# would score that non-event as a clean pass.
doctor_literal_hits=0
doctor_literal_scan_failed=0
for bound in "$PIN_MIN" "$PIN_MAX"; do
  grep -nF "$bound" "$DOCTOR" >&2
  grep_rc=$?
  case "$grep_rc" in
    0)
      echo "    ^ bound literal '$bound' present in $DOCTOR" >&2
      doctor_literal_hits=$((doctor_literal_hits + 1))
      ;;
    1) ;;
    *)
      bad "the pin-literal scan for '$bound' could not run against $DOCTOR (grep exit $grep_rc)"
      doctor_literal_scan_failed=1
      ;;
  esac
done
if [ "$doctor_literal_scan_failed" -eq 1 ]; then
  : # already reported; do not also claim the bound is absent
elif [ "$doctor_literal_hits" -eq 0 ]; then
  ok "the doctor carries neither pin bound as a literal"
else
  bad "the doctor carries $doctor_literal_hits pin-bound literal(s)"
fi

# ---------------------------------------------------------------------------
echo "10. The doctor mutates nothing"
# ---------------------------------------------------------------------------
# Re-run scenario 2 and compare a manifest of the fake HOME before and after: the
# spec puts remediation and repair explicitly out of scope.

before="$S2/manifest.before"
after="$S2/manifest.after"
find "$S2_HOME" -type f -exec cksum {} \; | sort > "$before"
run_doctor "$S2_HOME" "$S2_PATHDIR" "$S2/report.2.txt"
find "$S2_HOME" -type f -exec cksum {} \; | sort > "$after"
if diff -q "$before" "$after" >/dev/null 2>&1; then
  ok "a doctor run leaves every file under HOME byte-identical"
else
  bad "the doctor modified something under HOME:"
  diff "$before" "$after" >&2 || true
fi

# ---------------------------------------------------------------------------
echo ""
echo "Summary: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
