---
id: "0214"
slug: gemini-settings-preserve
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1210
version: 1.0.0
---

# Gemini setup preserves operator settings across re-runs

## Intent

When an operator re-runs the Gemini CLI setup on a machine where
`~/.gemini/settings.json` already exists, everything they put in that file —
their own hooks, their own settings, the values they chose for keys the
framework ships a default for — is still there after the run, and the
session-recording hooks and worktree git guard an earlier run registered stay
registered even when they decline or cancel session recording this time, as
they already do on Claude Code and Copilot CLI. Today the setup rebuilds the
whole file from `config/gemini/settings.json` on every run and carries across
only the operator's MCP servers (spec 0089) and the usage-capture commands
(spec 0211 R13), so every other operator key and every other hook entry is
silently lost, recoverable only from the timestamped backup. After this change
the framework enforces only the parts of the file it owns — the context-file
enrolment list and the reserved MCP server entries — and treats every other
template key as a default that an operator value overrides; deleting such a
key brings the default back on the next run, so an operator overrides it by
setting a value. The file is read the way Gemini CLI reads it, comments
included: the only operator content a re-run does not carry into the
rewritten file is those comments, and the setup says so and points to the
backup that keeps them.

## Requirements

1. The Gemini setup SHALL treat exactly two parts of an existing
   `~/.gemini/settings.json` as framework-owned: the `context.fileName` list
   and the entries under the reserved MCP server names of spec 0089 R1
   (`mempalace`, `sequentialthinking`). Every other part of the file SHALL be
   treated as operator content.
2. Every key of `config/gemini/settings.json` other than the framework-owned
   parts of requirement 1 SHALL be a seed: the setup SHALL write the template
   value of a seed only when that key is absent from the existing file and
   every ancestor of that key is either absent or an object, and SHALL
   otherwise retain the existing value unchanged, whatever that value and
   whatever its type. A seed nested inside an object the existing file already
   holds SHALL be added without altering the object's other members. An
   ancestor that is present with a value other than an object is itself an
   operator value: the seeds beneath it SHALL NOT be written, and the ancestor
   SHALL be retained unchanged, without a warning.
3. Every part of the existing file that is not framework-owned SHALL be
   retained unchanged by a setup run, whatever the run's answers to the
   session-recording and usage-capture questions. This covers, at minimum:
   every key absent from the template; every operator value of a seed; every
   non-reserved MCP server declaration; and every hook entry — operator-declared
   hooks, the session-recording hooks, the worktree git guard, and the
   usage-capture commands — subject only to requirements 4 and 5. A `hooks`
   value that is present and is not an object is operator content under this
   requirement; this specification does not change how the session-recording
   and usage-capture steps treat such a value.
4. A run in which the operator declines session recording, cancels it at
   confirmation, or dismisses the question SHALL leave in place every
   session-recording hook and the worktree git guard that an earlier run
   registered, matching the outcome Claude Code and Copilot CLI produce on the
   same re-run.
5. A run in which the operator accepts session recording SHALL register the
   session-recording hooks and the worktree git guard with the same result the
   session-recording merge of spec 0211 R8 produces today on the file it is
   given, and SHALL retain unchanged every hook entry registered on an event
   the session-recording manifest does not register. The usage-capture answer
   SHALL change hook entries only as spec 0211 prescribes for that answer.
6. After a run, `context.fileName` SHALL be a list holding every entry of the
   template's `context.fileName` list, in the template's order, followed by
   every entry of the existing file's `context.fileName` that is not in the
   template's list, in the order the existing file held them; no entry SHALL
   appear more than once.
7. An existing `context.fileName` value that is a single string SHALL be
   treated as a one-entry list for requirement 6. Any other value that is not
   a list of strings SHALL be replaced by the template's list, and the setup
   SHALL emit a non-silent warning naming the key and the timestamped backup
   that preserves the prior value. Likewise, an existing `context` or
   `mcpServers` value that is present and is not an object SHALL, whenever the
   run writes a member beneath it, be replaced by an object holding the
   members the run writes there, and the setup SHALL emit a non-silent warning
   naming the key and the timestamped backup that preserves the prior value.
