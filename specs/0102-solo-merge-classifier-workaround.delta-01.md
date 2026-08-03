---
id: "0102"
slug: solo-merge-classifier-workaround
status: draft
complexity: small
related-issue: 636
version: 1.1.0
---

# 0102 — solo-merge-classifier-workaround (delta-01)

This delta relaxes the letter of Requirement 8 of spec 0102 to match its
own rationale. The original R8 required the solo-merge guidance to *"live
inline"* in `AGENTS.md` → *Branching Strategy* and forbade its relocation
*"to a separate file"*. During DEV (issue #636), realizing the full
Requirements 1–11 guidance inline pushed `AGENTS.md` over the hard
22,000-byte ceiling enforced by `scripts/check-agents-size.sh` in CI — a
pre-existing, project-wide constraint that R8 did not account for, because
the SPECS stage does not simulate the byte cost of the eventual prose. The
DEV team resolved this (with the user's explicit mid-implementation
sign-off) by extracting the Requirements 1–11 detail into a dedicated
`docs/solo-merge-classifier-workaround.md`, following the same established
`AGENTS.md`-extraction convention the repository already uses throughout
the file, while keeping the single operationally critical rule
(retry-once, hand a hard block to the user, never delegate to a sibling)
inline in `AGENTS.md` under the Claude-Code-labelled heading R8 already
mandated.

That implementation is in direct tension with R8's literal *"SHALL live
inline … SHALL NOT be relocated to a separate file"* even though it
satisfies R8's actual purpose: the CLI-labelling/recognizability
guarantee, and the *"mirror an established `AGENTS.md` pattern"* instinct
R8 already invoked (the `docs/agent-team-protocol.md` reference). This
delta amends R8 so its letter matches its rationale, extending the
"mirror an established pattern" instinct one level further — from the
labelling convention to the extraction convention introduced by commit
`c5eb2f4` (issue #500), which is the same convention the rest of
`AGENTS.md` already follows.

Grounded state (verified on branch `fix/636-solo-merge-classifier-workaround`):
the post-extraction `AGENTS.md` is 21,870 bytes against the 22,000-byte
`scripts/check-agents-size.sh` threshold; the fully-inline draft exceeded
that budget (DEV-reported at ~23,874 bytes; the intermediate over-budget
state was corrected before commit and is not itself in git history). The
extracted file `docs/solo-merge-classifier-workaround.md` carries the full
Requirements 1–11 detail; `AGENTS.md` → *Branching Strategy* retains a
`### On Claude Code CLI — solo-maintainer self-merge block` section with an
inline pointer to that file and the inline critical rule.

Every other requirement of spec 0102 — Requirements 1–7 and 9–12 — is
**UNCHANGED** and remains in force. In particular, the parent's *Out of
scope* exclusion of a true CLI-conditional loading mechanism, and
Requirements 9 and 12's Claude-Code-only / other-CLIs-unverified framing,
are untouched and stay consistent with the amended R8: the extracted file
loads identically for all four CLIs, gated only by the inline Claude-Code
label plus the reader's own judgment to skip it — exactly as the original
inline-only design would have been read by all four CLIs. No open
questions are introduced by this delta.

## ADDED

1. **New scenario (happy path) — extraction with an inline pointer and the
   inline critical rule conforms.** The following scenario SHALL be added to
   spec 0102's `## Scenarios`, recording that the amended R8 treats the
   extract-to-`docs/` layout as conformant:

   ```text
   **Scenario:** Extracted docs file with an inline pointer and inline
   critical rule satisfies R8

   Given the Requirements 1–7 and 9–11 detail is extracted into
         docs/solo-merge-classifier-workaround.md to keep AGENTS.md under
         the 22,000-byte scripts/check-agents-size.sh budget
   And   AGENTS.md → Branching Strategy retains a Claude-Code-labelled
         section carrying an inline pointer to that file and the inline
         critical rule (re-attempt once, hand a hard block to the user,
         never delegate to a sibling)
   When  the amended R8 is evaluated against this layout
   Then  the layout conforms, because the section names Claude Code, the
         critical rule stays inline, and the extracted file loads
         identically for all four CLIs
   And   the separate-file extraction is not treated as an R8 violation
   ```

2. **New scenario (failure path) — extraction that drops the label or the
   inline critical rule violates R8.** The following scenario SHALL be added
   to spec 0102's `## Scenarios`, recording the boundary the amended R8 still
   enforces:

   ```text
   **Scenario:** Extraction that drops the inline label or critical rule
   violates R8

   Given the full guidance is moved entirely into a docs/ file
   And   AGENTS.md → Branching Strategy carries no Claude-Code-labelled
         section, or omits the inline critical rule
   When  the amended R8 is evaluated against this layout
   Then  the layout violates R8, because the Claude-Code-labelled section
         and the inline critical rule are both mandatory even when the
         Requirements 1–11 detail is extracted
   ```

## MODIFIED

1. **Requirement 8 is replaced.** The original R8 mandated a fully-inline
   home for the guidance and forbade its relocation to a separate file. It
   is replaced by an R8 that preserves the Claude-Code labelling and
   recognizability guarantee unchanged, but permits the Requirements 1–11
   detail to be extracted into a dedicated `docs/*.md` file — following the
   established `AGENTS.md`-extraction convention (commit `c5eb2f4`,
   issue #500) — provided a Claude-Code-labelled section, an inline pointer,
   and the inline critical rule remain in `AGENTS.md`. The justification is
   the hard `scripts/check-agents-size.sh` 22,000-byte CI budget, a
   pre-existing project-wide constraint the original R8 did not account for.

   - Original R8:

     > The guidance of Requirements 1–7 SHALL be introduced under an
     > explicit heading or lead sentence that names Claude Code as the CLI
     > it applies to, so that an agent operating a different CLI can
     > recognize the guidance does not apply to its session without reading
     > the full passage. The guidance SHALL live inline in `AGENTS.md` →
     > *Branching Strategy* as such a labelled Claude-Code section or
     > callout, mirroring the established pattern in
     > `docs/agent-team-protocol.md`, whose *On Claude Code CLI (single
     > implicit session team)* and *On CLIs with no multi-agent coordination
     > surface (e.g. Gemini CLI)* sections co-locate CLI-scoped guidance in
     > one shared file, each headed by the CLI or CLIs it governs. The
     > guidance SHALL NOT be relocated to a separate file, a new skill, or a
     > memory space.

   - Replacement R8:

     > The guidance of Requirements 1–7 SHALL be introduced under an
     > explicit heading or lead sentence that names Claude Code as the CLI
     > it applies to, so that an agent operating a different CLI can
     > recognize the guidance does not apply to its session without reading
     > the full passage. `AGENTS.md` → *Branching Strategy* SHALL carry that
     > labelled Claude-Code section, and the section SHALL retain inline the
     > single operationally critical rule: re-attempt a classifier-denied
     > `gh pr merge` once as the same agent, hand a persistent hard block to
     > the user, and never delegate the denied merge to a sibling agent. The
     > remaining detail of Requirements 1–7 and 9–11 MAY be extracted into a
     > dedicated `docs/*.md` file that the labelled section links by an
     > inline pointer, following the established `AGENTS.md`-extraction
     > convention introduced by commit `c5eb2f4` (issue #500) — under which a
     > short pointer plus a critical-rule excerpt stays inline in `AGENTS.md`
     > while the full section body lives in a dedicated `docs/` file, as
     > `docs/agent-team-protocol.md` and `docs/plan-review-protocol.md`
     > already do. The extracted file, if any, SHALL load identically for all
     > four CLIs; its Claude-Code labelling is a reader-facing recognizability
     > label, not a loading condition. The guidance SHALL NOT be relocated to
     > a new skill or a memory space, and SHALL NOT be placed behind a
     > CLI-conditional loading mechanism that would deliver it to Claude Code
     > only — no such mechanism exists in this repository (see this spec's
     > *Out of scope*).

## REMOVED

(None. The delta modifies Requirement 8 and adds two scenarios; it removes
no requirement, scenario, or out-of-scope item. Requirements 1–7 and 9–12
of spec 0102 remain in force unchanged.)
