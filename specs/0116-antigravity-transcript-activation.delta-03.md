---
id: "0116"
slug: antigravity-transcript-activation
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 928
version: 3.0.0
---

# 0116 — antigravity-transcript-activation (delta-03)

This delta rescopes delta-01's requirement 3 and the parent's requirement 5 from
"the Antigravity hook manifest" to "the named transcript hook
`crewrig-mempalace-transcript`", and nuances requirement 23's measured-cardinality
justification, so that a second named hook — the worktree guard mandated by spec
0153 — can coexist with the transcript contract instead of contradicting it.

Delta-01 replaced requirement 3 with a whole-manifest statement: "The Antigravity
hook manifest SHALL register the end-of-execution event and SHALL register no
other event." That scope was chosen when the manifest had one hook and one job. It
is untenable as soon as the manifest has two named hooks and two jobs, which is
exactly the position spec 0153 puts it in. Spec 0153 R4 mandates that
`hooks/worktree-git-guard.sh` be registered in the Antigravity manifest — the
three sibling manifests (Claude Code, Gemini CLI, GitHub Copilot CLI) already
carry it — and R1 mandates pre-tool interception. Pre-tool interception is
`PreToolUse`, an event delta-01's R3, read across the whole manifest, forbids. The
guard and the transcript are not in conflict; the whole-manifest scope
manufactures a conflict between two normative documents.

The conflict became a CI failure through PR #924, which registered the guard on
`PreInvocation` inside the named hook `crewrig-mempalace-transcript` and broke
`check-components` on `main`. Four defects follow, each independently fatal:

1. **Requirement 3 violated.** The registered event keys are
   `["PreInvocation","Stop"]`; the delta-01 replacement allows only `Stop`.
2. **Requirement 5 violated.** The guard's command
   (`bash hooks/worktree-git-guard.sh`) does not end with the event name it is
   registered under, so nothing tells the hook which event fired.
3. **The guard is inert on `PreInvocation`.** The vendored contract describes
   `PreInvocation` as running "before the model is called", and its payload
   carries `invocationNum` and `initialNumSteps` — no tool call. The command the
   guard exists to block is not in that payload, so the guard can never see it.
   Delta-01 already recorded the same fact about the event's shape.
4. **The deployment neutralises it regardless.**
   `deploy_antigravity_transcript_hooks` in `scripts/lib/common.sh` rewrites
   every command in the manifest to the installed `mempalace-transcript.sh` with
   the transcript enabling environment prefix. Even a correctly placed guard
   would be rewritten into a transcript-hook invocation and silently disabled.

The correct placement is `PreToolUse`, where the payload does carry the command —
for the `run_command` tool it sits under `.toolCall.args.CommandLine` (structure
`{toolCall:{name:"run_command",args:{CommandLine:...}}}`), not under
`.tool_input.command`, which is what the guard currently extracts. Two further
facts follow. The guard's command must reference this repository: the guard
delegates to `scripts/worktree-claim.sh` through
`$(dirname "${BASH_SOURCE[0]}")/..`, so it cannot be installed to an
assistant-owned directory the way the transcript hook is. And the guard must gain
an Antigravity extraction path, because the field it reads today is a different
CLI's payload shape.

The correction: the manifest is restructured into two named hooks —
`crewrig-mempalace-transcript` registering `Stop` only (the transcript contract,
bounded to one write per turn), and `crewrig-worktree-git-guard` registering
`PreToolUse` in the grouped `{matcher, hooks:[...]}` form with matcher
`run_command` and the guard referenced by a path into this repository.
Requirements 3 and 5 are rescoped to the transcript hook; requirement 23's
measured-cardinality justification is stated to apply to transcript-persisting
registrations, leaving the guard's registration to be justified by its
interception function. Delta-02 (version 2.1.0, the enforcement clause for
requirement 23 and the measurement-record requirement 26) is untouched except for
the R23 amendment, which is nuanced rather than withdrawn; because delta-02
already allocated requirement 26, the new requirements below are numbered 27, 28
and 29.

The version bump is **MAJOR** (`2.1.0` → `3.0.0`). Delta-01's R3, read as a
whole-manifest constraint, forbids registering `PreToolUse` under any named hook;
spec 0153 R4 and this delta require exactly that registration. An implementation
conforming to delta-01's R3 as merged cannot satisfy this delta, and the `main`
manifest as it stands — violating both R3 and R5 — is the proof that the two
contracts were already in live contradiction.

## ADDED

**Requirements.**

