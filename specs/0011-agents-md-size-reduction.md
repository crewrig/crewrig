---
id: "0011"
slug: agents-md-size-reduction
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 219
version: 1.0.0
---

# Reduce AGENTS.md Below Claude Code's 40 KB Context Limit

## Intent

`AGENTS.md` is brought below Claude Code's recommended 40 KB context-file limit
by extracting its two largest sections into dedicated reference files under
`docs/`. Each extracted section is replaced in `AGENTS.md` by a concise stub
that preserves the section heading, a compact set of immediately actionable
rules, and a link to the full document. No rule content is altered.

## Requirements

1. `docs/agent-team-protocol.md` SHALL be created containing the verbatim
   content of `AGENTS.md`'s `## Agent Team Protocol` section.
2. `docs/cli-matrix-maintenance.md` SHALL be created containing the verbatim
   content of `AGENTS.md`'s `## CLI Matrix Maintenance` section.
3. `AGENTS.md` SHALL replace `## Agent Team Protocol` with a stub that retains
   the section heading, critical immediately-actionable rules, and a link to
   `docs/agent-team-protocol.md`.
4. `AGENTS.md` SHALL replace `## CLI Matrix Maintenance` with a stub that
   retains the section heading and a link to `docs/cli-matrix-maintenance.md`.
5. `AGENTS.md` file size SHALL be strictly less than 35,840 bytes after the
   extraction, as measured by `wc -c AGENTS.md`.
6. A CI check script SHALL be added that measures `wc -c AGENTS.md` and exits
   non-zero when the value equals or exceeds 35,840.
7. The CI check script SHALL be integrated into the existing CI pipeline so
   that a pull-request violating the threshold cannot be merged.
8. The content of every extracted section SHALL be reproduced verbatim — no
   paraphrasing, no omissions, no additions.
9. `CLAUDE.md` and `GEMINI.md` SHALL NOT be modified.
10. Sections other than `## Agent Team Protocol` and `## CLI Matrix Maintenance`
    SHALL NOT be extracted in this ticket.

## Scenarios

**Scenario 1:** Successful extraction (happy path)

Given `AGENTS.md` contains `## Agent Team Protocol` and `## CLI Matrix
Maintenance` with a total file size of 53,965 bytes
When the developer applies the extraction and stub replacement
Then `wc -c AGENTS.md` returns a value strictly less than 35,840
And `docs/agent-team-protocol.md` exists and contains the verbatim Agent
Team Protocol section
And `docs/cli-matrix-maintenance.md` exists and contains the verbatim CLI
Matrix Maintenance section

**Scenario 2:** CI blocks an oversized AGENTS.md (failure path)

Given the CI check script is wired into the pipeline
When a pull-request is opened where `wc -c AGENTS.md` equals or exceeds 35,840
Then the CI check job exits non-zero
And the pull-request cannot be merged until the threshold is satisfied

**Scenario 3:** Content integrity preserved

Given the extraction has been applied
When any rule originally in `## Agent Team Protocol` or `## CLI Matrix
Maintenance` is looked up
Then the rule is found verbatim in the corresponding `docs/` file, unchanged
in wording and structure

## Out of scope

- Modifying the wording, structure, or semantics of any extracted rule.
- Updating `CLAUDE.md`, `GEMINI.md`, or any other entry-point file.
- Extracting sections other than `## Agent Team Protocol` and
  `## CLI Matrix Maintenance` (e.g. Interaction modes, Retroactive review loop).
- Defining the exact content of the stubs beyond the mandate in R3 and R4
  (a plan-stage concern).
- Back-filling cross-tool parity for the new `docs/` files beyond what already
  exists for sibling docs.

## Open questions

(none)
