#!/bin/bash
set -e

GEMINI_HOME="${HOME}/.gemini"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-install}"
EXT="$2"

# shellcheck source=lib/extension-manifest.sh
. "$REPO_DIR/scripts/lib/extension-manifest.sh"

# Extensions live under extensions/<tier>/<name>/. The tier is a SOURCE-side
# organization concern: the install TARGET ($GEMINI_HOME/extensions/<name>)
# stays flat — the tier is never reflected in the installed extension's name.
#
# The "all" loop covers the upstream tiers (core + library). The adopter-owned
# org tier is opt-in: pass --include-org (or set INCLUDE_ORG=1) to fold it in.
UPSTREAM_TIERS=(core library)
INCLUDE_ORG="${INCLUDE_ORG:-}"

mkdir -p "$GEMINI_HOME/extensions"

# resolve_ext_dir <name> — echo the absolute SOURCE dir for a bare extension
# name, searching every tier (first match). Hard-errors on a duplicate name
# across tiers. Returns non-zero if not found.
resolve_ext_dir() {
  local name="$1" found="" tier
  for tier in core library org; do
    if [ -d "$REPO_DIR/extensions/$tier/$name" ]; then
      if [ -n "$found" ]; then
        echo "Error: extension '$name' exists in multiple tiers; names must be unique." >&2
        return 2
      fi
      found="$REPO_DIR/extensions/$tier/$name"
    fi
  done
  [ -n "$found" ] || return 1
  echo "$found"
}

do_install() {
  local name="$1"
  local src target
  src="$(resolve_ext_dir "$name")" || {
    echo "Error: extension '$name' not found." >&2
    return 1
  }

  # Render before installing/linking (spec 0173 delta-01 R7/R20): nothing
  # generated is committed on the primary branch, so the source tree alone
  # has no gemini-extension.json to serve. Both modes move together — a
  # `link` into the source tree would symlink an extension with no manifest,
  # which is broken by construction rather than merely unsupported.
  # No separate ext_assert_current_shape call here (spec 0183 R13): this
  # delegates to build-extension.sh, which reaches it through
  # ext_validate_manifest — do NOT add a second call.
  bash "$REPO_DIR/scripts/build-extension.sh" --target gemini "$name" >&2 || {
    echo "Error: rendering extension '$name' failed." >&2
    return 1
  }
  src="$(ext_build_dir "$REPO_DIR" "$name")"

  target="$GEMINI_HOME/extensions/$name"

  [ -e "$target" ] || [ -L "$target" ] && rm -rf "$target"

  if [ "$MODE" = "link" ]; then
    ln -s "$src" "$target"
    echo "  Linked: $name (build directory)"
  else
    cp -rf "$src" "$target"
    echo "  Copied: $name (build directory)"
  fi
}

if [ -n "$EXT" ]; then
  if [ "$EXT" = "--include-org" ]; then
    EXT=""
    INCLUDE_ORG=1
  fi
fi

if [ -n "$EXT" ]; then
  do_install "$EXT"
else
  tiers=(${UPSTREAM_TIERS[@]+"${UPSTREAM_TIERS[@]}"})
  [ -n "$INCLUDE_ORG" ] && tiers+=(org)
  for tier in ${tiers[@]+"${tiers[@]}"}; do
    for dir in "$REPO_DIR"/extensions/"$tier"/*/; do
      [ -d "$dir" ] && do_install "$(basename "$dir")"
    done
  done
fi
