#!/bin/bash
# test-check-core-paths.sh — Regression tests for check-core-paths.sh (spec 0031).
#
# check-core-paths.sh is the CI guard that rejects "phantom" manifest entries —
# a .crewrig/core-paths.txt line naming a strict/adopt-on-edit path that does
# not resolve to tracked content at HEAD. This is the parity sibling mandated by
# the repo convention "every check-*.sh has a test-*.sh".
#
# Since spec 0121 the same script also guards the reverse direction — every
# directory the component build writes component outputs into must carry an
# upstream-sync guarantee — so cases e-i exercise that half.
#
# Cases:
#   Forward direction (manifest → tree, spec 0031 R5)
#   a. Phantom strict entry → exit 1, stderr names the failing entry.
#   b. Phantom adopt-on-edit entry → exit 1, stderr names the failing entry.
#   c. Fully resolvable manifest → exit 0 with the OK line on stdout.
#   d. Phantom excluded entry → exit 0 (excluded is org-owned, NOT checked).
#
#   Reverse direction (tree → manifest, spec 0121 R5)
#   e. Built output absent from the manifest → exit 1, stderr names it.
#   f. Same tree, manifest lists it → exit 0. The control that makes e
#      informative: it isolates the manifest omission as e's cause.
#   g. Write-helper call site with no $out_root/ target → non-zero, names the
#      line (fail-closed: unclassifiable is not the same as nothing to report).
#   h. Built output covered only by an `excluded` entry → exit 1. `excluded` is
#      the absence of a guarantee, and R2 admits no directory without one.
#   i. The repository's REAL build script + a manifest naming no built output →
#      exit 1 naming `.agents/skills` and `.agents/agents`, 9 derived. The only
#      case run against the real script's real shape, so the only one a
#      matcher-blinding change cannot pass.
#   j. A call site that is not the first token of its line → exit 1, named.
#      Case i cannot cover this: all sixteen real call sites are bare.
#   k. An `excluded` ANCESTOR over a governed child → exit 0. Pins the half of
#      dir_is_governed() that keeps it from being stricter than the sync.
#   l. An indented comment naming a helper → still a comment. Pins the trim,
#      which no other case constrains now that the matcher accepts non-leading
#      calls and is therefore indentation-insensitive.
#
# Cases a-d commit a stub `scripts/build-components.sh` with no call sites, so
# the derived set is empty in half the suite — the accumulator-empty path the
# array guards in check-core-paths.sh must survive under bash 3.2 `set -u`. The
# stub is committed, not merely written, so the fixtures hold up if the guard
# ever reads the build script from HEAD instead of from disk.
#
# Case i reads `scripts/build-components.sh`. That coupling is deliberate: a
# legitimate tenth output directory turns case i red on its count until the
# literal is updated. That is the forcing function working, not flakiness.
#
# Usage:
#   bash scripts/tests/test-check-core-paths.sh
#   /bin/bash scripts/tests/test-check-core-paths.sh   # the bash 3.2 gate;
#       real only because run_check spawns via "${BASH:-bash}". No CI job runs
#       a 3.2 interpreter, so this local run is the only place the empty-array
#       trap is caught.

# -e intentionally omitted: pass/fail counters control the harness; adding -e
# would abort on expected non-zero exits from the script under test.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/check-core-paths.sh"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# init_git_repo <dir>
init_git_repo() {
  local dir="$1"
  git -C "$dir" init -q
  git -C "$dir" config user.email "test@example.com"
  git -C "$dir" config user.name "Test"
  git -C "$dir" config commit.gpgsign false
}

# make_initial_commit <repo> [<file> <content>]...
make_initial_commit() {
  local repo="$1"; shift
  while [ "$#" -ge 2 ]; do
    local file="$1" content="$2"; shift 2
    mkdir -p "$repo/$(dirname "$file")"
    printf '%s' "$content" > "$repo/$file"
    git -C "$repo" add "$file"
  done
  git -C "$repo" commit -q -m "initial"
}

