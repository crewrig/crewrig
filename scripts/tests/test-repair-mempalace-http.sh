#!/usr/bin/env bash
# test-repair-mempalace-http.sh — Regression tests for the MemPalace switch
# residue repair command (spec 0165).
#
# The command under test is scripts/repair-mempalace-http.sh. It is a pure
# file-level repair: it reads and rewrites assistant MCP configuration files
# under $HOME and never touches supervisor state, ports, or the daemon, so the
# isolation contract is the single $HOME axis: mcp_assistant_config_path
# (common.sh) derives all four config paths from $HOME alone, and nothing here
# invokes a real CLI. That single axis is sufficient only for as long as that
# derivation holds: Claude Code itself resolves its user config through
# CLAUDE_CONFIG_DIR, so if common.sh ever learns to honour that variable, this
# suite must redirect it too or it silently escapes isolation and rewrites the
# operator's real ~/.claude.json. The sibling suite test-mcp-daemon.sh already
# exports CLAUDE_CONFIG_DIR deliberately — it owes coverage on the Claude arm
# (the switch transaction, the Claude reader) that this pure file-level suite
# never will — so the two suites differ on purpose, not by omission.
# The "present" gate is `command -v`, so each CLI is stubbed on PATH exactly as
# test-mcp-daemon.sh section 11 does.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

PASS=0
FAIL=0
SKIP=0
ok()   { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
nope() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }
# skipped <first-line> — a case whose fixture cannot be built on this platform.
# Counted, because the summary is what a reader compares between heads: an
# uncounted skip makes a run that exercised less look numerically identical to
# one that exercised more. Continuation lines are plain echoes; only the first
# is counted. A skip is not a failure and never changes the exit status.
skipped() { SKIP=$((SKIP + 1)); printf '  skip %s\n' "$1"; }

REAL_HOME="${HOME}"
TEST_HOME="$(mktemp -d)"
# $HOME is the only isolation axis and this suite rewrites MCP configuration
# under it, so an isolated HOME that failed to materialise must abort BEFORE
# the export. There is no `set -e` here: a failed mktemp leaves TEST_HOME
# empty, and the suite would then rewrite /.claude.json and
# /.gemini/settings.json — outside any sandbox.
if [ -z "${TEST_HOME}" ] || [ ! -d "${TEST_HOME}" ] || [ "${TEST_HOME}" = "${REAL_HOME}" ]; then
  echo "REFUSING TO RUN: the isolated HOME did not materialise (got '${TEST_HOME}')." >&2
  exit 1
fi
export HOME="${TEST_HOME}"

cleanup() { rm -rf "${TEST_HOME}"; }
trap cleanup EXIT

# shellcheck source=../lib/common.sh
. "${REPO_DIR}/scripts/lib/common.sh"
CREWRIG_REPO_DIR="${REPO_DIR}"

REPAIR="${REPO_DIR}/scripts/repair-mempalace-http.sh"

# The transaction's "present" gate is `command -v`, so stub each tool on PATH
# (test-mcp-daemon.sh section 11 pattern). The stubs must exist for the repair
# command to treat the four assistants as present without a real install.
mkdir -p "${TEST_HOME}/bin"
for c in claude gemini copilot agy; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "${TEST_HOME}/bin/${c}"
  chmod +x "${TEST_HOME}/bin/${c}"
done
export ORIG_PATH="${PATH}"
export PATH="${TEST_HOME}/bin:${PATH}"

# mode_of <path> — the file's mode in octal, GNU first (test-mcp-daemon.sh
# token-file precedent: `stat -f` on GNU means "filesystem" and SUCCEEDS with
# unusable output, so probing BSD-style first silently yields garbage).
#
# Deliberately WITHOUT `-L`, unlike file_mode in the command under test: this
# is an assertion helper, and every caller asserts on the restored config path,
# which the restore is required to leave as a regular file. Dereferencing here
# would make a restore that wrongly left a symlink in place report its target's
# mode and pass. file_mode needs `-L` for the opposite reason — it reads a
# BACKUP, which `cp -P` can legitimately have made a symlink.
mode_of() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null
}

