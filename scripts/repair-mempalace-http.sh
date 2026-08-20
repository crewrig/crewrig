#!/usr/bin/env bash
# scripts/repair-mempalace-http.sh — Repair the residue left by an interrupted
# MemPalace switch (spec 0165).
#
# The residue is the state repetition cannot reach (spec 0113 delta-01 R14):
# an assistant whose configuration does not parse as JSON, or whose `mempalace`
# registration matches neither the `http` shape (has `url`/`serverUrl`) nor the
# `stdio` shape (has `command`). R14 reports it and hands it to the operator;
# this command gives the operator one verb that detects it, names it, and
# repairs it to a recognisable arrangement.
#
# The command restores recognisability ONLY. It never converges (that is
# setup's job, R15), never registers anyone for `http` (an operator who wants
# the daemon re-runs setup once the residue is recognisable), and never places
# the bearer token in argv (R8) — the secure config writer is used for every
# JSON rewrite.
#
# Verbs:
#   (no flag)          Report each affected assistant, its configuration path,
#                      whether a timestamped backup exists, and the repair
#                      actions available. Exits non-zero when any residue
#                      exists (R4).
#   --restore-backup   Restore, for each affected assistant that has a
#                      timestamped backup whose content parses as JSON, the
#                      most recent such backup. The restore preserves the
#                      file's mode, except that a configuration carrying a
#                      bearer token remains 0600 and a mode denying its own
#                      owner read is replaced by 0600. An affected assistant
#                      without a usable backup is reported, not silently
#                      skipped (R5).
#   --reset-none       Remove the `mempalace` registration from each affected
#                      assistant whose configuration parses, producing the
#                      recognisable `none` arrangement. An affected assistant
#                      whose configuration does not parse is reported as
#                      requiring `--restore-backup` first, and is not modified
#                      (R6).
#
# After applying a repair the command re-runs the detection and reports every
# present assistant's resulting arrangement; it exits 0 only when no residue
# remains (R7). A second run after a successful repair finds no residue and
# exits 0 (R9).
#
# Usage:
#   bash scripts/repair-mempalace-http.sh
#   bash scripts/repair-mempalace-http.sh --restore-backup
#   bash scripts/repair-mempalace-http.sh --reset-none
#   task mempalace:repair

# -e intentionally omitted: this is an aggregating repair. Every per-assistant
# step is allowed to fail and be reported; the accumulated verdict controls the
# exit.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=lib/common.sh
. "${SCRIPT_DIR}/lib/common.sh"
# shellcheck disable=SC2034  # read by helpers in common.sh
CREWRIG_REPO_DIR="${REPO_DIR}"

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required to read the CLI MCP registration files." >&2
  echo "       Install with: brew install jq (macOS) or apt-get install jq" >&2
  exit 2
fi

usage() {
  cat <<'EOF'
Usage: bash scripts/repair-mempalace-http.sh [--restore-backup | --reset-none]

Repair the residue left by an interrupted MemPalace switch (spec 0165): an
assistant whose configuration does not parse as JSON, or whose mempalace
registration matches neither the http nor the stdio shape.

With no flag, reports each affected assistant, its configuration path, whether
a timestamped backup exists, and the repair actions available; exits non-zero
when any residue exists.

  --restore-backup  Restore each affected assistant's most recent backup whose
                    content parses as JSON (mode preserved; 0600 when the
                    restored content carries a bearer token, or when the
                    backup's mode would deny its owner read).
  --reset-none      Remove the mempalace registration from each affected
                    assistant whose configuration parses, producing the
                    recognisable none arrangement.

The command restores recognisability only — it never registers anyone for http
(that is setup's job) and never places the bearer token in argv.
EOF
}

# --- Flag parsing -------------------------------------------------------------
RESTORE_BACKUP=0
RESET_NONE=0
for arg in "$@"; do
  case "$arg" in
    --restore-backup) RESTORE_BACKUP=1 ;;
    --reset-none)     RESET_NONE=1 ;;
    -h|--help)        usage; exit 0 ;;
    *) echo "ERROR: unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done
if [ "$RESTORE_BACKUP" -eq 1 ] && [ "$RESET_NONE" -eq 1 ]; then
  echo "ERROR: --restore-backup and --reset-none are mutually exclusive." >&2
  usage >&2
  exit 2
fi

# --- Detection helpers --------------------------------------------------------

