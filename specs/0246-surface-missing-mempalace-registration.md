---
id: "0246"
slug: surface-missing-mempalace-registration
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1410
version: 1.0.0
---

# A missing MemPalace registration is announced at session start, never silent

*Context (issue #1410). On 2026-10-01 `task mempalace:status` reported the
shared MemPalace MCP HTTP daemon `HEALTHY` while Claude Code and Gemini CLI
carried no `mempalace` registration at all; backups of `~/.claude.json` show
Claude Code ran at least four days that way. Nothing said so: a CLI without
the registration starts with no `mempalace_*` tool, the session-start sweep of
`artifacts/core/rules/60-tools.md` cannot run, and no rule tells the agent to
report it. Issue #989 / spec 0113 covered the noisy neighbour of this state —
registered on stdio and refused writes by the daemon's lease. This spec
covers the quiet one, and a registration that points at the wrong endpoint.
The setup bugs that probably caused the 2026-09-27 loss are already fixed
and are not reopened here: issues #1210, #1243, #1247, and #1255.*

## Intent

When an operator opens a session of Claude Code, Gemini CLI, Copilot CLI, or
Antigravity CLI on a machine where the shared MemPalace daemon is installed
and serving, and that CLI is not registered against it — no entry, a stdio
entry, or an entry aimed at another endpoint — the operator sees a short
warning at the start of the session. The warning names the CLI and the one
command that repairs it. A correctly registered CLI, or a machine with no
daemon installed, shows nothing. Separately, any agent that finds itself
without memory tools tells the user so before doing any work, instead of
quietly skipping the memory protocol.

## Requirements

1. **(Expected arrangement)** The session-start check SHALL derive what the
   CLI it runs in is expected to have from the machine state alone. When a
   MemPalace MCP HTTP daemon installed by this framework's setup exists on the
   machine AND that daemon is serving (requirement 2), the expected
   arrangement SHALL be a `mempalace` registration of that CLI over HTTP,
   aimed at exactly the expected endpoint. The expected endpoint SHALL be
   composed of the host and the port recorded in the installed daemon
   launcher (`MCP_HOST` and `MCP_PORT` in `~/.crewrig/mcp-daemon-launcher.sh`,
   materialised from `scripts/lib/mcp-daemon-launcher.sh`), with the scheme
   `http` and the path `/mcp`. The scheme and the path are the framework's
   fixed transport contract, the same constants every framework reader of
   the endpoint uses today. The host and the port SHALL NOT be taken from a
   hard-coded default, nor from environment variables that happen to be set
   in the session. A launcher that exists but records no readable host or
   port SHALL count as no installed daemon. When no such daemon is
   installed, or the platform has no daemon supervisor this framework
   installs, there SHALL be no expectation, and the check SHALL behave as
   requirement 6 states.

2. **(Serving predicate)** The check SHALL decide whether the daemon is
   serving from positive evidence obtained by one request, sent without any
   credential, to the expected loopback endpoint itself. That evidence SHALL
   be either an authentication refusal or a successful MCP answer from that
   endpoint. A liveness endpoint that answers in every state SHALL NOT by
   itself establish that the daemon is serving. That reasoning is recorded in
   `docs/runbooks/mempalace-mcp-server.md` → *Checking it is actually
   serving, and actually authenticated*, in the header of
   `scripts/status-mcp-server.sh`, and in issue #880. No spec carries it:
   the `scripts/lib/common.sh` comment that attributes it to spec 0139
   delta-01 is a mis-attribution. A refused connection, a timeout, or
   any other answer SHALL count as "not serving".

3. **(Registration classes)** When the daemon is serving, the check SHALL
   classify the CLI's user-level `mempalace` registration as exactly one of:
   `ok` (an HTTP entry whose endpoint equals the expected endpoint);
   `absent` (no `mempalace` entry, including a configuration file that does
   not exist); `stdio` (an entry that launches a local process);
   `wrong-endpoint` (an HTTP entry aimed at any other endpoint); and
   `unrecognised` (a configuration file that does not parse, or an entry
   matching neither the HTTP nor the stdio shape). The four registration
   shapes recorded in `scripts/lib/common.sh` (`type`+`url` for Claude Code,
   Gemini CLI, and Copilot CLI; `serverUrl` with no transport key for
   Antigravity CLI) SHALL all be recognised. Because the check runs inside the
   CLI, a missing configuration file SHALL be classified `absent`, never as
   "CLI not installed".

4. **(Agreement with `task mempalace:status`)** For every configuration file
   that exists, the check's class SHALL agree with the arrangement that
   `task mempalace:status` reports for the same file: `ok` and
   `wrong-endpoint` with `http`, `stdio` with `stdio`, `absent` with `none`,
   and `unrecognised` with `unknown`. `task mempalace:status` SHALL report a
   `wrong-endpoint` registration on a line distinct from a correct HTTP one,
   naming the registered endpoint and the expected endpoint and nothing else
   from the entry. The expected endpoint `task mempalace:status` compares
   against SHALL be the requirement 1 endpoint, read from the same source
   (the installed launcher), never from environment variables or hard-coded
   defaults, so the two readers agree on `wrong-endpoint` on a machine
   installed with a non-default port. The agreement SHALL be guaranteed
   either by one shared definition or by an automated test that runs both
   readers over the same fixtures.

5. **(Warning content)** For `absent`, `stdio`, and `wrong-endpoint`, the
   check SHALL emit exactly one warning that names the CLI, states the class
   in plain words, says that shared memory is unavailable to this session (or,
   for `stdio`, that its writes are refused by the daemon), and names
   `task mempalace:switch-http` followed by a session restart as the repair.
   When the class is `absent` because the CLI's configuration file does not
   exist, the warning SHALL instead name that CLI's own setup script
   (`scripts/setup-<cli>-interactive.sh`), because
   `task mempalace:switch-http` refuses a present CLI that has no
   configuration file and asks for its own setup script to be run first
   (`scripts/lib/common.sh`, the R12 pre-flight of
   `switch_assistants_to_http`).
   For `unrecognised`, the warning SHALL name `task mempalace:repair` instead.
   When the daemon is installed but not serving and the CLI's registration is
   anything other than `stdio`, the check SHALL emit one warning that the
   shared memory daemon is not answering and that names
   `task mempalace:status`. Every warning SHALL be at most 600 bytes.

6. **(Silence)** The check SHALL emit nothing on any channel — nothing for
   the user, nothing for the model's context — when the class is `ok`, when
   no daemon is installed, when the platform has no supported daemon
   supervisor, and when the daemon is installed but not serving and the CLI is
   registered `stdio` (the stdio fallback that setup leaves behind on purpose,
   spec 0113 delta-02 R19). Nothing in this requirement prevents the check
   from writing to its own private state (requirement 8).

7. **(Both audiences)** On each CLI, the warning SHALL reach the human
   through a channel that the CLI shows in its own interface, AND the model
   through a channel that the CLI adds to the session's context, for every
   channel that the CLI offers on the event used (requirement 8). When a CLI
   offers only one of the two channels for that event, the warning SHALL use
   that one, and `docs/cli-matrix.md` SHALL record the missing channel as a
   gap carrying concrete evidence as defined in
   `docs/cli-matrix-maintenance.md` → *Gap-acceptance evidence rule*. When a
   CLI offers neither channel on any event the check could use, that CLI
   SHALL be recorded as an evidenced gap and SHALL be covered by
   requirement 13 alone.

8. **(When it runs)** On Claude Code, Gemini CLI, and Copilot CLI, the check
   SHALL run on the CLI's session-start event, at least for a new session and
   for a resumed one. On Antigravity CLI, which has no session-start event
   (`docs/cli-matrix.md` row 8, spec 0116), the rules below apply.
   - **Normative base.** This requirement is the normative base of a new
     named hook, `crewrig-mempalace-session-check`, on the
     per-model-invocation event `PreInvocation`. Requirement 11's writer
     registers it directly in the user-level hook file
     `~/.gemini/config/hooks.json`, beside any transcript hooks. The
     committed transcript manifest `hooks/antigravity-transcript-hooks.json`
     does not carry it. So it never passes through the transcript deploy
     path, which spec 0116 R4 governs and which rewrites every named hook
     except `crewrig-worktree-git-guard` into a transcript invocation. The
     prohibition of `PreInvocation` in spec 0116
     delta-01 replacement R3 was rescoped by
     `specs/0116-antigravity-transcript-activation.delta-03.md` replacement R3
     to the named hook `crewrig-mempalace-transcript` alone. That replacement
     allows other named hooks with their own normative base, so the
     prohibition does not bind this hook, and this spec leaves it in force
     for the transcript hook.
   - **Throttle key.** The recorded evidence shows the `PreInvocation`
     payload carrying `invocationNum` and `initialNumSteps` (spec 0116
     delta-03, item 3), and `conversationId` only on `Stop` (row 8,
     Exercise B). The DEV stage SHALL establish, by a live `agy` probe
     recorded in `docs/cli-matrix.md`, whether `PreInvocation` carries a
     conversation identifier. If it does, the check SHALL read configuration
     and probe the daemon at most once per conversation, keyed by that
     identifier. If it does not, the check SHALL read configuration and probe
     at most once per 30-minute window per user. The window is long enough
     that one working conversation is not warned at every model call. It is
     short enough that a session opened later the same half-day is checked
     again. Each conversation's agent is still covered by requirement 13.
   - **Guarded path.** Every invocation that the throttle suppresses SHALL
     emit nothing and SHALL NOT probe or read any assistant configuration.
   - **Cost bound.** The hook runs synchronously on every model call, about
     four times per turn (row 8, Exercise A). So the suppressed path SHALL
     cost at most 150 ms of wall-clock time per invocation, runtime start
     included. The DEV stage SHALL measure that cost as the 95th percentile
     of at least 20 consecutive invocations and record the figure, the
     machine, and the `agy` version in `docs/cli-matrix.md`.
   - **Fallback.** If the measured cost exceeds the bound, or `PreInvocation`
     offers no channel to the user or the model (requirement 7), the hook
     SHALL NOT be registered. Antigravity CLI SHALL then be recorded as an
     evidenced gap covered by requirement 13 alone.
   - **State.** The throttle state SHALL be private to the user (mode `0600`
     or stricter, in a directory only the user can write) and SHALL NOT grow
     without bound.

9. **(Never blocks)** The check SHALL end with a success status on every
   path, including a missing runtime or a runtime below the repository's Node
   floor, an unreadable or unparseable file, a probe failure, an unsupported
   platform, and a hook command pointing at a checkout that has since moved
   or been deleted. It SHALL finish within 2 seconds of wall-clock time on
   every path, with the probe itself bounded to 1 second. It SHALL NOT use
   any CLI mechanism that blocks, denies, or stops a session, a prompt, or a
   tool call.

10. **(No secret, no side effect)** The MemPalace bearer token SHALL NOT
    appear in the check's output on any channel, in the arguments of any
    process the check starts, in any file the check writes, or in the
    environment the check passes to a child process. The probe of
    requirement 2 SHALL carry no credential. The check SHALL NOT modify any
    assistant configuration file, SHALL NOT start, stop, or restart the daemon
    or any MCP server, SHALL NOT invoke any assistant CLI, and SHALL NOT send
    any network request other than the single loopback request of
    requirement 2.

11. **(Installed by default)** Every run of
    `scripts/setup-{claude,gemini,copilot,antigravity}-interactive.sh` SHALL
    register the check in that CLI's user-level hook configuration without
    asking, with one exception. On Antigravity CLI it SHALL register the
    check only while requirement 8's evidence conditions hold. When
    requirement 8's fallback applies, the Antigravity setup SHALL NOT register
    the check, and SHALL remove any check entry an earlier run registered.
    Registration SHALL NOT depend on the session-recording opt-in (row 8) or
    the usage-capture opt-in (spec 0211), nor on the outcome of that run's
    MemPalace step (HTTP registered, stdio fallback, or MemPalace not
    installed). No committed `hooks/*-transcript-hooks.json` or
    `hooks/*-usage-capture-hooks.json` manifest SHALL carry the check's entry,
    on any CLI. This requirement's own writer SHALL register it directly in
    the user-level hook file, never through the session-recording or
    usage-capture deploy paths. The registration SHALL be idempotent (exactly
    one check entry after any number of runs), backup-first, and written at
    mode `0600`. It SHALL preserve every other hook entry and every non-hook
    key. Conversely, the session-recording and usage-capture writers SHALL
    leave the check's entry untouched whatever their answer (accept,
    decline, cancel, keep, or remove). The check's entry SHALL be identified
    by its content, never by its position.

