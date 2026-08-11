#!/bin/bash
# check-core-paths.sh — Keep the core-paths manifest and the tree in agreement,
# in BOTH directions.
#
# Forward direction — manifest to tree (spec 0031 R5). Continuous integration
# MUST fail a pull request when any entry in .crewrig/core-paths.txt does not
# resolve to tracked content at the repository HEAD. A "phantom" entry — a
# manifest line naming a path with no tracked content — makes an adopter's
# sync-from-upstream.sh run skip-with-warning at best, and historically
# aborted the whole sync. This guard catches such an entry before it can
# reach the canonical branch.
#
# Reverse direction — tree to manifest (spec 0121 R5). Continuous integration
# MUST fail when a directory the component build writes component outputs into
# carries no upstream-synchronisation guarantee, and MUST name that directory.
# The forward direction is structurally blind to this: it walks the manifest,
# so a built-output directory the manifest never mentions is invisible to it.
# That blindness is why `.agents/skills` and `.agents/agents` sat unguaranteed
# through a fully green CI (issue #755).
#
# Policy semantics (spec 0020) mirror sync-from-upstream.sh:
#   strict / adopt-on-edit  Upstream-owned content — MUST resolve at HEAD.
#   excluded                Org-owned — not guaranteed tracked in every
#                           clone, so explicitly NOT checked.
# The path/policy split logic below is intentionally identical to the
# manifest parser in sync-from-upstream.sh (first whitespace field = path,
# second token = policy, default `strict`; blank/`#` lines skipped; CRLF
# tolerated).
#
# Three limits on what the reverse direction can see. The first two are
# deliberate scoping decisions; the third is a precondition it cannot check:
#
#   1. Depth-2 extraction. Only a `$out_root/<a>/<b>` target yields a
#      directory, because `<a>/<b>` is the granularity the manifest itself
#      claims (`.claude/skills`, not `.claude`). A future top-level output —
#      `"$out_root/AGENTS.md"` — therefore yields nothing and trips the
#      fail-closed rule below. That is loud by design, not a false positive:
#      such an output needs a manifest classification decision, and this guard
#      is where the decision gets forced rather than skipped.
#   2. Bounded identity with sync-from-upstream.sh's path_is_governed().
#      dir_is_governed() below mirrors it EXCEPT for the
#      `.crewrig/.synced-markers` short-circuit (sync-from-upstream.sh:369),
#      which is the R8 marker-bookkeeping carve-out and can never name a build
#      output. Everything else — the strict/adopt-on-edit policy filter, the
#      nested-`excluded`-child carve-out, and continuing the scan rather than
#      concluding when such a child matches — is the identical rule.
#   3. PRECONDITION, not a fact: every output write goes through one of the two
#      helpers. True at the time of writing and verified then, but nothing here
#      enforces it, and no matcher can — a call-site parser cannot see a write
#      that is not a call. A direct redirection,
#          printf '%s' "$content" > "$out_root/.newcli/skills/$name/SKILL.md"
#      writes an ungoverned directory and this guard reports the repository
#      clean. Teaching the build a third write path therefore retires the
#      reverse direction for whatever that path writes, silently. If one is
#      ever added, either route it through a helper or move to the
#      `--list-output-dirs` escape below — which closes this class too, since a
#      declaration covers every write regardless of how it is spelled.
#
# Known limitation, named here so it is not rediscovered the hard way: a write
# site reachable only for a non-`core` tier would demand a manifest entry for a
# path with no tracked content at HEAD, which the forward direction would then
# reject as a phantom — an unsatisfiable pair, since output_root_for_tier() in
# build-components.sh sends non-core tiers to `dist/<tier>`. The escape is to
# teach build-components.sh to declare its own output directories (e.g. a
# `--list-output-dirs` query mode) and consume that here instead of parsing
# call sites; a declaration can distinguish tiers, this extraction cannot.
#
# Usage:
#   bash scripts/check-core-paths.sh
#
# Exit codes:
#   0  Both directions agree.
#   1  A manifest entry does not resolve at HEAD (forward), or a built-output
#      directory carries no guarantee (reverse). Failing items are listed.
#   2  A required input is missing or unclassifiable: the manifest, the build
#      script, or a write-helper call site whose target yields no directory.

set -euo pipefail

REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/.." && pwd)"}"
MANIFEST="$REPO_DIR/.crewrig/core-paths.txt"

if [ ! -f "$MANIFEST" ]; then
  echo "Error: manifest not found: $MANIFEST" >&2
  exit 2