1. **Requirement 27 — the manifest MAY carry the named hook
   `crewrig-worktree-git-guard`.** The Antigravity hook manifest SHALL be
   permitted to include a named hook `crewrig-worktree-git-guard` that registers
   `PreToolUse` through a group whose `matcher` selects the `run_command` tool
   and whose handler command references `hooks/worktree-git-guard.sh` by a path
   to this repository, conforming to spec 0153 R1 (pre-tool interception) and R4
   (registration in the Antigravity manifest).
2. **Requirement 28 — the deployment rewrites the guard to this repository, not
   to the installed transcript hook.** The deployment SHALL install and rewrite
   the named hook `crewrig-mempalace-transcript` exactly as established — install
   the transcript hook under the assistant's own directory and rewrite every
   transcript command to that absolute path with the transcript enabling
   environment prefix — and SHALL rewrite the command of the named hook
   `crewrig-worktree-git-guard` to the absolute path of
   `hooks/worktree-git-guard.sh` in this repository, SHALL NOT prefix that
   command with the transcript enabling environment, and SHALL NOT append a
   lifecycle-event argument to it.
3. **Requirement 29 — the guard SHALL extract the command from Antigravity
   payloads.** The guard SHALL extract the command it inspects from an
   Antigravity `PreToolUse` payload's `.toolCall.args.CommandLine`, falling back
   to `.toolCall.args`, in addition to the payload forms it already reads
   (`.tool_input.command`, `.command`, `.tool_input`).

**Scenarios.**

*Scenario:* the manifest carries two named hooks with distinct normative bases

```text
Given hooks/antigravity-transcript-hooks.json
When its named hooks and their registered event keys are enumerated
Then the named hook `crewrig-mempalace-transcript` SHALL register only `Stop`
And the named hook `crewrig-worktree-git-guard` SHALL register `PreToolUse`
  through a group whose `matcher` selects `run_command` and whose handler command
  names `hooks/worktree-git-guard.sh`
```

*Scenario:* the deployment rewrites the guard to this repository, not to the
installed transcript hook

```text
Given a run of the deployment against a temporary home
When the deployed manifest's guard command is inspected
Then it SHALL contain the absolute path of `hooks/worktree-git-guard.sh` in this
  repository
And it SHALL NOT contain the installed transcript hook path
And it SHALL NOT carry the transcript enabling environment prefix
```

*Scenario:* the guard extracts the command from an Antigravity payload

```text
Given hooks/worktree-git-guard.sh and an Antigravity `PreToolUse` payload carrying
  {"toolCall":{"name":"run_command","args":{"CommandLine":"git reset --hard"}}}
When the guard is invoked with that payload on standard input
Then the command it inspects SHALL be `git reset --hard`
And the prohibited whole-tree operation SHALL be refused as spec 0153 R2 prescribes
```

*Scenario (failure path):* a guard registered on `PreInvocation` stays inert and
non-conforming

```text
Given a manifest registering the guard under `PreInvocation` inside
  `crewrig-mempalace-transcript`
When a turn issues `git reset --hard` in a shared worktree without an exclusive claim
Then the guard SHALL NOT have seen the command, because the `PreInvocation`
  payload carries no tool call
And the manifest SHALL be non-conforming to R3 (a second event registered under
  the transcript hook) and to R5 (the guard command carries no event name)
```

## MODIFIED

1. **Requirement 3 is replaced** (the delta-01 replacement, further rescoped to
   the named transcript hook).

   - Original (delta-01):

     > **R3.** The Antigravity hook manifest SHALL register the end-of-execution
     > event and SHALL register no other event. In particular it SHALL NOT
     > register `PreInvocation`, `PostInvocation`, `PreToolUse` or
     > `PostToolUse`: the first two fire once per model call and the last two
     > once per tool step, so each has approximately per-tool-round cardinality
     > within a turn, and the CLI runs hooks synchronously, blocking the agent
     > loop.

   - Replacement:

     > **R3.** The named hook `crewrig-mempalace-transcript` SHALL register the
     > end-of-execution event and SHALL register no other event. In particular it
     > SHALL NOT register `PreInvocation`, `PostInvocation`, `PreToolUse` or
     > `PostToolUse`: the first two fire once per model call and the last two
     > once per tool step, so each has approximately per-tool-round cardinality
     > within a turn, and the CLI runs hooks synchronously, blocking the agent
     > loop. The restriction is scoped to the named transcript hook; the manifest
     > MAY contain other named hooks, each carrying its own normative base — for
     > example the named hook `crewrig-worktree-git-guard` mandated by spec 0153
     > R4, which registers `PreToolUse` to intercept tool commands rather than to
     > persist transcripts.

