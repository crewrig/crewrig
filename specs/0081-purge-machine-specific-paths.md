---
id: "0081"
slug: purge-machine-specific-paths
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 562
version: 1.0.0
---

# Machine-specific home paths and the maintainer login are absent from tracked files

## Intent

After this change, a repository-wide search across the tracked files for
machine-specific absolute home-directory paths — the `/Users/<user>/…` and
`/home/<user>/…` shapes — and for the maintainer's operating-system login
returns nothing on the tip of `main`. The captured test and research artifacts
that once embedded those strings, together with the prose document that
referenced such a path, no longer reveal where the maintainer's machine stored
files or which account owns them, and the prose still reads coherently. A later
commit that reintroduces a machine-specific home path into a tracked file no
longer merges unnoticed: the project's continuous-integration check fails and
points at the offending path. The project's git history is deliberately left
untouched — the maintainer accepts that older commits still carry the old
strings — so this is a clean-up of the current tree, not a history rewrite.

## Requirements

1. Tracked files SHALL NOT contain machine-specific absolute home-directory
   paths, in either the `/Users/<user>/…` or the `/home/<user>/…` shape.
2. Tracked files SHALL NOT contain the maintainer's operating-system login as a
   bare identifier.
3. The captured test and research artifacts that currently embed such paths or
   the login SHALL be either redacted to neutral placeholders (for example
   `$HOME`, `<user>`, `<repo>`) or removed when they are not needed as durable
   fixtures; each artifact SHALL reach exactly one of those two terminal states.
4. Prose documentation that references such paths SHALL be redacted in place,
   SHALL remain coherent after redaction, and SHALL NOT be deleted.
5. A continuous-integration check SHALL fail the build whenever a tracked file
   reintroduces a machine-specific home-directory path, and the check SHALL name
   the offending path in its output.
6. The check SHALL detect reintroduction through generic patterns (for example a
   `/Users/` or `/home/<name>` path prefix) and SHALL NOT hard-code any specific
   login value, so that the guard itself never reintroduces the login into a
   tracked file.
7. The change SHALL confirm, and record, that only paths and filenames — not
   secret values and no email addresses — were present in the captured artifacts
   before redaction.
8. Git history SHALL NOT be rewritten; the removal SHALL operate only on the
   current tree.
9. The capture procedure that produces these dumps SHALL, going forward, redact
   the `$HOME` and owner columns at capture time, so that a freshly captured
   artifact does not reintroduce the leak the guard in requirement 5 forbids.

## Scenarios

**Scenario:** clean tip of main is free of home paths and the login (happy path)

```text
Given a clean checkout of `main` after this specification is realized,
When   a repository-wide search over the tracked files runs for the
       `/Users/<user>/…` and `/home/<user>/…` path shapes and for the
       maintainer's operating-system login,
Then   the search returns zero hits.
```

**Scenario:** a redacted prose document still reads coherently (happy path)

```text
Given the prose document that referenced a machine-specific home path has had
      that path replaced by a neutral placeholder,
When   a reader reads the document end-to-end,
Then   the document is still coherent and self-explanatory, and it was not
       deleted.
```

**Scenario:** the guard catches a reintroduced home path (failure path)

```text
Given the guard is in place and a new commit adds a tracked file line containing
      a `/Users/<user>/…` path,
When   the continuous-integration check runs,
Then   the check fails and names the offending path, and the build is red.
```

**Scenario:** the captured artifacts held only paths and filenames (audit)

```text
Given the captured test and research artifacts as committed before redaction,
When  they are inspected for their sensitive content,
Then  they are found to contain only filesystem paths and filenames — including
      sensitive-looking filenames that are metadata only — and no secret values
      and no email addresses, and that finding is recorded.
```

**Scenario:** git history is left untouched (out-of-scope confirmation)

```text
Given the removal has landed on the current tree,
When  the project's git history is inspected at commits predating this change,
Then  those historical commits still contain the old paths and login, and no
      history-rewriting operation was performed.
```

## Out of scope

- Rewriting, filtering, or otherwise rewriting the project's git history; the
  maintainer has accepted that historical commits retain the old strings.
- Non-tracked and gitignored files, which this change does not touch.
- Re-running or altering the research and end-to-end test activities that
  originally produced the captured artifacts; only their committed output is
  redacted or removed.
- Redacting content in tracked files that is neither a machine-specific
  home-directory path nor the maintainer's login (for example generic,
  non-machine-specific tool output).

## Open questions

- [AUTO-PARKED] The per-file redact-versus-remove decision for each captured
  test and research artifact is a realization detail deferred to PLAN;
  requirement 3 fixes the two terminal states (redacted to placeholders, or
  removed), and which state each file lands in follows from whether it is needed
  as a durable fixture.
- [AUTO-PARKED] The exact guard mechanism and its location (for example a
  `scripts/check-*.sh` script wired into a continuous-integration workflow,
  following the repository's existing `check-*.sh` convention), and whether a
  companion ignore rule should accompany it, are deferred to PLAN.
- [AUTO-PARKED] Grounding: a generic sweep of the current tree found tracked
  files beyond the ticket's enumerated set — at least one additional research
  document under `docs/research/` also matches the home-path pattern — so the
  removal SHALL be driven by the generic pattern of requirement 1 rather than by
  the ticket's hand-listed file set. Recorded for post-hoc audit via the spec
  PR.