# residue_config — a mempalace registration that matches neither the http nor
# the stdio shape: the residue the repair command exists to detect (R2).
residue_config() {
  printf '%s\n' '{"mcpServers":{"mempalace":{"nonsense":true}}}'
}

echo "test-repair-mempalace-http.sh — isolated in ${TEST_HOME}"
echo ""

# --- R4. Report-only run -----------------------------------------------------
echo "R4 — report-only run:"
mkdir -p "${TEST_HOME}/.gemini"
residue_config > "${TEST_HOME}/.gemini/settings.json"
out="$(bash "${REPAIR}" 2>&1)"; rc=$?
[ "${rc}" -ne 0 ] \
  && ok "a report-only run exits non-zero when residue exists" \
  || nope "report-only run exited ${rc} with residue present"
case "${out}" in
  *"gemini"*) ok "the affected assistant is named" ;;
  *) nope "the affected assistant is not named: ${out}" ;;
esac
case "${out}" in
  *"${TEST_HOME}/.gemini/settings.json"*) ok "the configuration path is named" ;;
  *) nope "the configuration path is not named: ${out}" ;;
esac
case "${out}" in
  *"backup:  no"*) ok "the report names the backup state (none present)" ;;
  *) nope "no backup-state line: ${out}" ;;
esac
case "${out}" in
  *"--reset-none"*) ok "the available repair action is named" ;;
  *) nope "no repair action named: ${out}" ;;
esac

# A parseable backup flips the report: backup yes, and --restore-backup joins
# the available actions.
printf '%s\n' '{"mcpServers":{"mempalace":{"command":"bash","args":["x"]}}}' \
  > "${TEST_HOME}/.gemini/settings.json.bak.20260101-000000"
out="$(bash "${REPAIR}" 2>&1)"; rc=$?
case "${out}" in
  *"backup:  yes (most recent parses as JSON)"*) ok "the report names a usable backup" ;;
  *) nope "no usable-backup line: ${out}" ;;
esac
case "${out}" in
  *"--restore-backup"*) ok "--restore-backup joins the available actions" ;;
  *) nope "--restore-backup not named: ${out}" ;;
esac
rm -f "${TEST_HOME}/.gemini/settings.json.bak."*

# A present assistant with no config file has no mempalace registration —
# recognisably `none`, not residue (spec 0165 R2, absent→none mapping).
rm -f "${TEST_HOME}/.gemini/settings.json"
bash "${REPAIR}" >/dev/null 2>&1; rc=$?
[ "${rc}" -eq 0 ] \
  && ok "a present assistant with no config file is none, not residue (exit 0)" \
  || nope "a config-less present assistant was treated as residue (exit ${rc})"

# --- R5. Restore from the most recent usable backup --------------------------
echo ""
echo "R5 — restore from the most recent usable backup:"
# Three backups: an older non-parseable one, an older parseable one, and a
# newer parseable one. The restore must skip the non-parseable AND pick the
# newer of the two parseable ones — a regression that takes the first
# parseable match would restore the older content.
echo 'not json' > "${TEST_HOME}/.gemini/settings.json.bak.20260101-000000"
printf '%s\n' '{"mcpServers":{"mempalace":{"command":"bash","args":["older"]}}}' \
  > "${TEST_HOME}/.gemini/settings.json.bak.20260102-000000"
printf '%s\n' '{"mcpServers":{"mempalace":{"command":"bash","args":["newer"]}}}' \
  > "${TEST_HOME}/.gemini/settings.json.bak.20260103-000000"
chmod 644 "${TEST_HOME}/.gemini/settings.json.bak.20260102-000000" \
        "${TEST_HOME}/.gemini/settings.json.bak.20260103-000000"
