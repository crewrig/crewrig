---
id: "0029"
slug: chroma-daemon-fd-limits
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 300
version: 1.0.0
---

# Chroma daemon file-descriptor limits

## Intent

An agent relying on MemPalace never sees the shared memory service become
unavailable because the underlying daemon ran out of open-file descriptors.
The daemon stays healthy across long uptimes and heavy multi-session use on
every supported host operating system, so memory calls no longer fail after
a few days with a spurious "No palace found".

## Requirements

1. The shared memory daemon SHALL run with an open-file-descriptor soft
   limit of at least 65536 on every supported host operating system.
2. The daemon's open-file-descriptor hard limit SHALL be at least equal to
   its soft limit, so the soft limit is enforceable rather than capped below
   the intended value.
3. The raised file-descriptor limit SHALL be declared in every daemon
   supervisor configuration shipped in the repository, so a fresh install
   inherits it without manual tuning.
4. The daemon SHALL NOT accumulate open socket descriptors without bound
   across concurrent and successive agent sessions; connections belonging to
   ended sessions SHALL NOT remain open indefinitely.
5. A wrapper process orphaned by a terminated agent session SHALL NOT keep
   its daemon connection alive after the session has ended.
6. The repository documentation SHALL state how an already-running daemon is
   brought up to the raised limit, so an existing install is remediated
   without waiting for a host restart.

## Scenarios

**Scenario:** Fresh macOS install starts the daemon with the raised limit

Given a fresh install on a macOS host
When the launchd-supervised memory daemon starts
Then its open-file soft and hard limits are each at least 65536

**Scenario:** Fresh Linux install starts the daemon with the raised limit

Given a fresh install on a Linux host
When the systemd-supervised memory daemon starts
Then its effective open-file limit is at least 65536

**Scenario:** Sustained multi-session use no longer exhausts descriptors

Given the memory daemon has served many concurrent and successive agent
sessions over several days of uptime
When an agent issues a MemPalace memory call
Then the daemon responds successfully
And the daemon never reports "No palace found" caused by file-descriptor
exhaustion

**Scenario:** An orphaned session does not leak a connection

Given an agent session terminates abruptly and leaves a wrapper process
behind
When that session is no longer active
Then the daemon does not retain the orphaned session's socket connection
indefinitely

## Out of scope

- Migrating the on-disk index format or upgrading the ChromaDB version.
- The drift-segment rebuild maintenance (the recurring `.drift-*` segment
  directories) — a separate reliability concern not caused by descriptor
  exhaustion.
- Changing the daemon's bind host, port, or transport.
- Raising descriptor limits for MemPalace processes other than the shared
  daemon and its connection wrappers.
- Automatically reaping orphaned wrapper processes on a schedule; this spec
  requires only that an orphaned session not hold a daemon connection open,
  not that a janitor process exist.

## Open questions

- [GROUNDING:] No file-descriptor limit exists today in either shipped
  supervisor configuration (`config/launchd/com.mempalace.chroma-server.plist`,
  `config/systemd/mempalace-chroma-server.service`); R1–R3 introduce it.
  Back-fill responsibility is resolved: the implementation PR for this spec
  adds the limit to both supervisor files in the same diff and documents the
  live-reload step in `docs/runbooks/chroma-http-server.md`. No residual
  question.
