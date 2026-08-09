---
id: "0116"
slug: antigravity-transcript-activation
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 724
version: 1.0.0
---

# Antigravity CLI session recording actually records

## Intent

A user who runs the Antigravity CLI setup is offered session recording to
MemPalace on the same terms as the other three assistants, and a user who
accepts it finds their Antigravity sessions in the transcripts wing afterwards —
recorded from any working directory, not only from a checkout of this
repository.

## Requirements

1. The Antigravity hook manifest SHALL be structured as a map of named hooks at
   its top level, each name holding its own event keys.
2. The Antigravity hook manifest SHALL register only lifecycle events that the
   Antigravity CLI recognizes, and SHALL NOT register `BeforeAgent`,
   `AfterTool`, `AfterModel` or `SessionEnd`.
3. The Antigravity hook manifest SHALL register the start-of-turn event and the
   end-of-execution event, and SHALL NOT register the per-tool events.
4. Every command in the Antigravity hook manifest SHALL name the shared
   transcript hook by a path that does not depend on the working directory the
   assistant was started from.
5. Every command in the Antigravity hook manifest SHALL tell the hook which
   lifecycle event fired, because the Antigravity payload does not carry the
   event name.
6. Requirements 2, 4 and 6 of `specs/0056-antigravity-hooks.md` are contradicted
   by the CLI's documented and observed behavior; this spec SHALL supersede
   them, and the superseding SHALL be stated in the manifest's own
   documentation so a reader never faces two live contradictory specs.
7. The shared transcript hook SHALL classify an Antigravity event from the event
   name passed to it, without relying on a field the Antigravity payload does
   not carry.
8. The shared transcript hook SHALL derive the session identifier of an
   Antigravity event from the conversation identifier carried in the payload.
9. The shared transcript hook SHALL derive the project directory of an
   Antigravity event from the workspace path carried in the payload when that
   path is present, and SHALL fall back to its existing resolution chain when it
   is absent or empty.
10. The shared transcript hook SHALL emit a JSON object on standard output when
    handling an Antigravity event, and that object SHALL NOT instruct the
    assistant to block, deny, continue, or otherwise alter its execution.
11. The shared transcript hook SHALL produce, for Claude Code, Gemini CLI and
    GitHub Copilot CLI, output and persistence behavior identical to what it
    produces before this change.
12. The Antigravity setup script SHALL offer session recording as an opt-in,
    declined by default, using the same two-prompt shape as the three sibling
    setup scripts: an offer, a plain-English statement of every change it is
    about to apply, and a confirmation.
13. The Antigravity setup script SHALL install the shared transcript hook to a
    location owned by the assistant, so that the deployed hook does not depend
    on this repository remaining at any particular path.
14. The Antigravity setup script SHALL deploy the manifest to the customization
    root the Antigravity CLI reads, rewriting every command to the absolute
    installed path of the hook and prefixing it with the environment that
    enables persistence.
15. The Antigravity setup script SHALL back up any manifest already present at
    the deployment target before overwriting it.
16. The Antigravity setup script SHALL leave every file it would otherwise write
    untouched when the user declines either prompt.
17. A hermetic regression suite SHALL cover the manifest's structure, the hook's
    Antigravity classification, the no-regression guarantee of requirement 11,
    and the setup script's deployment and decline paths; it SHALL require no
    network access and SHALL write nothing outside a temporary directory.
18. The regression suite SHALL run in continuous integration, or SHALL be listed
    in the test-wiring exemption allowlist with a recorded reason.
19. `docs/cli-matrix.md` rows 8, 9 and 10 SHALL be updated in the same change,
    and row 8's Antigravity cell SHALL name the deployment path exactly as the
    Copilot cell already names its own.
20. `docs/cli-matrix.md` SHALL record, as a gap with its evidence, that
    workspace-level manifest discovery is documented by the vendor but was not
    observed to fire.
21. Every shipped source this change modifies SHALL carry a version bump in the
    same change, per `docs/version-bump-convention.md`.

## Scenarios

**Scenario:** The manifest is shaped the way the assistant reads it

Given `hooks/antigravity-transcript-hooks.json` after this change
When its content is parsed as JSON
Then every top-level key SHALL be a hook name whose value is an object
And no top-level key SHALL be `hooks`
And every event key under a hook name SHALL be one of `PreToolUse`,
  `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`

**Scenario:** The retired event names are gone

Given `hooks/antigravity-transcript-hooks.json` after this change
When its content is searched for the strings `BeforeAgent`, `AfterTool`,
  `AfterModel` and `SessionEnd`
Then none of them SHALL be found