residue_config > "${TEST_HOME}/.gemini/settings.json"
# The destination is deliberately given a DIFFERENT mode from the backup. R5
# says the restore preserves "the file's mode" and there are two candidate
# files; left at the ambient umask the destination is also 644, and the
# assertion below then passes whether the implementation reads the backup or
# the destination — a loose reading of R5 that is wrong, since the destination
# is the residue being replaced. 600 here vs 644 on the backup makes the
# assertion name which file it means.
chmod 600 "${TEST_HOME}/.gemini/settings.json"
# umask 077 makes the mode assertion non-vacuous: the restore stages the
# content into a mktemp sibling created under this umask (0600) and chmods it to
# the backup's mode before renaming, so the restored file staying 644 proves the
# backup's mode is propagated deliberately, not inherited from the umask.
out="$(umask 077; bash "${REPAIR}" --restore-backup 2>&1)"; rc=$?
[ "$(jq -c '.mcpServers.mempalace' "${TEST_HOME}/.gemini/settings.json")" = '{"command":"bash","args":["newer"]}' ] \
  && ok "the most recent usable backup is restored" \
  || nope "the wrong backup was restored"
[ "$(mode_of "${TEST_HOME}/.gemini/settings.json")" = "644" ] \
  && ok "the file's mode is preserved by the restore (not umask-derived)" \
  || nope "restore did not preserve the mode (got $(mode_of "${TEST_HOME}/.gemini/settings.json"))"
[ "${rc}" -eq 0 ] \
  && ok "a restore that leaves no residue exits 0" \
  || nope "restore exited ${rc}"

echo ""
echo "R5 — a restored config carrying a bearer token stays 0600:"
printf '%s\n' '{"mcpServers":{"mempalace":{"type":"http","url":"http://127.0.0.1:1/mcp","headers":{"Authorization":"Bearer x"}}}}' \
  > "${TEST_HOME}/.gemini/settings.json.bak.20260103-000000"
chmod 644 "${TEST_HOME}/.gemini/settings.json.bak.20260103-000000"
residue_config > "${TEST_HOME}/.gemini/settings.json"
bash "${REPAIR}" --restore-backup >/dev/null 2>&1
[ "$(mode_of "${TEST_HOME}/.gemini/settings.json")" = "600" ] \
  && ok "a restored config carrying a bearer token is forced to 0600" \
  || nope "token-bearing restored config is $(mode_of "${TEST_HOME}/.gemini/settings.json"), expected 600"

echo ""
echo "R5 — no usable backup is reported, not silently skipped:"
rm -f "${TEST_HOME}/.gemini/settings.json.bak."*
residue_config > "${TEST_HOME}/.gemini/settings.json"
out="$(bash "${REPAIR}" --restore-backup 2>&1)"; rc=$?
[ "${rc}" -ne 0 ] \
  && ok "restore with no usable backup exits non-zero" \
  || nope "restore with no usable backup exited ${rc}"
case "${out}" in
  *"gemini"*"NO USABLE BACKUP"*) ok "the assistant with no usable backup is reported" ;;
  *) nope "no usable-backup report: ${out}" ;;
esac

echo ""
echo "R5 — the restore never follows a symlinked destination:"
# `cp -p BAK CFG` writes THROUGH a symlinked CFG: the restored configuration —
# bearer token included — lands wherever the link points, and the link target
# takes the backup's mode. Staging the content into a mktemp sibling and
# renaming it over CFG replaces the link itself, so the target is untouched.
# This is the deterministic half of the same defect whose other half — the
# window during which the token sits at the backup's (possibly 0644) mode
# before the chmod narrows it — is a race and cannot be asserted directly.
victim="${TEST_HOME}/victim-outside-the-config.json"
rm -f "${TEST_HOME}/.gemini/settings.json"
ln -s "${victim}" "${TEST_HOME}/.gemini/settings.json"
# The classifier reads through the link, so the residue has to live in the link
# target for gemini to be treated as affected at all.
residue_config > "${victim}"
chmod 600 "${victim}"
printf '%s\n' '{"mcpServers":{"mempalace":{"type":"http","url":"http://127.0.0.1:1/mcp","headers":{"Authorization":"Bearer SECRET123"}}}}' \
  > "${TEST_HOME}/.gemini/settings.json.bak.20260104-000000"