8. Each reserved MCP server entry that a run registers SHALL be written in
   full from the framework's configuration of that run and SHALL replace any
   prior entry under that name as a whole: no member of the prior entry SHALL
   survive unless the framework's configuration of that run carries it. A
   reserved server that the run does not register — declined, or MemPalace
   absent — SHALL leave no entry under its name. Spec 0089 R7, R8, and R9,
   including the R9 warning, SHALL keep holding for the Gemini setup.
9. The custom-CA / native-TLS wrapping of the reserved entries (spec 0084) and
   the HTTP registration of the `mempalace` entry (spec 0113 delta-02 R17 to
   R20) SHALL produce the same reserved entries they produce today for the
   same answers and the same environment; in particular the
   `sequentialthinking` entry SHALL carry the TLS wrapper exactly once,
   however many runs preceded.
10. The MCP precedence of spec 0089 and spec 0091 SHALL be unchanged for the
    Gemini setup: framework-reserved entries over org-declared servers over
    operator-declared servers.
11. When `~/.gemini/settings.json` is absent, or is present but holds nothing
    once its comments and whitespace are removed, the setup SHALL produce the
    same JSON document — the same keys, values, and array order — that it
    produces today for an absent file, for the same answers and the same
    environment. A file that held comments and nothing else SHALL also cause
    the comment warning of requirement 12; it SHALL NOT cause the
    not-a-JSON-object warning of requirement 12.
12. The setup SHALL read an existing `~/.gemini/settings.json` the way Gemini
    CLI reads it: comments removed, then the remainder parsed as JSON (the
    reference behavior is `JSON.parse(stripJsonComments(...))` in
    `packages/cli/src/config/settings.ts` of `google-gemini/gemini-cli`).
    Comment removal SHALL leave the content of JSON strings intact, so that a
    `//` or `/*` inside a string value — such as the URL of the template's
    `$schema` key — is never taken for a comment. Whether the file is a JSON
    object SHALL be decided on the content after comment removal. A file that holds comments and is a JSON object after
    their removal SHALL be merged as requirements 1 to 10 prescribe, and the
    setup SHALL emit a non-silent warning stating that its comments are not
    kept in the rewritten file and are preserved in the timestamped backup,
    whose path it names. A file that is still not a JSON object after comment
    removal — unparseable, or a JSON value of another type — SHALL cause a
    non-silent warning that names the file and the path of its timestamped
    backup, after which the setup SHALL produce the document it would produce
    for an absent file (requirement 11).
13. Before a run makes its first change to an existing
    `~/.gemini/settings.json`, a timestamped backup of that file SHALL exist.
    Every run that writes the file — a fresh install and a repair under
    requirement 12 included — SHALL leave it readable and writable by its
    owner only (mode 0600) at the end of the run.
14. Two consecutive runs with the same answers and the same environment SHALL
    leave the same JSON document — the same keys, values, and array order —
    with no hook entry, `context.fileName` entry, MCP server entry, or TLS
    wrapper duplicated by the second run.
15. The messages the Gemini setup prints when session recording is declined
    or canceled SHALL NOT state that the settings file was rebuilt or that an
    earlier registration was not kept; they SHALL state that any
    session-recording hooks and worktree git guard an earlier run registered
    are left in place.
16. Every usage-capture command registered before a run SHALL survive the run
    unless the operator answers `remove`, so that spec 0211 R13 keeps holding.
    Whether the separate carry-over of the usage-capture footprint remains
    necessary is left to the PLAN stage, provided spec 0211 R13 holds.
17. The following documentation SHALL be updated in the same change to
    describe the preserving behavior and SHALL no longer describe the Gemini
    settings write as a rebuild from the template: `docs/cli-matrix.md` row 7c
    (which lists Gemini among the overwrite-based setups) and row 8c (Gemini
    cell); `docs/usage-capture.md` → *Shim wiring*; and `docs/usage-guide.md`
    → *Gemini CLI → Before re-running*. The `docs/usage-guide.md` section SHALL
    also state, in one sentence each, that deleting a key the framework ships
    a default for brings the template value back on the next run (setting a
    value is the way to override it), and that comments in the file are not
    kept by a re-run and remain in the timestamped backup.