12. **(Repository ratchet)** Every file this ticket adds SHALL comply with
    spec 0238: no new tracked shell file outside its allowlist, no new
    JavaScript file outside its named exceptions, and new executable code and
    tests authored in TypeScript.

13. **(Absent-tools rule for agents)**
    `artifacts/core/rules/60-tools.md` → *Memory Activation Protocol* →
    *Session Start* SHALL state the following. When no `mempalace_*` tool is
    available to the agent — neither directly callable nor discoverable
    through the host CLI's deferred-tool search — or when the sweep's first
    MemPalace call fails because the server cannot be reached, the agent SHALL,
    before any task work, tell the user explicitly that shared memory is
    unavailable for this session. It SHALL say that the handoff lookup, the
    checkpoint, and the final flush will not happen, and SHALL point at
    `task mempalace:status`. The agent SHALL NOT skip the sweep silently and
    SHALL NOT act as if the sweep had run. Once it has signalled, the agent
    SHALL continue with the task unless the user says otherwise. The rule
    SHALL apply to every role, seated reviewer passes included, and SHALL
    mirror the *Explicit signal — never silent* step of *Retrieving the
    system-context store*. A deferred tool SHALL count as available.

14. **(Built outputs)** The change to `artifacts/core/rules/60-tools.md`
    SHALL ship with the outputs of `bash scripts/build-components.sh`
    regenerated in the same commit, as `AGENTS.md` → *Agent Team Protocol*
    requires.

