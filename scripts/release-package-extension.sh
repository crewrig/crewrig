#!/bin/bash
# release-package-extension.sh — The ONE place a versioned release
# artifact's shape is decided (spec 0183 R17/R21/R22, PLAN v2 step 32 as
# corrected by pass-2 finding v2-F1).
#
# Usage:
#   bash scripts/release-package-extension.sh <name> --version <v> --out <dir>
#
# Ruling A (maintainer arbitration, 2026-08-25, issue #1008's contingent
# block; specs/0183-extension-model-migration.delta-01.md): a versioned
# release serves the command-line tool that loads an extension in place
# (Gemini CLI) ALONE. The archive root is `build/extensions/<name>`
# BYTE-FOR-BYTE — exactly the tree scripts/install-extension.sh installs.
# There is no staging directory and no multi-target assembly; the other
# three supported tools keep their own local render-and-install paths and
# are not served by this artifact (spec 0183 delta-01, Out of scope).
#
# Asserts, in order, refusing to produce an archive on any failure:
#   1. The extension is in the CURRENT declaration shape
#      (ext_assert_current_shape — spec 0183 R12/R13).
#   2. A fresh `--target gemini` render succeeds.
#   3. gemini-extension.json sits at the ROOT of build/extensions/<name>
#      (R17: "carrying only the extension's committed source tree" is
#      refused, naming the rendered outputs it lacks).
#   4. Its .version equals the passed --version (R22).
#   5. Exactly ONE asset will be published — the measured vendor constraint
#      (`findReleaseAsset` returns the generic asset only when the release
#      carries exactly one asset; see specs/0183-extension-model-migration.delta-01.md
#      Notes). This script writes exactly one archive per invocation, so
#      the assertion is that the caller has not already populated <dir>
#      with something else, not a multi-file computation.
# Where `gemini` is on PATH, also runs `gemini extensions validate` against
# the rendered tree as a best-effort local check, skipping silently
# otherwise (the CI capability declares tools: [jq, yq] only — no `gemini`).
#
# Writes <out>/<name>-<version>.tar.gz: a gzipped tar of the archive root
# with no path prefix beyond the tree's own contents, so extracting it at
# the archive root produces exactly build/extensions/<name>'s own layout.
#
# Prerequisites: jq, tar

set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "Error: jq is required. Install with: brew install jq"; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "Error: tar is required."; exit 1; }

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/extension-manifest.sh
. "$REPO_DIR/scripts/lib/extension-manifest.sh"

NAME=""
VERSION=""
OUT_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="${2:?Usage: release-package-extension.sh <name> --version <v> --out <dir>}"
      shift 2
      ;;
    --out)
      OUT_DIR="${2:?Usage: release-package-extension.sh <name> --version <v> --out <dir>}"
      shift 2
      ;;
    *)
      if [ -z "$NAME" ]; then
        NAME="$1"
        shift
      else
        echo "Error: unexpected argument '$1'" >&2
        exit 1
      fi
      ;;
  esac
done

if [ -z "$NAME" ] || [ -z "$VERSION" ] || [ -z "$OUT_DIR" ]; then
  echo "Usage: release-package-extension.sh <name> --version <v> --out <dir>" >&2
  exit 1
fi

# --- Resolve the extension source tree over the three tiers ---------------
EXT_DIR=""
for tier in core library org; do
  if [ -d "$REPO_DIR/extensions/$tier/$NAME" ]; then
    if [ -n "$EXT_DIR" ]; then
      echo "Error: extension '$NAME' exists in multiple tiers; names must be unique." >&2
      exit 1
    fi
    EXT_DIR="$REPO_DIR/extensions/$tier/$NAME"
  fi
done
if [ -z "$EXT_DIR" ]; then
  echo "Error: extension '$NAME' not found in extensions/." >&2
  exit 1
fi