# classify <cli> — echoes the arrangement, mapping absent→none for present
# assistants. A present assistant with no config file has no mempalace
# registration — recognisably `none`, not residue (spec 0165 R2). This matches
# the claude branch of the classifier, which already returns `none` for a
# missing config file.
classify() {
  local cli="$1" state
  state="$(mcp_assistant_arrangement "$cli")"
  [ "$state" = "absent" ] && state="none"
  printf '%s\n' "$state"
}

# has_any_backup <cfg> — true when at least one timestamped backup exists.
#
# `-e` and not `-e || -L`, deliberately: a DANGLING .bak symlink is reported as
# `backup: no`. That reads as a contradiction next to the fallback action the
# same report prints ("restore the .bak file by hand"), and it is — the
# directory entry exists. It is still the right answer, because the question
# this line answers is "is there anything restorable", and a link whose target
# is gone is the absence of a backup with a leftover name, not a backup. The
# alternative label, `backup: yes, but none parses as JSON`, would be less
# accurate still: nothing was parsed, the target simply is not there. Both
# messages already point the operator at the .bak files beside the config,
# which is where one `ls -l` shows them the broken link.
has_any_backup() {
  local cfg="$1" bak
  for bak in "${cfg}".bak.*; do
    [ -e "$bak" ] && return 0
  done
  return 1
}

# file_mode <path> — the mode chmod should be given for a COPY of <path>, in
# octal. 600 when the mode cannot be read, and 600 when preserving it would
# leave the copy's owner unable to read it (see the case list below).
#
# GNU probed first: `stat -f` on GNU means "filesystem" and SUCCEEDS with
# output this caller would then feed to chmod (the test suite's mode_of carries
# the same ordering for the same reason).
#
# The `*)` arm catches an UNPARSEABLE result — both probes failing and leaving
# `$m` empty — and not every unreadable file. On BSD, `stat -L` on a dangling
# symlink falls back to the link and exits 0 with its mode (measured: 755), so
# for that one input the function returns the WIDE value and `*)` never runs.
# It cannot arrive here: most_recent_usable_backup gates every candidate on
# `jq -e .`, which fails on a dangling link, and `cat "$bak"` would fail before
# the chmod even if it did. Stated rather than guarded — a guard for a state
# the call site excludes is dead code that still has to be maintained.
#
# `-L` dereferences, and it is required here: the argument is a BACKUP, and a
# backup can be a symlink. backup_file (scripts/lib/common.sh) copies with
# `cp -P`, which deliberately does not dereference, so an assistant config that
# is itself a symlink — the dotfiles pattern, ~/.gemini/settings.json linked
# into a dotfiles repo — yields a symlinked backup, and
# most_recent_usable_backup accepts it because jq follows the link and parses
# the target. Without -L this reads the LINK's own mode — 0755 on macOS, 0777
# on Linux — and the restore publishes the configuration wider than the
# operator ever had it, up to world-writable for a file whose
# mcpServers.mempalace.command the CLI executes at session start.
#
# The case list accepts a mode ONLY when its owner triad carries read — that
# is the property, and it is not the same as "looks like a mode". A backup can
# be readable through something the restore does not carry over: an ACL
# granting the owner read (measured: `jq -e .` exits 0 while stat still reports
# `60`), foreign ownership plus group access, or a root run. The restore then
# writes a NEW file, owned by the operator, with no ACL, and applies these
# bits verbatim. Preserving an owner-unreadable mode in exactly the case that
# made it reachable therefore produces a configuration its owner cannot read:
# the repair's own verification reclassifies it as residue, the command exits
# 1, and R7 ("exits 0 only when no residue remains") becomes unsatisfiable
# through the documented verb. Falling back to 600 converges instead.
#
# Owner-read and not merely owner-nonzero: modes 100, 200 and 300 all leave
# the owner unable to read (measured, `jq -e .` exits 2 for each), so the
# accepted owner digit is 4-7.
#
# Both arms are needed because the two probes disagree on width. `%a`/`%Lp`
# strip leading zeros, so an all-zero owner triad prints in fewer than three
# digits (`0060` -> `60`) and is rejected by falling off the list. GNU `%a`
# additionally reports setuid/setgid/sticky, giving a four-digit string where
# the OWNER digit is the second one — measured, GNU prints `4060` where BSD
# `%Lp` prints `60` — so the four-digit arm has to test that second digit or a
# setuid backup would smuggle an unreadable mode past on Linux.
file_mode() {
  local m
  m="$(stat -Lc '%a' "$1" 2>/dev/null || stat -L -f '%Lp' "$1" 2>/dev/null)"
  case "$m" in
    [4-7][0-7][0-7]|[0-7][4-7][0-7][0-7]) printf '%s\n' "$m" ;;
    *) printf '600\n' ;;
  esac
}

