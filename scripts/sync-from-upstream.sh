#!/bin/bash
# sync-from-upstream.sh — Pull core-layer files from the canonical upstream.
#
# Usage:
#   bash scripts/sync-from-upstream.sh
#
# Reads the upstream URL from crewrig.config.toml (canonical_repo field).
#
# Policy-driven (spec 0020). Each .crewrig/core-paths.txt entry carries one
# of three policies (default `strict` when the column is absent):
#
#   strict         Upstream-owned. A local modification relative to FETCH_HEAD
#                  aborts the sync — revert or promote the change to overlay
#                  before syncing.
#   adopt-on-edit  Upstream-owned until the adopter diverges, then frozen
#                  permanently. The "modified?" decision is stateless and
#                  two-tier (committed marker fast path, then upstream-history
#                  membership). Never aborts the sync.
#   excluded       Org-owned. Never guarded, never restored, never touched.
#
# An `excluded` entry nested under a `strict`/`adopt-on-edit` parent (e.g.
# `specs/org` under `specs`, `.crewrig/.synced-markers` under `.crewrig`) is
# carved out of BOTH the parent's dirty guard and its restore via a
# `:(exclude)` git pathspec — so org content under a core parent can neither
# abort the sync nor be overwritten.
#
# On success, restores each eligible core-layer path from FETCH_HEAD into the
# working tree without staging or committing anything. Review the diff with
# 'git diff' before deciding what to commit.
#
# Requires git >= 1.9 (the `:(exclude)` magic pathspec).

set -e

# CREWRIG_REPO_DIR may be set by tests to override the default discovery.
REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/.." && pwd)"}"
CONFIG="$REPO_DIR/crewrig.config.toml"
MANIFEST="$REPO_DIR/.crewrig/core-paths.txt"
MARKERS_DIR="$REPO_DIR/.crewrig/.synced-markers"

# ---------------------------------------------------------------------------
# Read canonical_repo — strip surrounding quotes, reject empty/absent value.
# ---------------------------------------------------------------------------
CANONICAL_REPO=$(grep '^canonical_repo' "$CONFIG" 2>/dev/null | sed 's/.*= *"\(.*\)".*/\1/')

if [ -z "$CANONICAL_REPO" ]; then
  echo "Error: canonical_repo is not set in crewrig.config.toml" >&2
  echo "Set canonical_repo to the upstream repository URL before running sync." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Parse the manifest into parallel arrays of paths and policies.