2. **Requirement 5 is replaced**, scoped to the transcript hook, with an explicit
   exemption for payload-reading guard hooks.

   - Original (parent spec, left in force by delta-01):

     > **R5.** Every command in the Antigravity hook manifest SHALL tell the hook
     > which lifecycle event fired, because the Antigravity payload does not
     > carry the event name.

   - Replacement:

     > **R5.** Every command registered under the named hook
     > `crewrig-mempalace-transcript` SHALL tell the transcript hook which
     > lifecycle event fired, because the Antigravity payload does not carry the
     > event name. A named hook whose command inspects the payload it reads from
     > standard input rather than relying on a positional argument — such as the
     > named hook `crewrig-worktree-git-guard`, whose `PreToolUse` payload
     > carries the tool call to intercept — SHALL NOT be required to carry a
     > lifecycle-event argument.

3. **Requirement 23 is replaced** (as amended by delta-02), nuancing which
   registrations the measured-cardinality justification applies to, while keeping
   the enforcement clause.

   - Original (delta-02):

     > **R23.** An event SHALL NOT be registered on the strength of its name or
     > its documented description alone; its firing frequency relative to a turn
     > SHALL be measured against a real multi-step turn, and the measurement
     > recorded per Requirement 26. A single-prompt probe SHALL NOT be accepted
     > as evidence of per-turn cardinality, because one invocation equals one
     > turn in that case. **A REVIEW pass that audits a change registering a
     > lifecycle event without a recorded measurement satisfying this
     > requirement SHALL emit a `class: spec` finding citing this
     > requirement.**

   - Replacement:

     > **R23.** An event registered to PERSIST a transcript entry SHALL NOT be
     > registered on the strength of its name or its documented description
     > alone; its firing frequency relative to a turn SHALL be measured against a
     > real multi-step turn, and the measurement recorded per Requirement 26. A
     > single-prompt probe SHALL NOT be accepted as evidence of per-turn
     > cardinality, because one invocation equals one turn in that case. A REVIEW
     > pass that audits a change registering a lifecycle event for transcript
     > persistence without a recorded measurement satisfying this requirement
     > SHALL emit a `class: spec` finding citing this requirement. These clauses
     > apply to events registered to persist transcript entries; a named hook
     > that writes no transcript justifies its registration by its interception
     > function instead, and its firing frequency SHALL be documented rather than
     > bounded. The `PreToolUse` registration of the named hook
     > `crewrig-worktree-git-guard` is justified by its pre-tool interception
     > function (spec 0153 R1), not by measured cardinality.

4. **The scenario "High-frequency events are not registered" is replaced** (the
   delta-01 replacement), scoped to the transcript hook, because the manifest now
   legitimately registers `PreToolUse` under the guard hook.

   - Original (delta-01):

     ```text
     Given hooks/antigravity-transcript-hooks.json
     When its registered event keys are enumerated
     Then the only key SHALL be Stop
     ```

   - Replacement:

     ```text
     Given hooks/antigravity-transcript-hooks.json
     When the registered event keys of the named hook
       `crewrig-mempalace-transcript` are enumerated
     Then the only key SHALL be Stop
     ```

Requirements 1, 2, 4 through 22, 24 and 25 of the parent spec and delta-01, and
Requirement 26 of delta-02, are **UNCHANGED** and remain in force. In particular
the parent's Requirement 6 (superseding the spec-0056 event names) still applies,
and delta-02's Requirement 26 (the recorded measurement) still applies to
transcript-persisting registrations.

## REMOVED

1. **The whole-manifest reading of Requirement 3.** "The Antigravity hook
   manifest SHALL register the end-of-execution event and SHALL register no other
   event" is removed as a whole-manifest constraint; the same normative content
   remains in force scoped to the named hook `crewrig-mempalace-transcript` (see
   MODIFIED, item 1).
2. **The whole-manifest reading of Requirement 5.** "Every command in the
   Antigravity hook manifest SHALL tell the hook which lifecycle event fired" is
   removed as a whole-manifest constraint; the requirement remains in force for
   commands registered under the transcript hook, and payload-reading guard hooks
   are exempt (see MODIFIED, item 2).
3. **The whole-manifest scenario "High-frequency events are not registered".** The
   assertion that enumerating every registered event key in the manifest yields
   only `Stop` is removed, because the guard hook legitimately registers
   `PreToolUse` (see MODIFIED, item 4).
