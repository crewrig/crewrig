#!/usr/bin/env bash
# test-check-markdown-links.sh — Hermetic unit tests for check-markdown-links.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK_SCRIPT="$REPO_DIR/scripts/check-markdown-links.sh"

TEST_DIR="$(mktemp -d -t test-md-links.XXXXXX)"
trap 'rm -rf "$TEST_DIR"' EXIT

cd "$TEST_DIR"
git init -q
git config user.name "Test Runner"
git config user.email "test@example.com"
git config commit.gpgsign false

# Create targets
mkdir -p docs sub/folder
touch target.md docs/guide.md "sub/folder/file with spaces.md"

# Test 1: Valid relative links pass
cat << 'EOF' > valid.md
# Valid Links
- [Target](target.md)
- [Guide](docs/guide.md)
- [With Fragment](target.md#section)
- [Percent Encoded](sub/folder/file%20with%20spaces.md)
- [Absolute](https://example.com)
- [Mailto](mailto:user@example.com)
- [Anchor](#top)
- [Templated](${VARIABLE}/path)
- [GitHub Issue](../../../../issues/80)
EOF

git add .
git commit -m "add valid test files" -q

if bash "$CHECK_SCRIPT" valid.md > /dev/null 2>&1; then
  echo "PASS: valid links check passed"
else
  echo "FAIL: valid links check failed unexpectedly"
  exit 1
fi

# Test 2: Broken link fails
cat << 'EOF' > broken.md
# Broken Link
- [Non-existent](non_existent_file.md)
EOF
git add broken.md
git commit -m "add broken link file" -q

if bash "$CHECK_SCRIPT" broken.md > /dev/null 2>&1; then
  echo "FAIL: broken link passed unexpectedly"
  exit 1
else
  echo "PASS: broken link correctly detected and failed"
fi

# Test 3: Link inside code block / inline code span is ignored
cat << 'EOF' > code.md
# Code Blocks and Spans
`[ignored](non_existent_inline.md)`

```markdown
[ignored](non_existent_fenced.md)
```
EOF
git add code.md
git commit -m "add code test file" -q

if bash "$CHECK_SCRIPT" code.md > /dev/null 2>&1; then
  echo "PASS: links inside code spans and blocks ignored"
else
  echo "FAIL: links inside code spans or blocks incorrectly flagged"
  exit 1
fi

echo "All check-markdown-links.sh tests passed cleanly."
