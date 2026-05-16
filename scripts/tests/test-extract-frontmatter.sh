#!/usr/bin/env bash
# Regression test for issue #24 — extract_frontmatter() leaks body content
# when bare `---` lines appear inside fenced code blocks in the Markdown body.
#
# The current implementation in scripts/build-components.sh uses:
#   sed -n '/^---$/,/^---$/p' "$1" | sed '1d;$d'
# `sed` range mode restarts after each closing match, so any subsequent pair
# of `---` lines (including ones inside ```yaml fenced blocks) is re-emitted
# and merged with the real frontmatter.
#
# Expected behavior: only the YAML between the FIRST two `---` lines is
# returned. The test fails (exit 1) against the buggy implementation and
# passes (exit 0) once the bug is fixed.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TARGET_SCRIPT="$REPO_DIR/scripts/build-components.sh"

if [[ ! -f "$TARGET_SCRIPT" ]]; then
  echo "FAIL: cannot locate build-components.sh at $TARGET_SCRIPT" >&2
  exit 1
fi

# Extract the current extract_frontmatter() function body from the real
# script, then eval it into this shell. We do NOT source the whole script
# because it has `set -euo pipefail` and runs a CLI parser at load time.
fn_src="$(awk '
  /^extract_frontmatter\(\) \{/ { capture = 1 }
  capture { print }
  capture && /^\}/ { exit }
' "$TARGET_SCRIPT")"

if [[ -z "$fn_src" ]]; then
  echo "FAIL: could not extract extract_frontmatter() from $TARGET_SCRIPT" >&2
  exit 1
fi

eval "$fn_src"

# Build a fixture: real frontmatter + a body containing a fenced code block
# with bare `---` separators inside.
fixture="$(mktemp -t extract-frontmatter-fixture.XXXXXX)"
trap 'rm -f "$fixture"' EXIT

cat > "$fixture" <<'EOF'
---
name: test-skill
description: A test skill
---

Some body text.

```yaml
---
nested: value
---
```

More body text.
EOF

actual="$(extract_frontmatter "$fixture")"

# The bug surfaces as `nested: value` (or the embedded `---` separators)
# bleeding into the output.
if printf '%s\n' "$actual" | grep -q 'nested: value'; then
  printf 'FAIL: extracted frontmatter leaked body content. Expected only {name, description}; got: %s\n' \
    "$(printf '%s' "$actual" | tr '\n' '|')" >&2
  exit 1
fi

# Positive assertions — the real frontmatter must still be present.
if ! printf '%s\n' "$actual" | grep -qx 'name: test-skill'; then
  printf 'FAIL: expected "name: test-skill" in output; got: %s\n' \
    "$(printf '%s' "$actual" | tr '\n' '|')" >&2
  exit 1
fi

if ! printf '%s\n' "$actual" | grep -qx 'description: A test skill'; then
  printf 'FAIL: expected "description: A test skill" in output; got: %s\n' \
    "$(printf '%s' "$actual" | tr '\n' '|')" >&2
  exit 1
fi

echo "PASS: extract_frontmatter ignores ---  lines inside fenced code blocks"
exit 0