fi

# Parse the manifest into parallel arrays of paths and policies.
# `while read` rather than `mapfile` for bash 3.2 compat (macOS default).
PATHS=()
POLICIES=()
while IFS= read -r line || [ -n "$line" ]; do
  # Strip a trailing carriage return (tolerate CRLF manifests).
  line="${line%$'\r'}"
  # Skip blank lines and comments.
  [[ -z "$line" || "$line" == \#* ]] && continue
  # Split off the first whitespace-delimited field (path) and the rest (policy).
  path="${line%%[[:space:]]*}"
  rest="${line#"$path"}"
  policy="${rest#"${rest%%[![:space:]]*}"}"   # ltrim
  policy="${policy%%[[:space:]]*}"             # first token only
  [ -z "$policy" ] && policy="strict"
  PATHS+=("$path")
  POLICIES+=("$policy")
done < "$MANIFEST"

# ---------------------------------------------------------------------------
# Reverse direction, part 1 — derive the built-output directory set from the
# build script itself (spec 0121 R5).
#
# Deriving rather than declaring is the whole point: a list held here would
# drift from the build exactly as the manifest just did, which is the failure
# this guard exists to end.
#
# This works only while every output write goes through one of the two helpers
# — a precondition, not a property this guard can verify (header, limit 3). So
# long as it holds, the call sites are the declaration.
# ---------------------------------------------------------------------------
BUILD_SCRIPT="$REPO_DIR/scripts/build-components.sh"

if [ ! -f "$BUILD_SCRIPT" ]; then
  echo "Error: build script not found: $BUILD_SCRIPT" >&2
  echo "The reverse direction (spec 0121 R5) derives the built-output directory" >&2
  echo "set from this file. A rename must be followed here — it must never" >&2
  echo "silently retire the guard." >&2
  exit 2
fi

DERIVED=()
bs_lineno=0
while IFS= read -r bs_line || [ -n "$bs_line" ]; do
  bs_lineno=$((bs_lineno + 1))
  bs_line="${bs_line%$'\r'}"

  # Match on the TRIMMED line, and this is load-bearing: the real call sites
  # are indented inside `for`/`if` bodies, so a matcher tested against the raw
  # line matches only column-0 stubs and derives nothing from the real script.
  trimmed="${bs_line#"${bs_line%%[![:space:]]*}"}"

  case "$trimmed" in
    # Comment skip first — it is what excludes the prose mentions of both
    # helper names. The definition lines (`check_or_write() {`) are excluded
    # naturally instead: they carry `(`, not a space, after the name.
    \#*) continue ;;
    # Leading `*` deliberately: a helper call need not be the first token of
    # its line. `if ! check_or_write …`, `for … do check_or_write …` and
    # `[ -n "$x" ] && check_or_write …` all write output, and a prefix-anchored
    # pattern discarded them here — silently, because the fail-closed rule
    # below only ever sees lines that already matched. All sixteen call sites
    # happen to be bare today, which is exactly why measuring the matcher
    # against the real build script could not surface the gap.
    *"check_or_write "*|*"propagate_skill_resources "*) ;;
    *) continue ;;
  esac

  yielded=0
  rest="$trimmed"
  while :; do
    case "$rest" in
      *'$out_root/'*) ;;
      *) break ;;
    esac
    rest="${rest#*'$out_root/'}"

    seg_a="${rest%%/*}"
    seg_b="${rest#*/}"
    seg_b="${seg_b%%/*}"

    # Depth-2 only: both segments must be literal directory names.
    case "$seg_a" in ''|*'"'*|*'$'*|*/*) continue ;; esac
    case "$seg_b" in ''|*'"'*|*'$'*|*/*) continue ;; esac

    yielded=1
    dir="$seg_a/$seg_b"
    seen=0
    for d in ${DERIVED[@]+"${DERIVED[@]}"}; do
      [ "$d" = "$dir" ] && { seen=1; break; }
    done
    [ "$seen" -eq 0 ] && DERIVED+=("$dir")
  done

  # Fail closed. A write-helper call whose target this guard cannot classify is
  # an output directory it cannot check — indistinguishable, from the outside,
  # from a repository with nothing to report. Refusing to run is the only
  # answer that cannot be mistaken for a clean bill of health.
  if [ "$yielded" -eq 0 ]; then
    echo "Error: unclassifiable write-helper call site" >&2
    echo "  $BUILD_SCRIPT:$bs_lineno" >&2
    echo "  $trimmed" >&2
    echo "" >&2
    echo "This guard extracts an output directory from a \$out_root/<a>/<b>" >&2
    echo "target and found none on this line. Depth-2 is deliberate — see the" >&2
    echo "header comment of this script. A top-level or tier-conditional output" >&2
    echo "needs a manifest classification decision before it can be built." >&2
    exit 2
  fi
