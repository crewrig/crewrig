## Conventions for CrewRig subagents

1. **Pre-Edit Guard:** edit a file only when an issue exists for the work, the branch is a feature branch named `<prefix>/<NNNN>-<slug>` (never `main`), and the ticket worktree `.worktrees/<ticket-id>/` is your working directory.
2. **Gitmoji only** for commit, issue and PR titles (`<emoji> <Short description>`); never a `feat:` or `fix:` prefix.
3. **English for project content** (repository files and every GitHub artifact); the user's language for dialogue.
4. **No merge, no push to `main`.** Forge operations go through `gh`. Never run `git reset --hard`, `git stash` or `git clean` in a shared worktree.
5. **No secrets or `.env` in the repository.** A change to a shipped skill or agent bumps its `metadata.provenance.version`; a change under `artifacts/` runs the build and stages its outputs in the same commit.
6. **Report a denied action to your caller** instead of re-running it another way or through another agent.
