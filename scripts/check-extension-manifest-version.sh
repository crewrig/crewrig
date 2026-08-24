#!/bin/bash
# check-extension-manifest-version.sh — Enforce a single authoritative version
# per extension across its sibling manifests (spec 0044, R5/R6, as amended by
# specs/0044-extension-versioning-manifest.delta-01.md R6/R8/R10).
#
# An extension can ship up to two COMMITTED manifests in its directory:
#   - package.json           (npm workspace manifest, AUTHORITATIVE)
#   - extension.json         (per-extension manifest, cli-matrix row 17)
#
# `gemini-extension.json` is no longer a committed sibling — under the
# render-at-publication model (spec 0173 delta-01) it is a BUILD output, and a
# committed instance of it fails scripts/build-extension.sh --check instead
# (arm COMMITTED). The 0044 delta-01 content-gate decision is that a check
# whose subject disappears is REMOVED, not left green over nothing (R8): the
# arm that used to compare `gemini-extension.json` against the authoritative
# version is gone from this guard, and the property it asserted is carried,
# in the same change, by scripts/build-extension.sh --check arm
# VERSION-DRIFT on the BUILT manifest (spec 0173 delta-01 R11). This guard's
# scope now follows the committed manifest set (R6 as amended): only
# `extension.json` is checked here.
#
# package.json is elected as the single source of truth because it is the ONLY
# manifest the release driver writes back and tags from
# (scripts/monorepo-release.sh: `@semantic-release/git` `assets` + `tagFormat`
# `${EXT_NAME}-v${version}`). The release driver still iterates
# `package.json extension.json gemini-extension.json` (spec 0044 delta-01
# *Notes*: its own re-specification is deferred to S5, issue #1008) — the
# third iteration is now a no-op wherever `gemini-extension.json` is absent,
# guarded by `[ -f "$m" ] &&` at scripts/monorepo-release.sh:72.
#
# This guard is STATIC (diff-free): it walks the whole tree on every run and
# fails when the committed extension.json of an extension declares a
# `version` that differs from that extension's authoritative package.json
# `version`. Like the 0043 provenance guard, being static makes it safe on
# both `push` and `pull_request` and catches drift regardless of how it was
# introduced (a release commit, a manual edit, a botched merge).
#
# Scope — upstream-owned tiers (extensions/core, extensions/library), matching
# the sibling guards; extensions/org is adopter-owned ⇒ EXEMPT.
#
# Parser — jq (extension manifests are JSON; jq is the parser already used by
# scripts/build-claude-plugin.sh and scripts/create-extension.sh, and is
# preinstalled on ubuntu-latest — no yq dependency).
#
# Usage:
#   bash scripts/check-extension-manifest-version.sh
#
# Exits 0 when every extension's manifests agree on a single version, non-zero
# (with a per-offender list) otherwise.

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required but not found on PATH." >&2
  exit 2
fi

# Upstream-owned extension tier roots. extensions/org is adopter-owned ⇒ EXEMPT.
TIER_ROOTS=(
  "extensions/core"
  "extensions/library"
)

# Sibling manifests checked against the authoritative package.json version.
# gemini-extension.json is deliberately absent: it is a build output, not a
# committed sibling (spec 0044 delta-01 R8) — see the header comment.
SIBLINGS=(
  "extension.json"
)

checked=0
failures=()

# Collect extension dirs (those carrying a package.json) under upstream tiers.
ext_dirs=()
while IFS= read -r d; do
  [ -z "$d" ] && continue
  ext_dirs+=("$d")
done < <(
  for root in ${TIER_ROOTS[@]+"${TIER_ROOTS[@]}"}; do
    [ -d "$root" ] || continue
    # extensions/<tier>/<name>/package.json — one level of <name> under the root.
    for pkg in "$root"/*/package.json; do
      [ -f "$pkg" ] || continue
      dirname "$pkg"
    done
  done | sort
)

for dir in ${ext_dirs[@]+"${ext_dirs[@]}"}; do
  checked=$((checked + 1))
  authoritative="$(jq -r '.version // empty' "$dir/package.json")"

  if [ -z "$authoritative" ]; then
    echo "  FAIL $dir/package.json — no .version field (authoritative source must declare one)"
    failures+=("$dir/package.json")
    continue
  fi

  dir_ok=1
  for sib in ${SIBLINGS[@]+"${SIBLINGS[@]}"}; do
    [ -f "$dir/$sib" ] || continue
    sib_version="$(jq -r '.version // empty' "$dir/$sib")"
    if [ "$sib_version" != "$authoritative" ]; then
      echo "  FAIL $dir/$sib — version '$sib_version' != authoritative package.json version '$authoritative'"
      failures+=("$dir/$sib")
      dir_ok=0
    fi
  done

  if [ "$dir_ok" -eq 1 ]; then
    echo "  OK   $dir (version $authoritative)"
  fi
done

if [ "${#failures[@]}" -gt 0 ]; then
  echo ""
  echo "FAILED: ${#failures[@]} manifest(s) diverge from their extension's authoritative version:"
  for f in ${failures[@]+"${failures[@]}"}; do
    echo "  - $f"
  done
  echo ""
  echo "Per spec 0044 (as amended by delta-01), an extension's package.json version"
  echo "is authoritative; its committed extension.json sibling MUST declare the SAME"
  echo "version (gemini-extension.json is a build output, asserted separately by"
  echo "'bash scripts/build-extension.sh --check'). The release driver"
  echo "(scripts/monorepo-release.sh) syncs both in lockstep, so post-release drift"
  echo "means a manual edit fell out of step."
  exit 1
fi

echo ""
echo "OK: ${checked} extension(s) declare a single authoritative version across their manifests."