**Scenario:** No command depends on the launch directory

Given any command string in `hooks/antigravity-transcript-hooks.json`
When that string is inspected
Then it SHALL NOT contain `$PWD`

**Scenario:** A completed turn is recorded

Given a deployed Antigravity manifest and persistence enabled
When the assistant finishes an execution loop and the end-of-execution hook
  runs with an Antigravity payload on standard input
Then one entry SHALL be persisted to the transcripts wing
And its room SHALL be derived from the conversation identifier in that payload

**Scenario:** The hook answers the assistant without steering it

Given the shared transcript hook invoked for any Antigravity event
When it exits
Then its standard output SHALL parse as a JSON object
And that object SHALL NOT carry a `decision` of `continue`, `deny`, `ask` or
  `force_ask`

**Scenario:** A payload without a workspace path still resolves a project

Given an Antigravity payload whose workspace path list is empty
When the shared transcript hook handles it
Then the project directory SHALL be resolved by the hook's existing fallback
  chain
And the entry SHALL still be persisted

**Scenario:** The other three assistants are unaffected

Given a Claude Code, a Gemini CLI and a GitHub Copilot CLI payload that the
  hook handled before this change
When each is replayed against the hook after this change
Then the persisted entry type, room and content SHALL be unchanged
And nothing SHALL be written to standard output for those payloads

**Scenario:** High-frequency events are not registered

Given `hooks/antigravity-transcript-hooks.json` after this change
When its registered event keys are enumerated
Then `PreToolUse`, `PostToolUse` and `PostInvocation` SHALL be absent

**Scenario:** Accepting the offer deploys a runnable hook

Given a run of the Antigravity setup script against a temporary home
When the user accepts the recording offer and confirms
Then the shared hook script SHALL exist under the assistant-owned directory and
  SHALL be executable
And the deployed manifest SHALL exist at the customization root
And every command in it SHALL contain the absolute path of that installed hook
And every command in it SHALL carry the environment that enables persistence

**Scenario:** Declining the offer writes nothing

Given a run of the Antigravity setup script against a temporary home
When the user declines the recording offer
Then no manifest SHALL exist at the customization root
And no hook script SHALL exist under the assistant-owned directory

**Scenario:** Declining the confirmation writes nothing

Given a run of the Antigravity setup script against a temporary home
When the user accepts the recording offer and then declines the confirmation
Then no manifest SHALL exist at the customization root
And no hook script SHALL exist under the assistant-owned directory

**Scenario:** An existing manifest is preserved before being replaced

Given a manifest already present at the customization root
When the user accepts the recording offer and confirms
Then a backup copy of the prior manifest SHALL exist alongside it

**Scenario:** The matrix stops claiming an unproven capability

Given `docs/cli-matrix.md` after this change
When row 8's Antigravity cell is read
Then it SHALL name the deployment path
And the document SHALL carry a gap entry, with its evidence, for
  workspace-level manifest discovery

## Out of scope

- Workspace-level manifest deployment. The vendor documents a per-workspace
  customization root, but a hook registered there was not observed to fire; this
  change deploys to the machine-global root only, and records the difference as
  a documented gap rather than shipping an unproven path.
- Capturing the text of user prompts or model responses for Antigravity. No
  payload the assistant sends to a hook carries either, so an Antigravity
  transcript entry is a turn marker, not a verbatim exchange. Closing that gap
  would mean reading the transcript file the payload points at, which is a
  separate change with its own size and its own failure modes.
- The disagreement between the two directories the Antigravity setup script
  writes to — the assistant's application-data directory for skills and agents,
  the documented customization root for rules and server configuration. It is a
  real defect and it is tracked separately as issue #761; folding it into this
  change would put two independent path corrections behind one review.
- Any change to the Claude Code, Gemini CLI or GitHub Copilot CLI manifests,
  setup scripts, or deployment paths. Requirement 11 constrains this change to
  leave their behavior identical; it does not license improving it here.
- Retro-fitting recording onto Antigravity sessions already run. Nothing was
  captured; there is nothing to import.
- Any change to how entries are persisted once the hook has classified them —
  the daemon routing, the write-lock relief and the timeout guard are untouched.

## Open questions

- Whether the per-workspace customization root fails to fire in every
  configuration or only in the one that was probed (a headless single-prompt run
  from a freshly initialized repository) is not established. The gap recorded
  under requirement 20 states what was observed, not a general claim about the
  assistant.
- Whether the workspace path list is populated in an interactive session inside
  a workspace is not established; it was empty in the headless probe. Requirement
  9 is written so that either answer yields a correct project directory, so the
  question does not block this change.
