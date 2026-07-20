---
id: "0082"
slug: mempalace-3-6-support
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 566
version: 1.0.0
---

# Support the MemPalace 3.6.x line

## Intent

An adopter whose installed MemPalace is on the current 3.6.x line can complete
CrewRig's interactive setup and register the MemPalace memory server instead of
being turned away, while an adopter on an unsupported line is refused with an
accurate message that tells them how to reach a supported version without
calling the change an "upgrade" when it is a downgrade; and CrewRig's MemPalace
reference material describes the tool surface and knowledge-graph temporal
semantics of the MemPalace version adopters actually run.

## Requirements

1. The interactive setup for each of the four supported CLIs (Claude Code,
   Gemini CLI, GitHub Copilot CLI, Antigravity CLI) SHALL accept an installed
   MemPalace whose version lies within the 3.6.x line (`>=3.6.0,<3.7`) and SHALL
   proceed to register the MemPalace memory server for that install.
2. The interactive setup SHALL reject an installed MemPalace whose version is
   below the supported line (any version below `3.6.0`) and SHALL NOT register
   the memory server for that install.
3. The interactive setup SHALL reject an installed MemPalace whose version is at
   or above the supported ceiling (any version `3.7.0` or higher, including a
   `3.7.x` prerelease).
4. The supported version range SHALL be identical across all four interactive
   setup flows; no setup flow SHALL advertise or enforce a range that differs
   from the others.
5. Every location in the repository that currently states the MemPalace
   supported range as the literal `>=3.3.3,<3.4` — including
   `scripts/prune-transcripts.sh` and `scripts/start-chroma-server.sh` — SHALL
   state the new supported range, and no `>=3.3.3,<3.4` string (nor any range
   string divergent from the four setup flows) SHALL remain anywhere in the
   repository.
6. The message shown when the installed MemPalace is outside the supported
   range SHALL NOT describe the remediation as an "upgrade"; it SHALL use
   neutral wording that stays accurate when the required action is a downgrade,
   and SHALL state how to install a supported version.
7. The MemPalace tool-surface reference
   (`artifacts/core/system-context/mcp-tools-reference.md`) SHALL be refreshed
   to describe the MemPalace 3.6.0 tool surface — listing the tools available as
   of 3.6.0 — and SHALL note the half-open temporal-interval semantics of
   knowledge-graph queries.
8. The version-specific MemPalace facts in the core tools rule
   (`artifacts/core/rules/60-tools.md`) SHALL be refreshed to reflect MemPalace
   3.6.0, including the half-open temporal-interval semantics of knowledge-graph
   queries.
9. The refreshed reference material SHALL NOT wire any tool newly added in
   MemPalace 3.6.0 (the checkpoint, delete-by-source, and knowledge-graph
   supersede tools, the search source-file filter, and the drawer-listing
   since/before filters) into any operational cross-tool protocol procedure;
   such a tool MAY be listed as available but SHALL NOT be prescribed as a
   required or default step.
10. The version bump SHALL be applied symmetrically across all four CLIs, and
    `docs/cli-matrix.md` SHALL be consulted and updated in the same change per
    the CLI-matrix maintenance protocol.
11. The MemPalace launch and detection path — the HTTP wrapper
    (`scripts/lib/mempalace-http-wrapper.py`), the Python-interpreter detection
    (`detect_mempalace_python`), and the version-range check
    (`mempalace_version_in_range`) — SHALL remain functional against a MemPalace
    3.6.0 memory server whose initialization returns immediately with a
    background preflight and which exposes an HTTP transport entry point.

## Scenarios

**Scenario:** Current MemPalace is accepted

Given an adopter has MemPalace 3.6.0 (or any 3.6.x release) installed
When they run the interactive setup for any of the four supported CLIs
Then setup accepts the installed version and proceeds to register the MemPalace
memory server.

**Scenario:** Below-range MemPalace is rejected with a non-misleading message

Given an adopter has MemPalace 3.3.5 (or any 3.3.x / 3.4.x / 3.5.x release)
installed
When they run the interactive setup for any of the four supported CLIs
Then setup rejects the installed version, does not register the memory server,
and prints a message that states how to install a supported 3.6.x version
without describing that action as an "upgrade".

**Scenario:** Above-ceiling prerelease is rejected

Given an adopter has a MemPalace 3.7.x prerelease installed
When they run the interactive setup for any of the four supported CLIs
Then setup rejects the installed version as above the supported line and does
not register the memory server.

**Scenario:** Reference material reflects the running MemPalace

Given the MemPalace tool-surface reference and the core tools rule
When they are read after this change
Then they describe the MemPalace 3.6.0 tool surface (with the tools added in
3.6.0 listed as available) and note the half-open temporal-interval semantics of
knowledge-graph queries, and they prescribe no 3.6.0-added tool as a protocol
step.

## Out of scope

- Wiring or using any tool newly added in MemPalace 3.6.0 (checkpoint,
  delete-by-source, knowledge-graph supersede, the search source-file filter,
  the drawer-listing since/before filters) as an operational protocol step —
  adopting them is a separate follow-up.
- Enabling or requiring the new opt-in MemPalace features: the HTTP transport
  with bearer/TLS/read-only options, daemon write-queuing, the Milvus backend,
  the `authored_at` transcript metadata, and the `hallways` CLI.
- Rewriting git history, and the interim 3.3.x downgrade workaround available to
  adopters blocked before this change ships — it is a local stopgap, not a
  repository change.

## Open questions

- (PLAN) Whether the supported range should be single-sourced from one
  definition consumed by all six affected scripts, or kept per-script and merely
  verified consistent. This is a HOW decision deferred to the PLAN stage; both
  options satisfy requirements 4 and 5.
- (PLAN) The exact neutral wording of the rejection message required by
  requirement 6. Deferred to the PLAN stage; requirement 6 fixes the constraints
  (no "upgrade" label, accurate under downgrade, states how to install a
  supported version) but not the final phrasing.
- (PLAN) Whether the MemPalace 3.6.0 half-open knowledge-graph temporal
  semantics warrants any adjustment to protocol behaviour, or only the
  documentation note mandated by requirements 7 and 8. Deferred to the PLAN
  stage; if behaviour change is required it is additive to this spec's WHAT.