# write_manifest <repo> <content>
# Write .crewrig/core-paths.txt (read from disk by the script — not committed).
write_manifest() {
  local repo="$1" content="$2"
  mkdir -p "$repo/.crewrig"
  printf '%s' "$content" > "$repo/.crewrig/core-paths.txt"
}

# run_check <repo>
# Run the script under test with CREWRIG_REPO_DIR set, capturing stdout, stderr,
# and exit code into the globals CHECK_EXIT / CHECK_STDOUT / CHECK_STDERR.
run_check() {
  local repo="$1" out_file err_file
  out_file="$(mktemp "$TMP_ROOT/out.XXXXXX")"
  err_file="$(mktemp "$TMP_ROOT/err.XXXXXX")"
  CHECK_EXIT=0
  # `${BASH:-bash}`, not bare `bash`: bare `bash` resolves from $PATH, so
  # launching this harness as `/bin/bash test-check-core-paths.sh` would run the
  # harness on 3.2.57 and the script under test on whatever modern bash $PATH
  # supplies — making the 3.2 gate below inert. The `:-` default keeps it safe
  # under `set -u`. (Repo-wide, 19 of 68 suites still carry the bare form; #798.)
  ( CREWRIG_REPO_DIR="$repo" "${BASH:-bash}" "$SCRIPT_UNDER_TEST" >"$out_file" 2>"$err_file" ) || CHECK_EXIT=$?
  CHECK_STDOUT="$(cat "$out_file")"
  CHECK_STDERR="$(cat "$err_file")"
  rm -f "$out_file" "$err_file"
}

# ---------------------------------------------------------------------------
# Stub build scripts. Single-quoted so `$out_root` stays literal.
#
# Deliberately written at column 0, unlike the real script's six-space-indented
# call sites: a matcher that tested the raw line instead of the trimmed one
# would still match these stubs and only case i would catch it.
# ---------------------------------------------------------------------------

# No write-helper call site → the derived set is empty.
BUILD_STUB_NONE='#!/bin/bash
# Stub build script: no write-helper call sites.
echo "stub"
'

# One call site writing into .newcli/skills.
BUILD_STUB_NEWCLI='#!/bin/bash
check_or_write "$out_root/.newcli/skills/$name/SKILL.md" "$content" "$source"
'

# One call site whose target this guard cannot classify (line 2).
BUILD_STUB_UNCLASSIFIABLE='#!/bin/bash
check_or_write "$some_other_root/x.md" "$content"
'

# A call site that is NOT the first token of its line. All sixteen real call
# sites are bare, so case i cannot exercise this shape — and a prefix-anchored
# matcher discarded it silently, the fail-closed rule never seeing a line that
# failed to match in the first place.
BUILD_STUB_NESTED_CALL='#!/bin/bash
for name in demo; do
  if ! check_or_write "$out_root/.newcli/skills/$name/SKILL.md" "$content" "$source"; then
    exit 1
  fi
done
'

# An INDENTED comment naming a helper, above a real call site. The comment skip
# runs on the trimmed line; on the raw line an indented comment is not seen as a
# comment, matches the helper pattern instead, yields no directory, and trips
# the fail-closed rule. build-components.sh carries such a comment today (:625),
# but it ends at the helper name with no trailing space, so it happens not to
# match — which would leave the trim pinned by nothing.
BUILD_STUB_INDENTED_COMMENT='#!/bin/bash
for name in demo; do
    # check_or_write is how the compiled skill gets written
  check_or_write "$out_root/.newcli/skills/$name/SKILL.md" "$content" "$source"
done
'

