---
id: "0245"
slug: playwright-mcp-tls-exec
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1416
version: 1.0.0
---

# The opt-in Playwright MCP registration inherits root-CA trust on every CLI

## Intent

An operator who runs the opt-in `task setup:playwright-mcp` gets a Playwright
MCP server that starts in every supported assistant (Claude Code, Gemini CLI,
GitHub Copilot CLI, Antigravity CLI) even behind a TLS-intercepting proxy,
provided they consented to TLS delegation during setup, exactly as the
framework's own `sequentialthinking` server already does. An operator who ran
the task before this change, or from a checkout that has since moved, and
re-runs it has the registration upgraded in place. An operator who customised
their `playwright` entry keeps it unchanged, and is told so. Nothing else in
any assistant's configuration changes, and every change can be undone.

## Requirements

Terms used below:

- **Legacy shape** — the registration this task wrote before this spec: a
  local-process (stdio) server under the name `playwright` whose command is
  `npx` and whose arguments are exactly the one-element list
  `["@playwright/mcp@latest"]`, carrying no environment variables, headers, or
  other operator-set fields. Fields an assistant adds on its own when a server
  is registered with no options (an explicit stdio transport marker, an empty
  environment map) do not disqualify an entry from the legacy shape.
- **Wrapped form** — the legacy launch command `npx @playwright/mcp@latest`
  prefixed by an invocation of the spec 0084 runtime trust wrapper
  (`scripts/lib/tls-exec.sh`) of the repository checkout the task runs from,
  addressed by absolute path — the same prefix the framework's
  `sequentialthinking` registration carries on that assistant: command `bash`,
  arguments `[<absolute checkout path>/scripts/lib/tls-exec.sh, npx,
  @playwright/mcp@latest]`.
- **Relocated wrapped form** — an entry identical to the wrapped form in every
  respect except that its trust-wrapper path points at the
  `scripts/lib/tls-exec.sh` of a different checkout (a moved repository, or a
  second clone). Only the wrapper path may differ: different arguments, extra
  fields, or a different package or version make the entry neither wrapped
  nor relocated.

1. `task setup:playwright-mcp` SHALL cover all four supported assistants:
   Claude Code (user scope), Gemini CLI (`~/.gemini/settings.json`), GitHub
   Copilot CLI (`~/.copilot/mcp-config.json`), and Antigravity CLI
   (`~/.gemini/config/mcp_config.json`).
2. When an assistant has no `playwright` entry, the task SHALL register one in
   the wrapped form.
3. When an assistant's existing `playwright` entry is in the legacy shape, the
   task SHALL replace it with the wrapped form and SHALL emit a notice naming
   the assistant and stating that the legacy registration was converged.
4. When an assistant's existing `playwright` entry is in the relocated wrapped
   form, the task SHALL replace it with the wrapped form for the current
   checkout and SHALL emit a non-silent notice naming the assistant, the old
   wrapper path, and the new wrapper path.
5. When an assistant's existing `playwright` entry is already the wrapped form
   for the checkout the task runs from, the task SHALL leave that assistant's
   configuration unmodified (no rewrite, no backup) and SHALL report it as
   already up to date.
6. When an assistant's existing `playwright` entry is in none of the legacy
   shape, the relocated wrapped form, or the wrapped form for the current
   checkout, the task SHALL leave it
   unchanged and SHALL emit a non-silent warning that names the assistant and
   its configuration location, states that the entry was left untouched
   because it does not match the shape this task writes, and states how the
   operator can opt in to the wrapped form (remove the entry, then re-run the
   task).
7. The name `playwright` SHALL remain an operator-owned, non-reserved MCP
   server name; this spec SHALL NOT add it to the framework-reserved set of
   spec 0089 R1, and spec 0089 is not amended.
8. A run of the task SHALL NOT alter, reorder, or drop any MCP server
   declaration other than `playwright`, nor any non-MCP key of an assistant's
   configuration.
9. Before modifying any configuration file it writes directly, the task SHALL
   record a timestamped backup of that file's prior content, and the
   registration report of requirement 2 or the notice of requirement 3 or 4
   SHALL name the backup's location (the recoverability obligation spec 0089
   R10 places on setup scripts).
10. Where an assistant's registration is changed through that assistant's own
    server-registration interface rather than by a direct file write (Claude
    Code), the notice of requirement 3 or 4 SHALL state the replaced
    registration in full, so the prior state is recoverable without a file
    backup.
11. A configuration file write SHALL leave the file either in its complete
    prior state or in its complete new state, SHALL NOT follow a symbolic link
    at the target, and SHALL NOT widen the file's permissions — the same write
    guarantees `docs/cli-matrix.md` row 7c records for the framework's other
    MCP configuration writes.
12. The task SHALL read each assistant's configuration as that assistant
    itself reads it; a Gemini CLI settings file containing comments SHALL be
    accepted and handled as spec 0214 handles it, including its warning that
    the comments survive only in the timestamped backup.
13. When an assistant is not installed, or its configuration file does not
    exist, the task SHALL skip that assistant with a notice naming it and
    SHALL NOT create the configuration file, and SHALL continue with the
    remaining assistants; a skip SHALL NOT count as a failure.
14. When an assistant's configuration exists but cannot be read or parsed as
    that assistant reads it, the task SHALL leave it unchanged, SHALL emit a
    warning naming the file, SHALL continue with the remaining assistants, and
    SHALL end with a non-zero exit status once every assistant has been
    processed.