15. **(Documentation and matrix)** `docs/cli-matrix.md` SHALL describe the
    check for each of the four CLIs in one row: the event it runs on, the
    file its entry lands in, the user channel, the model channel, and, for
    Antigravity CLI, the throttle key that requirement 8's probe selected and
    the measured cost of the suppressed path. Each gap SHALL be listed
    under *Parity gaps* with its evidence. Row 10 (setup) SHALL mention the
    default registration of requirement 11. `docs/runbooks/mempalace-mcp-server.md`
    SHALL document each warning of requirement 5, what it means, and its
    repair. It SHALL also state that on Gemini CLI the check's entry and the
    `mempalace` registration live in the same file, so losing the whole file
    loses both, and that requirement 13 is the backstop for that case. It
    SHALL also document an accepted limitation. `task mempalace:switch-http`
    runs a machine-wide all-or-nothing pre-flight, so a warning that names it
    for one CLI can meet a refusal caused by another CLI's missing
    configuration file. That refusal names the CLI at fault and asks for its
    own setup script, which the operator runs before retrying
    `task mempalace:switch-http`.

16. **(Hermetic tests)** The DEV stage SHALL add automated tests that run
    against a fixture home directory and a fake loopback endpoint on an
    ephemeral port. The tests SHALL NOT contact the live daemon on
    `127.0.0.1:41893`. They SHALL cover, at minimum: every class of
    requirement 3 for each of the four registration shapes; `absent` from a
    missing configuration file, whose warning names the CLI's setup script
    (requirement 5); a launcher recording a non-default port, against which
    the check and `task mempalace:status` agree on `wrong-endpoint`
    (requirement 4); silence with no daemon installed; the not-serving cases of requirements 5 and 6; an
    endpoint that accepts the connection and never answers, which finishes
    within the requirement 9 budget with a success status; a sentinel token
    planted in every fixture configuration and token file that never shows up
    in any output or any child argument; the Antigravity throttle with a
    `PreInvocation` payload that carries a conversation identifier and with
    one that does not (requirement 8); and the setup registration's idempotence and coexistence with both
    opt-ins in both directions (requirement 11). The tests SHALL be wired
    into continuous integration as spec 0076 requires.