# --- Assertion 1: current declaration shape (spec 0183 R12/R13) -----------
MANIFEST="$EXT_DIR/extension.json"
if [ ! -f "$MANIFEST" ]; then
  echo "Error: no extension.json found in $EXT_DIR — run scripts/migrate-extension.sh if this is an old-shape extension." >&2
  exit 1
fi
ext_assert_current_shape "$MANIFEST" || exit 1

# --- Assertion 2: a fresh --target gemini render succeeds ------------------
if ! bash "$REPO_DIR/scripts/build-extension.sh" --target gemini "$NAME"; then
  echo "Error: a fresh --target gemini render failed for '$NAME' — refusing to publish a release artifact for a tree that does not build." >&2
  exit 1
fi

BUILD_DIR="$(ext_build_dir "$REPO_DIR" "$NAME")"
BUILT_MANIFEST="$BUILD_DIR/gemini-extension.json"

# --- Assertion 3: gemini-extension.json sits at the root of the archive ---
# (R17: an artifact carrying only the committed source tree is refused,
# naming the rendered outputs it lacks.)
if [ ! -f "$BUILT_MANIFEST" ]; then
  echo "Error: $BUILD_DIR carries no gemini-extension.json at its root — a source-only tree is not a publishable release artifact (spec 0183 R17)." >&2
  exit 1
fi

# --- Assertion 4: the built manifest's version equals the requested one ---
# (R22: the lockstep spec 0044 R5 establishes must hold at the moment of
# publication, not only at render time.)
BUILT_VERSION="$(jq -r '.version // ""' "$BUILT_MANIFEST")"
if [ "$BUILT_VERSION" != "$VERSION" ]; then
  echo "Error: $BUILT_MANIFEST declares version '$BUILT_VERSION', which does not equal the requested release version '$VERSION' (spec 0183 R22)." >&2
  exit 1
fi

# --- Assertion 5: exactly one asset will be published (measured vendor
# --- constraint — see this file's header) -----------------------------
mkdir -p "$OUT_DIR"
EXISTING_COUNT="$(find "$OUT_DIR" -mindepth 1 -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')"
if [ "$EXISTING_COUNT" -gt 0 ]; then
  echo "Error: $OUT_DIR already carries $EXISTING_COUNT file(s) — a release publishes exactly ONE asset (the installed tool resolves the generic asset only when the release carries exactly one; a checksums file or a second archive defeats it just as a second archive would). Clear $OUT_DIR before packaging." >&2
  exit 1
fi

# --- Best-effort local validation where the gemini CLI is available -------
if command -v gemini >/dev/null 2>&1; then
  if gemini extensions validate "$BUILD_DIR" >/dev/null 2>&1; then
    echo "  gemini extensions validate: OK"
  else
    echo "  gemini extensions validate: reported an issue (non-fatal, best-effort only) — re-run manually against $BUILD_DIR for detail." >&2
  fi
else
  echo "  gemini CLI not on PATH — skipping the best-effort 'gemini extensions validate' check."
fi

# --- Write the archive: build/extensions/<name>'s CONTENTS at the archive
# --- root, byte-for-byte, with NO wrapper directory ------------------------
# Pinned by the R20 probe (docs/runbooks/extension-release-install-probe.md):
# the installed tool (Gemini CLI 0.46.0) does NOT tolerate a top-level
# wrapper directory the way its own bundled documentation claims — a first
# archive built as `tar -C build/extensions <name>` (wrapper: <name>/) failed
# install with "Configuration file not found at .../gemini-extension.json",
# because the tool looks for the manifest directly at the archive root, not
# one level down. `tar -C build/extensions/<name> .` places every file
# (gemini-extension.json included) AT the root instead.
ARCHIVE="$OUT_DIR/$NAME-$VERSION.tar.gz"
tar -czf "$ARCHIVE" -C "$BUILD_DIR" .

echo "Packaged: $ARCHIVE"
echo "  Archive root: build/extensions/$NAME's CONTENTS, no wrapper directory (byte-for-byte — Ruling A, single-tool; see the R20 probe runbook for why no wrapper)"
echo "  Version: $VERSION"
