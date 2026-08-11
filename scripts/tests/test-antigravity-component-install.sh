#!/bin/bash
# test-antigravity-component-install.sh — Regression tests for the Antigravity
# component install target, its outcome verification, and the migration away
# from the superseded placement (spec 0123, issue #761).
#
# Units under test, both in scripts/lib/common.sh:
#   install_antigravity_tier_to_home()
#   migrate_antigravity_superseded_components()
# plus the two install surfaces' call sites, asserted structurally.
#
# WHY THE HELPERS ARE SOURCED AND NOT SPAWNED. `docs/cli-matrix.md` row 10
# records that the interactive setup scripts cannot run end-to-end in CI (fzf
# prompts, the `agy` binary guard, the chroma daemon) — the same constraint that
# produced spec 0116 R17's helper. Sourcing also makes the interpreter claim
# real: the helpers then execute in THIS harness's interpreter, so launching the
# suite as `/bin/bash` genuinely exercises them at 3.2.57, where the empty-array
# trap (`"${arr[@]}"` aborts under `set -u`) lives. That trap is invisible to
# `scripts/check-bash32-portability.sh`, which is a static grep, so this runtime
# run is its only detector — and both new accumulators are empty on precisely
# the success path.
#
# Contract asserted (spec 0123):
#   R1/R2 — both kinds land under the single documented customization root.
#   R3    — the installed shape is the one the assistant accepts: directory for
#           both kinds, per the 2026-08-11 probe recorded in
#           docs/runbooks/antigravity-discovery-probe.md.
#   R4    — staged-vs-placed shortfalls are reported.
#   R5    — no `Installed` line for a component absent from the target.
#   R6    — staged some, placed none: non-zero, not a quiet pass.
#   R7    — the per-component surface targets the same root as a full run.
#   R8    — a setup run leaves no framework component at the superseded
#           placement, INCLUDING tiers the run does not install.
#   R9    — content the framework did not install is untouched.
#
# HERMETIC: no HOME writes, no network, no interactive script runs, no `agy`.
# Every path lives under a temp root removed on exit.
#
# Usage:
#   bash scripts/tests/test-antigravity-component-install.sh

# -e intentionally omitted: the pass/fail counters drive the harness and several
# probes return non-zero on purpose.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
COMMON_LIB="$REPO_DIR/scripts/lib/common.sh"
SETUP="$REPO_DIR/scripts/setup-antigravity-interactive.sh"
MANAGE="$REPO_DIR/scripts/manage-antigravity-component.sh"

for f in "$COMMON_LIB" "$SETUP" "$MANAGE"; do
  [ -f "$f" ] || { echo "FATAL: missing $f" >&2; exit 2; }
done

# install_file() branches on INSTALL_MODE; pin it, as the sibling suite does.
# shellcheck disable=SC2034  # read by install_file() in the lib sourced below
INSTALL_MODE="copy"
# shellcheck source=scripts/lib/common.sh
source "$COMMON_LIB"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

echo "Interpreter under test: $BASH_VERSION"
echo ""

# --- Fixture builders --------------------------------------------------------

# write_component <marker-file-path> <name> <provenance: yes|no> <body: plain|canonical>
#
# `body=canonical` appends an INDENTED provenance block to the BODY — outside
# the frontmatter, lexically identical to a real one. That indentation is
# load-bearing and must never be "simplified" to column 0: dropping the
# frontmatter-exit rule from the reader leaves its PATTERN untouched, so a
# mutant built from an indent-requiring pattern would never match a column-0 or
# mid-line token and the mutation would pass green while the bug was live.
# Measured across the reader x token cross-product: an indented token reddens
# every whole-file variant; column-0 misses the likeliest mutant; mid-line prose
# misses two of three.
write_component() {
  local marker="$1" name="$2" prov="$3" body="$4"
  mkdir -p "$(dirname "$marker")"
  {
    echo "---"
    echo "name: $name"
    echo "description: \"Fixture component $name.\""
    if [ "$prov" = "yes" ]; then
      echo "metadata:"
      echo "  provenance:"
      echo "    canonical: \"https://github.com/crewrig/crewrig\""
      echo "    feedback: \"https://github.com/crewrig/crewrig\""
      echo "    version: \"1.0.0\""
    fi
    echo "---"
    echo ""
    echo "# $name"
    echo ""
    echo "Fixture body."
    if [ "$body" = "canonical" ]; then
      echo ""
      echo "A user's own notes, quoting what a framework block looks like:"
      echo ""
      echo "    metadata:"
      echo "      provenance:"
      echo "        canonical: \"https://github.com/some-user/their-own-thing\""
      echo ""
    fi
  } > "$marker"
}

