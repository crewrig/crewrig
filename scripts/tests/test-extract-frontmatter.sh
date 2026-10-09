#!/usr/bin/env bash
# Regression test for issue #24 — frontmatter extraction leaks body content
# when bare `---` lines appear inside fenced code blocks in the Markdown body.
#
# The original implementation in scripts/build-components.sh used:
#   sed -n '/^---$/,/^---$/p' "$1" | sed '1d;$d'
# `sed` range mode restarts after each closing match, so any subsequent pair
# of `---` lines (including ones inside ```yaml fenced blocks) is re-emitted
# and merged with the real frontmatter.
#
# Expected behavior: only the YAML between the FIRST two `---` lines is read as
# frontmatter, and everything after the closing `---` is body, untouched.
#
# This suite observes that behavior on the build's OUTPUT, never by reaching
# into the build's internals (spec 0250 R10, R26): it stages a scratch repository
# root holding one skill whose body carries a fenced `---` pair, runs the real
# build against it (`REPO_DIR` points the build at the scratch root), and asserts
# on the built `.claude/skills/test-skill/SKILL.md`. The same assertions hold for
# the shell build and for its TypeScript replacement.
#
# The suite fails (exit 1) against the buggy extraction and passes (exit 0) once
# the bug is fixed.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_SCRIPT="$REPO_DIR/scripts/build-components.sh"

if [[ ! -f "$BUILD_SCRIPT" ]]; then
  echo "FAIL: cannot locate the build script at $BUILD_SCRIPT" >&2
  exit 1
fi

# Scratch root: no staged tree is needed. The build resolves its own libraries
# (and, once migrated, its dependencies) from the real checkout, and writes only
# under REPO_DIR, which is the scratch root.
scratch="$(mktemp -d -t extract-frontmatter-fixture.XXXXXX)"
trap 'rm -rf "$scratch"' EXIT

skill_dir="$scratch/artifacts/core/skills/test-skill"
mkdir -p "$skill_dir"

# Fixture: real frontmatter + a body containing a fenced code block with bare
# `---` separators inside.
cat > "$skill_dir/SKILL.md" <<'EOF'
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

if ! REPO_DIR="$scratch" bash "$BUILD_SCRIPT" --target claude \
     > "$scratch/build.stdout" 2> "$scratch/build.stderr"; then
  printf 'FAIL: the build exited non-zero on the fixture. stderr: %s\n' \
    "$(tr '\n' '|' < "$scratch/build.stderr")" >&2
  exit 1
fi

built="$scratch/.claude/skills/test-skill/SKILL.md"
if [[ ! -f "$built" ]]; then
  # A frontmatter that leaked body content corrupts the skill name the build
  # reads, so the output lands under a wrong path: name what was produced.
  printf 'FAIL: the build did not produce .claude/skills/test-skill/SKILL.md. Produced: %s\n' \
    "$( (cd "$scratch" && find .claude -print 2>/dev/null) | tr '\n' '|')" >&2
  exit 1
fi

# Split the built file the way a reader would: the frontmatter is the block
# between the first two `---` lines, the body is everything after the second.
built_frontmatter="$(awk 'NR==1 && /^---$/{inblk=1; next} inblk && /^---$/{exit} inblk{print}' "$built")"
built_body="$(awk 'BEGIN{c=0} /^---$/{c++; if(c==2){found=1; next}} found{print}' "$built")"

# The bug surfaces as `nested: value` (or the embedded `---` separators)
# bleeding into the built frontmatter.
if grep -q 'nested: value' <<< "$built_frontmatter" || grep -qx -- '---' <<< "$built_frontmatter"; then
  printf 'FAIL: built frontmatter leaked body content. Expected only {name, description}; got: %s\n' \
    "$(printf '%s' "$built_frontmatter" | tr '\n' '|')" >&2
  exit 1
fi

# Exactly the two source keys, no more: every top-level key line is counted.
# (Quote style around the values is a rendering choice the build owns, so the
# values are compared with one optional pair of double quotes stripped.)
key_count="$(grep -cE '^[A-Za-z_][A-Za-z0-9_-]*:' <<< "$built_frontmatter")"
name_value="$(sed -n -E 's/^name:[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1/p' <<< "$built_frontmatter")"
description_value="$(sed -n -E 's/^description:[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1/p' <<< "$built_frontmatter")"

if [[ "$key_count" != "2" ]] || [[ "$name_value" != "test-skill" ]] || [[ "$description_value" != "A test skill" ]]; then
  printf 'FAIL: expected exactly {name: test-skill, description: A test skill}; got %s key(s): %s\n' \
    "$key_count" "$(printf '%s' "$built_frontmatter" | tr '\n' '|')" >&2
  exit 1
fi

# The fenced content belongs to the body and must survive there, with both of
# its `---` lines.
if ! grep -qx 'nested: value' <<< "$built_body"; then
  printf 'FAIL: the fenced "nested: value" line is missing from the built body; got: %s\n' \
    "$(printf '%s' "$built_body" | tr '\n' '|')" >&2
  exit 1
fi

fence_rule_count="$(grep -cx -- '---' <<< "$built_body")"
if [[ "$fence_rule_count" != "2" ]]; then
  printf 'FAIL: expected both fenced "---" lines in the built body, found %s; got: %s\n' \
    "$fence_rule_count" "$(printf '%s' "$built_body" | tr '\n' '|')" >&2
  exit 1
fi

echo "PASS: the built skill ignores ---  lines inside fenced code blocks"
exit 0
