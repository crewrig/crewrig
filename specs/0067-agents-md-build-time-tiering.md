---
id: "0067"
slug: agents-md-build-time-tiering
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 492
version: 1.0.0
---

# AGENTS.md build-time per-CLI tiering

## Intent

`AGENTS.md` no longer risks silent truncation on any target CLI. Each CLI
receives a context bundle sized to its own byte budget, assembled at build
time from a single annotated source. Content the bundle cannot hold inline is
preserved as a reference file the agent can follow — never dropped. In the
same effort, the framework records, for every target CLI, whether that CLI
sandboxes filesystem reads at runtime, so the sibling user-space ticket knows
whether a retrieval indirection is needed at all.

## Requirements

1. Every section of `AGENTS.md` SHALL carry an inline tier annotation of the
   form `<!-- crewrig-tier: essential -->` or `<!-- crewrig-tier: reference -->`
   placed immediately before the section heading it governs; a section with no
   annotation SHALL default to `essential`.
2. `scripts/build-components.sh` SHALL emit, for each target CLI (Claude Code,
   Gemini CLI, GitHub Copilot CLI, Antigravity CLI), one context bundle whose
   inline body contains every `essential`-tier section verbatim.
3. Each `reference`-tier section SHALL be extracted verbatim into a committed
   file under `docs/`, and its position in every emitted bundle SHALL be
   replaced by a stub that preserves the section heading and a link to the
   extracted file.
4. Content extracted to `docs/` SHALL be byte-for-byte identical to the source
   section — no paraphrasing, omission, or addition.
5. Each emitted bundle SHALL be strictly smaller than its CLI's declared byte
   budget, measured by `wc -c`: Antigravity 24,000 bytes, Claude Code 40,960
   bytes; the budget for every target CLI SHALL be declared in a single place
   in the build configuration.
6. A CI check script SHALL fail the build with a non-zero exit code when any
   emitted bundle equals or exceeds its declared budget, and SHALL be wired
   into the existing CI pipeline so a violating pull request cannot merge.
7. The build SHALL extend — not replace — the Antigravity concatenation
   introduced by spec 0061: the tiered `essential` body feeds the existing
   `~/.gemini/GEMINI.md` assembly point rather than introducing a second
   assembly path.
8. The framework SHALL record, for each of the four target CLIs, an empirically
   determined verdict on whether the CLI sandboxes runtime filesystem reads,
   established by a reproducible probe in which an agent attempts to read a
   `docs/` reference file that is not part of its inline bundle and the outcome
   is observed.
9. The sandbox verdict for each CLI SHALL be committed to the repository in a
   form the sibling ticket #493 can consume without re-running the probe.
10. No emitted bundle SHALL omit any `AGENTS.md` rule content: the worst case
    for any rule SHALL be relocation behind a `docs/` link, never disappearance.

## Scenarios

**Scenario:** Bundle fits every CLI budget

Given `AGENTS.md` annotated with `essential` and `reference` tiers
When `scripts/build-components.sh` runs and the CI check measures each emitted bundle
Then every bundle is strictly smaller than its declared budget and the CI check exits zero

**Scenario:** Reference content is preserved, not dropped

Given a section annotated `<!-- crewrig-tier: reference -->`
When the build emits the per-CLI bundles
Then the section's verbatim content exists in a committed `docs/` file and the bundle carries a stub with the heading and a link to it

**Scenario:** Oversized bundle blocks the merge

Given an edit that pushes the Antigravity bundle to 24,000 bytes or more
When the CI check runs on the pull request
Then the check exits non-zero and the pull request cannot be merged

**Scenario:** Sandbox verdict is established empirically

Given the reproducible filesystem-read probe for a target CLI
When an agent on that CLI attempts to read a `docs/` reference file outside its inline bundle
Then the observed outcome (read succeeded or was denied) is recorded as that CLI's committed sandbox verdict

## Out of scope

- The user-space layered context system (`~/.claude/rules/`, `~/.gemini/`,
  `~/.copilot/instructions/`, `~/.gemini/antigravity-cli/`) — owned by #493.
- Any runtime retrieval layer, MemPalace dependency in the boot path, or
  MCP-served context — deferred to #493 and gated on the sandbox verdict.
- Changing *what* any rule says; only the delivery mechanism and byte size are
  in scope (carried from #489 non-goals).
- Re-tiering or resizing skill/agent sources built by `build-components.sh`;
  this spec governs the `AGENTS.md` context bundle only.

## Open questions

- [USER-PARKED] Does an `essential`-only Antigravity bundle fit under 24,000 bytes, or does
  Antigravity require a third, Antigravity-specific extraction pass beyond the
  shared `essential`/`reference` split? To be measured during DEV against the
  real annotated `AGENTS.md`; if a third pass is needed, its trigger and shape
  are a `class: arch` question for PLAN.
- [USER-PARKED] Canonical storage form for the committed sandbox verdicts (a table in a
  `docs/` reference file vs a machine-readable manifest under `.crewrig/`) —
  constrained by requirement 9's "consumable by #493 without re-running the
  probe"; the concrete shape is deferred to PLAN.
