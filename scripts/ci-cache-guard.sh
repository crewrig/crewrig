#!/usr/bin/env bash
# ci-cache-guard.sh — Portable script-level cache guard (spec 0147 R6/R7).
#
# Wraps a single hermetic CI command so that a cache hit skips re-execution
# (R6) and a changed input re-executes (R7). The cache key is content-addressed
# from the DECLARED impacted files (their sha256) plus the values of the
# declared env vars, so any change to an input yields a different key and the
# command runs again.
#
# The guard is engine-agnostic: it is invoked identically from the GitLab
# pipeline (emitted by scripts/build-ci.sh) and the GitHub Actions workflow
# (hand-authored in .github/workflows/build.yml). It is the real correctness
# gate — even if the engine's own cache restores a stale .ci-cache/ directory,
# the guard recomputes the key, finds no marker, and re-executes.
#
# The script has two mutually exclusive modes.
#
# 1. Cache mode (default, spec 0147):
#
#   bash scripts/ci-cache-guard.sh \
#     --cache-dir <dir> \
#     --key-files <f1,f2,...> \
#     --key-env <V1,V2,...> \
#     -- <command...>
#
#   On a cache hit the guard exits 0 WITHOUT running <command>. On a miss it
#   runs <command> and, only if it succeeds, writes the marker so a later run
#   hits.
#
# 2. Stray-scan mode (spec 0170 delta-01, R10-R14):
#
#   bash scripts/ci-cache-guard.sh --stray-scan -- <command...>
#
#   Runs <command> exactly once and passes its stdout and stderr through on
#   their own streams, byte for byte, while also capturing both in a scratch
#   directory (mktemp, removed on exit; nothing is written in the working
#   directory, stdin is inherited). After the command ends, both captures are
#   searched for the shell's not-found phrase ('command not found'). A hit is a
#   "stray": a command line of the suite that does not exist and whose failure
#   nothing consumed. The verdict window is exactly this one command, so a stray
#   raised by any other command of the job never fails it.
#
#   Exit status:
#     0 or the command's own status   no stray, status preserved (R12)
#     <non-zero command status>       stray AND the command already failed:
#                                     the report is printed, the status is kept
#     70                              stray and the command exited 0
#     71                              detector inactive: the shell on PATH does
#                                     not print 'command not found' (for
#                                     instance a translated locale). The probe
#                                     runs first and the command is NOT run.
#                                     Retry with LC_ALL=C.
#     2                               usage error, including any combination
#                                     of --stray-scan with --cache-dir,
#                                     --key-files or --key-env
#
#   The probe runs only when the guard reaches the command, so a skipped job
#   pays nothing for it (R13). No marker is read or written in this mode; when
#   nested INSIDE cache mode, a stray exits non-zero so the outer guard writes
#   no marker (R11).
#
#   On a stray the report goes to stderr:
#     ci-cache-guard: stray-scan: STRAY in: <command>
#   followed by up to 20 matched lines. The shell already prints
#   '<file>: line <N>: <cmd>: command not found', so file and line are reported.
#
#   Known limits (R14, each pinned by scripts/tests/ci-cache-guard-scan.test.ts):
#     - Accepted false positive: a suite that prints the phrase on purpose
#       (echoes it, asserts it) fails with 70. Remedy: REWORD the suite so the
#       output no longer contains the phrase; there is no exemption switch.
#     - Accepted limit: stdout and stderr are teed by two independent
#       processes, so the relative order of stdout and stderr lines in a merged
#       job log may differ from the order the command wrote them (each stream
#       stays ordered on its own). Keeping the streams separate is what
#       preserves R12.
#     - Undetected (output never reaches the scanned streams): a stray whose
#       stderr is discarded (`bogus 2>/dev/null || true`); a stray captured by
#       `x=$(bogus 2>&1)` and never re-emitted; a stray in a child shell that
#       words it differently (`sh -c bogus` where /bin/sh is dash prints
#       'not found'); a missing command run through `env` or a path-qualified
#       missing command (`./nope`), which print 'No such file or directory'.
#
# Prerequisites: cache mode needs sha256sum (Linux) or shasum -a 256 (macOS).
# Stray-scan mode needs bash, mktemp, tee, grep, head, sed and rm.

set -euo pipefail

CACHE_DIR=".ci-cache"
KEY_FILES=""
KEY_ENV=""
STRAY_SCAN=0
CACHE_OPT_GIVEN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cache-dir) CACHE_DIR="$2"; CACHE_OPT_GIVEN=1; shift 2 ;;
    --key-files) KEY_FILES="$2"; CACHE_OPT_GIVEN=1; shift 2 ;;
    --key-env)   KEY_ENV="$2";   CACHE_OPT_GIVEN=1; shift 2 ;;
    --stray-scan) STRAY_SCAN=1; shift ;;
    --) shift; break ;;
    *) echo "Error: unknown option '$1'" >&2; exit 2 ;;
  esac
