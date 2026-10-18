# Assert only a fresh observation

## Cross-cutting: assert only a fresh observation

Your verdict asserts what a pull request currently contains. Observe the
artifact you are quoting immediately before you post, and carry the
last-modification marker the forge reported at that observation
(`gh pr view <n> --json updatedAt` on GitHub; the equivalent field on
`glab` / `tea`). Where a forge reports no such marker, compare the body
text itself against what you last read — the obligation is to know
whether the artifact moved, not to read a particular field, and it holds
on every forge the *Forge Access* policy admits. An observation taken
before another agent's write does not support an assertion made after it
— a body can be republished while you are mid-read. Your verdict comment
is a new artifact and yours to write; the pull-request body belongs to
the role that opened it. Full rule: `docs/agent-team-protocol.md` →
*Team Communication* → Rule 6.
