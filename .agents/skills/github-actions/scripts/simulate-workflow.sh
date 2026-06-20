#!/usr/bin/env bash
# simulate-workflow.sh — dry-run a full workflow locally via `act`, with
# optional event-payload injection.
#
# Usage: simulate-workflow.sh <workflow-file> [event-type] [event-payload-json-file]
#
# Defaults: event-type = push. When no payload file is given, a minimal
# default payload matching the event-type is synthesized in a tempfile.

set -euo pipefail

usage() {
    echo "Usage: $(basename "$0") <workflow-file> [event-type] [event-payload-json-file]" >&2
    exit 2
}

if [ "$#" -lt 1 ] || [ "$#" -gt 3 ]; then
    usage
fi

WORKFLOW="$1"
EVENT="${2:-push}"
PAYLOAD="${3:-}"

if [ ! -f "$WORKFLOW" ]; then
    echo "[FAIL] workflow file not found: $WORKFLOW" >&2
    exit 1
fi

if ! command -v act >/dev/null 2>&1; then
    echo "[SKIP] act not found — install: brew install act"
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

cleanup_payload=""
cleanup() {
    if [ -n "$cleanup_payload" ] && [ -f "$cleanup_payload" ]; then
        rm -f "$cleanup_payload"
    fi
}
trap cleanup EXIT

default_payload_for() {
    case "$1" in
        push)               echo '{"ref":"refs/heads/main"}' ;;
        pull_request)       echo '{"action":"opened","pull_request":{"number":1,"head":{"ref":"feature"},"base":{"ref":"main"}}}' ;;
        workflow_dispatch)  echo '{"inputs":{}}' ;;
        release)            echo '{"action":"published","release":{"tag_name":"v0.0.0"}}' ;;
        schedule)           echo '{}' ;;
        *)                  echo '{}' ;;
    esac
}

if [ -z "$PAYLOAD" ]; then
    cleanup_payload="$(mktemp -t act-payload.XXXXXX.json)"
    default_payload_for "$EVENT" > "$cleanup_payload"
    PAYLOAD="$cleanup_payload"
elif [ ! -f "$PAYLOAD" ]; then
    echo "[FAIL] event payload file not found: $PAYLOAD" >&2
    exit 1
fi

cmd=(act "$EVENT" --workflows "$WORKFLOW" --eventpath "$PAYLOAD" --dryrun)

echo "+ ${cmd[*]}"
"${cmd[@]}"
