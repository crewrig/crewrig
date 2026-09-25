#!/bin/bash
# monorepo-release.sh — Analyze and release every extension of the monorepo,
# on GitHub Actions or GitLab CI (spec 0213 + delta-01; spec 0183 for the
# artifact; spec 0044 for manifest lockstep).
#
# One engine (semantic-release) and one entry point on both forges. The forge,
# the mode, the branch, the identity and the credential are resolved up front
# (scripts/lib/monorepo-release-lib.sh); every refusal there exits 2 before
# anything is written (R10).
#
# Modes:
#   publish   (default) — per extension, run `npx semantic-release` in the
#             checkout with the forge's publish leg. Prints one of
#               PUBLISHED <ext> tag=<t> archive=<file> sha256=<hex>
#               UNCHANGED <ext>
#               RELEASE-FAILED <ext> step=<verify|package|commit|upload|release|engine>
#               RELEASE-INCOMPLETE-TAG <tag>   (a tag exists, the release does not)
#   rehearsal (RELEASE_DRY_RUN=true; DRY_RUN=true is accepted) — needs NO
#             credential and publishes nothing (R12). The engine's dry run
#             runs in a throwaway clone of a throwaway bare mirror of HEAD;
#             the clone redirects the real forge URL to the mirror with
#             `url.<mirror>.insteadOf`, so the notes carry the forge's real
#             links while every git operation stays local. The checkout's refs,
#             index, working tree and ignored files are left as found (R13).
#             Prints, per extension,
#               REHEARSAL <ext> version=<v> tag=<t> baseline=<tag|none> archive=<file> sha256=<hex>
#             followed by the release note, or UNCHANGED <ext>.
#
# Credential (publish mode): GITHUB_TOKEN / GITLAB_TOKEN (or GH_TOKEN /
# GL_TOKEN), else the portable key RELEASE_TOKEN. It is only ever named.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/monorepo-release-lib.sh
. "$SCRIPT_DIR/lib/monorepo-release-lib.sh"

# --- Preflight: forge -> mode -> branch -> identity -> credential ----------
release_detect_forge
release_mode
release_branch "$RELEASE_FORGE"
release_identity "$RELEASE_FORGE"
if [ "$RELEASE_FORGE" = "gitlab" ]; then
  [ -n "${CI_PROJECT_URL:-}" ] || release_refuse "CI_PROJECT_URL is not set"
  [ -n "${CI_SERVER_URL:-}" ] || release_refuse "CI_SERVER_URL is not set"
elif [ "$RELEASE_MODE" = "rehearsal" ]; then
  [ -n "${GITHUB_SERVER_URL:-}" ] || release_refuse "GITHUB_SERVER_URL is not set"
  [ -n "${GITHUB_REPOSITORY:-}" ] || release_refuse "GITHUB_REPOSITORY is not set"
fi
if [ "$RELEASE_MODE" = "publish" ]; then
  release_credential "$RELEASE_FORGE"
fi

echo "Forge: $RELEASE_FORGE"
echo "Mode: $RELEASE_MODE"
echo "Branch: $RELEASE_BRANCH"

ROOT_DIR=$(pwd)
export NODE_PATH="$ROOT_DIR/node_modules"

ERRORS=0

