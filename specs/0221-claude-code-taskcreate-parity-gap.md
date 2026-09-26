---
id: "0221"
slug: claude-code-taskcreate-parity-gap
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 1267
version: 1.0.0
---

# Claude Code `TaskCreate` coordination-primitive parity gap

Issue #1267 is a Harness Curator friction cluster: `AGENTS.md` → *Agent
Team Protocol* → *Coordination primitives on Claude Code CLI* names
`Agent`, `TaskCreate`, and `SendMessage` as three mandatory, non-optional
coordination primitives, but `TaskCreate` is not present in the current
Claude Code harness's tool surface. The claim traces to
`specs/0092-claude-code-implicit-team-model.md`, which assumed all three
tools were exposed; that assumption does not hold for `TaskCreate` in this
build. This session re-confirmed the absence empirically: a `ToolSearch`
for `TaskCreate`, and separately for the keywords `task` and `create
tracking`, returns no matching tool, while `TaskStop` — `TaskCreate`'s
lifecycle counterpart — is present and loadable. Neither
`specs/0092-claude-code-implicit-team-model.md` nor
`specs/0040-pre-edit-guard.md` is edited by this spec; both carry frozen,
immutable normative or historical content out of this spec's scope.

## Intent

A contributor or an agent reading `AGENTS.md` → *Agent Team Protocol* on
Claude Code CLI, and its expansion in `docs/agent-team-protocol.md`,
finds a coordination-primitives contract that matches the tool surface
the harness actually exposes: `Agent` and `SendMessage` described as the
confirmed-present mandatory primitives, `TaskCreate` described as used
for tracking only when the harness exposes it, and its absence carrying
no protocol violation. `docs/adr/0010-spec-plan-review-lifecycle.md` and
`docs/cli-matrix.md` record the same confirmed capability gap so a later
session or REVIEW pass finds it documented rather than rediscovering it
under a false `tech`-class finding.

## Requirements

1. `AGENTS.md` → *Agent Team Protocol* → the *Coordination primitives on
   Claude Code CLI* bullet SHALL name `Agent` and `SendMessage` as the
   confirmed-present mandatory coordination primitives on Claude Code
   CLI, and SHALL describe `TaskCreate` as a tracking primitive used
   when the harness exposes it, whose absence SHALL NOT constitute a
   protocol violation.
2. `AGENTS.md` → *Agent Team Protocol* → the *Worktree isolation* bullet
   SHALL NOT presuppose `TaskCreate`'s presence in the condition that
   triggers creating the dedicated git worktree.
3. `docs/agent-team-protocol.md` → *On Claude Code CLI (single implicit
   session team)* SHALL present `Agent` and `SendMessage` as the
   confirmed-present mandatory coordination primitives, SHALL describe
   `TaskCreate` as used for tracking only when the harness exposes it,
   and SHALL state that its absence is neither a protocol violation an
   agent must work around nor a condition a REVIEW pass may cite for a
   `tech`-class finding.
4. `docs/agent-team-protocol.md` → *On Claude Code CLI* → the
   *Single-source brief rule* SHALL be worded consistently with
   requirement 3 wherever it references `TaskCreate`.
5. `docs/agent-team-protocol.md` → *Worktree Isolation* SHALL reword its
   `TaskCreate`-mentioning sentence consistently with requirement 2.
6. `docs/agent-team-protocol.md` → *Team Communication* → *Rule 1* SHALL
   reword its tracking clause ("tracked via `TaskCreate`") so the
   tracking mechanism named there does not presuppose `TaskCreate`'s
   presence.
7. `docs/adr/0010-spec-plan-review-lifecycle.md` → *Parity implications
   (Claude / Gemini / Copilot)* SHALL correct its `TaskCreate` mention so
   it does not overstate confirmed availability, and SHALL point at the
   `docs/cli-matrix.md` parity-gap entry required by requirement 8 rather
   than re-asserting that the retroactive routing engine is directly
   expressible via a primitive not confirmed present.