18. A hermetic regression test SHALL accompany the change, following the style
    of the existing `scripts/tests/test-setup-*.sh` suites, and SHALL run with
    no interactive picker, no running MemPalace daemon, and no network access.
    It SHALL assert at least: (a) an operator hook, an operator key absent from
    the template, and an operator value for `security.auth.selectedType` all
    survive a re-run; (b) session-recording hooks and the worktree git guard
    registered by an earlier run survive a re-run that declines session
    recording; (c) `context.fileName` is the ordered, de-duplicated union of
    requirement 6; (d) a reserved entry carrying members the framework's
    configuration lacks is replaced as a whole; (e) a present file that is
    still not a JSON object after comment removal is repaired with the
    requirement 12 warning, and an empty file is treated as absent; (f) two
    consecutive runs with the same answers leave the same JSON document;
    (g) a file holding comments, and holding `//` and `/*` inside string
    values, is merged, keeping its operator content and those string values
    unchanged, with the requirement 12 comment warning; and (h) a seed beneath a non-object
    ancestor is not written, while a non-object `context` is replaced with the
    requirement 7 warning.

## Scenarios

**Scenario:** Operator content survives a re-run

```text
Given a ~/.gemini/settings.json holding an operator hook on the Notification
      event, a top-level key "ui" absent from the template, and
      security.auth.selectedType set to "gemini-api-key"
When  the operator re-runs scripts/setup-gemini-interactive.sh
Then  the resulting file still holds the Notification hook, the "ui" key, and
      security.auth.selectedType "gemini-api-key", each unchanged
```

**Scenario:** A seed absent from the file is written, a present one is kept

```text
Given a ~/.gemini/settings.json whose "privacy" object holds only an operator
      key "telemetryOptOut": true, and whose general.previewFeatures is false
When  setup runs
Then  privacy holds both "telemetryOptOut": true and the template's
      "usageStatisticsEnabled": false, and general.previewFeatures is still
      false
```

**Scenario:** Declining session recording keeps an earlier registration

```text
Given a ~/.gemini/settings.json in which an earlier run registered the
      session-recording hooks and the worktree git guard
When  setup runs and the operator declines session recording
Then  the session-recording hooks and the worktree git guard are still
      registered, unchanged, and the decline message says an earlier
      registration is left in place
```

**Scenario:** Accepting session recording keeps hooks on other events

```text
Given a ~/.gemini/settings.json holding an operator hook on the Notification
      event, which the session-recording manifest does not register
When  setup runs and the operator accepts session recording
Then  the session-recording hooks and the worktree git guard are registered,
      and the Notification hook is still present, unchanged
```

**Scenario:** Context-file enrolment is the ordered union

```text
Given a ~/.gemini/settings.json whose context.fileName is
      ["TEAM_NOTES.md", "AGENTS.md", "LOCAL.md", "TEAM_NOTES.md"]
When  setup runs
Then  context.fileName is the template's list in the template's order,
      followed by "TEAM_NOTES.md" then "LOCAL.md", each appearing once
```

**Scenario:** A stale reserved entry is replaced as a whole

```text
Given a ~/.gemini/settings.json whose mcpServers.mempalace holds an HTTP "url"
      and "headers" from an earlier arrangement, and a run in which the
      framework registers mempalace as a stdio command
When  setup runs
Then  mcpServers.mempalace holds exactly the framework's stdio entry, with no
      "url" or "headers" member, and the spec 0089 R9 warning names mempalace
      and the timestamped backup
```

**Scenario:** A stale reserved entry is removed when MemPalace is absent

```text
Given a ~/.gemini/settings.json holding an mcpServers.mempalace entry and an
      operator server "acme-tools", on a machine where MemPalace is not
      installed
When  setup runs and MemPalace stays absent
Then  mcpServers holds no mempalace entry, still holds "acme-tools"
      unchanged, and the spec 0089 R9 warning is emitted
```

**Scenario:** A commented settings file is merged, its comments reported

```text
Given a ~/.gemini/settings.json holding a "// team proxy" line comment and a
      top-level key "ui" absent from the template, which Gemini CLI accepts
When  setup runs
Then  the resulting file still holds the "ui" key unchanged and the
      framework-owned parts of requirement 1, and setup warns that the
      comments are not kept in the rewritten file and are preserved in the
      timestamped backup, whose path it names
```

**Scenario:** An unreadable settings file is repaired

```text
Given a ~/.gemini/settings.json whose content is not a JSON object even after
      its comments are removed
When  setup runs
Then  setup warns, naming the file and the path of its timestamped backup,
      and the resulting file is the same JSON document a fresh install
      produces for the same answers
```

**Scenario:** An empty settings file is treated as absent

