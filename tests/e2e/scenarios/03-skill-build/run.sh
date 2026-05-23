#!/usr/bin/env bash
# tests/e2e/scenarios/03-skill-build/run.sh
#
# Pillar 3 — Skill build. Runs `scripts/build-components.sh` inside the
# per-CLI image (bind-mounted at /repo) against a writable copy of the
# repo, then asserts the per-CLI built artefacts are present and that
# the first built SKILL.md carries a `metadata:` frontmatter key.
#
# Parity: claude, gemini, copilot. The build script natively branches
# on `--target <cli>`; each CLI's expected output directory is encoded
# in the per-CLI map below.

set -euo pipefail

: "${E2E_LIB_DIR:?runner must export E2E_LIB_DIR}"
: "${E2E_REPORT_DIR:?runner must export E2E_REPORT_DIR}"
: "${E2E_CLI:?runner must export E2E_CLI}"
: "${E2E_IMAGE:?runner must export E2E_IMAGE}"
: "${E2E_SCENARIO_DIR:?runner must export E2E_SCENARIO_DIR}"

# shellcheck source=../../lib/assert.sh
source "${E2E_LIB_DIR}/assert.sh"
# shellcheck source=../../lib/structural.sh
source "${E2E_LIB_DIR}/structural.sh"

SCENARIO_TAP="${E2E_REPORT_DIR}/scenario.tap"
: > "$SCENARIO_TAP"
SUB_INDEX=0
SUB_NOK=0

sub_emit() {
  SUB_INDEX=$((SUB_INDEX + 1))
  case "$1" in
    ok)     printf 'ok %d - %s\n'     "$SUB_INDEX" "$2" >> "$SCENARIO_TAP" ;;
    not_ok) printf 'not ok %d - %s\n' "$SUB_INDEX" "$2" >> "$SCENARIO_TAP"; SUB_NOK=$((SUB_NOK + 1)) ;;
  esac
}

scenario_skip() {
  printf '1..0 # SKIP %s\n' "$1" > "$SCENARIO_TAP"
  printf 'SKIP - %s/03-skill-build: %s\n' "$E2E_CLI" "$1"
  exit 78
}

# --------------------------------------------------------------------------
# Per-CLI expected output dir under the repo root inside the container.
# --------------------------------------------------------------------------
case "$E2E_CLI" in
  claude)
    target_flag="claude"
    expect_dir=".claude"
    skill_glob=".claude/skills"
    ;;
  gemini)
    target_flag="gemini"
    expect_dir=".gemini"
    skill_glob=".gemini/skills"
    ;;
  copilot)
    target_flag="copilot"
    expect_dir=".github"
    skill_glob=".github/skills"
    ;;
  *)
    scenario_skip "unknown CLI '${E2E_CLI}'"
    ;;
esac

# Walk up from the scenario dir to find the repo root (the dir holding
# scripts/build-components.sh). Required because the scenario may be
# invoked from any worktree path.
REPO_ROOT="$E2E_SCENARIO_DIR"
while [[ "$REPO_ROOT" != "/" && ! -f "${REPO_ROOT}/scripts/build-components.sh" ]]; do
  REPO_ROOT="$(dirname "$REPO_ROOT")"
done
if [[ ! -f "${REPO_ROOT}/scripts/build-components.sh" ]]; then
  scenario_skip "could not locate scripts/build-components.sh from ${E2E_SCENARIO_DIR}"
fi

# Stage a writable copy of community-config + scripts into the case dir
# so the build is hermetic (the source tree is read-only on principle).
work_dir="${E2E_REPORT_DIR}/build-work"
mkdir -p "$work_dir"
cp -R "${REPO_ROOT}/community-config" "$work_dir/" 2>/dev/null || true
cp -R "${REPO_ROOT}/scripts"          "$work_dir/" 2>/dev/null || true
cp -R "${REPO_ROOT}/config"           "$work_dir/" 2>/dev/null || true

host_out="${E2E_REPORT_DIR}/out"
mkdir -p "$host_out"

container_name="crewrig-e2e-03-${E2E_CLI}-${E2E_RUN_ID:-adhoc}"

# Single bash -lc invocation: build, then walk the output dir into a
# manifest, then cp the manifest to the bind-mounted /out so the host
# can assert on it without invoking `docker cp` separately.
build_script="$(cat <<EOF
set -euo pipefail
cd /repo
bash scripts/build-components.sh --target ${target_flag}
manifest=/tmp/e2e-build-manifest.txt
if [ -d "${expect_dir}" ]; then
  find "${expect_dir}" -type f | sort > "\$manifest"
else
  printf 'MISSING: %s\n' "${expect_dir}" > "\$manifest"
fi
cp "\$manifest" /out/manifest.txt

# Locate the first SKILL.md for the structural assertion.
first_skill=\$(find "${skill_glob}" -name 'SKILL.md' -type f 2>/dev/null | sort | head -n1 || true)
if [ -n "\$first_skill" ]; then
  cp "\$first_skill" /out/first-skill.md
fi
EOF
)"

docker_argv=(
  docker run --rm --name "$container_name"
  -v "${work_dir}:/repo"
  -v "${host_out}:/out"
  --entrypoint bash
  "$E2E_IMAGE"
  -lc "$build_script"
)

{
  printf 'image: %s\n' "$E2E_IMAGE"
  printf 'argv:'
  for a in "${docker_argv[@]}"; do printf ' %q' "$a"; done
  printf '\n'
} > "${E2E_REPORT_DIR}/invocation.txt"

if ! "${docker_argv[@]}" \
      >"${E2E_REPORT_DIR}/build.stdout" \
      2>"${E2E_REPORT_DIR}/build.stderr"
then
  sub_emit not_ok "build: scripts/build-components.sh exited non-zero"
else
  sub_emit ok "build: scripts/build-components.sh exited 0"
fi

manifest_host="${host_out}/manifest.txt"
first_skill_host="${host_out}/first-skill.md"

# Side-effect 1 — manifest file present.
if assert_file_exists "$manifest_host"; then
  sub_emit ok "side-effect: build manifest written to /out"
else
  sub_emit not_ok "side-effect: build manifest missing"
fi

# Side-effect 2 — built dir contains at least one file.
if assert_file_contains "$manifest_host" "^${expect_dir}/"; then
  sub_emit ok "side-effect: ${expect_dir}/ populated by build"
else
  sub_emit not_ok "side-effect: ${expect_dir}/ empty or missing"
fi

# Side-effect 3 — at least one built SKILL.md.
if assert_file_contains "$manifest_host" "SKILL\\.md$|/agents/"; then
  sub_emit ok "side-effect: skills or agents emitted"
else
  sub_emit not_ok "side-effect: no skills nor agents emitted"
fi

# Structural — first built SKILL.md has a `metadata:` frontmatter key.
if [[ -f "$first_skill_host" ]]; then
  if assert_stdout_matches '^metadata:' "$first_skill_host"; then
    sub_emit ok "structural: first SKILL.md carries metadata: frontmatter"
  else
    sub_emit not_ok "structural: first SKILL.md missing metadata: frontmatter"
  fi
else
  sub_emit not_ok "structural: no SKILL.md captured for inspection"
fi

printf '1..%d\n' "$SUB_INDEX" >> "$SCENARIO_TAP"

if (( SUB_NOK > 0 )); then
  printf '%d/%d FAIL — %s/03-skill-build\n' "$SUB_NOK" "$SUB_INDEX" "$E2E_CLI"
  exit 1
fi
printf 'OK — %s/03-skill-build (%d assertions)\n' "$E2E_CLI" "$SUB_INDEX"
exit 0
