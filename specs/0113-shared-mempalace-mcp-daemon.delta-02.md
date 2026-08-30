---
id: "0113"
slug: shared-mempalace-mcp-daemon
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1096
version: 3.0.0
---

# Concurrent sessions all write to shared memory — delta 02

Closes the setup-script behaviour gap reported on issue #1096: a setup run on a
machine already converted to the shared daemon leaves the assistant back on the
stdio arrangement, so every session contends with the daemon for the palace
writer lease and is refused with MCP error `-32001` (*Peer MCP writer active*).

`MAJOR` bump. The delta changes the behaviour setup must exhibit — HTTP by
default, with stdio only as a reported fallback — which invalidates the current
implementation (each setup script writes the stdio-shaped entry and calls
`offer_mcp_http_switch` *before* that write, so the stdio write overwrites the
HTTP registration even when the operator accepts the offer).

Requirement numbering continues the parent's sequence (which ends at R16 after
delta-01), per the precedent of `specs/0112-spec-id-reservation.delta-01.md`.

## ADDED

1. **R17.** Setup SHALL register the `mempalace` MCP entry in the HTTP
   arrangement by default, without an interactive opt-in, when the shared daemon
   is serving.
2. **R18.** When the shared daemon is not serving, setup SHALL bring it up
   (install and start the supervisor) before registering the HTTP arrangement.
3. **R19.** When the shared daemon cannot be brought up, setup SHALL register
   the previous (stdio) arrangement and SHALL report that it did so, naming the
   repair.
4. **R20.** A setup run SHALL NOT leave an assistant on the stdio arrangement
   when the shared daemon is serving.

**Scenario:** Setup on a converted machine

Given the shared daemon is serving
And an assistant is already registered in the HTTP arrangement
When setup runs for that assistant
Then the assistant SHALL remain in the HTTP arrangement
And setup SHALL NOT require an interactive confirmation to keep it there

**Scenario:** Setup on an unconverted machine

Given the shared daemon is not serving
When setup runs for an assistant
Then setup SHALL bring the daemon up
And the assistant SHALL be registered in the HTTP arrangement

**Scenario:** The daemon cannot be brought up

Given the shared daemon is not serving
And it cannot be brought up
When setup runs for an assistant
Then the assistant SHALL be registered in the previous (stdio) arrangement
And setup SHALL report that it did so
And setup SHALL name the repair the operator must perform

## MODIFIED

None.

## REMOVED

None.
