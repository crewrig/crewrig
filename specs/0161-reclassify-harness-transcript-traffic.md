---
id: "0161"
slug: reclassify-harness-transcript-traffic
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 866
version: 1.0.0
---

# Reclassify harness transcript traffic

## Intent

The transcript hook distinguishes human user prompts from automated harness
injections (such as background-task notifications, monitor events, and system
reminders) on prompt submission events, recording machine chatter under a
dedicated `[HARNESS]` prefix and `harness-injection` entry type rather than
polluting the `[USER]` transcript stream.

## Requirements

1. `hooks/mempalace-transcript.sh` SHALL classify prompt submission events
   (`UserPromptSubmit`, `BeforeAgent`, `userPromptSubmitted`) as
   `harness-injection` with a `[HARNESS]` content prefix whenever the prompt
   payload matches harness or system injection patterns (including
   `<task-notification>`, `<system-reminder>`, `<system-message>`,
   `<SYSTEM_MESSAGE>`, or related structural system wrapper tags).
2. Genuine user prompts that do not match harness injection patterns SHALL
   continue to be classified as `user-prompt` with the `[USER]` content prefix.
3. The reclassified `harness-injection` entries SHALL be persisted to the
   session transcript room using `ENTRY_TYPE="harness-injection"`, preserving the
   forensic timeline of automated task events without allowing background
   chatter to masquerade as human user requests.
4. The test suite in `scripts/tests/test-mempalace-transcript-hook.sh` SHALL
   assert that genuine user prompts and harness injections (including
   `<task-notification>` and `<system-reminder>`) are distinctly classified and
   formatted with their respective prefixes (`[USER]` vs `[HARNESS]`).
5. `docs/cli-matrix.md` (row 8) SHALL document the prompt classification
   behavior and multi-CLI parity across all supported CLIs.

## Scenarios

**Scenario:** human user prompt is recorded as user turn

Given a prompt submission event containing a human prompt "Run the test suite"
When  `hooks/mempalace-transcript.sh` processes the event
Then  the persisted drawer content begins with `[USER]` and is classified as
`user-prompt`

**Scenario:** harness task notification is reclassified

Given a prompt submission event containing `<task-notification><task-id>123</task-id><summary>CI pass</summary></task-notification>`
When  `hooks/mempalace-transcript.sh` processes the event
Then  the persisted drawer content begins with `[HARNESS]` and is classified as
`harness-injection`

**Scenario:** system reminder injection is reclassified

Given a prompt submission event containing `<system-reminder>Remember to verify CI</system-reminder>`
When  `hooks/mempalace-transcript.sh` processes the event
Then  the persisted drawer content begins with `[HARNESS]` and is classified as
`harness-injection`

## Out of scope

- Dropping harness traffic entirely at the door (the timeline is preserved via
  reclassification for forensic value).
- Extracting or truncating agent responses or tool call summaries (handled
  separately in issue #757).
- Modifying the transcript exclusion guidance in `artifacts/core/rules/60-tools.md`
  for pre-existing raw transcript archives.

## Open questions