8. `docs/cli-matrix.md` → *Parity gaps* SHALL gain an entry documenting
   that `TaskCreate` is named as a mandatory Claude Code coordination
   primitive by `AGENTS.md` and `docs/agent-team-protocol.md` (per spec
   0092) while being confirmed absent from the current Claude Code
   harness's tool surface, citing the empirical `ToolSearch` non-result
   recorded against issue #1267, and SHALL note `TaskStop` — the
   lifecycle counterpart of `TaskCreate` — as confirmed present, as
   corroborating evidence that the absence is a genuine capability gap
   rather than a session-specific fluke.
9. The changes required by requirements 1 through 8 SHALL preserve the
   substance of every other rule in `AGENTS.md` → *Agent Team Protocol*
   and `docs/agent-team-protocol.md` that is not about `TaskCreate`
   wording, including the solo work prohibition, the worktree
   isolation's substantive git-worktree-creation requirement, the
   complexity tiers and team sizing, the standard team templates, and
   every *Team Communication* rule other than Rule 1's tracking clause.
10. The implementation of this spec SHALL NOT modify any file under
    `/specs/` other than `specs/0221-claude-code-taskcreate-parity-gap.md`
    itself, and in particular SHALL NOT modify
    `specs/0092-claude-code-implicit-team-model.md` or
    `specs/0040-pre-edit-guard.md`.

## Scenarios

**Scenario:** Agent proceeds without stalling when `TaskCreate` is absent

Given the implementation PR for this spec has landed on `main`
And a Claude Code session is delegating work under `AGENTS.md` → *Agent
Team Protocol*
When the session runs `ToolSearch` for `TaskCreate` and receives no
matching tool
Then the session proceeds using `Agent` and `SendMessage` as the
mandatory coordination primitives
And no REVIEW pass records a `tech`-class finding for the absence of a
`TaskCreate` call.

---

**Scenario:** Pre-fix REVIEW pass wrongly flags a `tech`-class finding
for `TaskCreate` absence

Given `AGENTS.md` still carries the pre-fix wording naming `Agent`,
`TaskCreate`, and `SendMessage` as three mandatory, non-optional
coordination primitives
And a Claude Code session completed a ticket using only `Agent` and
`SendMessage` because `TaskCreate` was not present in its tool surface
When a REVIEW pass audits that session against the pre-fix `AGENTS.md`
wording
Then the REVIEW pass records a `tech`-class finding citing the missing
mandatory primitive
And that finding is a false positive rooted in a documentation claim the
harness cannot satisfy, per issue #1267.

---

**Scenario:** `docs/cli-matrix.md` records the parity gap with
corroborating evidence

Given the implementation PR for this spec has landed on `main`
When a future session reads `docs/cli-matrix.md` → *Parity gaps*
Then it finds an entry stating `TaskCreate` is confirmed absent from the
current Claude Code harness's tool surface
And the entry cites the empirical `ToolSearch` non-result recorded
against issue #1267
And the entry names `TaskStop`'s confirmed presence as corroborating
evidence of a genuine capability gap rather than a session-specific
fluke.

## Out of scope

- Editing `specs/0092-claude-code-implicit-team-model.md`'s normative
  content — it is immutable on `main` per `docs/spec-format.md` →
  *Delta-spec convention*, and this spec is not a delta of it.
- Editing `specs/0040-pre-edit-guard.md`'s `TaskCreate` mention — frozen
  historical Intent-section prose, unrelated to this spec's concern.
- Any change to the DEV-stage standard team templates, the team-sizing-
  by-complexity table, or the complexity tiers in
  `docs/agent-team-protocol.md`, beyond the `TaskCreate` wording changes
  required above.
- Adding, restoring, or detecting a real `TaskCreate` capability in the
  Claude Code harness, or filing an upstream feature request for one —
  this spec is documentation-only.
- Any change to Gemini CLI, GitHub Copilot CLI, or Antigravity CLI
  documentation — the confirmed gap is scoped to the current Claude Code
  CLI harness build only, and no claim is made about the other three.
- Re-verifying the gap against a future Claude Code harness release;
  `docs/cli-matrix.md`'s own `[GAP]` / `[GAP-confirmation]` convention
  carries that follow-up, not this spec.

## Open questions

*(None — AUTO mode; no user gate to raise a question against. The
capability gap was independently re-confirmed empirically in this session,
closing the only factual question this spec depended on.)*