17. **(Stale-clobber investigation)** The DEV stage SHALL run a reproducible
    experiment that determines whether a running Claude Code session, when it
    rewrites `~/.claude.json`, drops a `mempalace` entry written to that file
    by another process while the session was running. It SHALL record on
    issue #1410 the Claude Code version, the platform, the exact steps, the
    number of trials, and the observed outcome, with one verdict: `confirmed`,
    `ruled out`, or `inconclusive`. A `confirmed` verdict SHALL open a
    separate issue, linked from #1410, that carries the evidence. An
    `inconclusive` verdict SHALL NOT be reported as `ruled out`; it SHALL
    state what would settle the question and SHALL open a follow-up issue that
    tracks it.

## Scenarios

**Scenario:** A correctly registered CLI starts silently

Given the daemon is installed and answers an unauthenticated request to its MCP endpoint with an authentication refusal
And Claude Code's `~/.claude.json` carries a `mempalace` HTTP entry aimed at exactly the installed daemon's endpoint
When a new Claude Code session starts
Then the check emits nothing to the user and nothing to the model's context
And it ends with a success status

**Scenario:** A removed registration is announced (issue acceptance 1)

Given the daemon is installed and serving
And the `mempalace` entry has been deleted from `~/.gemini/settings.json`
When a new Gemini CLI session starts
Then the user sees one warning naming `gemini`, saying shared memory is unavailable, and naming `task mempalace:switch-http`
And the model's context carries the same warning
And the warning is at most 600 bytes