# most_recent_usable_backup <cfg> — echoes the most recent USABLE backup, or
# nothing (returning non-zero) when none is. The glob expands in lexical order
# and the %Y%m%d-%H%M%S stamp from backup_file is fixed-width, so lexical order
# IS chronological order and the last usable match is the most recent one.
#
# "Usable" is `jq -e .`, which is narrower than "parses as JSON" and is meant
# to be: `-e` also exits non-zero on a document that parses to `null` or to
# `false` (measured), so those two are rejected alongside the malformed ones.
# That is the wanted behaviour — a config file whose whole content is `null` is
# not something to restore an assistant from — but it means the operator-facing
# wording ("parses as JSON") is a simplification, not a literal description of
# the test. Keep `-e`: dropping it to make the prose exact would accept `null`
# as a usable backup. The realistic residue shapes are unaffected either way —
# a 0-byte or whitespace-only file from a truncated write exits 4 here.
most_recent_usable_backup() {
  local cfg="$1" bak best=""
  for bak in "${cfg}".bak.*; do
    [ -e "$bak" ] || continue
    if jq -e . "$bak" >/dev/null 2>&1; then
      best="$bak"
    fi
  done
  if [ -n "$best" ]; then
    printf '%s\n' "$best"
    return 0
  fi
  return 1
}

# report_residue <cli> — the R4 per-assistant report: configuration path,
# whether a timestamped backup exists, and the repair actions available.
report_residue() {
  local cli="$1" cfg actions=""
  cfg="$(mcp_assistant_config_path "$cli")"
  echo "  $cli"
  echo "    config:  $cfg"
  if has_any_backup "$cfg"; then
    if most_recent_usable_backup "$cfg" >/dev/null 2>&1; then
      echo "    backup:  yes (most recent parses as JSON)"
      actions="--restore-backup"
    else
      echo "    backup:  yes, but none parses as JSON"
    fi
  else
    echo "    backup:  no"
  fi
  if jq -e . "$cfg" >/dev/null 2>&1; then
    if [ -n "$actions" ]; then
      actions="${actions} | --reset-none"
    else
      actions="--reset-none"
    fi
  else
    echo "    note:    config does not parse — --reset-none unavailable"
  fi
  echo "    actions: ${actions:-restore the .bak file by hand, then re-run setup}"
  echo ""
}

# --- Repair verbs -------------------------------------------------------------

# restore_backup <cli> — R5: restore the most recent usable backup, preserving
# the file's mode; force 0600 when the restored content carries a bearer token.
# An affected assistant without a usable backup is reported, not silently
# skipped.
restore_backup() {
  local cli="$1" cfg bak mode tmp
  cfg="$(mcp_assistant_config_path "$cli")"
  bak="$(most_recent_usable_backup "$cfg")" || {
    echo "  $cli: NO USABLE BACKUP — restore the timestamped .bak file beside"
    echo "        $cfg by hand, or re-run setup once the cause is fixed."
    return 1
  }
  # R5: preserve the backup's mode, with two exceptions — a configuration
  # carrying a bearer token SHALL be 0600, and a mode that would deny the
  # new owner read is not preserved at all (file_mode returns 600 for it,
  # because the restore does not carry over the ACL or the ownership that
  # made such a backup readable, and an unreadable config is residue the
  # R7 verification below refuses to converge on). Both are decided here, before the content
  # exists at the config path, because the mode is a property of the write and
  # not a correction applied after it: `cp -p "$bak" "$cfg"` publishes the
  # token at the backup's mode — 0644 on a backup taken under umask 022 — and
  # only narrows it on the next statement, so the credential is world-readable
  # for the width of that window. `cp` also writes THROUGH a symlinked $cfg,
  # putting the configuration (token included) wherever the link points.
  # Staging into a mktemp sibling and renaming closes both: `mv` is rename(2),
  # so the destination inherits the temp file's already-final mode and replaces
  # a symlink instead of following it. write_json_config_secure in
  # scripts/lib/common.sh is the in-repo precedent for the same pattern.
  mode="$(file_mode "$bak")"
  if jq -e '.mcpServers.mempalace.headers.Authorization // empty' "$bak" >/dev/null 2>&1; then
    mode=600
  fi
  # mktemp, not "${cfg}.tmp.$$": a predictable name in a writable directory
  # turns this restore into an arbitrary-file-write with the bearer token as
  # payload (pre-create the name as a symlink). mktemp refuses an existing
  # name. umask 077 so the file is never observable wider than its final mode.
  tmp="$(umask 077; mktemp "${cfg}.tmp.XXXXXX")" || {
    echo "  ERROR: could not stage the restore of $cfg beside it" >&2
    return 1
  }
  if ! cat "$bak" > "$tmp"; then
    rm -f "$tmp"
    echo "  ERROR: could not restore $cfg from $bak" >&2
    return 1
  fi
  chmod "$mode" "$tmp" || {
    rm -f "$tmp"
    echo "  ERROR: could not set mode $mode on the staged restore of $cfg." >&2
    return 1
  }
  mv "$tmp" "$cfg" || {
    rm -f "$tmp"
    echo "  ERROR: could not restore $cfg from $bak" >&2
    return 1
  }
  echo "  $cli: restored from $bak"
  return 0
}

