---
id: "0248"
slug: worktree-git-guard-typescript
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1489
version: 1.1.0
---

# Worktree git guard hook and worktree-claim in TypeScript

*Delta-01 of `specs/0248-worktree-git-guard-typescript.md`, raised by issue #1489. It
amends requirement 10 and deviation (b) of requirement 38 of the parent and adds
requirements 39 to 42. Every requirement of the parent not named here is unchanged.*

## ADDED

### Requirements

<!-- markdownlint-disable MD029 -->

39. **Antigravity payload recognition.** The guard SHALL treat a payload as Antigravity
    CLI's when the parsed payload is a JSON object whose `toolCall` member is itself a
    JSON object (neither `null`, an array, nor a scalar), or, when the payload does not
    parse, when its raw text contains the substring `"toolCall"`. Recognition SHALL be
    settled from the bytes read before any other step, so that an internal error after
    the read still answers per requirement 40. The test SHALL use the payload only,
    never the process environment or the command line. **Accepted gap:** when standard
    input is unreadable or empty, no payload is available, the guard cannot tell the
    CLI, and the allow outcome stays silent as requirement 10 states.
40. **Antigravity allow answer.** On every allow outcome for an Antigravity payload the
    guard SHALL exit with status zero, write the single line `{"decision": "ask"}` and a
    line feed to standard output, and write nothing to standard error. The documented
    `PreToolUse` contract of `agy` requires a `decision`, and an empty standard output
    from a `PreToolUse` handler is read by the engine as a fail-closed denial of the tool
    call (issue #1489, verified live on 2026-09-02). `ask` defers to the CLI's standard
    permission flow and steers nothing; `allow` SHALL NOT be used, because it
    auto-approves the tool call and would widen the permission the user granted.
41. **One allow path.** Every allow outcome of the guard SHALL leave through one function,
    so that the answer of requirement 40 cannot be missed on a path added later. A test
    SHALL cover the three early outcomes (working directory outside a ticket worktree,
    empty ticket, command not prohibited), a prohibited command under a held claim, and
    the failure outcomes before identification that leave a payload to recognise (an
    unparsable payload carrying `"toolCall"`, an internal error after the read), each
    with an Antigravity payload; the unreadable-input gap of requirement 39 is asserted
    silent.
42. **Other CLIs unchanged.** For a payload that is not Antigravity's (requirement 39),
    every allow outcome SHALL remain exit status zero and zero bytes on both streams, as
    requirement 10 states, and a refusal SHALL remain as requirements 8 and 9 state for
    every payload shape: nothing on standard output. A test SHALL assert both payload
    shapes against the same working directory and command.

### Scenarios

**Scenario:** An Antigravity payload for a safe command is answered `ask`

Given a ticket worktree and the payload `{"toolCall": {"name": "run_command", "args": {"CommandLine": "git status"}}}`
When the guard runs
Then it exits 0, standard output is `{"decision": "ask"}` and a line feed, and standard error is empty

**Scenario:** The same command from another CLI stays silent

Given the same working directory and the payload `{"tool_input": {"command": "git status"}}`
When the guard runs
Then it exits 0 and both streams are empty

**Scenario:** An Antigravity payload outside a worktree is answered `ask`

Given a working directory with no `/.worktrees/` segment and an Antigravity payload
When the guard runs
Then it exits 0 with the single `ask` line on standard output

**Scenario:** A refused command on Antigravity prints no decision

Given a prohibited command in an unclaimed ticket worktree and an Antigravity payload
When the guard runs
Then it exits 1, standard output is empty, and standard error is the refusal of requirement 9

## MODIFIED

Requirement 10, first sentence — was: "Every other outcome SHALL exit with status zero and
write zero bytes to standard output and standard error". Now: "Every other outcome SHALL
exit with status zero and write zero bytes to standard output and standard error, except
an allow outcome for an Antigravity payload, which requirements 39 and 40 govern". The
silence of Node.js warnings, the failure-before-identification rule and the entry form
are unchanged.

Requirement 38, deviation (b) — the command lines each CLI runs are joined by deviation
(f), whose normative source is requirements 39 to 42 of this delta: the guard's allow outcome on Antigravity CLI is `{"decision": "ask"}` where the
shell guard printed nothing, because the shell guard's silence is the defect of
issue #1489.

## REMOVED

None.