**Scenario:** A missing configuration file points at the setup script

Given the daemon is installed and serving
And `copilot` is on `PATH` but `~/.copilot/mcp-config.json` does not exist
When a Copilot CLI session starts
Then the warning names `copilot`, says no `mempalace` registration exists, and names `scripts/setup-copilot-interactive.sh`
And it does not name `task mempalace:switch-http`, which would refuse this machine

**Scenario:** A registration aimed at the wrong port is announced

Given the installed launcher records `MCP_HOST=127.0.0.1` and `MCP_PORT=41893`, while the session's environment sets `MEMPALACE_MCP_PORT=41000`
And Copilot CLI's `~/.copilot/mcp-config.json` registers `mempalace` at `http://127.0.0.1:41000/mcp`
When a Copilot CLI session starts
Then the warning names `copilot`, the class `wrong-endpoint`, and `task mempalace:switch-http`
And the expected endpoint it reports is `http://127.0.0.1:41893/mcp`, not the environment's port
And `task mempalace:status` reports Copilot's registration on a wrong-endpoint line naming both endpoints

**Scenario:** No daemon installed means no alarm (issue acceptance 3)

Given no daemon installed by this framework's setup exists on the machine
And Claude Code has no `mempalace` entry
When a Claude Code session starts
Then the check emits nothing and sends no request at all

**Scenario:** A stale process answering only liveness is not "serving"

Given a process on the daemon's port answers `/healthz` with 200 but never answers the MCP endpoint
And Antigravity CLI is registered `stdio`
When the first model invocation of a new Antigravity conversation fires
Then the check classifies the daemon as not serving
And emits nothing, because a stdio registration with no serving daemon is setup's intended fallback

**Scenario:** A hung endpoint never blocks the session

Given a process on the daemon's port accepts the connection and never responds
And Claude Code is registered over HTTP
When a Claude Code session starts
Then the check ends with a success status within 2 seconds
And emits one warning naming `task mempalace:status`

**Scenario:** The token never leaks (issue acceptance 4)