```text
Given a ~/.gemini/settings.json holding only whitespace and a comment
When  setup runs
Then  the resulting file is the same JSON document a fresh install produces
      for the same answers, it has mode 0600, and setup emits the comment
      warning but not the not-a-JSON-object warning
```

**Scenario:** A non-object ancestor blocks a seed but not a framework-owned key

```text
Given a ~/.gemini/settings.json whose "security" value is the string "x" and
      whose "context" value is the string "y"
When  setup runs
Then  "security" is still the string "x", with no seed written beneath it and
      no warning about it; "context" is an object whose fileName is the
      template's list; and setup warns, naming context and the timestamped
      backup
```

**Scenario:** A malformed context-file list is replaced with a warning

```text
Given a ~/.gemini/settings.json whose context.fileName is the number 3
When  setup runs
Then  context.fileName is the template's list, and setup warns, naming
      context.fileName and the timestamped backup
```

**Scenario:** Re-runs are idempotent

```text
Given a ~/.gemini/settings.json produced by a setup run
When  setup runs twice more with the same answers and the same environment
Then  the file after the third run is the same JSON document as after the
      second run, the sequentialthinking entry carries the TLS wrapper once,
      and no hook or context.fileName entry is duplicated
```

**Scenario:** A deleted seed comes back on the next run

```text
Given a ~/.gemini/settings.json from which the operator deleted
      general.previewFeatures
When  setup runs
Then  general.previewFeatures holds the template value again
```

**Scenario:** The file stays owner-only and is backed up first

```text
Given an existing ~/.gemini/settings.json with mode 0644
When  setup runs
Then  a timestamped backup of the prior file exists and the resulting file
      has mode 0600
```

**Scenario:** A fresh install ends owner-only

```text
Given no ~/.gemini/settings.json, and a run in which the mempalace entry stays
      on its stdio arrangement
When  setup runs
Then  the resulting file has mode 0600
```

## Out of scope

- The Claude Code, Copilot CLI, and Antigravity CLI setups: none rebuilds its
  settings file from a template in the way this specification removes.
- Any removal path for session recording, on any CLI: a declined or canceled
  run leaves an earlier registration in place (requirement 4) and adds no way
  to remove it; spec 0211 → *Out of scope* stays accurate.
- The merge semantics of the session-recording opt-in on an accepting run
  (requirement 5), which the Gemini and Claude Code setups share: a hook entry
  the operator registered on one of the events the session-recording manifest
  registers is handled as that merge handles it today. Fixing that merge for
  both CLIs together is tracked in #1234.
- Any change to the values shipped in `config/gemini/settings.json`, and to
  the `context.fileName` enrolment guard of spec 0085.
- Propagating a later change of a seed value, or the removal of a seed from
  the template, to an installation that already holds the key: once written,
  a seed is operator content (requirement 2), consistent with the migration
  stance of ADR 0015 → *Existing adopters*.
- Opting out of a seed by deleting it: a deleted seed is absent, so the next
  run writes the template value again (requirement 2); an operator overrides
  a seed by setting a value, as `docs/usage-guide.md` states (requirement 17).
- Keeping comments in the rewritten file: they are removed on reading, as
  Gemini CLI removes them, and survive only in the timestamped backup
  (requirement 12).
- Any change to a non-object `hooks` value beyond what the session-recording
  and usage-capture steps already do with it (requirement 3).
- Retiring an entry the framework once enrolled in `context.fileName`: under
  requirement 6 an entry dropped from a future template cannot be told apart
  from an operator entry and stays in an existing file.
- Removing a non-reserved MCP server that an earlier org manifest contributed
  and the current one no longer declares: it stays, as it does today under
  spec 0089.
- Editing spec 0089 or spec 0211: both are merged and their requirements keep
  holding. Spec 0211 scenario *Coupled installation migrated on the first
  re-run* ("the session-recording commands are unchanged") becomes true for a
  declined Gemini re-run through requirement 4, and needs no delta.

## Open questions

None. The scope of requirement 5 was settled with the maintainer: hooks on
events the session-recording manifest registers are handled by the follow-up
issue #1234, for Claude Code and Gemini CLI together. The handling of a
commented file (read with comments removed, then merged, with a warning) and
of a file still not a JSON object after that (repaired) was settled with the
maintainer on the first review pass of PR #1236 (s1-F1), as was the treatment
of a non-object ancestor (s1-F2).
