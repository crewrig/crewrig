#!/usr/bin/env bash
# check-markdown-links.sh — Validate relative Markdown links across tracked .md files
#
# Usage:
#   bash scripts/check-markdown-links.sh [file1.md file2.md ...]

set -euo pipefail

exec python3 - "$@" << 'EOF'
import sys, os, re, subprocess, urllib.parse

def main():
    repo_dir = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
    os.chdir(repo_dir)

    files = sys.argv[1:]
    if not files:
        files = subprocess.check_output(["git", "ls-files", "*.md"], text=True).splitlines()

    errors = 0
    link_regex = re.compile(r"\]\(([^)\s]+|\<[^>]+\>)\)")

    for rel_file in files:
        if not os.path.isfile(rel_file):
            continue
        
        file_dir = os.path.dirname(rel_file)

        with open(rel_file, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()

        in_code_block = False
        for line_idx, line in enumerate(lines, 1):
            stripped = line.strip()
            if stripped.startswith("```"):
                in_code_block = not in_code_block
                continue

            if in_code_block:
                continue

            # Strip inline code spans (`...`)
            line_no_inline = re.sub(r"`[^`]+`", "", line)

            for match in link_regex.findall(line_no_inline):
                target = match.strip("<>")

                # 1. Ignore absolute URL schemes
                if re.match(r"^(https?|mailto|ftp):", target, re.I):
                    continue

                # 2. Ignore pure fragment anchors
                if target.startswith("#"):
                    continue

                # 3. Ignore templated targets
                if "${" in target or "{{" in target or "$CANONICAL_REPO" in target:
                    continue

                # 4. Ignore GitHub tree-escape patterns
                if re.search(r"\.\./.*(issues|pull)/[0-9]+", target):
                    continue

                # 5. Strip trailing fragment anchors
                clean_target = target.split("#")[0]
                if not clean_target:
                    continue

                # 6. Percent-decode URL
                decoded_target = urllib.parse.unquote(clean_target)

                # 7. Resolve relative path
                resolved = os.path.normpath(os.path.join(file_dir, decoded_target))

                # 8. Verify existence as file or directory
                if not os.path.exists(resolved):
                    print(f"FAIL: {rel_file}:{line_idx}: '{target}' -> resolved to '{resolved}' (does not exist)")
                    errors += 1

    if errors > 0:
        print(f"Found {errors} broken relative Markdown link(s).")
        sys.exit(1)
    else:
        print("All relative Markdown links resolved cleanly.")
        sys.exit(0)

if __name__ == "__main__":
    main()
EOF
