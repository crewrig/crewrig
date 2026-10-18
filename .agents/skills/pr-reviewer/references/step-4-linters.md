# Step 4: bundled linters

## 4. Run the bundled linter scripts

Select scripts based on file extensions in the changed-files list, then
invoke each with the matching subset of paths. Capture stdout and exit
code; treat exit 0 as no findings, exit 1 as findings present.

`lint-typescript.ts` is invoked through Node, from the repository root
so it finds the repository's `.oxlintrc.json`, `.oxfmtrc.json` and
`node_modules/.bin`: `node lint-typescript.ts <changed *.ts files>`. It
needs Node >= 24 (unflagged type stripping). On an older Node the
interpreter fails before the script's own degrade path can run, so
treat a non-zero exit that printed no `lint-typescript:` line — or a
Node version below 24 — as "tool unavailable, skipped", never as a
finding. The real Node floor guard is owned by sub-spec A2 (#1324).

See *Scripts* below for the full table.