# ---------------------------------------------------------------------------
# Publish mode
# ---------------------------------------------------------------------------
release_publish() {
  local dir ext out log rc tag step archive dist_preexisted=0 logdir
  logdir="$(mktemp -d)"
  # shellcheck disable=SC2064  # expand logdir now
  trap "rm -rf '$logdir'" EXIT
  if [ -d "$ROOT_DIR/dist" ]; then
    dist_preexisted=1
  fi

  if [ "$RELEASE_FORGE" = "gitlab" ]; then
    release_disable_credential_helpers
  fi

  for dir in extensions/*/*/; do
    [ -f "${dir}package.json" ] || continue
    ext=$(basename "$dir")
    echo ""
    echo "--- Analyzing: $ext ---"

    # The release artifact's own output directory (spec 0183 R17/R21/R22):
    # scripts/release-package-extension.sh writes exactly one archive per
    # invocation and refuses to run twice into a non-empty directory, so it
    # is cleared here rather than left to accumulate a stray asset across
    # retried runs.
    out="$ROOT_DIR/dist/release/$ext"
    rm -rf "$out"
    mkdir -p "$out"

    emit_releaserc "$RELEASE_FORGE" publish "$ext" "$ROOT_DIR" "$out" "$RELEASE_BRANCH" > "${dir}.releaserc.json"

    log="$logdir/$ext.log"
    echo "Running semantic-release for $ext..."
    cd "$dir"
    npx semantic-release --branches "$RELEASE_BRANCH" 2>&1 | tee "$log"
    rc=${PIPESTATUS[0]}
    rm -f .releaserc.json
    cd "$ROOT_DIR"

    tag="$(release_created_tag "$log")"
    if [ "$rc" -ne 0 ]; then
      step="$(release_failed_step "$log")"
      echo "RELEASE-FAILED $ext step=$step"
      if [ -n "$tag" ]; then
        echo "RELEASE-INCOMPLETE-TAG $tag"
      fi
      ERRORS=1
    elif [ -n "$tag" ]; then
      archive="$(ls "$out"/*.tar.gz 2>/dev/null | head -n 1)"
      if [ -n "$archive" ]; then
        echo "PUBLISHED $ext tag=$tag archive=$(basename "$archive") sha256=$(release_sha256 "$archive")"
      else
        echo "PUBLISHED $ext tag=$tag archive=none sha256=none"
      fi
    else
      echo "UNCHANGED $ext"
    fi
  done

  # Remove only what this run created: the whole dist/ when it did not exist
  # before the run, otherwise just this run's release output directories.
  if [ "$dist_preexisted" -eq 0 ]; then
    rm -rf "$ROOT_DIR/dist"
  else
    for dir in extensions/*/*/; do
      [ -f "${dir}package.json" ] || continue
      rm -rf "$ROOT_DIR/dist/release/$(basename "$dir")"
    done
    rmdir "$ROOT_DIR/dist/release" 2>/dev/null || true
  fi
}

# ---------------------------------------------------------------------------
# Rehearsal mode
# ---------------------------------------------------------------------------

# release_reconcile_tags <mirror> — create, in the MIRROR only, every remote
# `*-v*` tag that the checkout lacks but whose commit is local and an ancestor
# of HEAD. Read-only against the checkout and the remote. Uses the peeled
# (`^{}`) commit of an annotated tag. With full-depth history every commit
# reachable from HEAD is local, so this recovers exactly the reachable
# baselines the tag format (R4) needs, whatever tags the CI checkout fetched.
release_reconcile_tags() {
  local mirror="$1" remote_tags name sha
  if ! remote_tags="$(git ls-remote --tags origin '*-v*')"; then
    echo "Error: rehearsal cannot list the tags of origin" >&2
    exit 1
  fi
  printf '%s\n' "$remote_tags" | awk '
    NF == 2 {
      n = $2; sub("^refs/tags/", "", n)
      if (n ~ /\^\{\}$/) { sub(/\^\{\}$/, "", n); peeled[n] = $1 }
      else if (!(n in plain)) { plain[n] = $1 }
    }
    END { for (n in plain) print n, ((n in peeled) ? peeled[n] : plain[n]) }
  ' | while read -r name sha; do
    [ -n "$name" ] || continue
    if git rev-parse -q --verify "refs/tags/$name" >/dev/null; then
      continue
    fi
    if git cat-file -e "$sha^{commit}" 2>/dev/null && git merge-base --is-ancestor "$sha" HEAD; then
      git -C "$mirror" update-ref "refs/tags/$name" "$sha"
    fi
  done
}

