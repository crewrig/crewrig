# Contributing to example/widgets

These are the working rules for the `example/widgets` repository. The
forge is GitHub and every forge operation goes through the `gh` CLI.

## Pull requests

- The title starts with one gitmoji, then a short imperative sentence. It is
  at most 70 characters and has no trailing period.
- The body follows this layout, in this order: a purpose paragraph of two
  sentences at most, then the sections `How to read this PR?`, `How to test
  this PR?` and `Detailed description (for agents)`.
- Never write a CI skip directive in a title or a body.

## Logbook

- Every pull request is anchored to a logbook, a journal of what was tried,
  what happened and what was learned.
- When the pull request closes a feature issue, that issue is its own
  logbook: append the entry to it as a comment. Do not create another issue
  and do not add the `logbook` label to it.
- When the pull request closes no issue (a dependency bump, a hotfix, an
  automated change), open a standalone issue labelled `logbook` and put the
  entry in its body.

## Specs

- A spec lives under `specs/` and carries a `status` in its frontmatter:
  `draft`, `approved` or `implemented`.
- The pull request that implements a spec records the `approved` to
  `implemented` transition itself, in its own branch, as a new commit that
  changes the `status` value and nothing else.