stage_skill() { write_component "$1/skills/$2/SKILL.md" "$2" "${3:-yes}" "${4:-plain}"; }
stage_agent() { write_component "$1/agents/$2/AGENT.md" "$2" "${3:-yes}" "${4:-plain}"; }

# =====================================================================
echo "§1 both kinds land at the documented root, in the accepted shape (R1/R2/R3)"
# =====================================================================
S1="$TMP_ROOT/s1"
mkdir -p "$S1/repo/dist/library/.agents"
stage_skill "$S1/repo/dist/library/.agents" alpha-skill
stage_skill "$S1/repo/dist/library/.agents" beta-skill
stage_agent "$S1/repo/dist/library/.agents" alpha-agent

S1_OUT="$(install_antigravity_tier_to_home "$S1/repo" library \
  "$S1/cli-home/.gemini/config/skills" "$S1/cli-home/.gemini/config/agents" 2>&1)"
S1_ST=$?

[ "$S1_ST" -eq 0 ] && ok "a fully-placed tier exits 0" || bad "a fully-placed tier exited $S1_ST"
[ -f "$S1/cli-home/.gemini/config/skills/alpha-skill/SKILL.md" ] \
  && ok "skill lands at <root>/skills/<name>/SKILL.md" \
  || bad "skill missing from the documented root"
[ -f "$S1/cli-home/.gemini/config/skills/beta-skill/SKILL.md" ] \
  && ok "second skill lands under its own name" \
  || bad "second skill missing"
[ -f "$S1/cli-home/.gemini/config/agents/alpha-agent/AGENT.md" ] \
  && ok "agent lands at <root>/agents/<name>/AGENT.md (directory shape, R3)" \
  || bad "agent missing from the documented root, or not directory-shaped"
[ -e "$S1/cli-home/.gemini/antigravity-cli" ] \
  && bad "the install wrote into the application-data root" \
  || ok "nothing written under ~/.gemini/antigravity-cli/"
case "$S1_OUT" in
  *"Installed skill: library/alpha-skill"*) ok "reports the skill it placed" ;;
  *) bad "no Installed line for a skill that IS present" ;;
esac
case "$S1_OUT" in
  *"Installed agent: library/alpha-agent"*) ok "reports the agent it placed" ;;
  *) bad "no Installed line for an agent that IS present — the superseded glob bug" ;;
esac

# =====================================================================
echo "§2 a component absent from the target is not reported as installed (R5)"
# =====================================================================
# The sabotage is a staged directory carrying no marker file: `cp -R` succeeds,
# the destination exists, and yet nothing installable is there. Deterministic
# and permission-independent — a chmod-based sabotage is a no-op under root,
# which some CI images run as.
S2="$TMP_ROOT/s2"
mkdir -p "$S2/repo/dist/library/.agents/skills/hollow-skill"
stage_skill "$S2/repo/dist/library/.agents" real-skill

S2_OUT="$(install_antigravity_tier_to_home "$S2/repo" library \
  "$S2/cli-home/skills" "$S2/cli-home/agents" 2>&1)"
S2_ST=$?

case "$S2_OUT" in
  *"Installed skill: library/hollow-skill"*) bad "R5: reported a component that is not at the target" ;;
  *) ok "R5: no Installed line for the component that did not land" ;;
esac
case "$S2_OUT" in
  *"Installed skill: library/real-skill"*) ok "R5: the component that DID land is still reported" ;;
  *) bad "R5: suppressed the report of a component that is present" ;;
esac
[ "$S2_ST" -eq 0 ] && ok "a partial placement does not fail the tier (placed > 0)" \
  || bad "a partial placement exited $S2_ST"