release_rehearse() {
  local r forge_url remote_head dir ext out json released version tag last notes archive
  r="$(mktemp -d)"
  # shellcheck disable=SC2064  # expand r now
  trap "rm -rf '$r'" EXIT

  git init --bare -q "$r/mirror.git"
  # --no-verify: pushing to the mirror is a push FROM the checkout, so it
  # would otherwise run the checkout's pre-push hook (plan review v2-F3).
  # Pushing to a path writes no remote-tracking ref in the checkout.
  git push --no-verify -q "$r/mirror.git" "HEAD:refs/heads/$RELEASE_BRANCH" 'refs/tags/*:refs/tags/*'
  release_reconcile_tags "$r/mirror.git"

  remote_head="$(git ls-remote --heads origin "$RELEASE_BRANCH" | awk 'NR == 1 {print $1}')"
  if [ -n "$remote_head" ] && [ "$remote_head" != "$(git rev-parse HEAD)" ]; then
    echo "NOTICE remote branch has advanced; rehearsing HEAD"
  fi

  git -C "$r/mirror.git" symbolic-ref HEAD "refs/heads/$RELEASE_BRANCH"
  git clone -q --branch "$RELEASE_BRANCH" "$r/mirror.git" "$r/clone"
  forge_url="$(release_forge_url "$RELEASE_FORGE")"
  git -C "$r/clone" config "url.$r/mirror.git.insteadOf" "$forge_url"
  ln -s "$ROOT_DIR/node_modules" "$r/clone/node_modules"

  release_strip_args

  for dir in "$r"/clone/extensions/*/*/; do
    [ -f "${dir}package.json" ] || continue
    ext=$(basename "$dir")
    echo ""
    echo "--- Rehearsing: $ext ---"
    out="$r/out/$ext"
    mkdir -p "$out"
    emit_releaserc "$RELEASE_FORGE" rehearsal "$ext" "$r/clone" "$out" "$RELEASE_BRANCH" > "${dir}.releaserc.json"

    json="$r/$ext.json"
    if ! (cd "$dir" && env ${RELEASE_STRIP[@]+"${RELEASE_STRIP[@]}"} node "$ROOT_DIR/scripts/lib/release-rehearse.mjs" "$RELEASE_BRANCH") > "$json"; then
      echo "RELEASE-FAILED $ext step=engine"
      ERRORS=1
      continue
    fi
    rm -f "${dir}.releaserc.json"

    released="$(jq -r '.released' "$json")"
    if [ "$released" != "true" ]; then
      echo "UNCHANGED $ext"
      continue
    fi
    version="$(jq -r '.version' "$json")"
    tag="$(jq -r '.gitTag' "$json")"
    last="$(jq -r '.lastTag // "none"' "$json")"
    notes="$(jq -r '.notes' "$json")"
    if ! release_is_semver "$version"; then
      echo "RELEASE-FAILED $ext step=engine"
      echo "Error: the engine computed a version that is not SemVer" >&2
      ERRORS=1
      continue
    fi

    # Package exactly as the exec plugin would, in the clone, with the clone's
    # own packager and the computed literal version.
    if ! (cd "$dir" && sh -c "$(release_prepare_cmd "$r/clone" "$ext" "$out" "$version")"); then
      echo "RELEASE-FAILED $ext step=package"
      ERRORS=1
      continue
    fi
    archive="$(ls "$out"/*.tar.gz 2>/dev/null | head -n 1)"
    if [ -z "$archive" ]; then
      echo "RELEASE-FAILED $ext step=package"
      ERRORS=1
      continue
    fi
    echo "REHEARSAL $ext version=$version tag=$tag baseline=$last archive=$(basename "$archive") sha256=$(release_sha256 "$archive")"
    printf '%s\n' "$notes"
  done
}

if [ "$RELEASE_MODE" = "rehearsal" ]; then
  release_rehearse
else
  release_publish
fi

echo ""
if [ $ERRORS -ne 0 ]; then
  echo "Release analysis completed WITH ERRORS."
  exit 1
fi

echo "Release analysis completed successfully."
