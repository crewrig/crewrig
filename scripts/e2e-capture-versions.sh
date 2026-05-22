#!/usr/bin/env bash
# Capture resolved CLI/tool versions from built e2e images into a lockfile.
#
# Usage: e2e-capture-versions.sh <image-prefix> <lockfile-path>
# Example: e2e-capture-versions.sh crewrig/e2e docker/e2e/.versions.lock
#
# Idempotent. Overwrites the lockfile on every run.
#
# Failure modes:
#   - Any of the five images missing locally: exits non-zero before any
#     `docker run`, with a list of missing tags. Run `task e2e:build` first.
#   - `<cli> --version` inside an image returns empty: lockfile field is
#     written as `<unknown>` and the script exits non-zero at the end so
#     CI / the caller sees the regression.
set -euo pipefail

PREFIX="${1:-crewrig/e2e}"
LOCKFILE="${2:-docker/e2e/.versions.lock}"

base_img="${PREFIX}-base:latest"
claude_img="${PREFIX}-claude:latest"
gemini_img="${PREFIX}-gemini:latest"
copilot_img="${PREFIX}-copilot:latest"
mempalace_img="${PREFIX}-mempalace:latest"

# Precondition: every image must exist locally. Bail loudly otherwise so
# standalone `task e2e:lock` invocations don't silently produce a half-empty
# lockfile.
missing=()
for img in "$base_img" "$claude_img" "$gemini_img" "$copilot_img" "$mempalace_img"; do
  if ! docker image inspect "$img" >/dev/null 2>&1; then
    missing+=("$img")
  fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "ERROR: required image(s) not found locally:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  echo "Run 'task e2e:build' first." >&2
  exit 1
fi

empty_fields=()

run_in() {
  # Run a command inside an image, return stdout (stderr suppressed). On a
  # non-zero exit the caller sees an empty string — which is then detected
  # by capture() and recorded in empty_fields.
  local image="$1"
  shift
  docker run --rm --entrypoint /bin/bash "$image" -c "$*" 2>/dev/null || true
}

first_line() { head -n1 | tr -d '\r'; }

capture() {
  # capture <field-name> <image> <shell-snippet>
  # Writes the resolved version to stdout; on empty output records the
  # field name in empty_fields and emits "<unknown>".
  local name="$1" image="$2" snippet="$3"
  local value
  value=$(run_in "$image" "$snippet" | first_line)
  if [ -z "$value" ]; then
    empty_fields+=("$name")
    echo "<unknown>"
  else
    echo "$value"
  fi
}

debian_ver=$(capture base.debian "$base_img" 'cat /etc/debian_version')
node_ver=$(capture base.node "$base_img" 'node --version')
npm_ver=$(capture base.npm "$base_img" 'npm --version')
python_ver=$(capture base.python "$base_img" 'python3 --version')
pipx_ver=$(capture base.pipx "$base_img" 'pipx --version')
gh_ver=$(capture base.gh "$base_img" 'gh --version | head -n1')
yq_ver=$(capture base.yq "$base_img" 'yq --version')
jq_ver=$(capture base.jq "$base_img" 'jq --version')
# Ollama prints "Warning: could not connect to a running Ollama instance"
# followed by "Warning: client version is X.Y.Z" on stderr when no daemon
# is reachable. Extract just the X.Y.Z so the lockfile holds a clean value.
ollama_ver=$(capture base.ollama "$base_img" \
  'ollama --version 2>&1 | sed -nE "s/.*client version is ([0-9A-Za-z.+-]+).*/\\1/p" | head -n1')

claude_ver=$(capture claude.cli "$claude_img" 'claude --version')
gemini_ver=$(capture gemini.cli "$gemini_img" 'gemini --version')
copilot_ver=$(capture copilot.cli "$copilot_img" 'copilot --version 2>&1 | head -n1')
mempalace_ver=$(capture mempalace.cli "$mempalace_img" 'mempalace --version 2>&1 | head -n1')

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

if [ "${#empty_fields[@]}" -gt 0 ]; then
  echo >&2
  echo "ERROR: the following lockfile fields resolved to <unknown>:" >&2
  printf '  - %s\n' "${empty_fields[@]}" >&2
  echo "Rebuild the affected image(s) and re-run." >&2
  exit 2
fi