Given a sentinel token is planted in the daemon token file and in every fixture registration's header
When the check runs once for each class of requirement 3 on each of the four CLIs
Then the sentinel appears in no output channel, no argument of any started process, and no file the check writes

**Scenario:** Antigravity checks once per conversation when the payload identifies it

Given the DEV probe has shown that `PreInvocation` carries a conversation identifier
And the daemon is serving and Antigravity CLI has no `mempalace` entry
When one Antigravity conversation runs four model invocations
Then the warning appears at the first invocation only
And the daemon receives exactly one probe request

**Scenario:** Antigravity falls back to a time window when the payload does not identify the conversation

Given a `PreInvocation` payload carrying only `invocationNum` and `initialNumSteps`
And the daemon is serving and Antigravity CLI has no `mempalace` entry
When two conversations run eight model invocations within 30 minutes
Then the warning appears once, at the first invocation
And the daemon receives exactly one probe request
And each suppressed invocation ends within 150 ms

**Scenario:** A too-slow guarded path turns Antigravity into an evidenced gap

Given the DEV measurement puts the suppressed path's 95th percentile above 150 ms
When the implementation PR is prepared
Then no setup run registers `crewrig-mempalace-session-check` in `~/.gemini/config/hooks.json`, and a later run removes any entry registered earlier
And `docs/cli-matrix.md` lists Antigravity CLI under *Parity gaps* with the measurement as evidence, covered by requirement 13 alone

**Scenario:** An opt-in re-run keeps the check

Given setup has registered the check for Copilot CLI
When `scripts/setup-copilot-interactive.sh` is re-run and the operator declines session recording and removes usage capture
Then exactly one check entry remains in Copilot's user-level hook configuration

**Scenario:** An agent without memory tools says so (issue acceptance 5)

Given a session whose tool surface carries no `mempalace_*` tool, directly or as a deferred tool
When the agent starts its session-start sweep
Then its first message to the user states that shared memory is unavailable, that no handoff, checkpoint, or final flush will happen, and points at `task mempalace:status`
And it continues with the task unless the user says otherwise

**Scenario:** Deferred memory tools are not mistaken for absent ones

Given a Claude Code session whose `mempalace_*` tools are listed as deferred
When the agent starts its session-start sweep
Then it loads them through the deferred-tool search and runs the sweep
And it does not report memory as unavailable

**Scenario:** The clobber hypothesis gets a recorded verdict (issue acceptance 6)

Given the DEV stage has run the experiment of requirement 17
When the implementation PR is opened
Then issue #1410 carries a comment with the Claude Code version, platform, steps, number of trials, outcome, and one verdict
And a `confirmed` or `inconclusive` verdict links a separate issue

## Out of scope

