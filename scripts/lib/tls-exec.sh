#!/usr/bin/env bash
# scripts/lib/tls-exec.sh — Runtime trust-propagation wrapper (spec 0084).
#
# Sources the per-user managed TLS delegation file (if present) so the wrapped
# command inherits custom root-CA / native-TLS trust, then execs the command.
# A missing managed file is a silent no-op: the wrapper is transparent when the
# user never consented to TLS delegation.
#
# Registered as the command prefix for framework-launched runtime paths (the
# MCP servers, the supervised ChromaDB daemon) so trust reaches processes the
# CLI spawns long after setup — WITHOUT editing the user's shell profile
# (spec 0084 R7/R11).
#
# Usage: bash scripts/lib/tls-exec.sh <command> [args...]
set -eu

_tls_env="${HOME}/.crewrig/tls-env.sh"
if [ -f "${_tls_env}" ]; then
  # shellcheck source=/dev/null
  . "${_tls_env}"
fi

exec "$@"
