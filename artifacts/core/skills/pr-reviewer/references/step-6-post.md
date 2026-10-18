# Step 6: post the review

## 6. Post the review

Forge access is CLI-only (`AGENTS.md` → *Forge Access*): the framework
ships no forge MCP server. Post the verdict through `gh`, following the
ordered fallback ladder below. **Resolve the posting identity first**, so
you know which rung applies *before* attempting to post rather than
discovering a rejection reactively:

```bash
gh api user --jq .login                                # authenticated identity
gh pr view <number> --json author --jq .author.login   # PR author
```

1. **Distinct identities** — the authenticated login differs from the PR
   author. Post a formal review with the matching event:

   ```bash
   gh pr review <number> --approve            # or --request-changes / --comment
   ```

2. **Shared identity** — the authenticated login equals the PR author (the
   common solo-maintainer case). GitHub rejects `--approve` and
   `--request-changes` on your own PR (`Can not approve/request changes on
   your own pull request`), and even the `--comment` *review event* can trip
   a self-approval permission guard. Do **not** attempt any review-type
   event. Post a **plain** comment instead, whose body opens with a
   `## Verdict: …` header:

   ```bash
   gh pr comment <number> --body "## Verdict: APPROVE

   <the five review sections from step 5>"
   ```

   Use `## Verdict: APPROVE`, `## Verdict: REQUEST CHANGES`, or
   `## Verdict: COMMENT`. This plain comment is the canonical, binding
   verdict artifact for the shared-identity case. (Use `gh issue comment`
   instead if the verdict is being recorded on the anchoring issue rather
   than the PR.)

3. **Posting denied** — if even the plain comment is refused (e.g. a
   stricter permission classifier), do **NOT** ask the orchestrator to post
   the review on your behalf: that launders a permission you were denied.
   Return the full verdict and findings to the orchestrator, which records
   them in the logbook issue.

The three events map as follows:

- `APPROVE` — no blocking issues; minor nits welcome but not required.
- `REQUEST_CHANGES` — at least one finding that must be fixed before
  merge.
- `COMMENT` — observations without a verdict (e.g. when the diff is
  outside the reviewer's domain).