done < "$BUILD_SCRIPT"

# ---------------------------------------------------------------------------
# dir_is_governed <dir>
# Mirror of path_is_governed() in sync-from-upstream.sh (line 366), minus its
# `.crewrig/.synced-markers` short-circuit — no build output can live there.
# Governed iff some strict/adopt-on-edit entry covers <dir>, with no `excluded`
# entry nested strictly under THAT entry covering it. Consulting excluded
# ancestors, or concluding on the first excluded match instead of continuing
# the scan, would both be stricter than the sync actually is — and reachable:
# `.agents excluded` + `.agents/skills strict` is governed for the sync.
# ---------------------------------------------------------------------------
dir_is_governed() {
  local dir="$1" i j gov skip
  for i in "${!PATHS[@]}"; do
    case "${POLICIES[$i]}" in
      strict|adopt-on-edit) ;;
      *) continue ;;
    esac
    gov="${PATHS[$i]}"
    case "$dir" in
      "$gov"|"$gov"/*)
        skip=0
        for j in "${!PATHS[@]}"; do
          [ "${POLICIES[$j]}" = "excluded" ] || continue
          case "${PATHS[$j]}" in "$gov"/*) ;; *) continue ;; esac
          case "$dir" in
            "${PATHS[$j]}"|"${PATHS[$j]}"/*) skip=1; break ;;
          esac
        done
        [ "$skip" -eq 1 ] && continue
        return 0
        ;;
    esac
  done
  return 1
}

failures=()
checked=0
for i in "${!PATHS[@]}"; do
  path="${PATHS[$i]}"
  policy="${POLICIES[$i]}"

  # Org-owned entries are not guaranteed tracked content in every clone.
  [ "$policy" = "excluded" ] && continue

  checked=$((checked + 1))
  if ! git -C "$REPO_DIR" cat-file -e "HEAD:$path" 2>/dev/null; then
    echo "  FAIL $path ($policy) — does not resolve to tracked content at HEAD" >&2
    failures+=("$path")
  fi
done

if [ "${#failures[@]}" -gt 0 ]; then
  echo "" >&2
  echo "FAILED: ${#failures[@]} core-paths manifest entr(y/ies) do not resolve at HEAD:" >&2
  for p in ${failures[@]+"${failures[@]}"}; do
    echo "  - $p" >&2
  done
  echo "" >&2
  echo "Every strict/adopt-on-edit entry in .crewrig/core-paths.txt must resolve to" >&2
  echo "tracked content at HEAD (spec 0031). Either commit the missing content, or" >&2
  echo "remove the manifest entry (and its docs/layers.md row, per the co-maintenance" >&2
  echo "rule in AGENTS.md)." >&2
  exit 1
fi

echo "OK: all $checked strict/adopt-on-edit core-paths entries resolve at HEAD."

# ---------------------------------------------------------------------------
# Reverse direction, part 2 — every derived directory must carry a guarantee
# (spec 0121 R2/R5). No exemption allowlist: R2 admits none, and an allowlist
# is how this class of guard usually decays.
# ---------------------------------------------------------------------------
UNGOVERNED=()
for d in ${DERIVED[@]+"${DERIVED[@]}"}; do
  dir_is_governed "$d" || UNGOVERNED+=("$d")
done

if [ "${#UNGOVERNED[@]}" -gt 0 ]; then
  echo "" >&2
  echo "FAILED: ${#UNGOVERNED[@]} of ${#DERIVED[@]} built-output director(y/ies) derived from" >&2
  echo "scripts/build-components.sh carry no upstream-sync guarantee:" >&2
  for d in ${UNGOVERNED[@]+"${UNGOVERNED[@]}"}; do
    echo "  - $d" >&2
  done
  echo "" >&2
  echo "Every directory the component build writes component outputs into must be" >&2
  echo "governed by .crewrig/core-paths.txt with a strict or adopt-on-edit policy" >&2
  echo "(spec 0121 R2). Add the entry, and its docs/layers.md row in the same diff" >&2
  echo "per the co-maintenance rule in AGENTS.md." >&2
  exit 1
fi

echo "OK: all ${#DERIVED[@]} built-output directories derived from scripts/build-components.sh are governed."