- Fixing again the setup bugs that probably caused the 2026-09-27 loss
  (#1210, #1243, #1247 / #1255); all are closed.
- Automatic repair: the check reports and names the repair command, and it
  never rewrites an assistant configuration itself.
- Fixing the stale-clobber behaviour if requirement 17 confirms it. That fix
  belongs to the separate issue the requirement opens.
- A registration whose endpoint is right but whose bearer is stale (for
  example after a token rotation): its tools exist and every call fails
  loudly with an authentication error, so it is not silent. Requirement 13's
  "first call fails" branch covers the agent side.
- Changing the exit-code semantics of `task mempalace:status` beyond the
  distinct wrong-endpoint line of requirement 4.
- Registrations at a scope other than user level, such as a Claude Code
  project-level or local-level `mempalace` entry. The check reads the
  user-level file that setup writes, so a user-level gap hidden by a
  project-level entry may raise a warning that the session does not need.
- Losing a registration during a session that is already running. The check
  runs at session start only (once per conversation or per 30-minute window
  on Antigravity CLI, requirement 8).
- Changing the machine-wide all-or-nothing pre-flight of
  `task mempalace:switch-http`. The limitation it causes for a single-CLI
  warning is accepted and documented in the runbook (requirement 15).
- Other MCP servers, such as `sequentialthinking`.
- Supporting the daemon on platforms without a supervisor this framework
  installs (Windows). The check stays silent there (requirement 6).

## Open questions

- **OQ1 — Warn when the daemon is installed but not serving?** Requirements 5
  and 6 currently warn (pointing at `task mempalace:status`) when the daemon
  is installed, not serving, and the CLI is not on its stdio fallback.
  Without that warning the session shows the same silent symptom, with no
  memory tools. Recommendation: keep it. It costs nothing extra (the probe
  already ran), and requirement 6 keeps the stdio fallback silent.
- **OQ2 — Should an agent without memory continue or stop?** Requirement 13
  says signal, then continue unless the user objects. The system-context
  store rule says STOP, because that content is needed to act correctly.
  Memory is valuable but not a hard prerequisite for most tasks.
  Recommendation: signal and continue, as drafted.
- **OQ3 — Install with no question and no opt-out?** Requirement 11
  registers the check on every setup run without asking. It is silent when
  everything is correct, and it costs one local request per session.
  Recommendation: no question and no setup-level opt-out. The runbook
  documents removal by hand-editing the hook file, and the next setup run
  puts the entry back.
- **OQ4 — Antigravity coverage (revised after review finding s1-F2;
  needs the owner to confirm again).** The owner approved an earlier
  wording, which keyed a once-per-conversation guard on a conversation
  identifier assumed to be in the `PreInvocation` payload. The recorded
  evidence does not show one there: spec 0116 delta-03 lists only
  `invocationNum` and `initialNumSteps`, and row 8 shows `conversationId`
  on `Stop` only. Requirement 8 now does the following:
  - registers a new named hook, `crewrig-mempalace-session-check`, on
    `PreInvocation`, with requirement 8 as its normative base. Spec 0116
    delta-03 replacement R3 scopes the `PreInvocation` prohibition to
    `crewrig-mempalace-transcript` alone and allows other named hooks;
  - keys the throttle on a conversation identifier only if a DEV live
    probe shows one in the `PreInvocation` payload, and otherwise on a
    30-minute window per user;
  - bounds the suppressed path to 150 ms of wall-clock time (95th
    percentile, runtime start included), because the hook runs
    synchronously about four times per turn. DEV measures it;
  - drops the hook and records an evidenced gap (requirement 13 alone) if
    the bound is exceeded or the event has no channel to the user or the
    model.

  `agy` is not installed on the authoring machine and its `hooks.md` was
  not available, so the payload, the output channel, and the cost all
  depend on DEV evidence. Under the time-window fallback, a second
  conversation opened inside the window is not warned by the hook; its
  agent still signals through requirement 13. A resumed conversation
  (`--continue`) keeps its identifier, so under the identifier key it is
  not checked again. Both are accepted. Recommendation: confirm requirement
  8 as revised.
- [GROUNDING:] `mcp_assistant_arrangement` in `scripts/lib/common.sh`
  classifies any entry carrying `url` or `serverUrl` as `http` without
  comparing the endpoint, so no reader on `main` can tell `wrong-endpoint`
  apart today. Requirements 3 and 4 need it. Back-fill responsibility: this
  ticket's implementation PR adds the endpoint comparison to the shared
  reader (or to the shared definition that replaces it) and to
  `task mempalace:status`. That PR also switches status's expected endpoint
  from `mcp_daemon_url` (environment variables and defaults) to the
  installed launcher (requirement 4). It also corrects the
  `scripts/lib/common.sh` comment near `ensure_mempalace_http` that
  attributes the `/healthz` reasoning to spec 0139 delta-01
  (requirement 2).
- [GROUNDING:] The same reader returns `absent` ("CLI not installed") for a
  missing Gemini, Copilot, or Antigravity configuration file, and also for
  Claude Code when `claude` is not on `PATH`. A hook's `PATH` can differ from
  the operator's shell. Requirement 3 deliberately classifies both cases as a
  missing registration inside a running session. Back-fill responsibility:
  this ticket's implementation PR. Requirement 4's agreement is stated for
  existing files only, so `task mempalace:status` keeps its machine-wide
  "CLI not installed" meaning.