# Format per non-comment line: <path>[<whitespace><policy>].
# An absent policy column defaults to `strict`.
# ---------------------------------------------------------------------------
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
# excluded_children_of <parent>
# Echo every excluded manifest entry nested strictly under <parent> (i.e.
# beginning with "<parent>/"). Used to build the :(exclude) pathspecs.
# ---------------------------------------------------------------------------
excluded_children_of() {
  local parent="$1" i
  for i in "${!PATHS[@]}"; do
    [ "${POLICIES[$i]}" = "excluded" ] || continue
    case "${PATHS[$i]}" in
      "$parent"/*) printf '%s\n' "${PATHS[$i]}" ;;
    esac
  done
}

# ---------------------------------------------------------------------------
# pathspec_for <path>
# Print the pathspec arguments for <path>: the path itself followed by a
# :(exclude) entry for every excluded child nested under it (NUL-separated,
# read back with `mapfile -d ''`).
# ---------------------------------------------------------------------------
pathspec_for() {
  local path="$1" child
  printf '%s\0' "$path"
  while IFS= read -r child; do
    [ -n "$child" ] && printf ':(exclude)%s\0' "$child"
  done < <(excluded_children_of "$path")
}

# ---------------------------------------------------------------------------
# blob_sha <path>
# Print the SHA of the adopter's CURRENT working-tree blob for <path>. The
# working tree (not HEAD) is hashed so an uncommitted local customization is
# detected; falls back to the HEAD blob when the working file is absent.
# ---------------------------------------------------------------------------
blob_sha() {
  local path="$1"
  if [ -e "$REPO_DIR/$path" ]; then
    git hash-object "$REPO_DIR/$path" 2>/dev/null
  else
    git rev-parse "HEAD:$path" 2>/dev/null
  fi
}

# ---------------------------------------------------------------------------
# upstream_has_blob <path> <sha>
# Return 0 iff <sha> equals the blob of <path> at ANY commit in FETCH_HEAD
# history (upstream-history membership). Commits where the path is absent
# (add/rename boundaries) are skipped via the 2>/dev/null suppression.
# ---------------------------------------------------------------------------
upstream_has_blob() {
  local path="$1" want="$2" commit hist
  while IFS= read -r commit; do
    [ -n "$commit" ] || continue
    hist="$(git rev-parse "$commit:$path" 2>/dev/null)" || continue
    [ "$hist" = "$want" ] && return 0
  done < <(git log --format='%H' FETCH_HEAD -- "$path" 2>/dev/null)
  return 1
}

# ---------------------------------------------------------------------------
# resolves_at_fetch_head <path>
# Return 0 iff <path> resolves to an object (blob OR tree) in the fetched
# upstream tree. `git cat-file -e FETCH_HEAD:<path>` succeeds for either
# object type, so the test is uniform across file and directory manifest
# entries. A manifest entry that resolves to nothing upstream (a "phantom")
# is skipped-with-warning by the apply loop rather than aborting the sync.
# ---------------------------------------------------------------------------
resolves_at_fetch_head() {
  git cat-file -e "FETCH_HEAD:$1" 2>/dev/null
}

# ---------------------------------------------------------------------------
# write_marker <path> <sha>
# Record <sha> as the last-synced upstream blob marker for <path>.
# ---------------------------------------------------------------------------
write_marker() {
  local path="$1" sha="$2" marker
  marker="$MARKERS_DIR/$path.sha"
  mkdir -p "$(dirname "$marker")"
  printf '%s\n' "$sha" > "$marker"
}

# ---------------------------------------------------------------------------
# path_in_org_history <path>
# Return 0 iff <path> has ever existed in the adopter's OWN history — i.e.
# is reachable from HEAD. ORG-SCOPED ON PURPOSE: HEAD reaches only the
# checked-out branch tip's history (refs/heads), never refs/remotes/* or
# FETCH_HEAD. `git rev-list --all` would traverse remote-tracking refs, and
# because the sync fetches upstream first, every upstream blob is reachable
# that way — so --all would report EVERY genuinely-new upstream file as
# "already owned" and suppress the R3 add. HEAD-scoping is the data-integrity
# fix: a file present solely in FETCH_HEAD / refs/remotes/* is correctly
# "never existed here" (→ ADD, R3); a file the org committed then deleted is
# still reachable from HEAD history (→ SKIP, R2).
# ---------------------------------------------------------------------------
path_in_org_history() {
  local path="$1"
  [ -n "$(git rev-list HEAD -- "$path" 2>/dev/null)" ]
}

# ---------------------------------------------------------------------------
# strict_blob_is_dirty <path>
# Return 0 (dirty) iff <path> is locally modified relative to upstream.
# Three cases:
#   - File present locally: dirty iff blob is absent from FETCH_HEAD history.
#   - File absent locally, present in HEAD: locally deleted → dirty.
#   - File absent locally, absent from HEAD: new upstream file → not dirty.
# ---------------------------------------------------------------------------
strict_blob_is_dirty() {
  local path="$1" current
  if [ -e "$REPO_DIR/$path" ]; then
    current="$(git hash-object "$REPO_DIR/$path" 2>/dev/null)"
    upstream_has_blob "$path" "$current" && return 1
    return 0
  else
    if git cat-file -e "HEAD:$path" 2>/dev/null; then
      return 0  # was in HEAD, now absent: locally deleted
    else
      return 1  # new upstream file, never committed here
    fi
  fi
}

# ---------------------------------------------------------------------------
# reconcile_member <path>
# Run the spec-0020 two-tier "modified?" decision for one adopt-on-edit member
# file that exists in BOTH the upstream tree and the working tree, restoring it
# from FETCH_HEAD when untouched and freezing it (recording the adopter's own
# blob marker) when customized. Identical to the blob adopt-on-edit branch in
# the apply loop, factored out so reconcile_dir can call it per member.
# ---------------------------------------------------------------------------
reconcile_member() {
  local path="$1" current marker decision new_sha
  current="$(blob_sha "$path")"
  marker="$MARKERS_DIR/$path.sha"
  decision=""

  if [ -n "$current" ] && [ -f "$marker" ] && [ "$(cat "$marker")" = "$current" ]; then
    decision="update"
  elif [ -n "$current" ] && upstream_has_blob "$path" "$current"; then
    decision="update"
  else
    decision="freeze"
  fi

  if [ "$decision" = "update" ]; then
    git restore --source=FETCH_HEAD --worktree -- "$path"
    new_sha="$(blob_sha "$path")"
    [ -n "$new_sha" ] && write_marker "$path" "$new_sha"
  else
    [ -n "$current" ] && write_marker "$path" "$current"
    echo "Preserved (adopter customisation): $path" >&2
  fi
}

# ---------------------------------------------------------------------------
# reconcile_dir <dir>
# Directory-level adopt-on-edit reconciliation. Enumerates the upstream file
# set at FETCH_HEAD and the org working-tree set under <dir>/, unions them, and
# decides per member:
#   - upstream-only, never in org history  → ADD    (R3)
#   - upstream-only, in org history         → SKIP   (R2: org deleted it)
#   - org-only (upstream dropped/never had) → FREEZE (org-owned)
#   - in both                               → two-tier decision (reconcile_member)
# An explicit trailing-slash pathspec ("$dir/") guards against prefix
# collisions (e.g. config/expertise must not capture config/expertise-archive).
# ---------------------------------------------------------------------------
reconcile_dir() {
  local dir="$1" f new_sha
  declare -A in_upstream=() seen=()

  # U := upstream file set at FETCH_HEAD under <dir>/.
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    in_upstream["$f"]=1
    seen["$f"]=1
  done < <(git ls-tree -r --name-only FETCH_HEAD -- "$dir/" 2>/dev/null)

  # W := org working-tree file set under <dir>/.
  if [ -d "$REPO_DIR/$dir" ]; then
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      seen["$f"]=1
    done < <(cd "$REPO_DIR" && git ls-files --cached --others --exclude-standard -- "$dir/" 2>/dev/null)
  fi

  for f in "${!seen[@]}"; do
    if [ -n "${in_upstream["$f"]:-}" ] && [ ! -e "$REPO_DIR/$f" ]; then
      # Upstream has it, org doesn't.
      if path_in_org_history "$f"; then
        # R2 — org deleted it; stays gone.
        echo "Preserved (org-deleted): $f" >&2
      else
        # R3 — never existed here; add it.
        git restore --source=FETCH_HEAD --worktree -- "$f"
        new_sha="$(blob_sha "$f")"
        [ -n "$new_sha" ] && write_marker "$f" "$new_sha"
        echo "Added (new upstream file): $f" >&2
      fi
    elif [ -z "${in_upstream["$f"]:-}" ]; then
      # Org has it, upstream dropped/never had it → org-owned, never touched.
      :
    else
      # In both → existing two-tier decision.
      reconcile_member "$f"
    fi
  done
}

# ---------------------------------------------------------------------------
# Fetch upstream.
# ---------------------------------------------------------------------------
echo "Fetching $CANONICAL_REPO ..."
git fetch "$CANONICAL_REPO"

# ---------------------------------------------------------------------------
# Shallow-clone guard for history-reconciled directory paths.
#
# reconcile_dir's R2/R3 discrimination relies on `git rev-list HEAD -- <path>`
# (path_in_org_history) to tell "org deleted this file" from "never existed
# here". On a shallow clone a deletion below the shallow horizon is
# unreachable from HEAD, so a genuinely org-deleted file would look new and be
# wrongly re-ADDed — silently violating R2. The membership decision cannot be
# trusted, so fail safe: refuse to reconcile adopt-on-edit DIRECTORY entries on
# a shallow clone. Blob adopt-on-edit entries (e.g. README.md), strict, and
# excluded paths do not use path_in_org_history and are unaffected.
# ---------------------------------------------------------------------------
IS_SHALLOW="$(git rev-parse --is-shallow-repository 2>/dev/null || echo false)"

# ---------------------------------------------------------------------------
# Dirty-core detection: strict paths only. Upstream-history membership
# distinguishes "stale upstream version" from genuine local modification.
# Directory entries are enumerated member-by-member so new-in-upstream files
# are not treated as false positives (spec 0059 R1–R2).
# ---------------------------------------------------------------------------
DIRTY=()
for i in "${!PATHS[@]}"; do
  path="${PATHS[$i]}"
  policy="${POLICIES[$i]}"
  [ "$policy" = "strict" ] || continue
  # An entry absent from the fetched upstream tree (a "phantom") cannot be
  # dirty against a non-existent upstream object. Skip it silently here — the
  # single warning belongs to the apply loop below.
  resolves_at_fetch_head "$path" || continue

  if [ "$(git cat-file -t "FETCH_HEAD:$path" 2>/dev/null)" = "tree" ]; then
    # Directory entry: check each upstream member individually.
    dir_dirty=0
    while IFS= read -r member; do
      [ -n "$member" ] || continue
      skip=0
      while IFS= read -r excl; do
        case "$member" in "$excl"/*|"$excl") skip=1; break ;; esac
      done < <(excluded_children_of "$path")
      [ "$skip" -eq 1 ] && continue
      if strict_blob_is_dirty "$member"; then
        dir_dirty=1
        break
      fi
    done < <(git ls-tree -r --name-only FETCH_HEAD -- "$path/" 2>/dev/null)
    [ "$dir_dirty" -eq 1 ] && DIRTY+=("$path")
  else
    # Blob entry: upstream-history membership check.
    strict_blob_is_dirty "$path" && DIRTY+=("$path")
  fi
done

if [ ${#DIRTY[@]} -gt 0 ]; then
  echo "Error: the following core-layer paths have local modifications:" >&2
  for p in "${DIRTY[@]}"; do
    echo "  $p" >&2
  done
  echo "Revert these changes before running sync, or promote them to overlay overrides." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Apply per policy. git restore --source=FETCH_HEAD --worktree does NOT stage
# or commit.
# ---------------------------------------------------------------------------
for i in "${!PATHS[@]}"; do
  path="${PATHS[$i]}"
  policy="${POLICIES[$i]}"

  case "$policy" in
    excluded)
      # Org-owned: never touched.
      continue
      ;;
    strict)
      if ! resolves_at_fetch_head "$path"; then
        echo "Warning: skipping manifest entry absent from upstream: $path" >&2
        continue
      fi
      if [ "$(git cat-file -t "FETCH_HEAD:$path" 2>/dev/null)" = "tree" ]; then
        # Directory entry: enumerate upstream members and restore each individually
        # so new-in-upstream files absent from the local index are instantiated
        # (spec 0059 R3–R4).
        while IFS= read -r member; do
          [ -n "$member" ] || continue
          skip=0
          while IFS= read -r excl; do
            case "$member" in "$excl"/*|"$excl") skip=1; break ;; esac
          done < <(excluded_children_of "$path")
          [ "$skip" -eq 1 ] && continue
          git restore --source=FETCH_HEAD --worktree -- "$member"
        done < <(git ls-tree -r --name-only FETCH_HEAD -- "$path/" 2>/dev/null)
      else
        mapfile -d '' spec < <(pathspec_for "$path")
        git restore --source=FETCH_HEAD --worktree -- "${spec[@]}"
      fi
      ;;
    adopt-on-edit)
      # Phantom guard at the top of the arm covers both sub-branches: the
      # directory branch already tolerates absence via `git ls-tree`, but the
      # blob restore below would abort under `set -e` on an unresolved entry.
      if ! resolves_at_fetch_head "$path"; then
        echo "Warning: skipping manifest entry absent from upstream: $path" >&2
        continue
      fi
      # A directory entry (a tree at FETCH_HEAD) is reconciled member-by-member
      # with add/delete history awareness; a blob entry keeps the spec-0020
      # two-tier decision below.
      if [ "$(git cat-file -t "FETCH_HEAD:$path" 2>/dev/null)" = "tree" ]; then
        if [ "$IS_SHALLOW" = "true" ]; then
          echo "Warning: refusing to reconcile adopt-on-edit directory '$path' on a shallow clone." >&2
          echo "         History-based add/delete decisions cannot be trusted (a truncated history" >&2
          echo "         can hide an old deletion and wrongly re-add a file). Run sync from a full" >&2
          echo "         (non-shallow) clone to reconcile '$path'." >&2
          continue
        fi
        reconcile_dir "$path"
        continue
      fi

      # Stateless two-tier "modified?" decision (blob entry).
      current="$(blob_sha "$path")"
      marker="$MARKERS_DIR/$path.sha"
      decision=""

      if [ -n "$current" ] && [ -f "$marker" ] && [ "$(cat "$marker")" = "$current" ]; then
        # Tier 1 — marker fast path: byte-identical to the last accepted
        # upstream version → untouched.
        decision="update"
      elif [ -n "$current" ] && upstream_has_blob "$path" "$current"; then
        # Tier 2 — history membership: matches a historical upstream blob →
        # unmodified, possibly stale, upstream copy.
        decision="update"
      else
        # Genuine org customization (or first sync with no working file) →
        # freeze, never overwrite.
        decision="freeze"
      fi

      if [ "$decision" = "update" ]; then
        mapfile -d '' spec < <(pathspec_for "$path")
        git restore --source=FETCH_HEAD --worktree -- "${spec[@]}"
        # Refresh the marker to the now-current upstream blob so subsequent
        # syncs short-circuit on Tier 1.
        new_sha="$(blob_sha "$path")"
        [ -n "$new_sha" ] && write_marker "$path" "$new_sha"
      else
        # Record a freeze marker = the adopter's OWN current blob, so a later
        # marker fast-path comparison correctly sees it as untouched (it will
        # equal the adopter's blob, never an upstream one).
        [ -n "$current" ] && write_marker "$path" "$current"
        echo "Preserved (adopter customisation): $path" >&2
      fi
      ;;
    *)
      echo "Error: unknown policy '$policy' for path '$path' in $MANIFEST" >&2
      exit 1
      ;;
  esac
done

echo "Sync complete. Review the changes with 'git diff' before committing."
