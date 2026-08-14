<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# Post-Merge Flow

<!-- crewrig-doc: published=false -->

After any `gh pr merge`, the agent MUST verify the merge target before closing the task:

1. **Check the target branch.** If the PR was merged into `main` (or `master`), no further action is needed — the change is already on the primary branch.
2. **If the target was NOT `main`/`master`:** verify whether a downstream PR toward `main` is needed. This is required when:
   - A sibling repository or workflow is gated on `main` (e.g. deploy pipelines that only trigger from `main`).
   - The merge target is an intermediate integration branch that must eventually reach `main`.
3. **Open or propose the downstream PR** before considering the task complete. If the downstream PR can be created automatically (fast-forward or trivial rebase), open it. Otherwise, surface the need to the user with a clear explanation of what remains.

> **Pre-merge up-to-date requirement.** Before executing `gh pr merge`, the agent MUST verify that the feature branch is up-to-date with `main` (`git fetch crewrig main`, `git rebase crewrig/main` or `gh pr update-branch`) and that all test suites pass on the rebased state (`AGENTS.md` → *Branching Strategy*).

> **Merge blocked before it ran (Claude Code).** This flow begins only after a `gh pr merge` command has already executed. If the merge command itself was denied before it could run — the Claude Code auto-mode permission classifier can block a solo-maintainer self-merge — see `AGENTS.md` → *Branching Strategy* → *On Claude Code CLI — solo-maintainer self-merge block* for how to respond.