# ---------------------------------------------------------------------------
# Case a — Phantom strict entry → exit 1, stderr names the failing entry.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" \
    "real.txt" "tracked content" \
    "scripts/build-components.sh" "$BUILD_STUB_NONE"
  write_manifest "$repo" $'real.txt\tstrict\nphantom.txt\tstrict\n'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-a: phantom strict entry fails the check (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-a: expected exit 1, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF "FAIL phantom.txt (strict)"; then
    echo "PASS  case-a: stderr names the failing strict entry"
    pass=$((pass + 1))
  else
    echo "FAIL  case-a: stderr did not name phantom.txt (strict)"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case b — Phantom adopt-on-edit entry → exit 1, stderr names the failing entry.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" \
    "real.txt" "tracked content" \
    "scripts/build-components.sh" "$BUILD_STUB_NONE"
  write_manifest "$repo" $'real.txt\tstrict\nphantom.txt\tadopt-on-edit\n'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-b: phantom adopt-on-edit entry fails the check (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-b: expected exit 1, got $CHECK_EXIT"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF "FAIL phantom.txt (adopt-on-edit)"; then
    echo "PASS  case-b: stderr names the failing adopt-on-edit entry"
    pass=$((pass + 1))
  else
    echo "FAIL  case-b: stderr did not name phantom.txt (adopt-on-edit)"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case c — Fully resolvable manifest → exit 0 with the OK line on stdout.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" \
    "real.txt"  "tracked content" \
    "other.txt" "other tracked content" \
    "scripts/build-components.sh" "$BUILD_STUB_NONE"
  write_manifest "$repo" $'real.txt\tstrict\nother.txt\tadopt-on-edit\n'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-c: fully resolvable manifest passes the check (exit 0)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-c: expected exit 0, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDOUT" | grep -qF "OK: all 2 strict/adopt-on-edit core-paths entries resolve at HEAD."; then
    echo "PASS  case-c: OK line emitted on stdout with the checked count"
    pass=$((pass + 1))
  else
    echo "FAIL  case-c: missing/incorrect OK line"
    echo "      actual stdout: $CHECK_STDOUT"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case d — Phantom excluded entry → exit 0 (excluded is org-owned, skipped, NOT
#          failed). Confirms the policy carve-out matches sync-from-upstream.sh.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" \
    "real.txt" "tracked content" \
    "scripts/build-components.sh" "$BUILD_STUB_NONE"
  # phantom-excluded.txt resolves nowhere at HEAD, but `excluded` is skipped.
  write_manifest "$repo" $'real.txt\tstrict\nphantom-excluded.txt\texcluded\n'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-d: phantom excluded entry is skipped, not failed (exit 0)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-d: expected exit 0, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  # Only the strict entry should be counted (the excluded one is not checked).
  if echo "$CHECK_STDOUT" | grep -qF "OK: all 1 strict/adopt-on-edit core-paths entries resolve at HEAD."; then
    echo "PASS  case-d: excluded entry omitted from the checked count"
    pass=$((pass + 1))
  else
    echo "FAIL  case-d: excluded entry was counted or OK line malformed"
    echo "      actual stdout: $CHECK_STDOUT"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case e — A built-output directory absent from the manifest → exit 1, and
#          stderr names it. The reverse direction (spec 0121 R5); this is the
#          shape of the bug in issue #755.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" \
    "real.txt" "tracked content" \
    ".newcli/skills/demo/SKILL.md" "built output" \
    "scripts/build-components.sh" "$BUILD_STUB_NEWCLI"
  # The manifest never mentions .newcli/skills — the whole point of the case.
  write_manifest "$repo" $'real.txt\tstrict\n'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-e: ungoverned built-output directory fails the check (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-e: expected exit 1, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF -- "- .newcli/skills"; then
    echo "PASS  case-e: stderr names the ungoverned directory"
    pass=$((pass + 1))
  else
    echo "FAIL  case-e: stderr did not name .newcli/skills"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case f — The control for case e. Byte-identical tree; the manifest lists the
#          directory → exit 0. Without this, case e's exit 1 could as easily be
#          caused by the fixture existing at all as by the manifest omission.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" \
    "real.txt" "tracked content" \
    ".newcli/skills/demo/SKILL.md" "built output" \
    "scripts/build-components.sh" "$BUILD_STUB_NEWCLI"
  write_manifest "$repo" $'real.txt\tstrict\n.newcli/skills\tstrict\n'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-f: the same tree passes once the manifest lists it (exit 0)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-f: expected exit 0, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  # Exit status only, deliberately. Case f's job is to be the green control
  # that isolates case e's cause; asserting the reverse direction's success
  # line here would make the control sensitive to the reverse block existing,
  # which is precisely what case e is for.
}

# ---------------------------------------------------------------------------
# Case g — A write-helper call site with no $out_root/ target → non-zero,
#          naming the line. Fail-closed: a target the guard cannot classify is
#          an output it cannot check, which must not read as nothing to report.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" \
    "real.txt" "tracked content" \
    "scripts/build-components.sh" "$BUILD_STUB_UNCLASSIFIABLE"
  write_manifest "$repo" $'real.txt\tstrict\n'

  run_check "$repo"

  if [ "$CHECK_EXIT" -ne 0 ]; then
    echo "PASS  case-g: unclassifiable call site fails the check (exit $CHECK_EXIT)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-g: expected non-zero exit, got 0"
    echo "      actual stdout: $CHECK_STDOUT"
    fail=$((fail + 1))
  fi

  # Naming the line is what distinguishes a fail-closed refusal from an
  # unrelated crash that happens to exit non-zero.
  if echo "$CHECK_STDERR" | grep -qF "build-components.sh:2"; then
    echo "PASS  case-g: stderr names the offending build-script line"
    pass=$((pass + 1))
  else
    echo "FAIL  case-g: stderr did not name build-components.sh:2"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case h — A built output covered only by an `excluded` entry nested under a
#          governed parent → exit 1. `excluded` is the absence of a guarantee
#          (the sync never restores it), and R2 leaves no built-output
#          directory without one. Also exercises the nested-carve-out rule
#          this guard shares with sync-from-upstream.sh.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" \
    "real.txt" "tracked content" \
    ".newcli/skills/demo/SKILL.md" "built output" \
    "scripts/build-components.sh" "$BUILD_STUB_NEWCLI"
  # .newcli is strict, but the excluded child carves the built output back out.
  write_manifest "$repo" $'real.txt\tstrict\n.newcli\tstrict\n.newcli/skills\texcluded\n'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-h: an excluded built-output directory fails the check (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-h: expected exit 1, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF -- "- .newcli/skills"; then
    echo "PASS  case-h: stderr names the excluded built-output directory"
    pass=$((pass + 1))
  else
    echo "FAIL  case-h: stderr did not name .newcli/skills"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case i — The repository's REAL build script against a manifest naming no
#          built-output directory (spec 0121 R6).
#
# Every case above runs the guard against a stub whose shape this file chose.
# This one runs it against the real script's real shape — six-space-indented
# call sites, real quoting, all sixteen of them — so it is the only case a
# matcher-blinding change cannot pass: the derived set goes empty, the reverse
# direction turns vacuous, exit becomes 0, and case i alone turns red.
#
# Driven down the FAILURE path on purpose: the success path prints a count and
# no identities, so a mutation deriving nine wrong directories would pass an
# `OK: all 9 …` assertion. The failure path names each one, pinning the
# identities as well as the count. The expected names are literals here, never
# re-derived by re-running the guard's own extraction — a test that re-derives
# agrees with the parser instead of checking it.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" "real.txt" "tracked content"
  mkdir -p "$repo/scripts"
  cp "$SCRIPT_DIR/build-components.sh" "$repo/scripts/build-components.sh"
  # One trivially-resolvable entry, so the forward direction passes and the
  # non-zero exit is unambiguously the reverse direction's.
  write_manifest "$repo" $'real.txt\tstrict\n'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-i: the real build script against a bare manifest fails (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-i: expected exit 1, got $CHECK_EXIT"
    echo "      actual stdout: $CHECK_STDOUT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF -- "- .agents/skills"; then
    echo "PASS  case-i: stderr names .agents/skills"
    pass=$((pass + 1))
  else
    echo "FAIL  case-i: stderr did not name .agents/skills"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF -- "- .agents/agents"; then
    echo "PASS  case-i: stderr names .agents/agents"
    pass=$((pass + 1))
  else
    echo "FAIL  case-i: stderr did not name .agents/agents"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  # 9 derived directories today. A legitimate tenth output turns this red until
  # the literal is updated — the forcing function, not flakiness.
  if echo "$CHECK_STDERR" | grep -qF "9 of 9 built-output"; then
    echo "PASS  case-i: reverse-direction summary reports 9 derived directories"
    pass=$((pass + 1))
  else
    echo "FAIL  case-i: expected '9 of 9 built-output' in the failure summary"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case j — A call site that is not the first token of its line → exit 1,
#          stderr names the directory.
#
# The matcher was prefix-anchored and discarded such lines at the `case`, so
# they never reached the fail-closed rule: three real shapes (`if ! …`,
# `for … do …`, `[ … ] && …`) wrote into an ungoverned directory while the
# guard printed `OK: all 9 … are governed`. No other case catches this — case i
# runs the real build script, where all sixteen call sites happen to be bare,
# which is exactly why measuring the matcher against that script could not
# surface the gap.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" \
    "real.txt" "tracked content" \
    ".newcli/skills/demo/SKILL.md" "built output" \
    "scripts/build-components.sh" "$BUILD_STUB_NESTED_CALL"
  write_manifest "$repo" $'real.txt\tstrict\n'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-j: a non-leading call site is still extracted (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-j: expected exit 1, got $CHECK_EXIT"
    echo "      actual stdout: $CHECK_STDOUT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF -- "- .newcli/skills"; then
    echo "PASS  case-j: stderr names the directory written from a nested call"
    pass=$((pass + 1))
  else
    echo "FAIL  case-j: stderr did not name .newcli/skills"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case k — An `excluded` ANCESTOR must not disqualify a governed child →
#          exit 0.
#
# dir_is_governed() consults only `excluded` entries nested under the matched
# governing entry, because that is what sync-from-upstream.sh does
# (excluded_children_of). Consulting excluded ancestors instead would be
# stricter than the sync — and reachable, which is the point: on
# `.newcli excluded` + `.newcli/skills strict` the sync governs
# `.newcli/skills`, so this guard must too, or it fails a build the sync would
# have synchronised happily.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" \
    "real.txt" "tracked content" \
    ".newcli/skills/demo/SKILL.md" "built output" \
    "scripts/build-components.sh" "$BUILD_STUB_NEWCLI"
  write_manifest "$repo" $'real.txt\tstrict\n.newcli\texcluded\n.newcli/skills\tstrict\n'

  run_check "$repo"

  if [ "$CHECK_EXIT" -eq 0 ]; then
    echo "PASS  case-k: an excluded ancestor does not disqualify a governed child"
    pass=$((pass + 1))
  else
    echo "FAIL  case-k: expected exit 0, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case l — An indented comment naming a helper is still a comment → exit 1 for
#          the real call site below it, not exit 2 for the comment.
#
# Pins the trim. Before the matcher was widened to accept non-leading calls,
# the trim was what made the matcher see indented call sites, and mutating it
# to the raw line turned case i red. Widening the matcher made it
# indentation-insensitive, so that mutation stopped discriminating and the trim
# was left pinned by nothing — the comment skip being the one place it still
# matters. This case restores that.
# ---------------------------------------------------------------------------
{
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  make_initial_commit "$repo" \
    "real.txt" "tracked content" \
    ".newcli/skills/demo/SKILL.md" "built output" \
    "scripts/build-components.sh" "$BUILD_STUB_INDENTED_COMMENT"
  write_manifest "$repo" $'real.txt\tstrict\n'

  run_check "$repo"

  # Exit 1 (ungoverned), NOT exit 2 (unclassifiable): reaching exit 2 means the
  # comment was parsed as a call site.
  if [ "$CHECK_EXIT" -eq 1 ]; then
    echo "PASS  case-l: an indented comment naming a helper is skipped (exit 1)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-l: expected exit 1, got $CHECK_EXIT"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi

  if echo "$CHECK_STDERR" | grep -qF -- "- .newcli/skills"; then
    echo "PASS  case-l: the real call site below the comment is still extracted"
    pass=$((pass + 1))
  else
    echo "FAIL  case-l: stderr did not name .newcli/skills"
    echo "      actual stderr: $CHECK_STDERR"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total=$((pass + fail))
echo ""
echo "Results: $pass/$total passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
