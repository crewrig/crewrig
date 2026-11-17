# ADR-0027: Isolate per-client configuration spheres

<!-- crewrig-doc: section=architecture-adr nav_order=270 published=true title="ADR 0027 — Isolate per-client configuration spheres" -->

## Status

Proposed

RFC for issue #2060. No implementation in this ADR; each row of *Derived sub-specs* is its own issue. It realises *Alternative D — one palace per sphere* of [ADR-0016](0016-shared-mempalace-mcp-http-server.md), which that ADR judged "orthogonal and worth its own ADR" (`0016-shared-mempalace-mcp-http-server.md:289-298`). It relates to issue #1367 without deciding it (see *Relation to issue #1367*). Revised after the owner's review of the first draft; the owner's rulings and what each replaced are listed under *Decided inputs*.

## Context

Setup makes one whole-machine choice per layer: one team, one expertise and one level file per CLI home, each with a `.selected_<kind>` marker (`scripts/lib/setup/steps-rules-pick.ts:34-51`), and skills, agents and MCP servers are user-scoped. A consultant who works for several clients in parallel therefore gets, in every session, the union of all clients' tools and MCP credentials, and one MemPalace palace mixes client, employer and personal wings. ADR-0016 named that defect and deferred it. A Claude-Code-only prototype in daily use proves the mechanism: an isolated configuration home plus a launcher that guards the working directory, the account and the environment (issue #2060, *Prior art*). The three other CLIs must reach the same result or record a gap.

## Framing