# =====================================================================
echo "§3 staged two, placed one: the shortfall is named (R4)"
# =====================================================================
S3="$TMP_ROOT/s3"
mkdir -p "$S3/repo/dist/library/.agents/agents/hollow-agent"
stage_agent "$S3/repo/dist/library/.agents" real-agent

S3_OUT="$(install_antigravity_tier_to_home "$S3/repo" library \
  "$S3/cli-home/skills" "$S3/cli-home/agents" 2>&1)"
S3_ST=$?

case "$S3_OUT" in
  *"staged 0 skill(s) and 2 agent(s)"*) ok "R4: the staged tally counts both staged agents" ;;
  *) bad "R4: staged tally wrong or absent — got: $S3_OUT" ;;
esac
case "$S3_OUT" in
  *"placed 0 and 1 at the install target"*) ok "R4: the placed tally reports the shortfall" ;;
  *) bad "R4: placed tally wrong or absent — got: $S3_OUT" ;;
esac
case "$S3_OUT" in
  *"absent from the install target: agent library/hollow-agent"*) ok "R4: the missing component is named" ;;
  *) bad "R4: the shortfall does not name the missing component" ;;
esac
[ "$S3_ST" -eq 0 ] && ok "R4 shortfall alone does not fail the tier" \
  || bad "a reported shortfall with placed > 0 exited $S3_ST"

# =====================================================================
echo "§4 staged some, placed none: non-zero (R6)"
# =====================================================================
S4="$TMP_ROOT/s4"
mkdir -p "$S4/repo/dist/library/.agents/agents/hollow-one" \
         "$S4/repo/dist/library/.agents/agents/hollow-two"

S4_OUT="$(install_antigravity_tier_to_home "$S4/repo" library \
  "$S4/cli-home/skills" "$S4/cli-home/agents" 2>&1)"
S4_ST=$?

[ "$S4_ST" -ne 0 ] \
  && ok "R6: a tier that staged agents and placed none exits non-zero" \
  || bad "R6: staged 2 agents, placed 0, and exited 0 — the silent pass this spec exists to kill"
case "$S4_OUT" in
  *"staged 2 agent(s) and placed none"*) ok "R6: the failure states what was staged and what was placed" ;;
  *) bad "R6: no ERROR line naming the discrepancy — got: $S4_OUT" ;;
esac

# =====================================================================
echo "§5 a tier that stages nothing exits 0 (the R6 guard is vacuous, not eager)"
# =====================================================================
S5="$TMP_ROOT/s5"
mkdir -p "$S5/repo/dist/library/.agents/agents"   # exists, and is EMPTY
install_antigravity_tier_to_home "$S5/repo" library "$S5/cli-home/skills" "$S5/cli-home/agents" >/dev/null 2>&1
[ $? -eq 0 ] && ok "an existing-but-empty staged agents directory exits 0" \
  || bad "an empty staged agents directory was treated as a failure"

mkdir -p "$S5/repo2/dist/library/.agents"          # no skills/, no agents/
install_antigravity_tier_to_home "$S5/repo2" library "$S5/cli-home2/skills" "$S5/cli-home2/agents" >/dev/null 2>&1
[ $? -eq 0 ] && ok "a tier staging neither kind exits 0" \
  || bad "a tier staging nothing was treated as a failure"

install_antigravity_tier_to_home "$S5/repo3" library "$S5/cli-home3/skills" "$S5/cli-home3/agents" >/dev/null 2>&1
[ $? -eq 0 ] && ok "an unbuilt tier exits 0 early" || bad "an unbuilt tier did not exit 0"

# =====================================================================
echo "§6 the spec's migration scenario, verbatim (R8/R9)"
# =====================================================================
# "Given a machine whose ~/.gemini/antigravity-cli/skills/ holds framework
#  skills installed under the superseded placement, alongside a directory the
#  user placed there themselves / When the setup runs again / Then no
#  framework-installed skill remains, and the user's own directory is still
#  present and unmodified."
S6="$TMP_ROOT/s6"
stage_skill "$S6/artifacts/library" harness-report
stage_skill "$S6/artifacts/library" user-validate
write_component "$S6/superseded/skills/harness-report/SKILL.md" harness-report yes plain
write_component "$S6/superseded/skills/user-validate/SKILL.md"  user-validate  yes plain
# The user's own directory: not a served name, no framework provenance.
mkdir -p "$S6/superseded/skills/my-own-notes"
write_component "$S6/superseded/skills/my-own-notes/SKILL.md" my-own-notes no plain
echo "keep me" > "$S6/superseded/skills/my-own-notes/notes.txt"
USER_SUM_BEFORE="$(cat "$S6/superseded/skills/my-own-notes/SKILL.md" "$S6/superseded/skills/my-own-notes/notes.txt")"

