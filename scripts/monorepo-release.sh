#!/bin/bash
set -e

SR_ARGS=""
if [ "$DRY_RUN" = "true" ]; then
  echo "DRY RUN mode enabled"
  SR_ARGS="--dry-run"
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Branch: $CURRENT_BRANCH"

ROOT_DIR=$(pwd)
export NODE_PATH="$ROOT_DIR/node_modules"

ERRORS=0

for dir in extensions/*/*/; do
  if [ -f "${dir}package.json" ]; then
    EXT_NAME=$(basename "$dir")
    echo ""
    echo "--- Analyzing: $EXT_NAME ---"

    # Pre-package the extension so the .tgz is ready for upload
    echo "Packaging $EXT_NAME..."
    mkdir -p "$ROOT_DIR/dist"
    TARBALL=$(cd "$dir" && npm pack --pack-destination "$ROOT_DIR/dist" 2>/dev/null | tail -1)
    TARBALL_ABS="$ROOT_DIR/dist/$TARBALL"
    echo "Packaged: $TARBALL_ABS"

    # Single-job architecture:
    #   semantic-release-gitmoji → analyze commits (replaces both
    #     commit-analyzer and release-notes-generator)
    #   semantic-release-monorepo → scope commits to this extension dir
    #   @semantic-release/changelog → write CHANGELOG.md
    #   @semantic-release/github → create GitHub Release + upload .tgz
    #   @semantic-release/exec → sync extension.json + gemini-extension.json
    #     to nextRelease.version (lockstep with package.json, spec 0044 F1)
    #   @semantic-release/git → commit CHANGELOG + all three manifests back
    #
    # LOCKSTEP ORDERING (spec 0044): @semantic-release/exec MUST precede
    # @semantic-release/git in this array. semantic-release runs each release
    # step's plugins in array order, so exec.prepareCmd (which rewrites the two
    # sibling manifests) runs BEFORE git.prepare (which stages + commits the
    # assets). If git ran first, the synced siblings would miss the release
    # commit and re-introduce the divergence check-extension-manifest-version.sh
    # forbids. The siblings are ALSO listed in @semantic-release/git `assets`
    # below — exec writes them to the tree, git commits them; both are required.
    # The `[skip ci]` token in the git `message` MUST be preserved: it is what
    # stops the release commit from re-triggering build.yml (and the divergence
    # guard) — do not drop it when editing this heredoc.
    cat <<EOF > "${dir}.releaserc.json"
{
  "extends": "semantic-release-monorepo",
  "branches": ["$CURRENT_BRANCH"],
  "tagFormat": "${EXT_NAME}-v\${version}",
  "plugins": [
    ["semantic-release-gitmoji", {
      "releaseRules": {
        "major": [":boom:"],
        "minor": [":sparkles:"],
        "patch": [":bug:", ":ambulance:", ":lock:", ":zap:"]
      }
    }],
    "@semantic-release/changelog",
    ["@semantic-release/github", {
      "assets": [
        {"path": "$TARBALL_ABS", "label": "${EXT_NAME} (tgz)"}
      ]
    }],
    ["@semantic-release/exec", {
      "prepareCmd": "for m in extension.json gemini-extension.json; do [ -f \"\$m\" ] && jq --arg v \"\${nextRelease.version}\" '.version=\$v' \"\$m\" > \"\$m.tmp\" && mv \"\$m.tmp\" \"\$m\"; done; true"
    }],
    ["@semantic-release/git", {
      "assets": ["package.json", "extension.json", "gemini-extension.json", "CHANGELOG.md"],
      "message": "🔖 ${EXT_NAME}-v\${nextRelease.version} [skip ci]\\n\\n\${nextRelease.notes}"
    }]
  ]
}
EOF

    cd "$dir"

    echo "Running semantic-release for $EXT_NAME..."
    if ! npx semantic-release $SR_ARGS --branches "$CURRENT_BRANCH" 2>&1; then
      echo "Error: semantic-release failed for $EXT_NAME"
      ERRORS=1
    fi

    rm -f .releaserc.json
    cd "$ROOT_DIR"
  fi
done

# Cleanup dist
rm -rf "$ROOT_DIR/dist"

echo ""
if [ $ERRORS -ne 0 ]; then
  echo "Release analysis completed WITH ERRORS."
  exit 1
fi

echo "Release analysis completed successfully."