- **Goal.** A session launched for one client (`client-a`) sees only that client's configuration (organization context, team, expertise, skills, agents, MCP servers, account, memory) on Claude Code, Gemini CLI, Copilot CLI and Antigravity CLI, and nothing is ever written into a client repository.
- **Constraints.** Multi-CLI parity, no silent asymmetry (`docs/cli-matrix-maintenance.md:45-63`). The guarantees of ADR-0016 hold per palace: one writer-lease holder, the two tiers compose, fail loud, transcript persistence does not regress (`0016-…md:15-17`, `:209-225`). No MemPalace source modification (`0016-…md:17`). No secret on disk in plain text, in an argument list or in a shared file. An adopter who never creates a sphere sees no behaviour change. A CLI's own state in a home (sessions, history, credentials) is never wiped.
- **Non-goals.** Inheritance or composition between spheres; a per-repository override (issue #1367); containing a malicious MCP server (the trust gate is informed consent, not a sandbox); isolating, refusing or redirecting a session that was not started through the launcher; migrating existing drawers out of the default palace.

## Decided inputs

Taken by the owner before this ADR; recorded, not reopened.

1. One sphere per client; no inheritance between spheres in V1.
2. The shared manifest is in V1: `sphere.yaml` (committed in a team repository: no secret, no absolute path, no personal identity) plus `sphere.local.yaml` (personal overlay: client root, expected accounts, references to the OS secret store).
3. Strict memory isolation: one MemPalace palace per sphere.
4. Nothing is written into a client repository. Selection is explicit (`crewrig run <sphere> <cli>`) or by working-directory prefix against the sphere root (`crewrig run auto <cli>`); an agent manager with a configurable launch command calls the launcher directly.
5. The term is "sphere": it collides with none of `PROFILE.md`, the worker settings profile (`docs/worker-profile.md`) or the capability profiles.

### Rulings on the first draft

Taken by the owner on the first draft of this ADR. Each replaces a position of that draft, which is kept here as the rejected alternative.

| # | Ruling | What the draft said | Rejected alternative |
|---|---|---|---|
| R1 | The account check never blocks a launch. Unconfigured (nobody logged in yet in the sphere home, or no expected account declared): an informational line. Mismatch (a logged-in account that differs from the declared one): a warning that shows the logged-in and the expected account and how to switch, as the prototype does. | Unconfigured launched with a notice, in one clause of a step worded as fail-closed; a mismatch refused the launch with its own exit status. | Refusing on an unconfigured account: the first launch is the only way to reach the CLI's own login. Refusing on a mismatch: it makes the wrong account impossible rather than visible, but it blocks legitimate work whenever the declaration is stale, the account probe is wrong or the user is switching accounts on purpose, and its only remedy is to edit the overlay. |
| R2 | The per-sphere ChromaDB and MCP daemon pair is started on demand by the launcher and stopped when idle. | An always-on pair supervised per OS; on-demand daemons were rejected for the risk to transcript persistence, and the resident cost was an open question. | The always-on supervised pair: every inactive client would keep two resident processes. |
| R3 | A CLI started bare inside a sphere root is never refused. At most it receives a non-blocking notice, where the CLI offers a suitable hook; a CLI without one is an accepted gap. | Opt-in shell functions routing the bare CLI names through `crewrig run auto`. | Refusing the session, and shadowing the CLI names in the shell: both change what the bare command does. |
| R4 | The ADR keeps only the open questions that change the architecture; the others belong to the sub-spec that owns them. | Twelve open questions in the ADR. | Leaving implementation questions open at ADR level, where no spec answers them. |

## What the code says today

Every later section rests on these readings. Upstream MemPalace lines are from version 3.6.0, the floor of the pin (`scripts/lib/mempalace-pin.json`), read in an installed copy.

| # | Finding | Source |
|---|---|---|
| F1 | A descriptor's `homes.*` are data relative to `ctx.home`, but several step bodies still hard-code the dot-directory under `ctx.home`. | `scripts/lib/setup/descriptor.ts:7-9`, `:78-86`; `tier-install.ts:64`, `:107`; `mcp-gemini-step.ts:24`; `hooks-rewrite.ts:262-267`; `steps-agy.ts:190`, `:240`; `antigravity-hooks.ts:42-49` |
| F2 | `ctx.home` is one root for three kinds of state: the CLI configuration, the shared machine state (`.crewrig/system-context`, `.crewrig/claude-profiles`, `.crewrig/validation.conf`, the TLS environment file) and the supervisor units and MemPalace home of the daemons. | `cli-claude.ts:79-81`, `:94-101`; `validation-backend.ts:161`; `tls-offer.ts:97`; `chroma-install.ts:140-145`; `scripts/lib/service/daemon-install.ts:92-96`; `chroma-unit.ts:86` |
| F3 | Claude's user-scope MCP file is read at `<ctx.home>/.claude.json`, while under `CLAUDE_CONFIG_DIR` it lives at `<config dir>/.claude.json` (prototype, issue #2060). Registration itself goes through a `claude mcp add` child, which follows the environment. | `mcp-claude-step.ts:75`, `:89`, `:121`; `mcp-claude-flow.ts:82`, `:164` |
| F4 | The flow is an interactive install, not a sync: `rules-existing` asks keep (skip every rule) or refresh (delete them); the catalogue picks read `config/teams`, `config/expertise`, `config/level` of the CrewRig checkout; a tier installs every built skill it holds. Pre-answers exist (`--answer`) for a closed inventory of questions. | `steps-rules.ts:94-112`; `steps-rules-pick.ts:38`, `:47`; `tier-install.ts:76-79`; `answers.ts:1-5`; `prompt-ids.ts:56-78` |
| F5 | A placement replaces whatever sits at the destination and has a link mode. Nothing records which files setup owns. | `files.ts:5`, `:36-38`, `:47-49` |
| F6 | The MCP daemon is parametrised by environment (palace path, port, label, unit). The ChromaDB daemon's service names are fixed, it serves one palace directory, its port defaults to 8001, and unit templates are looked up by label or unit name. | `service/daemon-install.ts:79-81`, `:93`, `:96`; `service/names.ts:41-50`; `service/chroma-state.ts:50-58`; `service/chroma-launch.ts:195`; `setup/ensure-http.ts:22-23` |
| F7 | MemPalace keeps process-global state under `~/.mempalace/` whatever the palace path: the write-ahead log, tunnels, hallways, entity registries, locks and the server token. The knowledge graph moves into the palace only when the `--palace` flag is given, and the framework launcher selects the palace through the environment, so today it stays global. | upstream `wal.py:23`, `palace_graph.py:352`, `hallways.py:83`, `entity_registry.py:299`, `miner.py:701`, `palace.py:745`, `cli.py:1382-1392`, `knowledge_graph.py:49`, `mcp_server.py:325`, `:708-711`; `scripts/lib/service/launcher/mcp-daemon-launcher.ts:104` |
| F8 | Memory clients route by environment: the hook endpoint reads `MEMPALACE_MCP_HOST` and `MEMPALACE_MCP_PORT`; the token comes from `MEMPALACE_DAEMON_TOKEN_FILE` or a palace-keyed path under the session's home. | `scripts/lib/usage-store/mcp.js:89-94`, `:101-133`; `scripts/lib/mempalace-transcript/daemon.ts:86`; `mempalace-transcript/token.ts:60-64` |
| F9 | A friction is one `mempalace_add_drawer(wing="harness-friction", …)`; its fallback files an issue on the offender's forge. The curator reads that wing, sweeps `transcripts` with `--deep` and can run on a schedule. | `artifacts/library/skills/harness-report/SKILL.md:75`; `…/harness-report/references/operating-mode.md:11`, `:21-29`; `artifacts/library/skills/harness-curator/SKILL.md:3` |
| F10 | A neutral MCP declaration with four native translations already exists: `mcp-servers.org.json`, `orgMcpToNative`, two reserved names, `${VAR}` references "the CLI resolves at runtime". | `scripts/lib/org-mcp.ts:19`, `:65`; `docs/org-mcp-declaration.md:165-166` |
| F11 | Home overrides: Claude Code verified by the prototype, and a fresh configuration directory is not logged in; `COPILOT_HOME` probed (instructions, hooks and user agents swapped by one variable); `GEMINI_CLI_HOME` documented upstream, not probed in this repository; Antigravity CLI unknown, its files live under `.gemini/antigravity-cli` and `.gemini/config`. | issue #2060; `specs/0290-skill-eval-runner.delta-03.md:13`; `docs/cli-matrix/rows/7b.md:28`; `cli-antigravity.ts:14`; `steps-agy.ts:240` |
| F12 | No `crewrig` executable exists (`package.json` declares no `bin`); programs installed under `~/.crewrig/` do (the daemon launcher, the trust wrapper). | `scripts/lib/mempalace-registration.ts:67-75`; `scripts/lib/setup/trust-wrapper.ts:27` |
| F13 | The pinned MemPalace server has its own idle watchdog: it exits when it has handled no JSON-RPC request for `MEMPALACE_MCP_IDLE_HOURS` (fractional hours, 0 disables); `/healthz` is answered outside that path. The framework launcher sets the variable to 0 when it is unset, and ADR-0016's daemon is supervised with keep-alive, which restarts an idle exit at once. | upstream `mcp_server.py:696-705`, `:4709-4718`, `:5073-5100`, `:5305`; `scripts/lib/service/launcher/mcp-daemon-launcher.ts:111`; `0016-…md:229-237` |
| F14 | A session-start hook already ships on the four CLIs with known output channels: user-visible and model on Claude Code and Gemini CLI; model only on Copilot CLI (no user channel, an evidenced gap) and on Antigravity CLI (`PreInvocation`, user channel unconfirmed). A prompt-submission event exists on three CLIs and has no counterpart on Antigravity CLI. | `scripts/lib/mempalace-registration.ts:33-64`; `docs/cli-matrix/rows/8e.md`; `docs/extension-hook-events.md:23` |

## Options

### D1. Sphere model and on-disk layout

```text
Option A: one directory per CLI (claude/, home/.gemini/, copilot/), as sketched in the issue
  Trade-off: reads naturally, but every hard-coded join of F1 must become data before a
  single file can be rendered, on all four CLIs at once.
Option B: one redirected home per sphere (home/.claude, home/.gemini, home/.copilot); the
  launcher derives each CLI's override variable from it
  Trade-off: the joins of F1 stay valid as written; one exception remains, Claude's MCP file (F3).
Option C: redirect HOME itself for the CLI process
  Trade-off: uniform, Antigravity included, but git, SSH, the forge CLIs and every toolchain
  the session runs lose the user's real home. Not probed; rejected on that reasoning.
Recommendation: B, because it reuses the step bodies with one resolver instead of six rewrites.
```

Ownership of files inside a home (numbered, to keep these options distinct from the layout options A to C above):

```text
Option 1: a ledger of what render placed (path, hash, origin); render touches nothing else
  Trade-off: a dropped skill or MCP server really disappears; costs a state file to keep honest.
Option 2: stateless re-run, as setup does today (F5)
  Trade-off: nothing to maintain, but a skill removed from the allowlist stays installed for
  ever, which defeats the purpose of an allowlist.
Option 3: wipe a rendered subtree and re-create it
  Trade-off: simple, but the CLIs keep their own state in the same directories.
Recommendation: 1.
```

### D2. Render and sync engine

```text
Option A: call runSetup() as it is with home = the sphere home and pre-answers from the manifest
  Trade-off: no new code path, but F2 sends supervisor units, the store, validation.conf and
  the TLS file into the sphere home, and F4 makes the run neither idempotent nor filtered.
Option B: a second, non-interactive flow over the same descriptors and step helpers, with the
  context split into the sphere home (written) and the machine home (read only)
  Trade-off: one new step list to maintain; per-CLI knowledge stays in one place.
Option C: a separate template renderer
  Trade-off: free of setup's history, but it duplicates the four CLIs' deploy rules and drifts.
Recommendation: B.
```

### D3. Launcher

```text
Option A: shell functions generated into the rc file (the prototype)
  Trade-off: no process overhead, but unusable from an agent manager that executes a command
  without a login shell, and the logic exists once per shell dialect.
Option B: one installed executable, ~/.crewrig/bin/crewrig, a TypeScript entry with POSIX and
  cmd shims; the managed shell block only adds the directory to PATH and optional aliases
  Trade-off: callable from anywhere; costs a Node.js start per launch (unmeasured) and an
  installed copy that can go stale against the checkout.
Option C: a task (task sphere:run)
  Trade-off: nothing to install, but it needs the CrewRig checkout as working directory, which
  defeats working-directory selection.
Recommendation: B, following the installed programs of F12.
```

Environment scrub: an allowlist of variables, as the skill-eval runner uses for its children (`docs/skill-evals.md:35`), is too narrow for an interactive development session whose toolchains need arbitrary variables; a denylist of known provider and credential variables is recommended, with its limit stated (an unknown provider variable passes).

Account check: block or inform. Refusing a launch on a mismatch makes a session on the wrong account impossible, which is the strict reading of what a sphere is for (such a session bills and routes a client's work through another organisation); it costs a hard stop each time the declaration is stale, the probe misreads the account or the user switches on purpose. Informing leaves the decision to the user at the cost of relying on a line being read. The first draft proposed the refusal for a mismatch; the owner ruled that the check never blocks (R1): an informational line when unconfigured, a warning on a mismatch.

Bare CLI inside a sphere root: refuse the session (ruled out, R3); shadow the CLI names with shell functions that call `crewrig run auto` (the draft's opt-in, ruled out with it: no shell trickery); or notify through a session-start hook of the default home on the channels of F14 (decided), accepting a gap where a CLI has no user-visible channel.

Secret delivery: inject the sphere's secrets into the CLI's environment (uniform on four CLIs through the `${VAR}` convention of F10, but any process of the session can read them), or wrap each stdio MCP server in a shim that hands it only its own secrets (least privilege, but it rewrites every command line and does not cover HTTP headers). The first is recommended for V1; the second is recorded as a hardening follow-up for the security review.

### D4. Palace and daemon topology

```text
Option A: one daemon pair (ChromaDB + MCP) per sphere, both started with HOME pointing into
  the sphere, own ports, own token
  Trade-off: isolation by process and by file system, and F7's global state lands inside the
  sphere; costs two processes and two loopback ports per sphere while the pair runs.
Option B: one MCP daemon serving several palaces with strict routing
  Trade-off: one process, but the pinned server binds its palace and F7's state per process,
  so routing needs an upstream change (forbidden) or a proxy in front of N servers, and the
  write-ahead log, tunnels and registries stay shared: not strict.
Option C: one palace, one wing per sphere, by convention
  Trade-off: free, and exactly the defect ADR-0016 recorded: an unscoped search crosses spheres.
Recommendation: A. It is ADR-0016's topology, instantiated once per palace.
```

Lifecycle of that pair:

```text
Option L1: always on, supervised per OS with keep-alive, as ADR-0016's daemon is
  Trade-off: memory is always there and a crash is restarted at once; every inactive client
  keeps two resident processes and two supervisor units.
Option L2: started on demand by the launcher, stopped when idle, woken again by the hooks of
  the sphere home
  Trade-off: an inactive client costs nothing and no supervisor unit exists; costs a cold start
  on the first launch and after an idle stop, a wake path that must protect the transcript
  hook, and no automatic restart after a crash.
Option L3: started by the launcher and stopped with the last session, no wake path
  Trade-off: simplest, but a transcript hook firing late finds the daemon gone, which breaks
  the persistence floor of ADR-0016.
Decision (owner, R2): L2. The first draft recommended L1.
```

How idleness is measured under L2: by the MCP daemon's own request clock (F13), or by a registry of the CLI processes the launcher started. The registry never stops a pair under a live session, but a session left open for days keeps its pair resident, which is the cost R2 removes, and it does not see a client the launcher did not start. The request clock is kept by the one process every client talks to; it is recommended, with the wake path as its counterpart.

Friction inside a sphere: keep it in the sphere's own `harness-friction` wing with a human-reviewed export as the only bridge (recommended); register a second, global memory server in every sphere (rejected: a model can put client content into the payload, and it reopens a read path to the global palace); or disable friction tagging in spheres (rejected: it silences harness feedback from the consultant's main work).

### D5. Trust model of the shared manifest

```text
Option A: approval on first use and on every change: sync shows the diff of the executable
  surface and applies it only after an explicit confirmation, recorded per machine
  Trade-off: no key infrastructure; relies on the reader actually reading the diff.
Option B: signed manifests checked against an allowed-signers list
  Trade-off: resists a compromised push access; needs key distribution inside a client team.
Option C: trust the team repository like any other checkout
  Trade-off: no friction, and a push to that repository executes code on every colleague's machine.
Recommendation: A for V1; B recorded as a later hardening. C is rejected.
```

## Decision

**D1. Model and layout.** A sphere is a named, self-contained configuration for one client. The default homes (`~/.claude`, `~/.gemini`, `~/.copilot`) remain the implicit default sphere and are not moved. Each sphere lives under one directory:

```text
~/.crewrig/spheres/<name>/
  sphere.local.yaml   personal overlay, mode 0600, never shared
  source/             the approved snapshot of the shared manifest tree (sphere.yaml and the files it references)
  ledger.json         what render owns, the approved executable surface, the inputs it was rendered from
  home/               the redirected home: .claude/  .gemini/  .copilot/
  memory/             the HOME of this sphere's two memory daemons (.mempalace/…)
```

The launcher derives `CLAUDE_CONFIG_DIR=<sphere>/home/.claude`, `GEMINI_CLI_HOME=<sphere>/home` and `COPILOT_HOME=<sphere>/home/.copilot`. Render owns exactly the files and, in merged JSON files, the keys listed in the ledger; everything else in `home/` belongs to the CLI. Render overwrites a file it owns (keeping a backup when the file no longer matches its recorded hash), deletes one only when the ledger lists it and its hash still matches, and never removes a directory it did not create. Two sphere roots may not be equal or nested; `sphere:add` refuses such a root. The issue's per-CLI directory layout is not adopted (layout Option A of D1).

**D2. Render engine.** `task sphere:add -- <name> [--from <git-url|path>]`, `task sphere:sync [-- <name>]`, `task sphere:status` and `task sphere:remove -- <name>` drive a non-interactive flow that reuses the four setup descriptors and the step helpers (placement, MCP translation, settings and hook merges, the Antigravity context concatenation) with a split context: the sphere home is written, the machine home is only read. Machine-scoped steps (dependencies, TLS offer, daemon installation, the system-context store, the worker profiles, the validation backend) do not run; a sphere session reads `~/.crewrig/system-context` and `~/.crewrig/claude-profiles` from the real home, which hold client-neutral core content. Each descriptor's MCP file path becomes data read by the steps (F3). The desired state is a function of four inputs: the CrewRig checkout and its built component trees, the approved `source/` snapshot, `sphere.local.yaml`, and the ledger. A second run with unchanged inputs writes nothing, and a test asserts it. Placement is copy only: a link into `source/` would let a later fetch change executed content without passing the gate of D5. After a CrewRig update the ledger's recorded revision no longer matches; `sphere:status` lists stale spheres, `sphere:sync` with no name re-renders all of them, and the launcher prints one warning line for a stale sphere without blocking or rendering.

Manifest values are resolved as follows. `organization`, `team`, `expertise` and `tools` are a path inside the manifest tree (`./…`) or a catalogue name of the CrewRig checkout. `skills` and `agents` are allowlists of names resolved in the checkout's built trees; an unknown name, or an agent whose skill is missing from `skills`, is a validation error. A manifest cannot ship a skill, an agent, a script or a settings fragment in V1.

**D3. Launcher contract.** `crewrig run <sphere|auto> <cli> [args…]` is one installed program (`~/.crewrig/bin/crewrig`). It performs the steps below in order. Steps 1 (an unknown name), 2, 3 and 6 refuse the launch before any secret reaches a child process; the account check (step 5) and the memory step (step 7) never do.

1. **Selection.** An explicit name, or `auto`: the sphere whose resolved root is a path-segment prefix of the resolved working directory. `auto` outside every root runs the CLI on the default homes and says so on standard error.
2. **Root guard.** With an explicit name, a working directory outside the sphere's root refuses the launch.
3. **Render check.** A sphere not rendered for this CLI, or a CLI whose home override is a recorded gap (D6), refuses the launch; it never falls back to the default home.
4. **Environment.** Unset a denylist of provider and credential variables (a shared list, a per-CLI list, and names a manifest adds; a manifest can only add). Set the CLI's override variable, the memory routing variables of F8 for the sphere's daemon, and `CREWRIG_SPHERE=<name>`.
5. **Account check.** It never blocks a launch (R1). No expected account declared in `sphere.local.yaml` for the CLI's provider: one informational line. An expected account declared and nobody logged in yet in the sphere home: `no account logged in for sphere <name>; run /login with <expected account>` (a fresh Claude Code configuration directory starts logged out, F11; the other CLIs are probes P2 and P5). A logged-in account that differs from the declared one: a warning that shows both accounts and how to switch. A CLI that cannot report its account: one warning, recorded in the matrix.
6. **Secrets.** Each secret name the manifest declares is resolved through its reference in `sphere.local.yaml` to the OS secret store and placed in the child's environment only: never in an argument list, a file or a log. An unresolved secret refuses the launch and names the secret, not its value.
7. **Memory.** Call `ensure` for the sphere's daemon pair (D4). A failure is reported and does not block: the session then signals that memory is unavailable.
8. **Run.** The CLI runs as a child with inherited streams and forwarded signals, and the launcher returns the child's status (a Node.js process cannot replace itself, `mcp-daemon-launcher.ts:127`).

The launcher's own failures use a reserved band. Proposed, to be fixed by the launcher spec: 64 usage, 70 unknown sphere, 71 root guard, 72 not rendered or recorded gap, 73 unresolved secret, 127 CLI binary not found. A child CLI may itself exit with any of these values, so the status alone cannot tell a launcher refusal from the CLI's own result; the launcher spec settles a distinguishing channel (review finding `i1-F1`). The account check has no status: it never ends a launch. Everything above is shared across CLIs; the CLI-specific part is one data row per CLI (`Cli`, `scripts/lib/setup/context.ts:11-12`): binary name, override variable and its value relative to the sphere home, extra variables to unset, the account probe and its parser. The managed shell block is one marked block replaced as a whole; it adds `~/.crewrig/bin` to `PATH` and optional `<cli>-<sphere>` aliases. It holds no secret and no client root, and it never redefines the bare CLI names (R3).

A CLI started bare inside a sphere root runs on the default homes and is never refused, redirected or altered (R3). At most it receives a notice: a session-start hook in the default homes, modelled on the installed MemPalace registration check (F14), compares the working directory with the registered sphere roots and, on a match, emits one line suggesting `crewrig run <sphere> <cli>`. The hook always exits 0, uses no blocking or denying output, stays silent when `CREWRIG_SPHERE` is set or when no sphere exists, and is installed with the launcher, which an adopter without spheres never installs. Its reach per CLI is the row *Bare-session notice* of *CLI parity*; where the CLI offers no user-visible channel the notice reaches the model only, and that is an accepted gap.

**D4. Memory.** Each sphere gets its own palace and its own daemon pair: a ChromaDB daemon and a MemPalace MCP HTTP daemon, launched through the same wrapper as today, on two loopback ports allocated at `sphere:add` and recorded in `sphere.local.yaml`, with their own token. Both run with `HOME` set to `<sphere>/memory`, so the palace, the knowledge graph and all of F7's state resolve inside the sphere. The acceptance test of the memory spec is behavioural: after writes through sphere A's daemon, no byte changes under the real `~/.mempalace` or under sphere B. The default palace and its daemons are unchanged. Within a sphere ADR-0016 holds as written: one lease holder, launch through the wrapper, fail loud with no stdio fallback, and the transcript hook routed to the sphere's daemon by the variables the launcher exports (F8). The sphere's CLI configuration registers the reserved name `mempalace` against the sphere's daemon only, so the session-start sweep (`artifacts/core/rules/60-memory.md:76-104`) runs unchanged and can reach nothing else; a handoff written in one sphere is invisible from every other, by design. Until the memory spec lands, render registers no memory server in a sphere home: the sweep's explicit "memory unavailable" signal (`60-memory.md:81-87`) is the safe intermediate, shared memory is not.

The pair is started on demand and stopped when idle (R2). It is registered with no supervisor: no launchd agent, systemd unit or Task Scheduler task exists per sphere, and after a reboot nothing runs until the first launch.

- **Start.** One idempotent operation, `ensure`, takes a per-sphere lock, starts the ChromaDB daemon and then the MCP daemon when they are not serving, and returns once the authenticated probe accepts, the serving gate setup already uses (`scripts/lib/setup/ensure-http.ts:11`). The launcher calls it before it starts the CLI (D3 step 7).
- **Idleness.** Measured by the MCP daemon's own request clock: its watchdog exits the server when it has handled no JSON-RPC request for the configured window (F13); a liveness poll of `/healthz` does not count. The per-sphere daemon launcher, parent of the MCP child, then stops the ChromaDB daemon and exits. The window is `memory.idle_minutes` in `sphere.local.yaml`, passed as `MEMPALACE_MCP_IDLE_HOURS`; the proposed default is 30 minutes, to be fixed by the memory spec.
- **A session that reconnects after a stop.** The ports and the token file of a sphere do not change across restarts (the token is keyed by the palace path, `scripts/lib/service/launcher/launcher-token.ts:44-64`), so a restarted pair answers at the registration the session already holds. Two hooks rendered into the sphere home call `ensure` before memory is needed: the transcript hook at each lifecycle event, and a prompt-submission hook (the events of F14; on Antigravity CLI, `PreInvocation`). A session resumed after a long pause therefore wakes its pair on its next prompt, before the model's first memory call. Whether each CLI's MCP client re-establishes its connection to a restarted HTTP server without a restart of the CLI is not verified (probe P7); where it does not, the session reports memory unavailable until the CLI is restarted, never falls back to another palace, and the gap is recorded.
- **The transcript floor.** ADR-0016's persistence floor binds this lifecycle. The memory spec measures the pair's cold start against the transcript hook's five-second cap (`0016-…md:412-414`); if a wake does not fit, it specifies a local spool flushed at the next start. Losing a transcript to an idle stop is not an accepted outcome.
- **Crash.** With no supervisor, a crashed pair is restarted by the next `ensure`, not at once.

The default daemon of ADR-0016 keeps its supervised, always-on lifecycle; only the per-sphere pairs depart from it.

Friction tags written in a sphere land in that sphere's `harness-friction` wing and go no further. The only bridge to the global wing is an explicit export in which the user reads, edits and approves each payload. Inside a sphere the forge fallback of `harness-report` (F9) requires the user's confirmation of the exact payload, and the curator is never scheduled against a sphere palace nor run there with `--deep`.

**D5. Trust model.** `sphere.yaml` is validated against a versioned JSON Schema (`schemas/sphere/v1.schema.json`, `schema_version: 1`, unknown keys refused, not ignored). It may declare instruction files, allowlists, MCP servers in the neutral shape of F10 and hooks in the neutral event vocabulary (`docs/extension-hook-events.md`). It is refused when it contains: an absolute path, `~` or a `..` segment leaving the manifest tree; a secret value (a header or an environment entry named in `secrets` must be a `${NAME}` reference); an account, a root or any personal identity; a reserved MCP name (`mempalace`, `sequentialthinking`); a home override, `HOME` or `PATH` in a server's environment; a scrub entry that removes a default. The *executable surface* is the normalised set of MCP servers and hooks after translation. `sphere:sync` fetches the team repository, prints the full diff of the executable surface and a per-file summary of instruction changes against the approved snapshot, and applies nothing until the user confirms; a changed executable surface needs a typed confirmation, and a run without a terminal is refused unless it carries the digest printed by a previous dry run. Approval is per machine and per sphere, stored in the ledger with the source commit; render reads only the approved `source/` snapshot; the launcher never fetches. Changes that come from the user's own CrewRig checkout do not pass this gate. A security review of this flow is a merge condition of its spec.

A V1 sketch, to be fixed by the schema spec. It differs from the issue's example by the version field, the neutral MCP shape of F10 and the explicit path form of a team file:

```yaml
# sphere.yaml — shared, committed in a team repository
schema_version: 1
name: client-a
organization: ./ORGANIZATION.md       # inside the manifest tree
team: ./teams/atlas.md                # or a catalogue name of the CrewRig checkout
expertise: architect
skills: [architect, developer, tester]
agents: [architect, developer, tester]
mcp:
  issue-tracker:
    transport: stdio
    command: issue-tracker-mcp
    env: { ISSUE_TRACKER_TOKEN: "${ISSUE_TRACKER_TOKEN}" }
    secrets: [ISSUE_TRACKER_TOKEN]    # names only
```

```yaml
# sphere.local.yaml — personal, never shared
root: <client-root>
accounts: { anthropic: <expected login> }
secrets:
  ISSUE_TRACKER_TOKEN: { store: os, service: client-a-issue-tracker }
memory: { chroma_port: <allocated>, mcp_port: <allocated> }
```

**D6. Parity.** Every sub-spec lands the four CLIs together or records a gap with the evidence `docs/cli-matrix-maintenance.md:52-63` requires. The probes of *CLI parity* run first. A CLI without a proven home override is refused by the launcher (D3 step 3), never launched on the default home. Windows keeps the render engine; the per-sphere pair needs no Task Scheduler task (D4), and the memory spec verifies that an unsupervised pair behaves there as on POSIX. The Windows secret store adapter and PowerShell profile block are a separate sub-spec; until it lands, a manifest that declares secrets refuses to launch on Windows with a message naming the gap.

**D7. Issue #1367.** Not decided here; see *Relation to issue #1367*.

## Consequences

- Positive: a client session can no longer see another client's skills, agents, MCP servers, credentials or memory, on any CLI whose override is proven; several accounts coexist with no logout.
- Positive: ADR-0016's deferred alternative is realised without weakening it; each palace keeps one lease holder and the fail-loud contract.
- Positive: colleagues on one client share one reviewed manifest; an added MCP server or hook cannot run on a machine before its owner has seen it.
- Positive: additive and reversible for an adopter: no sphere, no change; `sphere:remove` stops two daemons and deletes one directory.
- Positive: an inactive client costs no process and no supervisor unit; resident cost is bounded by the spheres used within the idle window.
- Negative: isolation holds only for sessions started through the launcher. A CLI started bare inside a client root is not refused (R3) and runs on the default sphere and its memory; it gets at most a notice, user-visible on Claude Code and Gemini CLI only. Nothing in this design detects a client repository cloned outside the root.
- Negative: the first launch for a sphere and the first prompt after an idle stop pay the pair's cold start (unmeasured); a crashed pair stays down until the next `ensure`; recovery inside a running session depends on each CLI's MCP client reconnecting (P7); and transcript persistence now rests on a wake path the memory spec must prove by measurement.
- Negative: a session can run on an account other than the one the sphere expects, with a warning as the only barrier (R1); billing or routing a client's work through the wrong organisation is left to the user's attention.
- Negative: injected secrets are readable by every process of the session; the scrub is a denylist and misses a variable it does not know.
- Negative: a second deploy flow beside interactive setup. Both read the same descriptors, which bounds the drift but does not remove it; a new setup step must be classified as machine-scoped or home-scoped.
- Negative: once shared, the manifest schema and the sphere layout are contracts: changing them needs a schema version and a migration.
- Negative: memory no longer follows the person across clients; a lesson learnt in one sphere is not recalled in another.
- Neutral: the first launch of each CLI in a new sphere requires a login, which the launcher never blocks (R1). On macOS the Claude Code credential is keyed by configuration directory (prototype), so a sphere directory is probably not relocatable without a new login (assumption — verify before relying on this).
- Neutral: `crewrig` becomes a public command and `CREWRIG_SPHERE` a public variable; worker and coordinator profiles compose with it, since arguments pass through (`crewrig run client-a claude --settings …`, `docs/worker-profile.md:36-37`).
- Neutral: two daemon lifecycles coexist: the supervised, always-on default daemon of ADR-0016 and the on-demand per-sphere pairs.
- Neutral: a session started through the launcher hands its environment to the subagents and child CLIs it spawns, so they stay in the sphere; an agent manager that starts workers itself must use the launcher as its launch command.

## CLI parity

"Verified" and "probed" cite a source; everything else is an assumption until its probe runs.

| Capability | Claude Code | Gemini CLI | Copilot CLI | Antigravity CLI |
|---|---|---|---|---|
| Home override | `CLAUDE_CONFIG_DIR`: verified (prototype, issue #2060) | `GEMINI_CLI_HOME`, parent of `.gemini`: documented upstream, not probed here | `COPILOT_HOME`: probed (`docs/cli-matrix/rows/7b.md:28`); `COPILOT_CACHE_HOME` is separate | **unknown**: may follow `GEMINI_CLI_HOME`; probe P1 |
| Separate login per home | keychain entry per configuration directory on macOS (prototype); Linux and Windows not verified | not verified | authentication survived a scratch home through the copied `config.json` (row 7b); a distinct account per home not verified | not verified |
| Render target | `.claude/rules`, skills, agents, `.claude.json` (F3) | numbered files plus enrolment in `context.fileName` (row 7b) | `.copilot/instructions`, skills, `mcp-config.json` | `.gemini/antigravity-cli` plus `.gemini/config/` (`AGENTS.md`, `hooks.json`, `mcp_config.json`) |
| MCP `${VAR}` expansion | documented by `docs/org-mcp-declaration.md:165-166` for the channel as a whole; per-CLI behaviour to probe (P3) | same | same | same |
| Account probe | `claude auth status --json` exists (`specs/0290-…delta-03.md:59`); whether it names the account is to verify | to probe | to probe | to probe |
| Bare-session notice (default home, R3) | `SessionStart`: model channel verified live, user channel `systemMessage` documented (row 8e) | `SessionStart`: user channel verified live, model channel documented (row 8e) | `sessionStart`: model channel only; no user-visible channel, the evidenced gap of row 8e. **Accepted gap** | `PreInvocation`, throttled per conversation: model channel documented only, user channel unconfirmed (row 8e). **Accepted gap** |
| Wake hook before a prompt (sphere home, R2) | `UserPromptSubmit` | `BeforeAgent` | `userPromptSubmitted` | no prompt-submission event (`docs/extension-hook-events.md:23`); `PreInvocation` instead |
| MCP client reconnects to a restarted daemon | to probe (P7) | to probe (P7) | to probe (P7) | to probe (P7) |

Probes, all in sub-spec S0: **P1** Antigravity home override; **P2** a live `GEMINI_CLI_HOME` run with its own login; **P3** `${VAR}` expansion in each CLI's MCP configuration; **P4** the command that reports the logged-in account on each CLI; **P5** a distinct Copilot account per `COPILOT_HOME`; **P6** the pinned MemPalace, its ChromaDB server and the detected interpreter under a redirected `HOME`; **P7** whether each CLI's MCP client reaches a daemon restarted on the same port and token without a restart of the CLI. A probe that fails becomes a matrix gap with its reproduction, and the launcher's refusal message names it.

Operating systems: macOS is the prototype's ground. The Linux secret store (Secret Service) and the Windows one (Credential Manager) have no prior art in this repository; both are assumptions until S2 and S6 implement and test them.

## Blast radius

| Component | Change | Contract that shifts |
|---|---|---|
| `scripts/lib/setup/context.ts`, `descriptor.ts`, `mcp-claude-step.ts`, `mcp-claude-flow.ts`, `tier-install.ts` | Split context (sphere home, machine home); MCP file path read from the descriptor; allowlist filter for tiers | Internal contract of the step bodies; interactive setup's output must stay byte-identical (its golden fixtures under `scripts/tests/fixtures/setup-golden/` are the guard) |
| New `scripts/lib/sphere/**` and entries (`sphere-add`, `sphere-sync`, `sphere-status`, `sphere-remove`, the launcher) | Render flow, ledger, validation, launcher, secret-store adapters | New public command `crewrig run`, new variable `CREWRIG_SPHERE`, new exit-code band |
| `schemas/sphere/` | Manifest and overlay schemas with samples | New shared schema, versioned from the first release |
| `taskfiles/sphere.yml`, `Taskfile.yml` | New task group and its include | New `sphere:*` tasks; the Taskfile tree and command checks apply |
| `scripts/lib/service/**` (the daemon launcher, the ChromaDB launch and state modules) | A per-sphere instance: explicit ports, `HOME`, the idle window, the parent stopping ChromaDB, the `ensure` operation and its lock. No supervisor unit, so `names.ts` and the templates under `config/launchd`, `config/systemd` and `config/windows` are untouched | A second, unsupervised lifecycle beside the supervised default daemon of ADR-0016 and ADR-0019 |
| `scripts/doctor-mempalace.ts`, `status-mcp-server.ts`, `taskfiles/mempalace.yml` | Report and operate one sphere's daemons | New `--sphere` selector |
| `hooks/mempalace-transcript.ts`, `scripts/lib/usage-store/mcp.js` | The transcript hook calls `ensure` first when `CREWRIG_SPHERE` is set, with a spool if the cold start does not fit its cap; routing itself is already by environment (F8) | The hook's time budget |
| New hooks: a prompt-submission wake hook rendered into sphere homes; a session-start notice hook installed into the default homes | Hook entries, their installed copies under `~/.crewrig/hooks/`, their registration per CLI | New hook wiring on four CLIs, each with its matrix row and its recorded gaps (F14) |
| `artifacts/library/skills/harness-report`, `harness-curator`; a sphere-only rule fragment | Sphere guard on the forge fallback, the export command, curator exclusion | Skill versions bump; `scripts/build-components.ts` regenerates the built copies in the same commit; a rule under `artifacts/core/rules/` counts against `scripts/check-rules-size.ts` |
| `docs/layers.md` | New user-home deploy targets `~/.crewrig/spheres/` and `~/.crewrig/bin/` | Boundary contract text |
| `.crewrig/core-paths.txt` | No change: every new path sits under an entry already listed (`scripts`, `taskfiles`, `schemas`, `docs`, `hooks`; lines 47-48, 58, 65, 135, 204) | None, unless a sub-spec adds a top-level path |
| `docs/cli-matrix/rows/**`, regenerated `docs/cli-matrix.md` | A new row for the per-sphere home override (46 is the highest id today), edits to the rows on layered context, MemPalace registration and MCP delivery, and any gap | Matrix updated in the same diff as each change |
| `docs/index.json` | Regenerated for this ADR and for the reference page | Publication manifest |

Downstream consumers: adopting organisations (unchanged unless they create a sphere), team repositories that host a `sphere.yaml`, agent managers that set a launch command, and the harness curator. Reversibility: trivial for the machine (remove the sphere), awkward for the shared schema once manifests circulate, hence the version field.

## Alternatives rejected

- **The issue's per-CLI directory layout** (D1 layout A): it forces F1's six hard-coded joins to change before anything renders; a single home needs one resolver.
- **Redirecting `HOME` for the CLI** (D1 layout C): breaks the user's git, SSH, forge and toolchain configuration inside the session.
- **Running interactive setup with a redirected home** (D2 A): writes machine-scoped state into the sphere (F2) and is not idempotent (F4).
- **A separate template renderer** (D2 C): duplicates the per-CLI deploy rules.
- **Shell functions as the launcher** (D3 A) and **a task as the launcher** (D3 C): unusable from an agent manager, or tied to the checkout's working directory.
- **Blocking a launch on an unconfigured account** (no login yet, or no account declared): ruled out by the owner (R1); the first launch is how the user logs in.
- **Refusing a launch on an account mismatch** (the first draft's position): it makes the wrong account impossible instead of visible, but a stale declaration, a misread probe or a deliberate switch then stops legitimate work. Ruled out by the owner (R1): a mismatch warns, as in the prototype.
- **Refusing a bare CLI inside a sphere root**, and **shell functions that shadow the CLI names** (the first draft's opt-in): ruled out by the owner (R3); a notice is the most the default session receives.
- **One multi-palace daemon** (D4 B): not strict with the pinned MemPalace (F7) and needs an upstream change ADR-0016 forbids.
- **Selecting the palace with `--palace` or `MEMPALACE_PALACE_PATH` alone**: the knowledge graph follows the flag, but the write-ahead log, tunnels and registries stay under the shared `~/.mempalace` (F7).
- **Wing-per-sphere in one palace** (D4 C): the defect being fixed.
- **An always-on supervised pair per sphere** (L1, the first draft's recommendation): ruled out by the owner (R2); every inactive client would keep two resident processes.
- **Stopping the pair with the last session and no wake path** (L3): a late transcript hook finds the daemon gone.
- **Measuring idleness with a registry of launcher-started sessions**: a session left open keeps its pair resident, and unregistered clients are invisible.
- **A global friction server registered in every sphere**, and **no friction tagging in spheres**.
- **Trusting the team repository without a gate** (D5 C); **signed manifests** (D5 B) are deferred, not rejected.
- **Links instead of copies** in a sphere home: a fetch would change executed content behind the gate.

## Derived sub-specs

The issue lists five work packages. Its third (parity and matrix rows) cannot be a package of its own, because a matrix row changes in the same diff as the code it describes; it becomes the probes (S0), a per-PR obligation, and the Windows package (S6).

| # | Sub-spec | Tier | Depends on | Content |
|---|---|---|---|---|
| S0 | Parity and isolation probes | small | none | P1 to P7, recorded as matrix evidence and a research note; decides whether Antigravity is rendered or refused |
| S1 | Manifest schema, render engine and ledger | large | S0 | Schemas and validation, split context, the four renders, allowlists, `sphere:add`, `sync`, `status`, `remove` for a locally authored manifest, idempotence tests, matrix rows. No memory registration. Settles: whether a mandatory base set of skills (for instance `harness-report` and `user-validate`) is added to every allowlist; whether a manifest lists extensions and Claude plugins (the local marketplace is already keyed by `CLAUDE_CONFIG_DIR`, `docs/cli-matrix/rows/14.md:5-7`); whether `sphere:remove` deletes the secret-store entries and CLI credentials of the sphere or only lists them |
| S2 | Launcher and bare-session notice | standard | S1 | `crewrig run`, selection, guards, scrub, the account check that informs or warns and never blocks (R1), secret adapters for macOS and Linux, exit codes, installed program and managed shell block, the session-start notice hook of the default homes with its per-CLI gaps (R3), matrix rows. Settles: the command that reports the logged-in account on each CLI (P4) and whether the check needs a short-lived cache; what a Linux host without a Secret Service does (with S6); whether a second, opt-in selection signal, such as a git remote pattern kept in `sphere.local.yaml`, covers a client repository cloned outside the root; how a caller tells a launcher refusal from a child CLI exit that carries the same status, for instance a one-line marker on standard error or a status file (review finding `i1-F1`) |
| S3 | Shared-manifest distribution and trust gate | standard | S1 | `--from <git-url>`, approved snapshot, executable-surface diff, approval record, non-interactive digest; security review as a merge condition. Settles: whether hooks stay in the V1 manifest or are deferred by that review |
| S4 | Per-sphere palace and on-demand daemon pair | large | S1, S2 | Port allocation, redirected `HOME`, the `ensure` operation and its lock, the idle window and the parent stopping ChromaDB, the wake hooks of the sphere homes (transcript and prompt submission), the cold-start measurement against the transcript hook's cap and the spool if it does not fit, the handling of P7 per CLI, registration in the sphere homes, status and doctor per sphere, the isolation test (R2). Required (review finding `i1-F2`): the session-side token readers fall back to the real home's daemon token when `MEMPALACE_DAEMON_TOKEN_FILE` is unset (`scripts/lib/mempalace-transcript/token.ts:60-66`, `scripts/lib/usage-store/mcp.js:132`), so a sphere session would reach the default daemon. S4 makes that variable mandatory in every sphere session, makes the hooks fail loud when `CREWRIG_SPHERE` is set and the token file is not, and adds that case to the isolation test |
| S5 | Friction, sweep and curator inside a sphere | small | S4 | Sphere rule fragment, forge-fallback guard, reviewed export, curator exclusion |
| S6 | Windows secret store and PowerShell profile | standard | S2 | Credential Manager adapter, profile block, or a recorded gap with evidence; shares with S2 the fallback for a host without an OS secret store |
| S7 | Reference page and runbook | small | S1 to S5 | `docs/spheres.md`, `docs/layers.md`, adoption guide |

Order: S0, then S1, then S2 and S3 in parallel, then S4, then S5; S6 any time after S2; S7 last. Two gates protect the intermediate states: before S3 merges, `sphere:add --from <git-url>` is refused; before S4 merges, a sphere session has no memory server at all.

## Relation to issue #1367

Issue #1367 selects a context and a team per repository through a declaration file committed in that repository, applied by the session at the level of its instructions. Spheres select a whole configuration per client root, with nothing in the repository, enforced by the process environment. They overlap on "the right context for where I am" and differ on three axes: granularity (repository against client root), where the declaration lives (in the repository against outside it), and strength (advisory against structural).

This ADR does not close, absorb or re-scope #1367. It is offered as input to an IDEA convergence session on #1367, which should choose between at least three outcomes: spheres subsume it (one sphere per context, plus `crewrig run auto`); the two coexist, the per-repository file serving as a lightweight override inside the default sphere, where committing a file is acceptable; or #1367 is re-scoped so that its file only picks among context and team files already rendered in the active sphere. One constraint binds whatever is chosen: a file inside a repository must never be able to select tools, MCP servers, accounts or memory across a sphere boundary.

## Open questions

Only the questions whose answer changes the architecture stay here (R4). The others are in the scope of the sub-spec that owns them (the "Settles" entries of *Derived sub-specs*). The resident cost of a daemon pair, open in the first draft, is resolved by R2.

1. **Antigravity CLI** (P1): does it honour `GEMINI_CLI_HOME` for both `.gemini/antigravity-cli` and `.gemini/config`? If not, is there another override, or is the gap recorded?
2. **Personal layers in a sphere.** Which of SOUL, level and `PROFILE.md` are rendered into a client sphere, and is the user's own `AGENTS.org.md` (`cli-gemini.ts:82-87`) ever deployed there? Proposed default: SOUL and level yes, profile and org rules only when `sphere.local.yaml` asks for them.
3. **Usage capture.** Usage records carry `projectRoot` (`docs/usage-record-format.md:20`) and are journalled under the shared `~/.crewrig/usage`, then mirrored through the memory endpoint (`scripts/lib/usage-store/mcp.js:1-3`). Is a shared, machine-local journal acceptable for client project paths, and which palace must the mirror target from inside a sphere?
4. **Does the memory stack run under a redirected `HOME`** (P6)? If a component needs the real home, the fallback is a narrower redirection, to be specified with the same isolation test.
