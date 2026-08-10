#!/bin/bash
# component-resolve.sh — Overlay-tier component resolution shared by the four
# per-component install commands and by the build's collision pre-pass
# (spec 0119).
#
# ── What this library exists to remove ───────────────────────────────────────
# Before it, each `scripts/manage-*-component.sh` resolved a component by taking
# the FIRST existing source root and stopping. Which tiers were populated
# therefore decided which tiers were reachable: a component in `org` became
# invisible the moment `community` existed, and the resulting message blamed a
# missing build rather than the tier the operator asked for. Every function here
# searches every served root, collects every match, and reports a genuine miss
# as a miss — naming the tiers examined, never a cause that was not established.
#
# ── The exit-status contract, and why it is load-bearing ─────────────────────
# `resolve_component_in_roots`, `enumerate_components_in_roots`,
# `report_unresolved`, `report_collision` and `installed_targets` return **0 in
# every non-fatal case** and carry their answer on stdout. Absence is the empty
# string, never a non-zero status.
#
# That is not a stylistic preference. Every caller runs `set -e`
# (manage-claude-component.sh, manage-copilot-component.sh,
# manage-workspace-component.sh, manage-antigravity-component.sh;
# build-components.sh adds `-uo pipefail`). Under `set -e`, `x=$(f)` where `f`
# returns 1 aborts the script before the next line AND discards f's stdout into
# the unread variable — byte-for-byte the silent failure this ticket exists to
# remove. A resolver that signalled "not found" by returning 1 would reintroduce
# it at every call site.
#
# `ensure_overlay_tiers_fresh` is the one exception, and it is deliberate: it is
# the only function here that can legitimately fail, so it RETURNS THE BUILD'S
# STATUS and its caller tests that status explicitly. See its own header.
#
# ── Bash 3.2.57 is the floor ─────────────────────────────────────────────────
# `/bin/bash` on stock macOS is 3.2.57 and `ci/bash32-forbidden.txt` is enforced
# in CI. No `declare -A`, no `mapfile`. Two 3.2-specific traps are worked around
# in place:
#   * 3.2 does not make an earlier name visible to a later initialiser in the
#     SAME `local`, so `local a="$1" b="$WORK/$a"` aborts with `a: unbound
#     variable`. Every declaration below is split.
#   * `${arr[@]}` on an empty array trips `set -u`, so array expansions use the
#     `${a[@]+"${a[@]}"}` guard (the form already used at
#     scripts/check-test-wiring.sh).
#
# ── Precondition ─────────────────────────────────────────────────────────────
# The sourcing script must have defined REPO_DIR. Every path this library builds
# hangs off it, and `${REPO_DIR:?}` fails loudly rather than composing a path
# rooted at `/`.

# The overlay tiers every per-component command serves, in resolution order.
# `core` is deliberately absent: its landing zone is the committed project tree
# and its delivery is the build, not an install (spec 0119 R6).
COMPONENT_OVERLAY_TIERS="library community org"

# --- Internal helpers --------------------------------------------------------

# _component_declared_name <file> <fallback> — the `name:` declared in <file>'s
# leading YAML frontmatter, or <fallback> when it declares none.
#
# The build keys every compiled output path on the frontmatter `name`, not on
# the file or directory name, so a collision guard that keyed on the path would
# guard something the build does not produce.
_component_declared_name() {
  local file="$1"
  local fallback="$2"
  local value
  value=""
  if [ -f "$file" ]; then
    value=$(awk 'NR == 1 && /^---[ \t]*$/ { fm = 1; next }
                 fm && /^---[ \t]*$/ { exit }
                 fm && /^name:[ \t]*/ { sub(/^name:[ \t]*/, ""); print; exit }' \
            "$file" 2>/dev/null)
  fi
  # Strip surrounding quotes with parameter expansion rather than inside the awk
  # program: embedding a literal single quote in a single-quoted awk script is a
  # quoting hazard with no portable answer across awk implementations.
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  value="$(printf '%s' "$value" | tr -d '\r' | sed -e 's/[[:space:]]*$//')"
  [ -n "$value" ] || value="$fallback"
  printf '%s' "$value"
  return 0
}

# _component_emit_target <tier-class> <install-target> <tier> <kind>
_component_emit_target() {
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4"
  return 0
}

# _component_target_display_name <install-target> — the installed name a target
# key carries, for the human-readable half of a collision report.
_component_target_display_name() {
  local target="$1"
  local base
  base="$(basename "$target")"
  case "$base" in
    mcpServers.*)      base="${base#mcpServers.}" ;;
    settings.themes.*) base="${base#settings.themes.}" ;;
  esac
  base="${base%.md}"
  base="${base%.toml}"
  base="${base%.json}"
  printf '%s' "$base"
  return 0
}

