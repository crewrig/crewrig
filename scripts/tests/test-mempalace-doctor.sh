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
#   (i) R11 (structural): every CLI's launch path names the wrapper — for two
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

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

# --- Fixture builders --------------------------------------------------------

# make_fakesite <dir> <version>
make_fakesite() {
  local dir="$1"
  local version="$2"
  mkdir -p "$dir/mempalace" "$dir/mempalace-${version}.dist-info"
  printf '__version__ = "%s"\n' "$version" > "$dir/mempalace/__init__.py"
  printf 'def main():\n    return None\n' > "$dir/mempalace/mcp_server.py"
  printf 'Metadata-Version: 2.1\nName: mempalace\nVersion: %s\n' "$version" \
    > "$dir/mempalace-${version}.dist-info/METADATA"
}

# make_interpreter <path> <fakesite-dir>
# A shim that IS an interpreter as far as the doctor is concerned.
make_interpreter() {
  local path="$1"
  local site="$2"
  mkdir -p "$(dirname "$path")"
  cat > "$path" <<EOF
#!/bin/sh
exec env PYTHONPATH="${site}" PYTHONDONTWRITEBYTECODE=1 "${PYTHON_BIN}" "\$@"
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
has "$S1_OUT" "DIVERGE" "R8: reports the divergence explicitly"
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
lacks "$S2_OUT" "GUARD ABSENT" "no GUARD ABSENT label when every checkout carries the guard"
lacks "$S2_OUT" "DIVERGE" "no divergence reported on a consistent machine"
has   "$S2_OUT" "must be restarted" "R4: the restart sentence prints on a clean run too"
has   "$S2_OUT" "OK — every source reports the same MemPalace version" \
  "clean machine states the successful outcome"

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
echo "4. R11 — every CLI's launch path names the wrapper"
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

# ---------------------------------------------------------------------------
echo "5. The doctor mutates nothing"
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