S6_OUT="$(migrate_antigravity_superseded_components "$S6/superseded" "$S6/artifacts" all 2>&1)"
S6_ST=$?

[ "$S6_ST" -eq 0 ] && ok "the migration exits 0 on the spec scenario" || bad "the migration exited $S6_ST"
[ -e "$S6/superseded/skills/harness-report" ] \
  && bad "R8: a framework skill survived at the superseded placement" \
  || ok "R8: the framework skill is gone from the superseded placement"
[ -e "$S6/superseded/skills/user-validate" ] \
  && bad "R8: a second framework skill survived" \
  || ok "R8: the second framework skill is gone"
[ -d "$S6/superseded/skills/my-own-notes" ] \
  && ok "R9: the user's own directory is still present" \
  || bad "R9: the migration destroyed a directory the framework did not install"
[ "$(cat "$S6/superseded/skills/my-own-notes/SKILL.md" "$S6/superseded/skills/my-own-notes/notes.txt" 2>/dev/null)" = "$USER_SUM_BEFORE" ] \
  && ok "R9: the user's own directory is unmodified" \
  || bad "R9: the user's own directory was modified"

# =====================================================================
echo "§7 the predicate is a CONJUNCTION — each half discriminated separately"
# =====================================================================
# Two fixtures, each failing exactly ONE half. A fixture failing both would only
# prove the migration does not delete arbitrary junk; it would say nothing about
# the AND. Names like `user-validate`, `developer`, `tester` and `architect` are
# plausible user directory names, so a predicate degraded to either half alone
# destroys user content.
S7="$TMP_ROOT/s7"
stage_skill "$S7/artifacts/library" tester

# (i) NAME IS IN THE SET, provenance is absent from the frontmatter — and the
#     BODY carries an indented `canonical:` block. Only the frontmatter boundary
#     separates it from a real provenance line.
write_component "$S7/superseded/skills/tester/SKILL.md" tester no canonical
# (ii) PROVENANCE IS PRESENT, the name is not one the framework serves.
write_component "$S7/superseded/skills/retired-thing/SKILL.md" retired-thing yes plain

S7_OUT="$(migrate_antigravity_superseded_components "$S7/superseded" "$S7/artifacts" all 2>&1)"

[ -d "$S7/superseded/skills/tester" ] \
  && ok "(i) served name + NO frontmatter provenance survives — the body token is not provenance" \
  || bad "(i) removed a user directory whose only 'provenance' was an indented BODY token"
[ -d "$S7/superseded/skills/retired-thing" ] \
  && ok "(ii) framework provenance + unserved name survives" \
  || bad "(ii) removed a component that matches no served name"
case "$S7_OUT" in
  *"retired-thing"*) ok "(ii) the surviving residue is reported BY NAME" ;;
  *) bad "(ii) residue was left silently — got: $S7_OUT" ;;
esac
case "$S7_OUT" in
  *"tester"*) bad "(i) a directory with no framework provenance was reported as residue" ;;
  *) ok "(i) a directory failing the provenance half is not reported as residue either" ;;
esac

# =====================================================================
echo '§8 the same two fixtures in AGENT shape — flat <name>.md, removed with rm rather than rm -rf'
# =====================================================================
# Every case above is SKILL.md-shaped. The agents path at the superseded
# placement is a flat file and shares no code with the directory branch.
S8="$TMP_ROOT/s8"
stage_agent "$S8/artifacts/library" harness-curator
stage_agent "$S8/artifacts/library" tester-agent

write_component "$S8/superseded/agents/harness-curator.md" harness-curator yes plain
write_component "$S8/superseded/agents/tester-agent.md"    tester-agent    no  canonical
write_component "$S8/superseded/agents/retired-agent.md"   retired-agent   yes plain

