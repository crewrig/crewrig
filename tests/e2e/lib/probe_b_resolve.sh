#!/usr/bin/env bash
# tests/e2e/lib/probe_b_resolve.sh — probe B (06-agent-surface-consumption)
# per-cell outcome resolver. Pure function, no I/O, no env-var
# preconditions — sourceable in isolation by scripts/tests/test-e2e-
# probes.sh with synthetic cell results (spec 0194 R12-R14).
#
# e2e_probe_b_resolve_cell <nonce_observed> <baseline_observed>
#   Each argument is the literal string "true" or "false". Echoes one of
#   "consumed" | "not-consumed" | "indeterminate" on stdout.
#
#   consumed      — the cell's own nonce appears in the reply.
#   not-consumed  — nonce absent AND the in-cell baseline present (proves
#                   the session was alive; the declaration specifically was
#                   not read/consumed).
#   indeterminate — nonce absent AND baseline absent too (R12: "never
#                   omitted from the record" — a broken session must not
#                   be silently reported as a negative surface result).

set -o nounset

e2e_probe_b_resolve_cell() {
  local nonce_observed="$1" baseline_observed="$2"
  if [[ "$nonce_observed" == "true" ]]; then
    printf 'consumed\n'
  elif [[ "$baseline_observed" == "true" ]]; then
    printf 'not-consumed\n'
  else
    printf 'indeterminate\n'
  fi
}