chmod 644 "${TEST_HOME}/.gemini/settings.json.bak.20260104-000000"
bash "${REPAIR}" --restore-backup >/dev/null 2>&1
case "$(cat "${victim}")" in
  *SECRET123*) nope "the restore wrote the bearer token through the symlink into ${victim}" ;;
  *) ok "the symlink target never receives the restored configuration" ;;
esac
[ ! -L "${TEST_HOME}/.gemini/settings.json" ] \
  && ok "the symlinked config path is replaced, not followed" \
  || nope "the config path is still a symlink — the restore wrote through it"
[ "$(mode_of "${TEST_HOME}/.gemini/settings.json")" = "600" ] \
  && ok "the restored token-bearing config is 0600 at the config path" \
  || nope "restored config at the config path is $(mode_of "${TEST_HOME}/.gemini/settings.json"), expected 600"
# Hand the following sections a plain regular config again.
rm -f "${TEST_HOME}/.gemini/settings.json" "${victim}" \
      "${TEST_HOME}/.gemini/settings.json.bak."*

echo ""
echo "R5 — the restored mode comes from a symlinked backup's TARGET:"
# The other symlink hazard, and a different one from the case above: there the
# DESTINATION is a link, here the SOURCE is. backup_file (scripts/lib/common.sh)
# tests `[ -f ] || [ -L ]` and copies with `cp -P`, which does not dereference,
# so a config that is itself a symlink — the dotfiles pattern — produces a
# symlinked BACKUP; most_recent_usable_backup then accepts it because jq
# follows the link and parses the target. Reading the mode off the link instead
# of its target hands chmod the link's own mode — 0755 on macOS, 0777 on Linux
# — and publishes the restored configuration wider than the operator had it.
link_target="${TEST_HOME}/dotfiles-settings.json"
printf '%s\n' '{"mcpServers":{"mempalace":{"command":"bash","args":["from-dotfiles"]}}}' \
  > "${link_target}"
chmod 644 "${link_target}"
ln -s "${link_target}" "${TEST_HOME}/.gemini/settings.json.bak.20260105-000000"
residue_config > "${TEST_HOME}/.gemini/settings.json"
# 600 on the destination for the same reason as the first R5 case: it keeps the
# three candidate modes distinct — link target 644, link itself 755/777,
# destination 600 — so the single assertion below names all three outcomes
# apart instead of collapsing two of them.
chmod 600 "${TEST_HOME}/.gemini/settings.json"
# umask 077 for the same reason as the first R5 case: the staged temp file is
# created at 0600, so a restored config at 644 proves the target's mode was
# read and applied deliberately.
(umask 077; bash "${REPAIR}" --restore-backup) >/dev/null 2>&1
[ "$(jq -c '.mcpServers.mempalace' "${TEST_HOME}/.gemini/settings.json" 2>/dev/null)" \
  = '{"command":"bash","args":["from-dotfiles"]}' ] \
  && ok "a symlinked backup is restored from its target's content" \
  || nope "the symlinked backup was not restored"
[ "$(mode_of "${TEST_HOME}/.gemini/settings.json")" = "644" ] \
  && ok "the restored mode is the symlinked backup's target mode, not the link's" \
  || nope "restore from a symlinked backup is $(mode_of "${TEST_HOME}/.gemini/settings.json"), expected 644 (the link target's mode)"
rm -f "${TEST_HOME}/.gemini/settings.json" "${link_target}" \
      "${TEST_HOME}/.gemini/settings.json.bak."*

echo ""
echo "R5 — a symlinked backup whose target carries a bearer token stays 0600:"
# The token rule outranks the mode-preservation rule, and must keep doing so
# when the mode arrives by dereferencing a link: a 0644 target must not carry
# its mode over a credential.
link_target="${TEST_HOME}/dotfiles-settings-token.json"
printf '%s\n' '{"mcpServers":{"mempalace":{"type":"http","url":"http://127.0.0.1:1/mcp","headers":{"Authorization":"Bearer x"}}}}' \
  > "${link_target}"