15. The task SHALL end with a per-assistant outcome report, each assistant
    marked exactly one of: registered, converged (from the legacy shape),
    relocated (from another checkout's wrapper), already up to date, left
    untouched, skipped, or failed.
16. Re-running the task after a successful run SHALL produce no further
    configuration change on any assistant and SHALL report every previously
    registered, converged, or relocated assistant as already up to date; the
    same holds when the task is re-run from the checkout an entry was last
    relocated to.
17. A `playwright` entry in the wrapped form SHALL survive a subsequent
    interactive setup run of each assistant verbatim, as a preserved
    non-reserved declaration under spec 0089 R2-R3.
18. `docs/cli-matrix.md` row 7g SHALL list the Playwright MCP registration
    among the runtime paths routed through the trust wrapper, on all four
    assistants, and the task's own description SHALL name the four assistants
    it covers.
19. An automated regression test SHALL assert, for each of the four
    assistants: a fresh registration in the wrapped form; convergence of a
    legacy-shape entry and of a relocated wrapped-form entry, each with its
    backup or full notice; a customised entry (including a wrapped entry that
    differs in anything but the wrapper path) left unchanged, with the warning
    of requirement 6; no change on a second run; and every other MCP
    declaration preserved unchanged.

## Scenarios

**Scenario:** Fresh registration behind a TLS-intercepting proxy

Given an operator who consented to TLS delegation during setup, with all four
assistants installed and configured, and no `playwright` entry anywhere
When  they run `task setup:playwright-mcp`
Then  each of the four assistants holds a `playwright` entry in the wrapped
      form, the report marks all four "registered", and each assistant's
      Playwright MCP server, launched later, inherits the recorded root-CA
      trust

**Scenario:** Legacy registration is converged

Given an operator whose Claude Code and Gemini CLI configurations hold the
legacy-shape `playwright` entry written by a previous run of the task
When  they re-run `task setup:playwright-mcp`
Then  both entries become the wrapped form, a convergence notice names each
      assistant, the Gemini CLI notice names the timestamped backup of
      `~/.gemini/settings.json`, the Claude Code notice states the replaced
      registration in full, and every other MCP server declaration is unchanged

**Scenario:** Entry from another checkout is relocated

Given a Gemini CLI configuration whose `playwright` entry is the wrapped form
pointing at `/old/clone/scripts/lib/tls-exec.sh`, while the task runs from a
checkout at `/new/clone`
When  the operator runs `task setup:playwright-mcp`
Then  the entry's wrapper path becomes `/new/clone/scripts/lib/tls-exec.sh`
      with nothing else changed, a notice names Gemini CLI, the old path, the
      new path, and the timestamped backup, the report marks Gemini CLI
      "relocated", and a second run from `/new/clone` reports it "already up
      to date"

**Scenario:** Wrapped entry with a pinned version is left untouched

Given a Claude Code user-scope `playwright` entry that runs the trust wrapper
of the current checkout with `npx @playwright/mcp@0.0.40`
When  the operator runs `task setup:playwright-mcp`
Then  the entry is unchanged, a warning names Claude Code and explains how to
      opt in, and the report marks Claude Code "left untouched"

**Scenario:** Customised entry is left untouched

Given a Copilot CLI configuration whose `playwright` entry runs a pinned
version `@playwright/mcp@0.0.40` with an extra `--headless` argument
When  the operator runs `task setup:playwright-mcp`
Then  that entry is byte-for-byte unchanged, a warning names Copilot CLI and
      `~/.copilot/mcp-config.json` and explains how to opt in, no backup is
      written for that file, and the report marks Copilot CLI "left untouched"

**Scenario:** Re-run is a no-op

Given a previous run that registered or converged every assistant
When  the operator runs `task setup:playwright-mcp` again
Then  no configuration file is modified, no backup is written, and the report
      marks every assistant "already up to date"

**Scenario:** Unparseable configuration fails loudly without damage

Given an Antigravity CLI configuration file that is not valid JSON
When  the operator runs `task setup:playwright-mcp`
Then  that file is unchanged, a warning names it, the other three assistants
      are still processed, the report marks Antigravity CLI "failed", and the
      task exits non-zero

**Scenario:** Absent assistant is skipped

Given a machine where GitHub Copilot CLI has never been set up and
`~/.copilot/mcp-config.json` does not exist
When  the operator runs `task setup:playwright-mcp`
Then  the file is not created, a notice names Copilot CLI as skipped, the
      other assistants are processed, and the skip alone does not make the task
      exit non-zero

**Scenario:** Wrapped entry survives a later setup run

Given a Copilot CLI configuration holding the wrapped-form `playwright` entry
When  the operator later runs the Copilot CLI interactive setup
Then  the `playwright` entry is still present and unchanged, preserved as a
      non-reserved declaration under spec 0089

## Out of scope

- Reserving the name `playwright` or amending spec 0089; the name stays
  operator-owned (resolved decision, logbook #1416).
- Offering the Playwright MCP server from any interactive setup script; it
  remains reachable only through the opt-in task.
- Claude Code `playwright` entries at project or local scope; only the user
  scope the task writes is inspected or changed.
- Rewriting, migrating, or "repairing" any `playwright` entry other than the
  legacy shape or the relocated wrapped form, including pinned versions, extra
  arguments, environment variables, or remote transports.
- Removing a `playwright` registration; the task has no uninstall path.
- Creating a configuration file for an assistant that has not been set up.
- Changing the trust wrapper itself or the TLS delegation consent flow (spec
  0084).
- Installing Playwright browsers or any runtime dependency of
  `@playwright/mcp`.

## Open questions

None remain. The relocated-checkout case was resolved by the user on
2026-10-01: converge it (requirement 4).