# reset_none <cli> — R6: remove the mempalace registration, producing the
# recognisable `none` arrangement. A non-parseable config is reported as
# requiring --restore-backup first and is not modified.
reset_none() {
  local cli="$1" cfg
  cfg="$(mcp_assistant_config_path "$cli")"
  if ! jq -e . "$cfg" >/dev/null 2>&1; then
    echo "  $cli: CONFIG DOES NOT PARSE — run --restore-backup first, or restore"
    echo "        the timestamped .bak file beside $cfg by hand."
    return 1
  fi
  write_json_config_secure "$cfg" 'del(.mcpServers.mempalace)' || {
    echo "  ERROR: could not remove the mempalace registration from $cfg" >&2
    return 1
  }
  echo "  $cli: mempalace registration removed (arrangement: none)"
  return 0
}

# verify — R7: re-run the detection and report every present assistant's
# resulting arrangement. Returns non-zero when any residue remains.
verify() {
  local cli state residue=""
  echo ""
  echo "Post-repair verification:"
  for cli in claude gemini copilot antigravity; do
    mcp_assistant_present "$cli" || continue
    state="$(classify "$cli")"
    case "$state" in
      http)    echo "  $cli: http (shared daemon)" ;;
      stdio)   echo "  $cli: stdio (previous arrangement)" ;;
      none)    echo "  $cli: none (no mempalace registration)" ;;
      unknown) echo "  $cli: *** UNRECOGNISED — residue remains ***"
               residue="$residue $cli" ;;
    esac
  done
  if [ -n "$residue" ]; then
    echo ""
    echo "Residue remains for:$residue"
    return 1
  fi
  echo ""
  echo "No residue remains — every present assistant is in a recognisable"
  echo "arrangement (http, stdio, or none)."
  return 0
}

# --- Main ---------------------------------------------------------------------
echo "MemPalace switch residue repair (spec 0165)"
echo "==========================================="
echo ""

# Detection (R1, R2): every present assistant, classified; `unknown` is the
# residue.
PRESENT=""
RESIDUE=""
for cli in claude gemini copilot antigravity; do
  mcp_assistant_present "$cli" || continue
  PRESENT="$PRESENT $cli"
  [ "$(classify "$cli")" = "unknown" ] && RESIDUE="$RESIDUE $cli"
done

if [ -z "$PRESENT" ]; then
  echo "  No supported assistant found on this machine — nothing to repair."
  exit 0
fi

if [ -z "$RESIDUE" ]; then
  echo "  No residue found — every present assistant is in a recognisable"
  echo "  arrangement (http, stdio, or none). Nothing to repair."
  exit 0
fi

# R4 report.
echo "Residue found — assistants in neither a recognisable arrangement nor"
echo "parseable as JSON:"
echo ""
for cli in $RESIDUE; do
  report_residue "$cli"
done

if [ "$RESTORE_BACKUP" -eq 0 ] && [ "$RESET_NONE" -eq 0 ]; then
  echo "Run with --restore-backup or --reset-none to repair."
  exit 1
fi

# Apply the requested repair (R5 / R6).
if [ "$RESTORE_BACKUP" -eq 1 ]; then
  echo "Restoring the most recent usable backup for each affected assistant:"
  echo ""
  for cli in $RESIDUE; do
    restore_backup "$cli"
  done
else
  echo "Removing the mempalace registration from each affected assistant:"
  echo ""
  for cli in $RESIDUE; do
    reset_none "$cli"
  done
fi

# R7 verification — its exit code decides the run.
verify