chmod 644 "${link_target}"
ln -s "${link_target}" "${TEST_HOME}/.gemini/settings.json.bak.20260106-000000"
residue_config > "${TEST_HOME}/.gemini/settings.json"
bash "${REPAIR}" --restore-backup >/dev/null 2>&1
[ "$(mode_of "${TEST_HOME}/.gemini/settings.json")" = "600" ] \
  && ok "a token-bearing symlinked backup restores to 0600, not the target's mode" \
  || nope "token-bearing restore from a symlinked backup is $(mode_of "${TEST_HOME}/.gemini/settings.json"), expected 600"
rm -f "${TEST_HOME}/.gemini/settings.json" "${link_target}" \
      "${TEST_HOME}/.gemini/settings.json.bak."*


# make_owner_unreadable_backup <path> <chmod-arg> <expected-mode>
# Builds a backup that stat reports as <expected-mode> — a mode whose OWNER
# triad lacks read — and that is nonetheless readable, so the restore reaches
# file_mode instead of rejecting the backup earlier. Returns 0 on success;
# on failure echoes the reason THAT HALF failed.
#
# Each half reports separately on purpose. The fixture needs two independent
# things — the width/value stat reports, and read access granted by something
# other than the mode bits — and they fail on different platforms for
# different reasons.
#
# Under macOS Darwin, an extended ACL (chmod +a) grants the owner read while
# preserving stat mode bits. Under Linux POSIX.1e, named ACLs naming the owner
# are inert; foreign ownership with group read (via non-interactive sudo -n)
# is used instead so the test process reads the file through group bits while
# the owner triad denies read.
make_owner_unreadable_backup() {
  local path="$1" want_chmod="$2" want_mode="$3" got
  local acl_err=""

  # 1. Try standard chmod + ACL first (macOS, or Linux if effective).
  if chmod "${want_chmod}" "${path}" 2>/dev/null; then
    got="$(mode_of "${path}")"
    if [ "${got}" = "${want_mode}" ]; then
      if chmod +a "user:$(id -un) allow read" "${path}" 2>/dev/null \
         || setfacl -m "u:$(id -un):r" "${path}" 2>/dev/null; then
        if jq -e . "${path}" >/dev/null 2>&1; then
          got="$(mode_of "${path}")"
          if [ "${got}" = "${want_mode}" ]; then
            return 0
          fi
        else
          acl_err="the ACL primitive exited 0 but granted nothing — the file is still unreadable, so the restore would reject it before file_mode (a named POSIX ACL naming the owner itself is stored and inert)"
        fi
      else
        acl_err="no ACL primitive here — chmod +a and setfacl both failed"
      fi
    else
      acl_err="stat here reports '${got}' for a 0${want_chmod} file, not '${want_mode}' — this probe does not report that width (BSD %Lp drops the setuid bit)"
    fi
  else
    acl_err="chmod ${want_chmod} was refused here"
  fi

  # 2. If ACL didn't grant read access, try foreign ownership with group read (Linux with sudo -n).
  if sudo -n true 2>/dev/null; then
    local foreign_user="" u
    for u in nobody daemon root _spotlight bin sys; do
      if id "$u" >/dev/null 2>&1 && [ "$(id -u "$u" 2>/dev/null)" != "$(id -u)" ]; then
        foreign_user="$u"
        break
      fi
    done
    if [ -n "${foreign_user}" ]; then
      local target_chmod="${want_chmod}" target_mode="${want_mode}"
      # Under foreign ownership, the owner triad is unreadable and the group triad provides read.
      # For mode 100 (owner execute-only), group read is mode 140.
      if [ "${want_chmod}" = "100" ]; then
        target_chmod="140"
        target_mode="140"
      fi
      if sudo -n chown "${foreign_user}:$(id -g)" "${path}" 2>/dev/null \
         && sudo -n chmod "${target_chmod}" "${path}" 2>/dev/null; then
        got="$(mode_of "${path}")"
        if [ "${got}" = "${target_mode}" ] && jq -e . "${path}" >/dev/null 2>&1; then
          return 0
        fi
      fi
    fi
  fi

  if [ -n "${acl_err}" ]; then
    printf '%s\n' "${acl_err}"
  else
    printf 'failed to construct owner-unreadable readable fixture\n'
  fi
  return 1
}

