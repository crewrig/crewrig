---
id: "0211"
slug: usage-capture-opt-in
status: approved
complexity: small
interaction-mode: MINIMAL
related-issue: 1174
version: 1.0.0
---

# Usage-capture opt-in — decoupled from the session-recording opt-in on Claude Code, Gemini CLI and Copilot CLI

## Intent

An operator setting up Claude Code, Gemini CLI or Copilot CLI is asked, as a
question of its own, whether to capture token usage on that CLI, and the answer
no longer depends on whether they also agreed to record their conversations into
MemPalace. They can capture usage on a machine where MemPalace is absent, record
conversations without capturing usage, or do both; and when they run setup
again on a machine where capture is already active, they are offered to keep it
or to remove it, and removing it leaves their conversation recording and their
worktree git guard exactly as they were. This closes the one asymmetry left with
Antigravity CLI, whose usage capture already has its own opt-in and removal
path, and the operator-facing documentation stops describing the coupling as a
known limitation.

## Requirements

1. On Claude Code, Gemini CLI and Copilot CLI, each CLI's interactive setup
   SHALL offer a usage-capture opt-in of its own, distinct from the MemPalace
   session-recording opt-in, and SHALL offer it whatever the session-recording
   opt-in received: accepted and confirmed, accepted then canceled at
   confirmation, or declined.
2. Accepting the session-recording opt-in SHALL NOT register the capture command
   on any of the three CLIs, and its pre-write disclosure and its completion
   output SHALL no longer name the capture command. Accepting the usage-capture
   opt-in SHALL NOT register any session-recording command, set any
   session-recording environment variable, install the session-recording
   script, or register the worktree git guard.
3. The usage-capture opt-in SHALL be offered, and accepting it SHALL complete,
   on a machine where MemPalace is neither installed nor reachable; the capture
   command it registers SHALL carry no MemPalace-specific environment setting,
   so that its records reach the file-system journal of spec 0207 with no
   MemPalace dependency.
4. On an installation where no capture command is registered for that CLI, the
   usage-capture opt-in SHALL present `no` as its default answer; an empty or
   canceled answer SHALL be treated as `no`, and a `no` SHALL write nothing and
   SHALL print how to enable capture later.
5. Accepting the usage-capture opt-in SHALL register the capture command on
   exactly the events spec 0206 requirements 13 and 14 name for that CLI —
   `Stop` and `SessionEnd` on Claude Code, `AfterModel` on Gemini CLI,
   `agentStop` and `sessionEnd` on Copilot CLI — exactly once per event, at the
   in-repo absolute path of the capture script, and SHALL register it on no
   other event.
6. Before writing, the usage-capture opt-in SHALL disclose the events it
   registers, the in-repo absolute path it wires, the configuration file or
   files it changes, that no prompt or response text is recorded (spec 0206
   requirement 18), and that MemPalace is not required; when the checkout is a
   linked git worktree, it SHALL also emit the linked-worktree warning the
   installers already emit for the capture wiring.
7. Every write the usage-capture opt-in or its removal makes to a CLI's hook
   configuration SHALL preserve every entry it does not itself own — the
   session-recording commands, the worktree git guard, and any entry the
   operator declared, on the same events or on others — together with every
   non-hook setting in that file.
8. Every write the session-recording opt-in makes to a CLI's hook configuration
   SHALL preserve every capture command already registered there: it SHALL NOT
   remove, duplicate, or re-point one.
9. Before modifying a configuration file that already exists, the usage-capture
   opt-in and its removal SHALL back that file up; when the file does not exist,
   enabling SHALL create it holding only what capture requires, and removal
   SHALL write nothing.
10. When setup runs on an installation where a command naming the framework's
    capture script is already registered for that CLI — wherever that command's
    path points — setup SHALL NOT offer the enable question; it SHALL instead
    offer `keep` or `remove`, with `keep` as the default, and an empty or
    canceled answer SHALL be treated as `keep`.
11. Choosing `keep` SHALL leave the capture command registered exactly once on
    each event of requirement 5 and SHALL change no other entry. When the path
    the registered command names still resolves to an existing file, `keep`
    SHALL leave that path unchanged; when it no longer does, `keep` SHALL
    re-point the command at the capture script of the checkout the setup runs
    from and SHALL say so in its output.
