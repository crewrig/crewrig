#!/usr/bin/env bash
# scripts/merge-spec-pr.sh — exclusive merge mechanism for spec-PRs.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if [ -f "scripts/lib/common.sh" ]; then
  . scripts/lib/common.sh
fi

BRANCH_NAME="$(git branch --show-current)"

if [[ "$BRANCH_NAME" != spec/* ]]; then
    echo "  Not on a spec/ branch. Delegating to gh pr merge."
    exec gh pr merge --squash "$@"
fi

SPEC_SLUG="${BRANCH_NAME#spec/}"
SPEC_FILE="specs/${SPEC_SLUG}.md"

if [ ! -f "$SPEC_FILE" ]; then
    echo "  WARNING: Spec file $SPEC_FILE not found on branch $BRANCH_NAME. Delegating to gh pr merge."
    exec gh pr merge --squash "$@"
fi

STATUS=$(awk '/^---$/{ c++ } c==1 && /^status:/{ print $2; exit }' "$SPEC_FILE")

if [ "$STATUS" = "draft" ]; then
    echo "ERROR: Spec file $SPEC_FILE has 'status: draft' in its frontmatter." >&2
    echo "       A draft spec cannot be merged. Please approve it first." >&2
    exit 1
fi

echo "  Spec file $SPEC_FILE is not draft. Delegating to gh pr merge."
exec gh pr merge --squash "$@"