# assert_converges_at_600 <label> — run the restore over the fixture already in
# place and assert the OPERATOR's outcome: the repair converges, and the config
# it leaves behind can be read by the owner it leaves it to. A mode-only
# assertion is what let the non-converging restore ship.
assert_converges_at_600() {
  local label="$1" rc
  residue_config > "${TEST_HOME}/.gemini/settings.json"
  (umask 077; bash "${REPAIR}" --restore-backup) >/dev/null 2>&1; rc=$?
  [ "${rc}" -eq 0 ] \
    && ok "the restore converges (R7, exit 0) — ${label}" \
    || nope "restore exited ${rc}, residue remains (R7) — ${label}"
  jq -e . "${TEST_HOME}/.gemini/settings.json" >/dev/null 2>&1 \
    && ok "the restored config is readable by its owner — ${label}" \
    || nope "the restored config is NOT readable by its owner (mode $(mode_of "${TEST_HOME}/.gemini/settings.json")) — ${label}"
  [ "$(mode_of "${TEST_HOME}/.gemini/settings.json")" = "600" ] \
    && ok "the unsafe mode falls back to 600 — ${label}" \
    || nope "restored as $(mode_of "${TEST_HOME}/.gemini/settings.json"), expected 600 — ${label}"
}

echo ""
echo "R5 — a mode too NARROW to name an owner triad is not preserved (width):"
# 0060 prints as `60`. A two-digit string matches no arm, so this case pins the
# width rejection — and ONLY that. It says nothing about the owner digit,
# because the string never reaches an arm that tests one.
narrow_backup="${TEST_HOME}/.gemini/settings.json.bak.20260107-000000"
printf '%s\n' '{"mcpServers":{"mempalace":{"command":"bash","args":["narrow"]}}}' \
  > "${narrow_backup}"
if reason="$(make_owner_unreadable_backup "${narrow_backup}" 060 60)"; then
  assert_converges_at_600 "two-digit backup mode"
else
  skipped "${reason}"
  echo "       -> the WIDTH rejection in file_mode's case list is NOT exercised here."
fi
rm -f "${TEST_HOME}/.gemini/settings.json" "${narrow_backup}"

echo ""
echo "R5 — a three-digit mode whose OWNER cannot read is not preserved (owner digit):"
# The case the width one cannot cover. 0100 prints as `100`: three digits, so
# it REACHES the three-digit arm and is judged on its owner digit alone. That
# is the arm's whole content — 4-7 rather than 1-7 — and modes 100, 200 and
# 300 are exactly the values that distinguish "owner can read" from "owner
# triad is nonzero". Without this case a floor accepting `100` passes.
owner_backup="${TEST_HOME}/.gemini/settings.json.bak.20260107-000000"
printf '%s\n' '{"mcpServers":{"mempalace":{"command":"bash","args":["owner"]}}}' \
  > "${owner_backup}"
if reason="$(make_owner_unreadable_backup "${owner_backup}" 100 100)"; then
  assert_converges_at_600 "three-digit execute-only owner"
else
  skipped "${reason}"
  echo "       -> the OWNER-READ test in file_mode's three-digit arm is NOT"
  echo "          exercised here."
fi
rm -f "${TEST_HOME}/.gemini/settings.json" "${owner_backup}"

