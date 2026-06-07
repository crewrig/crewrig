#!/usr/bin/env bash
# simulate-job.sh — dry-run a single workflow job locally via `act`.
#
# Usage: simulate-job.sh <workflow-file> <job-id> [event-type]
#
# Defaults: event-type = push.
# Requires: `act` and a running Docker daemon. If either is missing the
# script exits 0 with an explanatory message — it is not a hard blocker.

set -euo pipefail

usage() {
    echo "Usage: $(basename "$0") <workflow-file> <job-id> [event-type]" >&2
    exit 2
}

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
    usage
fi

WORKFLOW="$1"
JOB_ID="$2"
EVENT="${3:-push}"

if [ ! -f "$WORKFLOW" ]; then
    echo "[FAIL] workflow file not found: $WORKFLOW" >&2
    exit 1
fi

if ! command -v act >/dev/null 2>&1; then
    echo "[SKIP] act not found — install: brew install act"
    echo "       act runs GitHub Actions locally inside Docker containers."
    exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "[SKIP] docker CLI not found — act needs Docker to run containers."
    exit 0
fi

if ! docker info >/dev/null 2>&1; then
    echo "[SKIP] Docker daemon not reachable — start Docker Desktop or the docker service."
    exit 0
fi

cmd=(act "$EVENT" --workflows "$WORKFLOW" --job "$JOB_ID" --dryrun)

echo "+ ${cmd[*]}"
"${cmd[@]}"
