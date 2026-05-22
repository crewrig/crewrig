#!/usr/bin/env bash
# Capture resolved CLI/tool versions from built e2e images into a lockfile.
#
# Usage: e2e-capture-versions.sh <image-prefix> <lockfile-path>
# Example: e2e-capture-versions.sh crewrig/e2e docker/e2e/.versions.lock
#
# Idempotent. Overwrites the lockfile on every run.
set -euo pipefail

PREFIX="${1:-crewrig/e2e}"
LOCKFILE="${2:-docker/e2e/.versions.lock}"

run_in() {
  local image="$1"
  shift
  docker run --rm --entrypoint /bin/bash "$image" -c "$*" 2>/dev/null || true
}

first_line() { head -n1 | tr -d '\r'; }

base_img="${PREFIX}-base:latest"
claude_img="${PREFIX}-claude:latest"
gemini_img="${PREFIX}-gemini:latest"
copilot_img="${PREFIX}-copilot:latest"
mempalace_img="${PREFIX}-mempalace:latest"

debian_ver=$(run_in "$base_img" 'cat /etc/debian_version' | first_line)
node_ver=$(run_in "$base_img" 'node --version' | first_line)
npm_ver=$(run_in "$base_img" 'npm --version' | first_line)
python_ver=$(run_in "$base_img" 'python3 --version' | first_line)
pipx_ver=$(run_in "$base_img" 'pipx --version' | first_line)
gh_ver=$(run_in "$base_img" 'gh --version | head -n1' | first_line)
yq_ver=$(run_in "$base_img" 'yq --version' | first_line)
jq_ver=$(run_in "$base_img" 'jq --version' | first_line)
ollama_ver=$(run_in "$base_img" 'ollama --version 2>&1 | grep -E "client version" | head -n1' | first_line)

claude_ver=$(run_in "$claude_img" 'claude --version' | first_line)
gemini_ver=$(run_in "$gemini_img" 'gemini --version' | first_line)
copilot_ver=$(run_in "$copilot_img" 'copilot --version 2>&1 | head -n1' | first_line)
mempalace_ver=$(run_in "$mempalace_img" 'mempalace --version 2>&1 | head -n1' | first_line)

captured_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

mkdir -p "$(dirname "$LOCKFILE")"
cat > "$LOCKFILE" <<EOF
# Resolved versions captured by \`task e2e:build\`.
# Populated automatically — do not edit manually.
# Regenerate with: task e2e:lock (after task e2e:build).
captured_at=${captured_at}

base.debian=${debian_ver}
base.node=${node_ver}
base.npm=${npm_ver}
base.python=${python_ver}
base.pipx=${pipx_ver}
base.gh=${gh_ver}
base.yq=${yq_ver}
base.jq=${jq_ver}
base.ollama=${ollama_ver}

claude.cli=${claude_ver}
gemini.cli=${gemini_ver}
copilot.cli=${copilot_ver}
mempalace.cli=${mempalace_ver}
EOF

echo "Wrote ${LOCKFILE}"
cat "$LOCKFILE"