12. Choosing `remove` SHALL delete every command naming the framework's capture
    script from that CLI's hook configuration and SHALL leave every other entry
    unchanged; an event registration or matcher group left holding no command
    solely because of that deletion SHALL be deleted with it, so the
    configuration holds what it would hold had capture never been enabled.
13. An installation whose capture command the former coupled deployment
    registered, inside the session-recording opt-in, SHALL be recognized as
    capture-installed under requirement 10 on its first setup run after this
    specification ships, so that capture stays registered unless the operator
    chooses to remove it, and removing it leaves session recording untouched;
    no setup run SHALL silently remove a capture command that was registered
    before it began.
14. Antigravity CLI's existing usage-capture opt-in and removal path (spec 0206
    requirements 20 and 21) SHALL remain unchanged in behavior, so that all four
    CLIs offer usage capture as an opt-in independent from session recording,
    each with a removal path, and no `Parity gaps` entry is recorded for this
    feature.
15. A hermetic regression suite SHALL cover, for each of the three CLIs, every
    scenario in `## Scenarios` that concerns that CLI, exercising the same
    deployment, detection, and removal logic the setup script itself executes
    rather than a transcription of it, with no write outside a temporary root,
    no network access, and no interactive prompt; the presence, independence,
    and default answers of the prompts themselves SHALL be asserted structurally
    against the setup scripts. No regression test SHALL continue to assert that
    the session-recording deployment registers the capture command.
16. The implementation SHALL update `docs/cli-matrix.md` in the same diff:
    row 8c SHALL drop its *Known limitation* sentence and describe, per CLI, the
    usage-capture opt-in, its default, and its removal path; row 8 SHALL state
    which hook entries the session-recording opt-in registers after this change;
    and any new file this change adds on the trigger surface of
    `docs/cli-matrix-maintenance.md` SHALL appear in the matching row.
