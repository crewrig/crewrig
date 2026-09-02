#!/usr/bin/env bash
# tests/e2e/lib/copilot_ephemeral_home.sh — shared ephemeral Copilot home
# staging, used by any probe that must inject an agent declaration into the
# user-level Copilot agent surface (`~/.copilot/agents/<name>.md`, i.e.
# `/home/agent/.copilot/agents/` in-container) without writing into the
# developer's persisted credential bundle.
#
# Consumers (spec 0194, PLAN v2):
#   - 05-copilot-model-routing's row-1 fallback control (step 2 failure path,
#     finding v2-F4).
#   - 06-agent-surface-consumption's cell 3, the cross-cell documented-layout
#     control (step 26).
#
# Why this exists (v2-F4): once Phase 2 (spec 0194 R1-R7) lands,
# `/home/agent/.copilot` is the container target of the inherited, read-write
# `[cli.copilot].mounts` entry pointing at the developer's real credential
# bundle (tests/e2e/defaults.toml). Writing an agent declaration directly at
# that in-container path would write it onto the host at
# `~/.crewrig-e2e/copilot/agents/<name>.md` — a probe fixture corrupting a
# persisted credential, which R4 forbids independently of any .gitignore
# entry. The mechanism below never touches the real bundle: it stages a
# throwaway COPY under `mktemp -d`, outside the repository working tree, and
# the caller substitutes that path for the mount's host side.
#
# Contract:
#   e2e_stage_copilot_ephemeral_home <bundle_dir> <agent_name> <decl_src>
#     Copies <bundle_dir> (if it exists) into a fresh mktemp -d staging root,
#     writes <decl_src> to <staging>/agents/<agent_name>.md (the flat
#     per-file layout `~/.copilot/agents/<name>.md` — the only layout the
#     public reference documents), tightens modes to 0700/0600, and echoes
#     the staging root path on stdout.
#
#     CALLER MUST REGISTER ITS OWN CLEANUP — this function does NOT set an
#     EXIT trap itself. It is always invoked via command substitution
#     (`staging="$(e2e_stage_copilot_ephemeral_home ...)"`), which runs in a
#     SUBSHELL: a trap set inside that subshell fires the instant the
#     subshell exits — i.e. immediately after this function returns, before
#     the caller ever uses the path — deleting the staging directory before
#     Docker can mount it (reproduced empirically: `docker run -v
#     <now-absent-path>:...` then fails with "error while creating mount
#     source path ... chown ... permission denied", the same daemon message
#     step 15 documents for a genuinely-absent bind source). The caller
#     registers `trap 'rm -rf "$staging"' EXIT` (or composes with its own
#     existing trap) AFTER capturing the returned path.
#
#   e2e_copilot_home_mount_override <new_home> [<mode>]
#     Echoes a single `-v` mount spec substituting <new_home> for the
#     container target /home/agent/.copilot, at <mode> (default: rw,
#     matching the inherited bundle mount's own mode).

set -o nounset

e2e_stage_copilot_ephemeral_home() {
  local bundle_dir="$1" agent_name="$2" decl_src="$3"
  local staging
  staging="$(mktemp -d "${TMPDIR:-/tmp}/crewrig-e2e-copilot-home.XXXXXX")" || {
    printf 'e2e_stage_copilot_ephemeral_home: mktemp -d failed\n' >&2
    return 1
  }

  if [[ -d "$bundle_dir" ]]; then
    cp -a "${bundle_dir}/." "${staging}/" 2>/dev/null || true
  fi
  mkdir -p "${staging}/agents"
  cp "$decl_src" "${staging}/agents/${agent_name}.md"

  chmod 700 "$staging"
  find "$staging" -type d -exec chmod 700 {} + 2>/dev/null || true
  find "$staging" -type f -exec chmod 600 {} + 2>/dev/null || true

  printf '%s\n' "$staging"
}

e2e_copilot_home_mount_override() {
  local new_home="$1" mode="${2:-rw}"
  printf '%s:/home/agent/.copilot:%s\n' "$new_home" "$mode"
}
