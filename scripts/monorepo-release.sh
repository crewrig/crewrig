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
#   publish   (default) — on GitLab, per extension, run `npx semantic-release`
#             in the checkout with the forge's publish leg, which commits the
#             version to the release branch and tags it. On GitHub, the
#             release-PR flow (issue #1379) — the `main-protected` ruleset
#             rejects any runner-made commit on `main`:
#               1. per extension, the engine's dry run (in the throwaway clone
#                  described under rehearsal) classifies it (release_classify):
#                  unchanged, publish (its committed version IS the computed
#                  next version: a release PR was merged) or pending;
#               2. every `publish` extension is released from the checkout —
#                  packaged, tagged on the merged commit, the tag pushed (never
#                  a branch), the forge release created;
#               3. every `pending` extension is released FOR REAL inside the
#                  clone, against the mirror, with no publish leg and no
#                  credential: changelog + manifest bump + release commit;
#               4. the clone's commits are force-pushed to the release PR
#                  branch (release_pr_branch), and scripts/release-pr.ts opens
#                  or updates the release PR (or closes a stale one) and
#                  dispatches its required checks. It prints
#                    PENDING <ext> version=<v> tag=<t>
#                    RELEASE-PR ... / RELEASE-PR-MANUAL <url> / RELEASE-PR-CHECKS ...
#                    RELEASE-FAILED release-pr step=<push|pr>
#             Both forges print, per released extension, one of
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
else
  [ -n "${GITHUB_SERVER_URL:-}" ] || release_refuse "GITHUB_SERVER_URL is not set"
  [ -n "${GITHUB_REPOSITORY:-}" ] || release_refuse "GITHUB_REPOSITORY is not set"
fi
if [ "$RELEASE_MODE" = "publish" ]; then
  # The release PR's own head branch is never a release branch: its versions
  # are committed but unmerged, so every extension would classify as publish
  # and be tagged from an unreviewed branch (issue #1379).
  case "$RELEASE_FORGE:$RELEASE_BRANCH" in
    github:release-pr/*) release_refuse "refusing to publish from a release PR branch ($RELEASE_BRANCH): merge the release PR instead" ;;
  esac
  release_credential "$RELEASE_FORGE"
fi

echo "Forge: $RELEASE_FORGE"
echo "Mode: $RELEASE_MODE"
echo "Branch: $RELEASE_BRANCH"

ROOT_DIR=$(pwd)
export NODE_PATH="$ROOT_DIR/node_modules"

ERRORS=0

# One scratch root for the whole run, removed on exit.
RELEASE_TMP="$(mktemp -d)"
# shellcheck disable=SC2064  # expand RELEASE_TMP now
trap "rm -rf '$RELEASE_TMP'" EXIT

# ---------------------------------------------------------------------------
# Publish mode
# ---------------------------------------------------------------------------

# release_publish [<extension-dir>...] — publish the given extension
# directories (relative to ROOT_DIR, trailing slash), every extension when none
# is given.
release_publish() {
  local dir ext out log rc tag step archive dist_preexisted=0 logdir
  local -a dirs=()
  logdir="$RELEASE_TMP/publish-logs"
  mkdir -p "$logdir"
  if [ -d "$ROOT_DIR/dist" ]; then
    dist_preexisted=1
  fi

  if [ "$RELEASE_FORGE" = "gitlab" ]; then
    release_disable_credential_helpers
  fi

  if [ "$#" -gt 0 ]; then
    dirs=("$@")
  else
    for dir in extensions/*/*/; do
      dirs+=("$dir")
    done
  fi

  for dir in ${dirs[@]+"${dirs[@]}"}; do
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

    releaserc="$ROOT_DIR/dist/release/$ext.releaserc.json"
    emit_releaserc "$RELEASE_FORGE" publish "$ext" "$ROOT_DIR" "$out" "$RELEASE_BRANCH" > "$releaserc"

    log="$logdir/$ext.log"
    echo "Running semantic-release for $ext..."
    cd "$dir"
    npx semantic-release --branches "$RELEASE_BRANCH" --extends "semantic-release-monorepo,$releaserc" 2>&1 | tee "$log"
    rc=${PIPESTATUS[0]}
    rm -f "$releaserc"
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
    for dir in ${dirs[@]+"${dirs[@]}"}; do
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

# release_make_mirror <r> — a throwaway bare mirror of HEAD (and its tags) at
# <r>/mirror.git and a clone of it at <r>/clone, whose real forge URL is
# redirected to the mirror, so every engine git operation stays local.
release_make_mirror() {
  local r="$1" forge_url remote_head
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
}