echo ""
echo "R5 — a four-digit setuid mode whose OWNER cannot read is not preserved:"
# In a four-digit string the owner digit is the SECOND one, so this arm needs
# its own case: a list testing only the first digit would let a setuid backup
# smuggle an owner-unreadable mode past. Only GNU `%a` reports the setuid bit
# (BSD `%Lp` drops it), so on a BSD-only machine the string is never four
# digits and the arm is unreachable. Where GNU stat exists but is not the
# default probe, shim it in front: that is not an artificial path, it is the
# probe file_mode tries FIRST and the one that answers on Linux.
setuid_backup="${TEST_HOME}/.gemini/settings.json.bak.20260108-000000"
gnu_shim=""
# Probe the ambient stat with a real setuid file rather than assuming which
# platform this is: if it reports 4755 the special bits are visible and the
# four-digit arm is reachable as-is; if it reports 755 they are not, and a
# GNU stat in front supplies the probe file_mode would have used on Linux.
setuid_probe="${TEST_HOME}/.setuid-probe"
: > "${setuid_probe}"
chmod 4755 "${setuid_probe}" 2>/dev/null
if [ "$(mode_of "${setuid_probe}")" != "4755" ] && command -v gstat >/dev/null 2>&1; then
  if gnu_shim="$(mktemp -d 2>/dev/null)" && [ -n "${gnu_shim}" ] && [ -d "${gnu_shim}" ]; then
    printf '#!/bin/sh\nexec %s "$@"\n' "$(command -v gstat)" > "${gnu_shim}/stat"
    chmod +x "${gnu_shim}/stat"
    PATH="${gnu_shim}:${PATH}"
  else
    gnu_shim=""
  fi
fi
rm -f "${setuid_probe}"
printf '%s\n' '{"mcpServers":{"mempalace":{"command":"bash","args":["setuid"]}}}' \
  > "${setuid_backup}"
if reason="$(make_owner_unreadable_backup "${setuid_backup}" 4060 4060)"; then
  assert_converges_at_600 "four-digit setuid, owner triad 0"
else
  skipped "${reason}"
  echo "       -> the OWNER-READ test in file_mode's FOUR-digit arm is NOT"
  echo "          exercised here."
fi
rm -f "${TEST_HOME}/.gemini/settings.json" "${setuid_backup}"
if [ -n "${gnu_shim}" ]; then
  PATH="${PATH#"${gnu_shim}:"}"
  rm -rf "${gnu_shim}"
fi

# --- R6. Reset to none -------------------------------------------------------
echo ""
echo "R6 — reset-none removes the mempalace registration:"
residue_config > "${TEST_HOME}/.gemini/settings.json"
out="$(bash "${REPAIR}" --reset-none 2>&1)"; rc=$?
[ "$(mcp_assistant_arrangement gemini)" = "none" ] \
  && ok "reset-none produces the none arrangement" \
  || nope "reset-none did not produce none"
jq -e '(.mcpServers | has("mempalace")) | not' "${TEST_HOME}/.gemini/settings.json" >/dev/null 2>&1 \
  && ok "no mempalace entry remains after reset-none" \
  || nope "a mempalace entry survived reset-none"
[ "${rc}" -eq 0 ] \
  && ok "a reset that leaves no residue exits 0" \
  || nope "reset exited ${rc}"

echo ""
echo "R6 — reset-none refuses a non-parseable config:"
echo 'not json' > "${TEST_HOME}/.gemini/settings.json"
out="$(bash "${REPAIR}" --reset-none 2>&1)"; rc=$?
[ "${rc}" -ne 0 ] \
  && ok "reset-none on a non-parseable config exits non-zero" \
  || nope "reset-none on a non-parseable config exited ${rc}"
[ "$(cat "${TEST_HOME}/.gemini/settings.json")" = "not json" ] \
  && ok "a non-parseable config is not modified" \
  || nope "the non-parseable config was modified"
case "${out}" in
  *"--restore-backup"*) ok "the non-parseable assistant is told to use --restore-backup first" ;;
  *) nope "no --restore-backup guidance: ${out}" ;;
esac

# --- R8. A recognisable arrangement is never modified ------------------------
echo ""
echo "R8 — a recognisable arrangement is never modified:"
for shape in \
  '{"mcpServers":{"mempalace":{"type":"http","url":"http://127.0.0.1:1/mcp"}}}' \
  '{"mcpServers":{"mempalace":{"command":"bash","args":["x"]}}}' \
  '{"mcpServers":{}}'; do
  printf '%s\n' "${shape}" > "${TEST_HOME}/.gemini/settings.json"
  before="$(cat "${TEST_HOME}/.gemini/settings.json")"
  bash "${REPAIR}" --restore-backup >/dev/null 2>&1
  bash "${REPAIR}" --reset-none >/dev/null 2>&1
  [ "$(cat "${TEST_HOME}/.gemini/settings.json")" = "${before}" ] \
    && ok "a recognisable config is never modified (${shape})" \
    || nope "a recognisable config was modified (${shape})"
