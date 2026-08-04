---
id: "0108"
slug: mempalace-runtime-version-guard
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 623
version: 1.0.0
---

# Runtime version guard for the MemPalace memory server

## Intent

An agent session never silently runs against a MemPalace whose version falls
outside the range CrewRig supports: a memory server whose version is out of
range refuses to start and says so, instead of serving a degraded tool surface
that agents mistake for the documented one; and an operator who suspects a
drifted install can ask the framework which MemPalace will actually answer,
learn the resolved location and version behind every MemPalace command on the
machine, and be told when those disagree.

## Requirements

1. When a MemPalace memory-server session is launched for an agent, the
   framework SHALL determine the MemPalace version that session would serve,
   and SHALL refuse to begin serving when that version lies outside the pinned
   supported range.
2. The version determined per requirement 1 SHALL be the version resolvable
   from the interpreter that will actually serve the session, and SHALL be
   determined inside the very process that goes on to serve, before that
   process begins serving. It SHALL NOT be taken from a package-manager
   inventory, from a version reported by a `mempalace` executable found on the
   operator's search path, or from a version recorded when the framework was
   last set up.
3. A refusal per requirement 1 SHALL emit a diagnostic that names the version
   found, the pinned supported range, the resolved interpreter, and the action
   that brings the install into range; and SHALL terminate unsuccessfully so
   that the launching CLI reports a failed memory server rather than a started
   one.
4. Every operator-facing output of the guard — the refusal diagnostic of
   requirement 3 and the diagnostic of requirement 7 — SHALL state that a
   memory-server session already running continues to serve the version it
   started with, and that running sessions must be restarted before a change to
   the install takes effect.
5. The supported range enforced per requirement 1 SHALL be the same single
   declaration already enforced when the framework is set up
   (`MEMPALACE_MIN_VERSION` / `MEMPALACE_MAX_VERSION_EXCLUSIVE` in
   `scripts/lib/common.sh`). No second copy of either bound SHALL be introduced
   anywhere on the memory-server launch path.
6. When the determined version lies inside the pinned range, the launch SHALL
   proceed with no change to the served tool surface, no additional prompt, and
   no additional output on the session's protocol channel.
7. The framework SHALL provide an operator-invocable diagnostic that reports,
   for each MemPalace command that resolves on the operator's search path
   (`mempalace` and `mempalace-mcp`), the resolved path, the interpreter that
   would run it, and the MemPalace version that interpreter serves; and that
   reports the interpreter and version the memory-server launch path would
   itself select.
8. The diagnostic per requirement 7 SHALL report a non-successful outcome when
   any two of the versions it reports differ, or when any version it reports
   lies outside the pinned range, and SHALL name which resolved path carries
   which version so the divergent install is identifiable without further
   investigation.
9. The diagnostic per requirement 7 SHALL derive every reported fact from the
   paths and interpreters that actually resolve at the moment it is invoked,
   and SHALL NOT depend on an enumeration of known Python package managers. A
   MemPalace installed by a mechanism the framework does not recognize SHALL
   still be reported.
10. When the framework's interpreter-resolution step selects a candidate other
    than its highest-priority one, the selection SHALL be reported together
    with the MemPalace version that candidate serves. A silent fallback to a
    lower-priority candidate SHALL NOT occur.
11. Requirements 1 through 6 SHALL hold identically for memory-server sessions
    launched from each of the four supported CLIs (Claude Code, Gemini CLI,
    GitHub Copilot CLI, Antigravity CLI). No CLI SHALL be able to start a
    memory-server session on an out-of-range MemPalace while another CLI
    refuses the same install.
12. The change realizing this spec SHALL consult and update
    `docs/cli-matrix.md` in the same diff, recording the launch-time guard and
    the operator diagnostic on the MemPalace integration rows, per the
    CLI-matrix maintenance protocol.

## Scenarios

**Scenario:** In-range MemPalace serves unchanged

Given the MemPalace the memory-server launch path resolves to is 3.6.0
When an agent session launches the memory server
Then the session starts, serves the full documented tool surface, and its
protocol channel carries nothing beyond what it carried before this spec.

**Scenario:** Below-floor MemPalace refuses to serve

Given the MemPalace the memory-server launch path resolves to is 3.3.5
When an agent session launches the memory server
Then the memory server does not begin serving, terminates unsuccessfully so the
launching CLI reports it as failed, and prints a diagnostic naming 3.3.5, the
supported range, the resolved interpreter, and how to install a supported
version.

**Scenario:** Above-ceiling MemPalace refuses to serve

Given the MemPalace the memory-server launch path resolves to is 3.7.0
When an agent session launches the memory server
Then the memory server does not begin serving and refuses with the same
diagnostic shape as the below-floor case.

**Scenario:** Refusal is uniform across the four CLIs

Given the MemPalace the memory-server launch path resolves to is out of range
When an agent session launches the memory server from each of Claude Code,
Gemini CLI, GitHub Copilot CLI, and Antigravity CLI in turn
Then every one of the four refuses to serve.

