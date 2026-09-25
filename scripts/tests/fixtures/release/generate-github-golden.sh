#!/bin/bash
# generate-github-golden.sh — Regenerate github-releaserc.golden.json from the
# PRE-REFACTOR release driver (spec 0213 PLAN v2 test 10c, as amended by the
# plan review's named edit v2-F1).
#
# The golden is the `.releaserc.json` that `main`'s own heredoc wrote before
# the release driver was refactored into scripts/lib/monorepo-release-lib.sh.
# It cannot be written by hand or extracted from the heredoc text: the heredoc
# bakes four run-time values into the JSON (the branch, the extension name,
# and the absolute repository root and release-output paths). So this script
# RUNS the historical driver, unmodified, in a throwaway fixture checkout:
#
#   - extension `foo` (extensions/core/foo/package.json), branch `main`;
#   - `npx` is shadowed by a shim that copies the `.releaserc.json` the driver
#     wrote into the current extension directory, then exits 0 (no engine);
#   - every occurrence of the fixture's absolute root is replaced, as a
#     literal string (jq split/join, never a regex), by the fixed placeholder
#     `/ROOT`, so the golden is machine-independent while keeping its bytes.
#
# test-monorepo-release.sh then compares, with `jq -S .`, this golden against
#   emit_releaserc github publish foo /ROOT /ROOT/dist/release/foo main
#
# Usage (from the repository root):
#   bash scripts/tests/fixtures/release/generate-github-golden.sh [<ref>] \
#     > scripts/tests/fixtures/release/github-releaserc.golden.json
#
# <ref> defaults to 4739512, the last `main` commit whose
# scripts/monorepo-release.sh still carried the heredoc. It must name a commit
# of that shape; the script refuses when the driver it runs writes no config.
set -euo pipefail

REF="${1:-4739512}"
REPO_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"

if ! git -C "$REPO_DIR" cat-file -e "$REF:scripts/monorepo-release.sh" 2>/dev/null; then
  echo "Error: $REF has no scripts/monorepo-release.sh" >&2
  exit 2
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FIX="$WORK/root"
mkdir -p "$FIX/scripts" "$FIX/extensions/core/foo" "$WORK/bin"
git -C "$REPO_DIR" show "$REF:scripts/monorepo-release.sh" > "$FIX/scripts/monorepo-release.sh"
printf '{"name":"foo","version":"1.2.0"}\n' > "$FIX/extensions/core/foo/package.json"

# The shim stands in for `npx semantic-release`: it captures the config the
# driver wrote into the extension directory (its cwd at call time).
cat > "$WORK/bin/npx" <<SHIM
#!/bin/bash
cp .releaserc.json "$WORK/captured.json"
SHIM
chmod +x "$WORK/bin/npx"

git -C "$FIX" init -q -b main
git -C "$FIX" -c user.name=golden -c user.email=golden@example.invalid add -A
git -C "$FIX" -c user.name=golden -c user.email=golden@example.invalid commit -q -m "fixture"

# ROOT_DIR inside the driver is `$(pwd)`, so the literal root to replace is the
# logical path this subshell cd's into.
ROOT_LITERAL="$(cd "$FIX" && pwd)"
(
  cd "$FIX"
  env -u DRY_RUN PATH="$WORK/bin:$PATH" bash scripts/monorepo-release.sh >/dev/null
)

if [ ! -s "$WORK/captured.json" ]; then
  echo "Error: the driver at $REF wrote no .releaserc.json" >&2
  exit 1
fi

jq -S --arg root "$ROOT_LITERAL" '
  walk(if type == "string" then (split($root) | join("/ROOT")) else . end)
' "$WORK/captured.json"