done

# --- R7. Post-repair verification --------------------------------------------
echo ""
echo "R7 — post-repair verification:"
residue_config > "${TEST_HOME}/.gemini/settings.json"
out="$(bash "${REPAIR}" --reset-none 2>&1)"; rc=$?
case "${out}" in
  *"Post-repair verification"*) ok "the post-repair verification runs" ;;
  *) nope "no post-repair verification: ${out}" ;;
esac
case "${out}" in
  *"gemini: none"*) ok "the verification reports the resulting arrangement" ;;
  *) nope "the verification does not report gemini's arrangement: ${out}" ;;
esac
[ "${rc}" -eq 0 ] \
  && ok "a repair that leaves no residue exits 0" \
  || nope "repair exited ${rc}"

# --- R9. Repeatability --------------------------------------------------------
echo ""
echo "R9 — a second run after a successful repair finds no residue:"
bash "${REPAIR}" >/dev/null 2>&1; rc=$?
[ "${rc}" -eq 0 ] \
  && ok "a second run after a successful repair finds no residue and exits 0" \
  || nope "a second run found residue or exited ${rc}"

# --- R14. The switch transaction hands off to the repair command -------------
echo ""
echo "R14 — the switch transaction hands off to the repair command:"
# The R15 loop refuses an unknown arrangement and names the repair command
# (common.sh R14 message). The unknown branch returns before any state change,
# so the switch is safe to invoke directly with a residue fixture.
residue_config > "${TEST_HOME}/.gemini/settings.json"
out="$(switch_assistants_to_http "test-token" 2>&1)"; rc=$?
[ "${rc}" -ne 0 ] \
  && ok "the switch refuses an unknown arrangement" \
  || nope "the switch accepted an unknown arrangement (exit ${rc})"
case "${out}" in
  *"task mempalace:repair"*) ok "the R15-loop handoff names the repair command" ;;
  *) nope "the R15-loop handoff does not name the repair command: ${out}" ;;
esac

# The rollback handoff names the restore verb. A restore fails deterministically
# when the config file is absent, so _switch_rollback reports the assistant as
# requiring manual repair and names the repair command's --restore-backup verb.
# The `--` separator is part of the assertion: the Taskfile entry forwards
# {{.CLI_ARGS}}, which go-task fills only from arguments after `--`, so the
# separator-less form the operator would copy exits 2 with `unknown flag:`.
rm -f "${TEST_HOME}/.gemini/settings.json"
out="$(_switch_rollback "gemini" "null" "null" "null" "null" 2>&1)"; rc=$?
case "${out}" in
  *"task mempalace:repair -- --restore-backup"*) ok "the rollback handoff names the restore verb with the -- separator" ;;
  *) nope "the rollback handoff does not name 'task mempalace:repair -- --restore-backup': ${out}" ;;
esac

# --- Flag parsing ------------------------------------------------------------
echo ""
echo "Flag parsing:"
out="$(bash "${REPAIR}" --restore-backup --reset-none 2>&1)"; rc=$?
[ "${rc}" -eq 2 ] \
  && ok "mutually exclusive flags exit 2" \
  || nope "mutually exclusive flags exited ${rc}"
case "${out}" in
  *"mutually exclusive"*) ok "the mutual-exclusion error is named" ;;
  *) nope "no mutual-exclusion error: ${out}" ;;
esac
out="$(bash "${REPAIR}" --bogus 2>&1)"; rc=$?
[ "${rc}" -eq 2 ] \
  && ok "an unknown flag exits 2" \
  || nope "an unknown flag exited ${rc}"

export PATH="${ORIG_PATH}"

echo ""
echo "----------------------------------------"
echo "  passed: ${PASS}   failed: ${FAIL}   skipped: ${SKIP}"
[ "${FAIL}" -eq 0 ] || exit 1