17. The implementation SHALL update `docs/usage-capture.md` in the same diff so
    that its *Architecture overview* and its *Installation contract* → *Shim
    wiring* section describe the per-CLI usage-capture opt-in, its independence
    from the MemPalace session-recording opt-in, its default, and its removal
    path (absorbing ledger entry `i2-F2` on issue #961).
18. The implementation SHALL correct `docs/usage-capture.md` → *Gemini CLI
    trigger measurement* so that it no longer claims only the last of the five
    firings finds a new response in the session record: the 4-of-5 figure SHALL
    be presented as the PLAN v3 assumption it is, and the section SHALL state
    that the fast path compares modification times, so any write to the session
    file during the turn — the user's own message included — sends that firing
    down the slow path (absorbing ledger entry `i2-F1` on issue #961).

## Scenarios

**Scenario:** Capture enabled on a machine without MemPalace, session recording declined

```text
Given a Claude Code installation on a machine where MemPalace is not
      installed and no capture command is registered
When  the operator declines the session-recording opt-in and accepts the
      usage-capture opt-in
Then  the capture command is registered exactly once on Stop and once on
      SessionEnd at the in-repo absolute path of the capture script, no
      session-recording command, session-recording environment variable, or
      worktree git guard is registered, and the next completed response
      yields a record in the file-system journal
```

**Scenario:** Session recording enabled, capture declined

```text
Given a Gemini CLI installation with no capture command registered
When  the operator accepts and confirms the session-recording opt-in and
      answers the usage-capture opt-in with its default
Then  the session-recording commands and the worktree git guard are
      registered, no command naming the capture script is registered on
      AfterModel or any other event, and setup prints how to enable
      capture later
```

**Scenario:** Removing capture leaves session recording and the git guard intact

```text
Given a Copilot CLI installation where both the session-recording commands
      and the capture command are registered on agentStop and sessionEnd,
      and the worktree git guard on preToolUse
When  setup runs again and the operator chooses remove at the
      usage-capture question
Then  the configuration file is backed up first, no command naming the
      capture script remains, and every session-recording command and the
      worktree git guard remain registered exactly as before
```

**Scenario:** Re-enabling session recording preserves an existing capture command

```text
Given a Claude Code installation where the capture command is registered on
      Stop and SessionEnd and session recording is not enabled
When  the operator accepts and confirms the session-recording opt-in
Then  the session-recording commands are added and the capture command
      remains registered exactly once on each of Stop and SessionEnd,
      unchanged
```

**Scenario:** Coupled installation migrated on the first re-run

```text
Given a Gemini CLI installation set up before this specification, where the
      capture command on AfterModel was registered by the session-recording
      opt-in
When  setup runs and the operator accepts the default at the usage-capture
      question
Then  setup offers keep or remove rather than the enable question, the
      default keep leaves exactly one capture command on AfterModel naming
      the capture script of the running checkout, and the session-recording
      commands are unchanged
```

**Scenario:** Keep on re-run does not duplicate the capture command

```text
Given a Claude Code installation where the capture command is already
      registered on Stop and SessionEnd
When  setup runs twice in a row and the operator answers keep both times
Then  each of Stop and SessionEnd carries exactly one command naming the
      capture script
```

**Scenario:** Keep re-points a vanished path and only a vanished path

```text
Given a Claude Code installation whose capture command names a capture
      script path, and setup runs from a different checkout
When  the operator answers keep, once while the registered path still
      exists and once after that path has been deleted
Then  the first run leaves the registered path unchanged, and the second
      re-points the command at the capture script of the running checkout,
      reports that it did, and leaves exactly one capture command on each
      of Stop and SessionEnd
```

**Scenario:** Canceled usage-capture question writes nothing

```text
Given a Copilot CLI installation with no capture command registered
When  the operator cancels the usage-capture question without answering
Then  the answer is treated as no, no configuration file is created,
      backed up, or modified by the usage-capture opt-in, and setup
      continues
```

**Scenario:** Removal preserves an operator-declared hook and prunes emptied containers

```text
Given a Claude Code installation where Stop carries an operator-declared
      command and the capture command, and SessionEnd carries only the
      capture command
When  the operator chooses remove at the usage-capture question
Then  Stop still carries the operator-declared command alone, SessionEnd
      is no longer registered, and every non-hook setting of the file is
      unchanged
```

**Scenario:** Antigravity CLI opt-in is unchanged

```text
Given an Antigravity CLI installation whose statusline display command is
      empty
When  its setup runs and the operator accepts the Antigravity usage-capture
      opt-in
Then  the statusline shim is installed and its removal restores the empty
      value exactly as spec 0206 requirements 20 and 21 already require
```

## Out of scope

- Any change to Antigravity CLI's usage-capture opt-in, its removal path, or
  its transcript hooks — already compliant (requirement 14).
- A removal path for session recording on any CLI: none exists today and this
  specification adds none; requirement 8 only guarantees that the
  session-recording opt-in, as it exists, never disturbs a registered capture
  command.
- Decoupling the worktree git guard from the session-recording opt-in: the guard
  keeps being registered by the session-recording opt-in on all four CLIs;
  requirements 7 and 12 only guarantee that capture writes never disturb it.
- The session-recording opt-in's own treatment of operator-declared hook
  entries other than capture commands: requirement 8 governs capture commands
  only.
- Remembering a declined usage-capture answer across setup runs: like
  Antigravity CLI's opt-in, the question is asked again on each run.
- The headless run-total envelope channel and the backfill command of spec
  0206: neither is registered in a CLI's hook configuration, and neither is
  enabled or disabled by the usage-capture opt-in.
- The capture step's own behavior — adapters, events, exit convention,
  fidelity — (spec 0206) and the storage contract (spec 0207), both unchanged.
- The checkout-location dependency of the in-repo absolute-path wiring (spec
  0206, `docs/usage-capture.md` → *Checkout-location dependency*), unchanged.
- A non-interactive or flag-driven setup path for the usage-capture opt-in.
- The operator user guide of spec 0212 (issue #1175): that ticket owns its own
  wording and follows this specification's behavior once it ships.

## Open questions

None. Both questions raised at authoring time were closed at the SPECS gate on
issue #1174: `keep` re-points only a vanished path (requirement 11), and
"independent in both directions" adds no session-recording removal path
(`## Out of scope`).