release_rehearse() {
  local r dir ext out json released version tag last notes archive
  r="$RELEASE_TMP/rehearsal"
  mkdir -p "$r"
  release_make_mirror "$r"

  release_strip_args

  for dir in "$r"/clone/extensions/*/*/; do
    [ -f "${dir}package.json" ] || continue
    ext=$(basename "$dir")
    echo ""
    echo "--- Rehearsing: $ext ---"
    out="$r/out/$ext"
    mkdir -p "$out"
    releaserc="$r/$ext.releaserc.json"
    emit_releaserc "$RELEASE_FORGE" rehearsal "$ext" "$r/clone" "$out" "$RELEASE_BRANCH" > "$releaserc"

    json="$r/$ext.json"
    if ! (cd "$dir" && env ${RELEASE_STRIP[@]+"${RELEASE_STRIP[@]}"} node "$ROOT_DIR/scripts/lib/release-rehearse.mjs" "$RELEASE_BRANCH" "$releaserc") > "$json"; then
      echo "RELEASE-FAILED $ext step=engine"
      ERRORS=1
      continue
    fi
    rm -f "$releaserc"

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

# ---------------------------------------------------------------------------
# GitHub publish mode — the release-PR flow (issue #1379)
# ---------------------------------------------------------------------------

# release_engine_run <r> <dir> <ext> <mode> <json> [apply] — the engine for one
# extension of the clone, credential-free, through release-rehearse.mjs. Its
# log goes to stderr and to <r>/<ext>.<mode>.log.
release_engine_run() {
  local r="$1" dir="$2" ext="$3" mode="$4" json="$5" apply="${6:-}" releaserc rc
  releaserc="$r/$ext.$mode.releaserc.json"
  emit_releaserc "$RELEASE_FORGE" "$mode" "$ext" "$r/clone" "$r/out/$ext" "$RELEASE_BRANCH" > "$releaserc"
  # shellcheck disable=SC2086  # $apply is empty or the single word `apply`
  (cd "$dir" && env ${RELEASE_STRIP[@]+"${RELEASE_STRIP[@]}"} node "$SCRIPT_DIR/lib/release-rehearse.mjs" "$RELEASE_BRANCH" "$releaserc" $apply) \
    > "$json" 2> "$r/$ext.$mode.log"
  rc=$?
  cat "$r/$ext.$mode.log" >&2
  rm -f "$releaserc"
  return "$rc"
}

release_github() {
  local r dir ext json released version tag notes manifest head incomplete=0
  local -a publish_dirs=() pending_dirs=()
  r="$RELEASE_TMP/release-pr"
  mkdir -p "$r"
  release_make_mirror "$r"
  release_strip_args
  head="$(release_pr_branch "$RELEASE_BRANCH")"

  # 1. Classify every extension from the engine's dry run on the branch head.
  for dir in "$r"/clone/extensions/*/*/; do
    [ -f "${dir}package.json" ] || continue
    ext=$(basename "$dir")
    echo ""
    echo "--- Analyzing: $ext ---"
    json="$r/$ext.classify.json"
    if ! release_engine_run "$r" "$dir" "$ext" rehearsal "$json"; then
      echo "RELEASE-FAILED $ext step=engine"
      ERRORS=1
      incomplete=1
      continue
    fi
    released="$(jq -r '.released' "$json")"
    version="$(jq -r '.version // ""' "$json")"
    manifest="$(jq -r '.version // ""' "${dir}package.json")"
    case "$(release_classify "$released" "$version" "$manifest")" in
      unchanged) echo "UNCHANGED $ext" ;;
      publish) publish_dirs+=("${dir#"$r/clone/"}") ;;
      pending) pending_dirs+=("$dir") ;;
    esac
  done

  # 2. Publish the releases a merged release PR committed.
  if [ "${#publish_dirs[@]}" -gt 0 ]; then
    release_publish ${publish_dirs[@]+"${publish_dirs[@]}"}
  fi

  # 3. Commit every pending release in the clone, against the mirror.
  printf '[]\n' > "$r/entries.json"
  for dir in ${pending_dirs[@]+"${pending_dirs[@]}"}; do
    ext=$(basename "$dir")
    echo ""
    echo "--- Preparing the release PR: $ext ---"
    json="$r/$ext.prepare.json"
    if ! release_engine_run "$r" "$dir" "$ext" prepare "$json" apply \
       || [ "$(jq -r '.released' "$json")" != "true" ]; then
      echo "RELEASE-FAILED $ext step=$(release_failed_step "$r/$ext.prepare.log")"
      ERRORS=1
      incomplete=1
      # Drop the failed extension's partial changes; earlier commits stay.
      git -C "$r/clone" reset -q --hard
      git -C "$r/clone" clean -q -fd
      continue
    fi
    version="$(jq -r '.version' "$json")"
    tag="$(jq -r '.gitTag' "$json")"
    notes="$(jq -r '.notes // ""' "$json")"
    jq --arg ext "$ext" --arg version "$version" --arg tag "$tag" --arg notes "$notes" \
      '. + [{ext: $ext, version: $version, tag: $tag, notes: $notes}]' "$r/entries.json" > "$r/entries.tmp"
    mv "$r/entries.tmp" "$r/entries.json"
    echo "PENDING $ext version=$version tag=$tag"
  done

  # 4. Push the release branch, then open/update/close the release PR and
  # dispatch its required checks. A run in which an extension could not be
  # classified or prepared, and which is left with nothing to propose, must
  # not close a release PR still open: it may carry that extension.
  if [ "$(jq 'length' "$r/entries.json")" -gt 0 ]; then
    # --no-verify: a push FROM the checkout would run its pre-push hook.
    if ! git fetch -q "$r/clone" "refs/heads/$RELEASE_BRANCH" \
       || ! git push --no-verify --force -q origin "FETCH_HEAD:refs/heads/$head"; then
      echo "RELEASE-FAILED release-pr step=push"
      ERRORS=1
      return 0
    fi
    echo "RELEASE-PR-BRANCH $head"
  elif [ "$incomplete" -eq 1 ]; then
    return 0
  fi
  if ! node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$SCRIPT_DIR/release-pr.ts" \
       sync "$RELEASE_BRANCH" "$head" "$r/entries.json"; then
    echo "RELEASE-FAILED release-pr step=pr"
    ERRORS=1
  fi
}

if [ "$RELEASE_MODE" = "rehearsal" ]; then
  release_rehearse
elif [ "$RELEASE_FORGE" = "github" ]; then
  release_github
else
  release_publish
fi

echo ""
if [ $ERRORS -ne 0 ]; then
  echo "Release analysis completed WITH ERRORS."
  exit 1
fi

echo "Release analysis completed successfully."
