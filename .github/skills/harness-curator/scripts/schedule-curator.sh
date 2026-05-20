#!/bin/bash
# schedule-curator.sh — Install (or remove) a recurring local schedule that
# runs `curate.sh --apply --dedup --max-issues 5` on the maintainer's
# machine. Auto mode never runs on CI by design: MemPalace state is local.
#
# Usage:
#   bash schedule-curator.sh             # interactive install
#   bash schedule-curator.sh --dry-run   # print the plist / cron line, no install
#   bash schedule-curator.sh --uninstall # remove the managed schedule entry
#
# Idempotency: re-running install replaces the previous entry, never
# duplicates. On macOS the plist lives at
# `~/Library/LaunchAgents/io.crewrig.harness-curator.plist`. On Linux the
# crontab entry is wrapped between a recognizable marker comment.

set -euo pipefail

DRY_RUN=false
UNINSTALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)   DRY_RUN=true; shift ;;
    --uninstall) UNINSTALL=true; shift ;;
    --help|-h)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Run '$0 --help' for usage." >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CURATE_SH="$SCRIPT_DIR/curate.sh"
LABEL="io.crewrig.harness-curator"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
CRON_MARKER="# crewrig-harness-curator (managed by schedule-curator.sh)"

OS="$(uname -s)"
case "$OS" in
  Darwin|Linux) ;;
  *) echo "Error: unsupported OS '$OS' — only Darwin (launchd) and Linux (cron) are wired." >&2; exit 1 ;;
esac

# Logfile follows the platform idiom: macOS uses ~/Library/Logs, Linux
# follows XDG state directory. mkdir -p the parent so the first scheduled
# run doesn't fail on a missing directory.
if [ "$OS" = "Darwin" ]; then
  LOGFILE="$HOME/Library/Logs/crewrig-harness-curator.log"
else
  LOGFILE="${XDG_STATE_HOME:-$HOME/.local/state}/crewrig/harness-curator.log"
fi

uninstall_macos() {
  if [ ! -f "$PLIST" ]; then
    echo "No managed plist at $PLIST — nothing to remove."
    return 0
  fi
  # Modern API first; fall back to the deprecated `unload` for older
  # macOS. Both are safe to call even if the agent is not loaded.
  if ! launchctl bootout "gui/$UID" "$PLIST" 2>/dev/null; then
    launchctl unload "$PLIST" 2>/dev/null || true
  fi
  rm -f "$PLIST"
  echo "Removed: $PLIST"
}

uninstall_linux() {
  if ! crontab -l 2>/dev/null | grep -q 'crewrig-harness-curator'; then
    echo "No managed crontab entry — nothing to remove."
    return 0
  fi
  ( crontab -l 2>/dev/null | grep -v 'crewrig-harness-curator' ) | crontab -
  echo "Removed crewrig-harness-curator entry from crontab."
}

if [ "$UNINSTALL" = true ]; then
  case "$OS" in
    Darwin) uninstall_macos ;;
    Linux)  uninstall_linux ;;
  esac
  exit 0
fi

# --- Interactive prereqs ---
command -v fzf >/dev/null 2>&1 || {
  echo "Error: fzf is required for interactive prompts." >&2
  echo "Install with: brew install fzf (macOS) or apt-get install fzf (Linux)" >&2
  exit 1
}

command -v gh >/dev/null 2>&1 || {
  echo "Error: 'gh' CLI is required (the scheduled run calls 'gh issue create')." >&2
  echo "Install: https://cli.github.com/" >&2
  exit 1
}

if ! gh auth status >/dev/null 2>&1; then
  echo "Error: 'gh' is not authenticated. Run 'gh auth login' first." >&2
  exit 1
fi

[ -f "$CURATE_SH" ] || {
  echo "Error: curate.sh not found at $CURATE_SH" >&2
  exit 1
}

echo "===================================================="
echo "  Harness Curator — schedule installer"
echo "===================================================="
echo ""
echo "Target OS:  $OS"
echo "Curator:    $CURATE_SH"
echo "Logfile:    $LOGFILE"
echo ""

# --- Schedule prompt ---
FREQUENCY=$(printf 'weekly\ndaily\n' | fzf --height 10% --header "Run frequency?")
[ -n "$FREQUENCY" ] || { echo "Cancelled."; exit 0; }

# Hours 00..23. `printf '%02d\n' {00..23}` works on bash 4+ but not bash 3.2
# (macOS default); a seq+printf form keeps it portable.
HOUR=$(seq 0 23 | awk '{printf "%02d\n", $0}' | fzf --height 30% --header "Hour of day (24h)?" --query "09")
[ -n "$HOUR" ] || { echo "Cancelled."; exit 0; }
# Strip leading zero for cron (cron accepts both but matches downstream
# tooling more cleanly).
HOUR_INT=$((10#$HOUR))

# The scheduled command line. Auto mode = --apply with dedup and
# --max-issues 5, run via `bash -lc` so $PATH and pipx resolve as if a
# login shell launched it.
CMD="bash $CURATE_SH --apply --dedup --max-issues 5"

mkdir -p "$(dirname "$LOGFILE")"

install_macos() {
  mkdir -p "$(dirname "$PLIST")"
  local weekday_line=""
  if [ "$FREQUENCY" = "weekly" ]; then
    # Monday (Weekday=1 in launchd's StartCalendarInterval semantics).
    weekday_line="    <key>Weekday</key>
    <integer>1</integer>
"
  fi
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>${CMD}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
${weekday_line}    <key>Hour</key>
    <integer>${HOUR_INT}</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOGFILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOGFILE}</string>
</dict>
</plist>
PLIST
}

install_linux() {
  local cron_expr
  if [ "$FREQUENCY" = "weekly" ]; then
    cron_expr="0 ${HOUR_INT} * * 1"
  else
    cron_expr="0 ${HOUR_INT} * * *"
  fi
  printf '%s\n%s\n' \
    "$CRON_MARKER" \
    "$cron_expr /bin/bash -lc '$CMD' >> $LOGFILE 2>&1"
}

print_tail_message() {
  echo ""
  echo "Reactive trigger (run manually when a severity:high friction is filed):"
  echo "    bash $CURATE_SH --apply --dedup --max-issues 5"
}

if [ "$DRY_RUN" = true ]; then
  case "$OS" in
    Darwin) install_macos ;;
    Linux)  install_linux ;;
  esac
  print_tail_message
  exit 0
fi

case "$OS" in
  Darwin)
    install_macos > "$PLIST"
    echo "Wrote: $PLIST"
    # Replace any prior load so the install is idempotent. bootout/bootstrap
    # is the modern API; older macOS versions fall back to unload/load.
    launchctl bootout "gui/$UID" "$PLIST" 2>/dev/null \
      || launchctl unload "$PLIST" 2>/dev/null \
      || true
    if launchctl bootstrap "gui/$UID" "$PLIST" 2>/dev/null; then
      echo "Loaded via launchctl bootstrap."
    else
      launchctl load "$PLIST"
      echo "Loaded via launchctl load (legacy path)."
    fi
    ;;
  Linux)
    CRONLINE=$(install_linux | tail -1)
    # Strip any pre-existing managed entry (marker + cron line), then
    # append the fresh pair. `crontab -l` exits 1 with no crontab — the
    # `|| true` shields against `set -e`.
    ( crontab -l 2>/dev/null | grep -v 'crewrig-harness-curator' || true; \
      echo "$CRON_MARKER"; \
      echo "$CRONLINE" ) | crontab -
    echo "Installed cron entry:"
    echo "  $CRONLINE"
    ;;
esac

print_tail_message
