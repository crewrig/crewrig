# Step 4: linters

Select the scripts by the extensions in the changed-files list and run each on its matching subset of paths, from the repository root so the tools find the repository's own configuration (`.oxlintrc.json`, `.oxfmtrc.json`, `node_modules/.bin`):

```bash
node scripts/lint-markdown.ts <changed *.md files>
node scripts/lint-skill.ts <changed SKILL.md files>
node scripts/lint-python.ts <changed *.py files>
node scripts/lint-json.ts <changed *.json files>
node scripts/lint-typescript.ts <changed *.ts files>
```

Exit `0` means no finding, `1` means findings, `2` means a usage mistake of yours, `3` means an input was unreadable or, with `--require-tools`, a tool is missing. Quote the stdout of any script that exited `1` verbatim in the verdict; do not paraphrase it.

Treat a missing optional tool as "tool unavailable, skipped" and say so in the verdict, never as a finding. `lint-typescript.ts` needs Node 24 or newer to run its `.ts` source: on an older Node the interpreter fails before the script can print its own `lint-typescript:` line, so a non-zero exit with no such line, or a Node version below 24, means the same: skipped.
