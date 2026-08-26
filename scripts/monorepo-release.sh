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

    # The release artifact's own output directory (spec 0183 R17/R21/R22):
    # scripts/release-package-extension.sh is the ONE place its shape is
    # decided (PLAN v2 step 32, corrected by pass-2 v2-F1). It writes exactly
    # one archive per invocation and refuses to run twice into a
    # non-empty directory, so this directory is cleared here rather than
    # left to accumulate a stray asset across retried runs.
    RELEASE_OUT="$ROOT_DIR/dist/release/$EXT_NAME"
    rm -rf "$RELEASE_OUT"
    mkdir -p "$RELEASE_OUT"

    # Single-job architecture:
    #   semantic-release-gitmoji → analyze commits (replaces both
    #     commit-analyzer and release-notes-generator)
    #   semantic-release-monorepo → scope commits to this extension dir
    #   @semantic-release/changelog → write CHANGELOG.md
    #   @semantic-release/exec → sync extension.json + package.json to
    #     nextRelease.version (lockstep with spec 0044 F1), THEN package the
    #     rendered installable tree via scripts/release-package-extension.sh
    #     (spec 0183 R17/R21/R22) — no `gemini-extension.json` arm: it is a
    #     BUILD OUTPUT under the render-at-publication model (spec 0173
    #     delta-01), never a committed sibling, so an arm over it would
    #     report success having found nothing to write (R21's own forbidden
    #     state).
    #   @semantic-release/github → create GitHub Release + upload the ONE
    #     archive scripts/release-package-extension.sh wrote (glob: the
    #     version-bearing filename is not knowable when this heredoc is
    #     written, only when nextRelease.version is computed).
    #   @semantic-release/git → commit CHANGELOG + the two surviving
    #     manifests back.
    #
    # LOCKSTEP ORDERING (spec 0044): @semantic-release/exec MUST precede
    # @semantic-release/git in this array. semantic-release runs each release
    # step's plugins in array order, so exec.prepareCmd (which rewrites the
    # two sibling manifests, then packages the release artifact from the
    # rewritten tree) runs BEFORE git.prepare (which stages + commits the
    # assets). If git ran first, the synced siblings would miss the release
    # commit and re-introduce the divergence check-extension-manifest-version.sh
    # forbids — and the package step would run against a tree not yet
    # carrying its own release version. The `[skip ci]` token in the git
    # `message` MUST be preserved: it is what stops the release commit from
    # re-triggering build.yml (and the divergence guard) — do not drop it
    # when editing this heredoc.
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
    ["@semantic-release/exec", {
      "prepareCmd": "for m in package.json extension.json; do [ -f \"\$m\" ] && jq --arg v \"\${nextRelease.version}\" '.version=\$v' \"\$m\" > \"\$m.tmp\" && mv \"\$m.tmp\" \"\$m\"; done; bash $ROOT_DIR/scripts/release-package-extension.sh $EXT_NAME --version \${nextRelease.version} --out $RELEASE_OUT"
    }],
    ["@semantic-release/github", {
      "assets": [
        {"path": "$RELEASE_OUT/*.tar.gz", "label": "${EXT_NAME} (installable tree)"}
      ]
    }],
    ["@semantic-release/git", {
      "assets": ["package.json", "extension.json", "CHANGELOG.md"],
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