# --- Root construction -------------------------------------------------------

# component_set_staging_roots <staging-subpath> — fill COMPONENT_ROOTS[] with
# the compiled staging root of every served overlay tier, in tier order.
# <staging-subpath> is the CLI root plus the type directory exactly as the build
# writes it, e.g. `.claude/skills`.
#
# All three roots are always produced, present or not. The whole list goes to
# resolve_component_in_roots (which tolerates an absent root, R8) and to
# report_unresolved (which must name every tier examined, R17) — so an absent
# tier is still reported as examined rather than silently dropped.
#
# An array rather than lines on stdout because the caller must hold the roots
# across a call to a driver that itself reads lines into COMPONENT_LINES[].
COMPONENT_ROOTS=()
component_set_staging_roots() {
  local subpath="$1"
  local tier
  COMPONENT_ROOTS=()
  for tier in $COMPONENT_OVERLAY_TIERS; do
    COMPONENT_ROOTS[${#COMPONENT_ROOTS[@]}]="${REPO_DIR:?component-resolve.sh requires REPO_DIR}/dist/$tier/$subpath"
  done
  return 0
}

# component_set_artifact_roots <type> — fill COMPONENT_ROOTS[] with the
# authoring-source root of every served overlay tier, for the types no CLI
# compiles (policies, hooks, themes, mcp-servers, and Gemini commands).
component_set_artifact_roots() {
  local type="$1"
  local tier
  COMPONENT_ROOTS=()
  for tier in $COMPONENT_OVERLAY_TIERS; do
    COMPONENT_ROOTS[${#COMPONENT_ROOTS[@]}]="${REPO_DIR:?component-resolve.sh requires REPO_DIR}/artifacts/$tier/$type"
  done
  return 0
}

# component_read_lines <text> — fill COMPONENT_LINES[] with the non-empty lines
# of <text>. Bash 3.2 has no `mapfile`, and a `printf | while read` pipeline
# would populate the array in a subshell that dies at the pipe.
COMPONENT_LINES=()
component_read_lines() {
  local text="$1"
  local line
  COMPONENT_LINES=()
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    COMPONENT_LINES[${#COMPONENT_LINES[@]}]="$line"
  done < <(printf '%s\n' "$text")
  return 0
}

# --- Resolution --------------------------------------------------------------

# resolve_component_in_roots <name> <root>... — every existing candidate for
# <name>, one path per line, in root order. Returns 0 always; absence is the
# empty string.
#
# Within one root the first existing candidate wins, which reproduces the
# `for candidate in "$SRC_DIR/$NAME" "$SRC_DIR/$NAME.md"` loop each command used
# before and keeps a single root from presenting itself as two sources. ACROSS
# roots every match is collected: that is what gives R15's refusal for free, and
# what stops a populated tier hiding a later one (R7).
#
# An absent root is skipped rather than ending the search (R8), and no root ever
# ends the loop early (R7).
resolve_component_in_roots() {
  local name="$1"
  shift
  local root
  local candidate
  for root in "$@"; do
    [ -d "$root" ] || continue
    for candidate in "$root/$name" "$root/$name.md" "$root/$name.toml" "$root/$name.json"; do
      if [ -e "$candidate" ]; then
        printf '%s\n' "$candidate"
        break
      fi
    done
  done
  return 0
}

# enumerate_components_in_roots <root>... — `<basename><TAB><path>` for every
# member of every present root, skipping `.gitkeep`. No deduplication: grouping
# repeated basenames is component_install_all's job.
#
# The glob is `"$root"/*` and NOT `"$root"/*/`, which matters more than it
# looks. A trailing-slash glob yields `…/foo/`, and BSD `cp -rf src/foo/ dest/`
# copies the CONTENTS of foo into dest instead of foo itself — so an unnamed
# install of two skills produced a single flattened `dest/SKILL.md`, printed
# `Copied: alpha` and `Copied: beta`, and exited 0. Emitting the path without
# the trailing slash is what keeps every component installed under its own name.
enumerate_components_in_roots() {
  local root
  local entry
  local base
  for root in "$@"; do
    [ -d "$root" ] || continue
    for entry in "$root"/*; do
      [ -e "$entry" ] || continue
      base="$(basename "$entry")"
      [ "$base" = ".gitkeep" ] && continue
      printf '%s\t%s\n' "$base" "$entry"
    done
  done
  return 0
}

# --- Reporting ---------------------------------------------------------------

# report_unresolved <name> <type> <root>... — the R16/R17/R18 miss report, on
# stderr. The caller owns the `exit`.
#
# R17 forbids naming a cause that was not established and R18 forbids blaming a
# missing build step unless no served root existed at all — so the build hint is
# emitted only in that one case, and every root is listed with whether it was
# there. Before this, the Copilot command's named miss printed nothing at all
# and its exit status was a trailing `[ -d ]` test rather than a decision.
report_unresolved() {
  local name="$1"
  local type="$2"
  shift 2
  local root
  local present
  present=0
  {
    printf "Error: no component named '%s' of type '%s' resolved in any served tier.\n" "$name" "$type"
    printf 'Locations examined, in resolution order:\n'
    for root in "$@"; do
      if [ -d "$root" ]; then
        printf '  - %s (present)\n' "$root"
        present=$((present + 1))
      else
        printf '  - %s (absent)\n' "$root"
      fi
    done
    if [ "$present" -eq 0 ]; then
      printf 'No served tier of this type was available at all. Populate one, or run:\n'
      printf '  bash scripts/build-components.sh\n'
    fi
  } >&2
  return 0
}

# report_collision <name> <source>... — the formatter shared by the build's
# refusal (R13) and an install command's (R15), on stderr.
#
# R15's closing sentence — "This requirement SHALL NOT be read to establish any
# order among the colliding sources" — is why the sources are printed as an
# unordered set and why nothing here picks one.
report_collision() {
  local name="$1"
  shift
  local source
  {
    printf "Refusing '%s': one installed name is claimed by more than one component.\n" "$name"
    printf 'Every source presenting it, in no significant order:\n'
    for source in "$@"; do
      printf '  - %s\n' "$source"
    done
  } >&2
  return 0
}

# --- Installed-target derivation (the build's R13 pre-pass) ------------------

# installed_targets <artifacts-dir> — one
# `<tier-class><TAB><install-target><TAB><tier><TAB><kind>` record per target
# every component of every tier would be installed to.
#
# THE KEY IS (tier-class, install-target), NOT the name. R12 makes two
# components collide only where they would be installed under the same name
# into the SAME landing zone: `architect` legitimately exists as both a skill
# and an agent, and `core` legitimately shares names with an overlay tier
# because `core` lands in the committed project tree while every overlay tier
# lands in the user home. Measured against this repository: 172 installed
# targets, ZERO duplicates keyed on (tier-class, install-target) and NINE keyed
# on name alone.
#
# The type partition is pinned on two orthogonal axes:
#   * Axis A — compiled by the build: skills, commands, agents. Keys are the
#     build's own output paths, so the guard covers exactly what it produces.
#     Note that three of four CLIs compile a COMMAND into the SKILLS namespace
#     (.claude/skills/<n>, .github/skills/<n>, .agents/skills/<n>), which is why
#     a command and a skill sharing one name is a collision.
#   * Axis B — read from artifacts/ by a manage command: policies, hooks,
#     themes, mcp-servers. A guard scoped to build output could not reach these
#     at all, and R15 would be a permanent dead end for them.
# `commands` sits in both; it is keyed from axis A only, so a library-versus-org
# command-name collision is reported once. The stated consequence:
# `~/.gemini/commands/<n>.md` — what the Gemini command installs today — is not
# guarded, because it is not a target the build produces.
installed_targets() {
  local artifacts_dir="$1"
  local tier_path
  local tier
  local tier_class
  local entry
  local name
  local base

  for tier_path in "$artifacts_dir"/*/; do
    [ -d "$tier_path" ] || continue
    tier_path="${tier_path%/}"
    tier="$(basename "$tier_path")"
    if [ "$tier" = "core" ]; then tier_class="core"; else tier_class="overlay"; fi

    # --- Axis A: skills ---
    for entry in "$tier_path"/skills/*; do
      [ -d "$entry" ] || continue
      [ -f "$entry/SKILL.md" ] || continue
      name="$(_component_declared_name "$entry/SKILL.md" "$(basename "$entry")")"
      _component_emit_target "$tier_class" ".claude/skills/$name"  "$tier" "skills"
      _component_emit_target "$tier_class" ".gemini/skills/$name"  "$tier" "skills"
      _component_emit_target "$tier_class" ".github/skills/$name"  "$tier" "skills"
      _component_emit_target "$tier_class" ".agents/skills/$name"  "$tier" "skills"
    done

    # --- Axis A: commands (three CLIs compile them into the skills namespace) ---
    for entry in "$tier_path"/commands/*.md; do
      [ -f "$entry" ] || continue
      base="$(basename "$entry" .md)"
      name="$(_component_declared_name "$entry" "$base")"
      _component_emit_target "$tier_class" ".claude/skills/$name"        "$tier" "commands"
      _component_emit_target "$tier_class" ".gemini/commands/$name.toml" "$tier" "commands"
      _component_emit_target "$tier_class" ".github/skills/$name"        "$tier" "commands"
      _component_emit_target "$tier_class" ".agents/skills/$name"        "$tier" "commands"
    done

    # --- Axis A: agents ---
    for entry in "$tier_path"/agents/*; do
      [ -d "$entry" ] || continue
      [ -f "$entry/AGENT.md" ] || continue
      name="$(_component_declared_name "$entry/AGENT.md" "$(basename "$entry")")"
      _component_emit_target "$tier_class" ".claude/agents/$name"    "$tier" "agents"
      _component_emit_target "$tier_class" ".gemini/agents/$name.md" "$tier" "agents"
      _component_emit_target "$tier_class" ".github/agents/$name.md" "$tier" "agents"
      _component_emit_target "$tier_class" ".agents/agents/$name"    "$tier" "agents"
    done

    # --- Axis B: policies (Claude and Antigravity rules, Gemini policies) ---
    for entry in "$tier_path"/policies/*; do
      [ -e "$entry" ] || continue
      base="$(basename "$entry")"
      [ "$base" = ".gitkeep" ] && continue
      _component_emit_target "$tier_class" "claude:rules/$base"      "$tier" "policies"
      _component_emit_target "$tier_class" "gemini:policies/$base"   "$tier" "policies"
      _component_emit_target "$tier_class" "antigravity:rules/$base" "$tier" "policies"
    done

    # --- Axis B: hooks ---
    for entry in "$tier_path"/hooks/*; do
      [ -e "$entry" ] || continue
      base="$(basename "$entry")"
      [ "$base" = ".gitkeep" ] && continue
      _component_emit_target "$tier_class" "gemini:hooks/$base" "$tier" "hooks"
    done

    # --- Axis B: themes ---
    for entry in "$tier_path"/themes/*.json; do
      [ -f "$entry" ] || continue
      base="$(basename "$entry" .json)"
      _component_emit_target "$tier_class" "gemini:settings.themes.$base" "$tier" "themes"
    done

    # --- Axis B: mcp-servers ---
    for entry in "$tier_path"/mcp-servers/*.json; do
      [ -f "$entry" ] || continue
      base="$(basename "$entry" .json)"
      _component_emit_target "$tier_class" "claude:mcpServers.$base"      "$tier" "mcp-servers"
      _component_emit_target "$tier_class" "gemini:mcpServers.$base"      "$tier" "mcp-servers"
      _component_emit_target "$tier_class" "copilot:mcpServers.$base"     "$tier" "mcp-servers"
      _component_emit_target "$tier_class" "antigravity:mcpServers.$base" "$tier" "mcp-servers"
    done
  done
  return 0
}

# report_installed_name_collisions <artifacts-dir> — the build's R13 pre-pass.
# Returns 0 when no two components claim one installed target, 1 otherwise,
# having reported every offending target through report_collision.
#
# `sort | uniq -d` replaces a seen-map because Bash 3.2 has no associative
# arrays — the same substitution scripts/check-core-paths.sh and
# scripts/check-test-wiring.sh already make.
report_installed_name_collisions() {
  local artifacts_dir="$1"
  local targets
  local duplicates
  local status
  local dup_class
  local dup_target
  local rec_class
  local rec_target
  local rec_tier
  local rec_kind
  local sources

  targets="$(installed_targets "$artifacts_dir")"
  [ -n "$targets" ] || return 0

  duplicates="$(printf '%s\n' "$targets" | cut -f1,2 | sort | uniq -d)"
  [ -n "$duplicates" ] || return 0

  status=0
  while IFS=$'\t' read -r dup_class dup_target; do
    [ -n "$dup_target" ] || continue
    sources=()
    while IFS=$'\t' read -r rec_class rec_target rec_tier rec_kind; do
      [ "$rec_class" = "$dup_class" ] || continue
      [ "$rec_target" = "$dup_target" ] || continue
      sources[${#sources[@]}]="tier '$rec_tier' declares a $rec_kind component installing to $rec_target"
    done < <(printf '%s\n' "$targets")
    report_collision "$(_component_target_display_name "$dup_target")" \
      ${sources[@]+"${sources[@]}"}
    status=1
  done < <(printf '%s\n' "$duplicates")

  return "$status"
}

# --- Staging freshness -------------------------------------------------------

# ensure_overlay_tiers_fresh <cli> <tier>... — prune then rebuild the served
# overlay staging roots of <cli>. RETURNS THE BUILD'S STATUS.
#
# It prunes as well as rebuilds because the build adds and never removes
# (`grep -n 'rm -rf' build-components.sh` finds one hit, the check-mode staging
# root). A component renamed or deleted under artifacts/ otherwise leaves its
# compiled copy behind, so an unnamed request installs a component no served
# tier holds — and if that residue shares a name with a live component, R15
# refuses that name permanently against a "source" that is only build residue,
# which no report can distinguish and no write-only rebuild can clear.
#
# It touches nothing outside `dist/<tier>/<cli-root>`. `output_root_for_tier`
# routes `core` to $REPO_DIR and every other tier to $REPO_DIR/dist/$tier, and
# `.gitignore` carries `dist/` — so an install command triggered on a branch
# carrying an unbuilt `core` source edit leaves the committed tree exactly as it
# found it, which a full-tier rebuild would not.
#
# EXIT CONTRACT. This is the one function here that can legitimately fail, so it
# is the one that returns a status instead of an answer. A non-zero is fatal and
# reported AS ITSELF, with the build's own output: after the R13 pre-pass the
# build carries a refusal whose whole purpose is to exit non-zero on a
# collision, and emitting "not resolved, examined 3 roots" when the established
# cause is a refused build would name a cause that was not established (R17).
ensure_overlay_tiers_fresh() {
  local cli="$1"
  shift
  local cli_root
  case "$cli" in
    claude)      cli_root=".claude" ;;
    gemini)      cli_root=".gemini" ;;
    copilot)     cli_root=".github" ;;
    antigravity) cli_root=".agents" ;;
    *)
      printf "Internal error: no staging root is defined for CLI '%s'.\n" "$cli" >&2
      return 2
      ;;
  esac

  local repo
  repo="${REPO_DIR:?component-resolve.sh requires REPO_DIR}"
  local tier
  local build_args
  build_args=()
  for tier in "$@"; do
    if [ "$tier" = "core" ]; then
      printf "Internal error: the 'core' tier is never pruned by an install command.\n" >&2
      return 2
    fi
    # Every interpolated component carries its own :? guard. Guarding only the
    # base would still let an empty tier or root widen the removal by a whole
    # directory level.
    rm -rf "${repo:?}/dist/${tier:?}/${cli_root:?}"
    build_args[${#build_args[@]}]="--tier"
    build_args[${#build_args[@]}]="$tier"
  done

  local log
  log="$(mktemp -t crewrig-overlay-rebuild.XXXXXX)"
  local status
  if bash "${repo}/scripts/build-components.sh" --target "$cli" \
       ${build_args[@]+"${build_args[@]}"} >"$log" 2>&1; then
    status=0
  else
    status=$?
    printf 'The rebuild of the served overlay tiers was refused (exit %s).\n' "$status" >&2
    printf 'Its own report follows verbatim; nothing has been installed.\n' >&2
    cat "$log" >&2
  fi
  rm -f "$log"
  return "$status"
}

# --- Install drivers ---------------------------------------------------------

# component_install_named <install-fn> <name> <type> <refresh-cli|""> <root>...
#   Resolve one named component over every served root and install it.
#   Returns 0 on success, non-zero on a miss, an ambiguity, or a refused
#   rebuild — the report is already on stderr in each case.
#
# The rebuild fires ONLY on a miss, never up front. That is deliberate: spec
# 0119 → Out of scope declines to require any command to regenerate or prune a
# compiled tree it finds already carrying a collision, and an unconditional
# prune on the named path would erase exactly the state R15 exists to refuse.
# It also costs nothing on a hit, which is the common case.
component_install_named() {
  local install_fn="$1"
  local name="$2"
  local type="$3"
  local refresh_cli="$4"
  shift 4
  local matches
  matches="$(resolve_component_in_roots "$name" "$@")"

  if [ -z "$matches" ] && [ -n "$refresh_cli" ]; then
    # A compiled tree is stale by default and nothing in the repository can
    # detect that — `ensure_tier_built` returns 0 the moment the staging
    # directory exists, so it sees absence and never staleness. A miss is
    # therefore not final: rebuild the served overlay tiers once, then search
    # again.
    ensure_overlay_tiers_fresh "$refresh_cli" $COMPONENT_OVERLAY_TIERS || return $?
    matches="$(resolve_component_in_roots "$name" "$@")"
  fi

  component_read_lines "$matches"
  if [ "${#COMPONENT_LINES[@]}" -eq 0 ]; then
    report_unresolved "$name" "$type" "$@"
    return 1
  fi
  if [ "${#COMPONENT_LINES[@]}" -gt 1 ]; then
    report_collision "$name" ${COMPONENT_LINES[@]+"${COMPONENT_LINES[@]}"}
    return 1
  fi
  "$install_fn" "${COMPONENT_LINES[0]}"
}

# component_install_all <install-fn> <refresh-cli|""> <root>...
#   Install every component of every served root, grouped by installed name.
#   A name with exactly one source installs; a name with more installs NOTHING
#   under that name, is reported, and sets a deferred non-zero return. Every
#   non-colliding sibling still installs.
#
# That per-NAME refusal, rather than a per-REQUEST one, is the only reading that
# satisfies R9 and R15 at once: R15's waiver is "Notwithstanding requirement 7",
# it names no other requirement, and its object is "any component under THAT
# name" — while R9 obliges the unnamed request to install every component of the
# type from every served tier.
#
# Here the rebuild fires FIRST, before enumeration, and unconditionally: a stale
# or residual tree mis-enumerates silently, which R9 forbids, and there is no
# miss to trigger on.
component_install_all() {
  local install_fn="$1"
  local refresh_cli="$2"
  shift 2
  local status
  status=0

  if [ -n "$refresh_cli" ]; then
    ensure_overlay_tiers_fresh "$refresh_cli" $COMPONENT_OVERLAY_TIERS || return $?
  fi

  local listing
  listing="$(enumerate_components_in_roots "$@")"
  [ -n "$listing" ] || return 0

  local names
  names="$(printf '%s\n' "$listing" | cut -f1 | sort -u)"
  local entry_name
  while IFS= read -r entry_name; do
    [ -n "$entry_name" ] || continue
    component_read_lines "$(printf '%s\n' "$listing" \
      | awk -F'\t' -v want="$entry_name" '$1 == want { print $2 }')"
    if [ "${#COMPONENT_LINES[@]}" -gt 1 ]; then
      report_collision "$entry_name" ${COMPONENT_LINES[@]+"${COMPONENT_LINES[@]}"}
      status=1
      continue
    fi
    if ! "$install_fn" "${COMPONENT_LINES[0]}"; then
      status=1
    fi
  done < <(printf '%s\n' "$names")

  return "$status"
}