S8_OUT="$(migrate_antigravity_superseded_components "$S8/superseded" "$S8/artifacts" all 2>&1)"

[ -e "$S8/superseded/agents/harness-curator.md" ] \
  && bad "R8 (agents): a flat framework agent survived the migration" \
  || ok "R8 (agents): the flat framework agent is removed"
[ -f "$S8/superseded/agents/tester-agent.md" ] \
  && ok "(i) agent shape: served name + body-only canonical token survives" \
  || bad "(i) agent shape: removed a flat file whose canonical token is in the BODY"
[ -f "$S8/superseded/agents/retired-agent.md" ] \
  && ok "(ii) agent shape: provenance + unserved name survives" \
  || bad "(ii) agent shape: removed an agent matching no served name"
case "$S8_OUT" in
  *"retired-agent"*) ok "(ii) agent shape: residue reported by name" ;;
  *) bad "(ii) agent shape: residue left silently" ;;
esac

# =====================================================================
echo "§9 an org-tier component is swept even when the run does not install org"
# =====================================================================
# R8 and its scenario carry no tier qualifier. An adopter who once opted into
# `org` and declines it on the re-run must have those components REMOVED, not
# orphaned. Scoping the sweep to the installed tiers would also re-introduce the
# dependency on `dist/` that this migration was rewritten to escape: the overlay
# prompt is itself gated on `dist/<tier>/.agents` existing.
S9="$TMP_ROOT/s9"
stage_skill "$S9/artifacts/library"   library-thing
stage_skill "$S9/artifacts/org"       org-thing
stage_skill "$S9/artifacts/community" community-thing
write_component "$S9/superseded/skills/org-thing/SKILL.md"       org-thing       yes plain
write_component "$S9/superseded/skills/community-thing/SKILL.md" community-thing yes plain

migrate_antigravity_superseded_components "$S9/superseded" "$S9/artifacts" all >/dev/null 2>&1
[ -e "$S9/superseded/skills/org-thing" ] \
  && bad "F7: an org-tier component was orphaned at the superseded placement" \
  || ok "F7: the org-tier component is swept although the run installs no org tier"
[ -e "$S9/superseded/skills/community-thing" ] \
  && bad "F7: a community-tier component was orphaned" \
  || ok "F7: the community-tier component is swept too"

# =====================================================================
echo "§10 the name is the frontmatter name, not the source directory name"
# =====================================================================
S10="$TMP_ROOT/s10"
# `build-components.sh` derives the installed name from the frontmatter `name`
# field, not the directory: a source at artifacts/library/skills/<dir>/ whose
# frontmatter says something else installs under the frontmatter name.
write_component "$S10/artifacts/library/skills/some-source-dir/SKILL.md" declared-name yes plain
write_component "$S10/superseded/skills/declared-name/SKILL.md" declared-name yes plain
write_component "$S10/superseded/skills/some-source-dir/SKILL.md" some-source-dir yes plain

migrate_antigravity_superseded_components "$S10/superseded" "$S10/artifacts" all >/dev/null 2>&1
[ -e "$S10/superseded/skills/declared-name" ] \
  && bad "the name set was keyed to the source DIRECTORY name, not the frontmatter name" \
  || ok "the served name comes from the frontmatter, matching what the build installs"
[ -d "$S10/superseded/skills/some-source-dir" ] \
  && ok "a directory named after the SOURCE dir is not in the served set and survives" \
  || bad "removed a component whose name is not the one the framework serves"

# =====================================================================
echo "§11 an empty name set is an ERROR, not a clean no-op"
# =====================================================================
# The failure this guards is a silent no-op migration, which looks exactly like
# a clean run. `yaml_field` reaches that state on any machine without `yq`: it
# ends `|| echo ""`, so it returns the empty string rather than failing, and a
# predicate built on it would remove nothing and exit 0.
S11="$TMP_ROOT/s11"
mkdir -p "$S11/artifacts/library/skills/unreadable"
# A source directory that IS there but whose marker carries no readable name.
printf 'no frontmatter at all\n' > "$S11/artifacts/library/skills/unreadable/SKILL.md"
write_component "$S11/superseded/skills/whatever/SKILL.md" whatever yes plain

