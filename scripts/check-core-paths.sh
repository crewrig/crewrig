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
#   regenerable             Upstream-owned content the component build
#                           regenerates (spec 0199 R42) — MUST resolve at
#                           HEAD, exactly as strict/adopt-on-edit do; the
#                           forward loop below never distinguishes it from
#                           them.
#   excluded                Org-owned — not guaranteed tracked in every
#                           clone, so explicitly NOT checked.
# The path/policy split logic below is intentionally identical to the
# manifest parser in sync-from-upstream.sh (first whitespace field = path,
# second token = policy, default `strict`; blank/`#` lines skipped; CRLF
# tolerated).
#
# Two limits on what the reverse direction can see, both deliberate scoping decisions:
#
#   1. Depth-2 output structure. Built outputs are evaluated at `<a>/<b>`
#      granularity (`.claude/skills`, `.claude/agents`), matching the core-paths
#      manifest.
#   2. Bounded identity with sync-from-upstream.sh's path_is_governed().
#      dir_is_governed() below mirrors it EXCEPT for the
#      `.crewrig/.synced-markers` short-circuit (sync-from-upstream.sh:369),
#      which is the R8 marker-bookkeeping carve-out and can never name a build
#      output. Everything else — the strict/adopt-on-edit/regenerable policy
#      filter, the nested-`excluded`-child carve-out, and continuing the scan
#      rather than concluding when such a child matches — is the identical
#      rule.
#
# Declared output set (spec 0125): `scripts/build-components.sh` is queried directly
# via `--list-output-dirs` to obtain its declared output directories. The build
# script is the authority on its outputs, so direct writes and helper calls are
# equally covered.
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
# Reverse direction, part 1 — query the built-output directory set from the
# build script itself (spec 0121 R5, spec 0125).
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
query_output=""
if ! query_output="$(bash "$BUILD_SCRIPT" --list-output-dirs 2>/dev/null)"; then
  echo "Error: failed to query built-output directories from build script: $BUILD_SCRIPT --list-output-dirs" >&2
  exit 2
fi

if [ -n "$query_output" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    [ -z "$line" ] && continue
    DERIVED+=("$line")
  done <<< "$query_output"
fi

# ---------------------------------------------------------------------------
# dir_is_governed <dir>
# Mirror of path_is_governed() in sync-from-upstream.sh (line 366), minus its
# `.crewrig/.synced-markers` short-circuit — no build output can live there.
# Governed iff some strict/adopt-on-edit/regenerable entry covers <dir>, with
# no `excluded` entry nested strictly under THAT entry covering it (spec 0121
# delta-01 R8: a `regenerable` path counts as governed for this purpose, same
# as strict/adopt-on-edit). Consulting excluded ancestors, or concluding on
# the first excluded match instead of continuing the scan, would both be
# stricter than the sync actually is — and reachable: `.agents excluded` +
# `.agents/skills strict` is governed for the sync.
# ---------------------------------------------------------------------------
dir_is_governed() {
  local dir="$1" i j gov skip
  for i in "${!PATHS[@]}"; do
    case "${POLICIES[$i]}" in
      strict|adopt-on-edit|regenerable) ;;
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
  echo "Every strict/adopt-on-edit/regenerable entry in .crewrig/core-paths.txt must" >&2
  echo "resolve to tracked content at HEAD (spec 0031). Either commit the missing" >&2
  echo "content, or remove the manifest entry (and its docs/layers.md row, per the" >&2
  echo "co-maintenance rule in AGENTS.md)." >&2
  exit 1
fi

echo "OK: all $checked strict/adopt-on-edit/regenerable core-paths entries resolve at HEAD."

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
  echo "governed by .crewrig/core-paths.txt with a strict, adopt-on-edit, or" >&2
  echo "regenerable policy (spec 0121 R2, spec 0121 delta-01 R8). Add the entry, and" >&2
  echo "its docs/layers.md row in the same diff per the co-maintenance rule in" >&2
  echo "AGENTS.md." >&2
  exit 1
fi

echo "OK: all ${#DERIVED[@]} built-output directories derived from scripts/build-components.sh are governed."

# ---------------------------------------------------------------------------
# Reverse direction, part 3 — every supported target's org channel file
# carries an `excluded` manifest carve-out (spec 0199 R41). Enumerated from
# HEAD, not from the manifest itself: a target whose only file is an org
# stem (no core mapping, R17) must not be a blind spot here, so the
# supported-target set is derived from BOTH `<target>.yml` and
# `<target>.org.yml` stems under model-mappings/, deduped.
# ---------------------------------------------------------------------------
TARGET_STEMS=()
while IFS= read -r mm_line; do
  [ -z "$mm_line" ] && continue
  mm_base="$(basename "$mm_line")"
  case "$mm_base" in
    *.org.yml) mm_stem="${mm_base%.org.yml}" ;;
    *.yml)     mm_stem="${mm_base%.yml}" ;;
    *)         continue ;;
  esac
  mm_found=0
  for mm_existing in ${TARGET_STEMS[@]+"${TARGET_STEMS[@]}"}; do
    [ "$mm_existing" = "$mm_stem" ] && { mm_found=1; break; }
  done
  [ "$mm_found" -eq 0 ] && TARGET_STEMS+=("$mm_stem")
done < <(git -C "$REPO_DIR" ls-tree -r --name-only HEAD -- "model-mappings/" 2>/dev/null)

UNCARVED_TARGETS=()
for mm_target in ${TARGET_STEMS[@]+"${TARGET_STEMS[@]}"}; do
  mm_carved=0
  for i in "${!PATHS[@]}"; do
    if [ "${PATHS[$i]}" = "model-mappings/${mm_target}.org.yml" ] && [ "${POLICIES[$i]}" = "excluded" ]; then
      mm_carved=1
      break
    fi
  done
  [ "$mm_carved" -eq 0 ] && UNCARVED_TARGETS+=("$mm_target")
done

if [ "${#UNCARVED_TARGETS[@]}" -gt 0 ]; then
  echo "" >&2
  echo "FAILED: ${#UNCARVED_TARGETS[@]} of ${#TARGET_STEMS[@]} supported target(s) have no" >&2
  echo "excluded org channel carve-out in .crewrig/core-paths.txt:" >&2
  for mm_target in ${UNCARVED_TARGETS[@]+"${UNCARVED_TARGETS[@]}"}; do
    echo "  - $mm_target (expected: model-mappings/${mm_target}.org.yml  excluded)" >&2
  done
  echo "" >&2
  echo "Every supported target's org channel file must carry an excluded manifest" >&2
  echo "entry (spec 0199 R41), nested under the strict model-mappings parent. Add" >&2
  echo "the entry, and its docs/layers.md row in the same diff per the" >&2
  echo "co-maintenance rule in AGENTS.md." >&2
  exit 1
fi

echo "OK: all ${#TARGET_STEMS[@]} supported target(s) carry an excluded org channel carve-out."