**Scenario:** Guard output tells the operator to restart running sessions

Given a MemPalace install that the guard has something to say about — either out
of range at launch, or divergent when the diagnostic is invoked
When the operator reads the output the guard produced
Then that output states that an already-running session keeps serving the
version it started with and that running sessions must be restarted before a
change to the install takes effect.

**Scenario:** Divergent installs are reported and flagged

Given `mempalace` resolves to an install serving 3.0.0 while `mempalace-mcp`
resolves to a different install serving 3.6.0
When the operator invokes the diagnostic
Then it reports both resolved paths with their interpreters and versions,
reports a non-successful outcome, and states which path carries the out-of-range
version.

**Scenario:** An unrecognized install mechanism is still reported

Given a MemPalace installed by a mechanism the framework has no knowledge of is
the one that resolves on the operator's search path
When the operator invokes the diagnostic
Then it reports that install's resolved path, interpreter, and version, without
having needed to recognize the mechanism that placed it there.

## Out of scope

- Remediating any particular machine's MemPalace install — removing a shadowing
  copy, repairing symlinks, or reinstalling is local operations work with no
  repository change involved.
- Any change to MemPalace upstream (the specs 0068 / 0070 boundary).
- Reporting the version an *already-running* memory-server session is serving.
  Enforcement is confined to the moment a session starts; see *Rejected
  alternatives* for the two shapes this could have taken and why neither was
  adopted.
- Restarting, terminating, or reloading agent sessions on the framework's own
  initiative when the install changes underneath them. The guard tells the
  operator to restart (requirement 4); it never does so itself.
- Re-litigating enforcement at framework-setup time: all four setup flows
  already refuse an out-of-range install and are already covered by
  `scripts/tests/test-mempalace-version-range.sh`. This spec adds a second
  enforcement point; it changes nothing about the first.
- Changing the pinned supported range itself. The range stays whatever
  `scripts/lib/common.sh` declares.
- Any override that lets an operator start a memory-server session on an
  out-of-range MemPalace. Setup-time enforcement offers no such escape hatch,
  and a runtime guard laxer than the install-time one would reopen exactly the
  silent-degradation window this spec closes.
- Automatically repairing a divergence the diagnostic reports. The diagnostic
  reports; it does not mutate the operator's installs.
- Protecting sessions whose memory-server registration points at a checkout
  that predates this guard. A registration records an absolute path into
  whichever checkout ran setup, so the guard takes effect for a given machine
  only once setup has been re-run against a checkout that carries it. Bridging
  that window is not addressed here.

## Open questions

None. The single design question raised while this spec was drafted — whether
the guard should also report the version a *running* session is serving, so a
session stale against its on-disk install becomes detectable — was resolved at
the SPECS gate in favour of a launch-time guard on the installed version alone.
It is recorded as requirements 1 through 4, as the third *Out of scope* bullet,
and as the rejected alternative below.

## Rejected alternatives

**Reporting the version a running session is serving.** Considered because the
one incident on record (issue #623, 2026-07-21) had exactly that shape: a
running memory server kept serving the MemPalace 3.3.5 tool surface after its
own binaries had been uninstalled and replaced by 3.6.0, because a Python
process retains the modules it has already loaded. Rejected in both the forms it
could take:

- *Upstream contribution* — carry the serving version in the MemPalace status
  tool's own response. Rejected as out of scope: issue #623 excludes changes to
  MemPalace upstream (the specs 0068 / 0070 boundary), and it would make this
  fix hostage to a third-party release schedule. The path stays open, and a
  future ticket can revive it cheaply, should the residual lag described below
  ever prove to cost more than it currently appears to.
- *CrewRig-side interception* — have the launch path annotate the tool responses
  that pass through it. Rejected as disproportionate: the launch path hands
  ownership of the session's protocol channel to MemPalace's own entry point, so
  annotating would mean wrapping the protocol stream and coupling the framework
  to the exact shape of upstream responses — a fragile dependency to take on for
  a diagnostic rather than for a correctness property.

**Why the launch-time guard suffices.** The recorded incident was severe
precisely because nothing checked at launch: the session began on 3.3.5 and
stayed there for weeks. Once a launch refuses an out-of-range version, that
session never starts at all. What remains is a session that started on a *valid*
version and keeps serving that valid version after the operator changes the
install — a lag, not a degradation, since no out-of-range version ever serves.
Its only symptom is confusion (a newly installed MemPalace's tools do not appear
until the session restarts), and requirement 4 addresses that symptom directly
by making every guard output say so.

**Why refusal, rather than starting with a warning.** The launch path already
refuses to start when the shared ChromaDB daemon is unreachable, terminating
unsuccessfully with the repair command on its error channel, and it already
records that a silent fallback in that situation is forbidden by design. An
out-of-range MemPalace is the same class of unmet precondition and is treated
the same way. A warning would also have nowhere visible to go: the session's
protocol channel cannot carry it (requirement 6), and the error channel of a
memory server is captured into per-CLI logs that nobody reads — which is how the
recorded incident went unnoticed for weeks in the first place.