S11_OUT="$(migrate_antigravity_superseded_components "$S11/superseded" "$S11/artifacts" all 2>&1)"
S11_ST=$?
[ "$S11_ST" -ne 0 ] \
  && ok "an empty name set derived from present sources exits non-zero" \
  || bad "an unreadable source set produced a no-op migration and exit 0 — the silent failure"
case "$S11_OUT" in
  *"refusing to run a migration"*) ok "the error says what it refused to do" ;;
  *) bad "no explanatory error — got: $S11_OUT" ;;
esac

# A fork that genuinely ships no components of a kind is NOT an error.
S11B="$TMP_ROOT/s11b"
mkdir -p "$S11B/artifacts/library/skills" "$S11B/superseded/skills"
migrate_antigravity_superseded_components "$S11B/superseded" "$S11B/artifacts" all >/dev/null 2>&1
[ $? -eq 0 ] && ok "a tier tree with no component directories at all exits 0" \
  || bad "an empty catalogue was misreported as a reader failure"

# =====================================================================
echo "§12 the narrow, per-component sweep touches only the names it installed"
# =====================================================================
S12="$TMP_ROOT/s12"
stage_skill "$S12/artifacts/library" one-skill
stage_skill "$S12/artifacts/library" other-skill
write_component "$S12/superseded/skills/one-skill/SKILL.md"   one-skill   yes plain
write_component "$S12/superseded/skills/other-skill/SKILL.md" other-skill yes plain

migrate_antigravity_superseded_components "$S12/superseded" "$S12/artifacts" skills one-skill >/dev/null 2>&1
[ -e "$S12/superseded/skills/one-skill" ] \
  && bad "the per-component sweep did not remove the name it installed" \
  || ok "the per-component sweep removes the name it installed"
[ -d "$S12/superseded/skills/other-skill" ] \
  && ok "the per-component sweep leaves every other framework component alone" \
  || bad "the per-component sweep widened to names this invocation never touched"

# =====================================================================
echo "§13 call-site ARGUMENTS in both install surfaces, asserted structurally"
# =====================================================================
# Spec 0116 delta-01 R24 records that an emptied argument once survived a whole
# suite: asserting that the deployment is *reached* is not the same as asserting
# what it is reached WITH.
grep -qE '^AGY_SKILLS_HOME="\$\{HOME\}/\.gemini/config/skills"$' "$SETUP" \
  && ok "setup: AGY_SKILLS_HOME is the documented customization root" \
  || bad "setup: AGY_SKILLS_HOME does not point at ~/.gemini/config/skills"
grep -qE '^AGY_AGENTS_HOME="\$\{HOME\}/\.gemini/config/agents"$' "$SETUP" \
  && ok "setup: AGY_AGENTS_HOME is the documented customization root" \
  || bad "setup: AGY_AGENTS_HOME does not point at ~/.gemini/config/agents"
grep -qE '^AGY_HOME="\$\{HOME\}/\.gemini/antigravity-cli"$' "$SETUP" \
  && ok "setup: AGY_HOME is untouched — context files and hooks stay put" \
  || bad "setup: AGY_HOME moved; spec 0123 excludes the context files and hooks"

if grep -q 'install_antigravity_tier_to_home "\$REPO_DIR" library "\$AGY_SKILLS_HOME" "\$AGY_AGENTS_HOME"' "$SETUP"; then
  ok "setup: the library call passes repo, tier, and BOTH destination roots"
else
  bad "setup: the library install call-site arguments are wrong or emptied"
fi
if grep -q 'install_antigravity_tier_to_home "\$REPO_DIR" "\$overlay_tier"' "$SETUP"; then
  ok "setup: the overlay call passes the overlay tier"
else
  bad "setup: the overlay install call-site arguments are wrong or emptied"
fi
if grep -q 'migrate_antigravity_superseded_components' "$SETUP" \
   && grep -q '"\$AGY_SUPERSEDED_ROOT" "\$REPO_DIR/artifacts" all' "$SETUP"; then
  ok "setup: the migration is called with the superseded root, the artifacts root, and both kinds"