done

if [ $# -eq 0 ]; then
  echo "Error: no command given after '--'" >&2
  exit 2
fi

if [ "$STRAY_SCAN" -eq 1 ] && [ "$CACHE_OPT_GIVEN" -eq 1 ]; then
  echo "Error: --stray-scan cannot be combined with --cache-dir, --key-files or --key-env" >&2
  exit 2
fi

# --- Stray-scan mode (spec 0170 delta-01) -----------------------------------
# Self-contained: it never reaches the cache code below.

if [ "$STRAY_SCAN" -eq 1 ]; then
  phrase='command not found'

  # Probe first: prove that this shell still prints the phrase, otherwise the
  # scan below would read as "zero strays" while being blind (R13).
  probe="$(bash -c 'crewrig_stray_scan_probe_nonexistent_command' 2>&1 || true)"
  case "$probe" in
    *"$phrase"*) ;;
    *)
      echo "ci-cache-guard: stray-scan: detector inactive: the shell did not print '$phrase' for a missing command (got: ${probe:-<nothing>}). Retry with LC_ALL=C." >&2
      exit 71
      ;;
  esac

  scratch="$(mktemp -d "${TMPDIR:-/tmp}/stray-scan.XXXXXX")"
  trap 'rm -rf "$scratch"' EXIT
  out="$scratch/stdout"
  err="$scratch/stderr"
  rc="$scratch/status"

  # Run the command once. The fd swap keeps the two streams apart: the command's
  # stderr goes through its own tee back to stderr, its stdout through fd 3 to
  # the outer tee. The status is captured with an `&&/||` list, which is exempt
  # from errexit: a plain `"$@"; echo $? > "$rc"` would abort the group under
  # `set -e` on a failing command and the verdict below would never run.
  { { "$@" && echo 0 > "$rc" || echo $? > "$rc"; } 2>&1 1>&3 3>&- | tee "$err" >&2; } 3>&1 | tee "$out" || true

  status=""
  [ -f "$rc" ] && status="$(cat "$rc")"
  case "$status" in
    ''|*[!0-9]*) status=1 ;;
  esac

  matches="$({ grep -h -F -- "$phrase" "$out" "$err" || true; } | head -n 20)"
  if [ -n "$matches" ]; then
    {
      echo "ci-cache-guard: stray-scan: STRAY in: $*"
      printf '%s\n' "$matches" | sed 's/^/  /'
    } >&2
    if [ "$status" -ne 0 ]; then
      exit "$status"
    fi
    exit 70
  fi
  exit "$status"
fi

# --- sha256 helper (portable across Linux/macOS) ----------------------------

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    shasum -a 256 "$@"
  fi
}

# --- Key derivation ---------------------------------------------------------
# The key is the sha256 of the concatenated hashes of every declared file
# (globs expanded) plus the values of every declared env var. This is the
# content-addressed form of the reference's `cache:` need declaration.

key_input=""
if [ -n "$KEY_FILES" ]; then
  # Enable globstar so `artifacts/**` expands recursively; nullglob so a
  # pattern matching nothing contributes nothing rather than the literal text.
  shopt -s globstar nullglob
  IFS=',' read -r -a files <<< "$KEY_FILES"
  for f in ${files[@]+"${files[@]}"}; do
    [ -z "$f" ] && continue
    for expanded in $f; do
      [ -f "$expanded" ] || continue
      key_input="${key_input}$(sha256 "$expanded" | awk '{print $1}')"
    done
  done
fi
if [ -n "$KEY_ENV" ]; then
  IFS=',' read -r -a envs <<< "$KEY_ENV"
  for e in ${envs[@]+"${envs[@]}"}; do
    [ -z "$e" ] && continue
    key_input="${key_input}${e}=${!e:-}"
  done
fi

# The command itself is part of the key so two different commands sharing a
# cache dir never collide on the same marker.
key_input="${key_input}${*}"
key="$(printf '%s' "$key_input" | sha256 | awk '{print $1}')"

cmd_hash="$(printf '%s' "$*" | sha256 | awk '{print $1}')"
marker="$CACHE_DIR/$key/$cmd_hash.marker"

# --- Cache hit? -------------------------------------------------------------
if [ -f "$marker" ]; then
  echo "ci-cache-guard: cache hit for: $*"
  exit 0
fi

# --- Cache miss: run the command, then write the marker ---------------------
echo "ci-cache-guard: cache miss, running: $*"
"$@"
mkdir -p "$(dirname "$marker")"
: > "$marker"
echo "ci-cache-guard: wrote marker $marker"
