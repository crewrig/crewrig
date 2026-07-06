<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# Post-Merge Flow

<!-- crewrig-doc: published=false -->

After any `gh pr merge`, the agent MUST verify the merge target before closing the task:

1. **Check the target branch.** If the PR was merged into `main` (or `master`), no further action is needed — the change is already on the primary branch.
2. **If the target was NOT `main`/`master`:** verify whether a downstream PR toward `main` is needed. This is required when:
   - A sibling repository or workflow is gated on `main` (e.g. deploy pipelines that only trigger from `main`).
   - The merge target is an intermediate integration branch that must eventually reach `main`.
3. **Open or propose the downstream PR** before considering the task complete. If the downstream PR can be created automatically (fast-forward or trivial rebase), open it. Otherwise, surface the need to the user with a clear explanation of what remains.