else
  bad "setup: the migration call-site arguments are wrong or emptied"
fi

# Both install calls must propagate a non-zero status rather than swallow it,
# or R6 is unobservable from the run's own exit code.
if [ "$(grep -c 'install_antigravity_tier_to_home' "$SETUP")" -eq \
     "$(grep -c 'install_antigravity_tier_to_home.*|| exit 1' "$SETUP")" ]; then
  ok "setup: every install call propagates a non-zero status"
else
  # The overlay call is wrapped across two lines; check the continuation.
  if grep -A1 'install_antigravity_tier_to_home "\$REPO_DIR" "\$overlay_tier"' "$SETUP" | grep -q '|| exit 1'; then
    ok "setup: every install call propagates a non-zero status (overlay call wraps)"
  else
    bad "setup: an install call swallows a non-zero status, hiding R6"
  fi
fi

# The migration must NOT sit inside the overlay opt-in branch: it is
# unconditional on which tiers this run installs.
MIGRATE_LINE="$(grep -n 'migrate_antigravity_superseded_components' "$SETUP" | head -1 | cut -d: -f1)"
OVERLAY_DONE="$(awk '/^for overlay_tier in/{f=1} f && /^done$/{print NR; exit}' "$SETUP")"
if [ -n "$MIGRATE_LINE" ] && [ -n "$OVERLAY_DONE" ] && [ "$MIGRATE_LINE" -gt "$OVERLAY_DONE" ]; then
  ok "setup: the migration runs after the overlay loop, not inside its opt-in branch"
else
  bad "setup: the migration is gated on the overlay opt-in (line $MIGRATE_LINE vs done at $OVERLAY_DONE)"
fi

# R7 — the per-component surface targets the same root.
grep -qE '^AGY_CUSTOMIZATION_ROOT="\$\{HOME\}/\.gemini/config"$' "$MANAGE" \
  && ok "manage: a customization root separate from ANTIGRAVITY_HOME exists" \
  || bad "manage: no separate customization root constant"
grep -q 'DEST="\$AGY_CUSTOMIZATION_ROOT/skills"' "$MANAGE" \
  && ok "R7: manage installs skills to the same root the setup run uses" \
  || bad "R7: manage does not target the documented customization root"

# The per-component cleanup is gated on `${#PLACED_NAMES[@]} -gt 0`, so an array
# that is never fed makes the whole branch a silent no-op that no placement
# assertion can see — the same emptied-argument shape spec 0116 delta-01 R24
# records. Both ends of the channel are asserted: the producer inside
# place_component, and the arguments the consumer is called with. `-F` because
# `[@]` would otherwise open a bracket expression.
grep -qF 'PLACED_NAMES+=("$item_name")' "$MANAGE" \
  && ok "manage: place_component feeds the name it just placed into PLACED_NAMES" \
  || bad "manage: PLACED_NAMES is never fed — the per-component cleanup is a no-op branch"
grep -qF '"$ANTIGRAVITY_HOME" "$REPO_DIR/artifacts" skills "${PLACED_NAMES[@]}"' "$MANAGE" \
  && ok "manage: the narrow migration is called with the superseded root, the artifacts root, the kind, and the names" \
  || bad "manage: the per-component migration call-site arguments are wrong or emptied"

# The two kinds spec 0123 explicitly EXCLUDES must not have moved. A one-line
# edit to ANTIGRAVITY_HOME would have relocated both silently.
grep -q 'DEST="\$ANTIGRAVITY_HOME/rules"' "$MANAGE" \
  && ok "policies still resolve under ANTIGRAVITY_HOME (out of scope for 0123)" \
  || bad "policies were relocated; spec 0123 excludes them for want of a probe"
grep -q 'config_file="\$ANTIGRAVITY_HOME/settings.json"' "$MANAGE" \
  && ok "mcp-servers still merge into ANTIGRAVITY_HOME/settings.json (out of scope)" \
  || bad "the MCP settings target was relocated; spec 0123 excludes it"

# =====================================================================
echo ""
echo "======================================"
echo "  passed: $pass    failed: $fail"
echo "======================================"
[ "$fail" -eq 0 ] || exit 1
exit 0
