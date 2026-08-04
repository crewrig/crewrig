---
id: "0102"
slug: solo-merge-classifier-workaround
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 636
version: 1.0.0
---

# Document the solo-maintainer `gh pr merge` classifier-block workaround

## Intent

An agent that carries a pull request through to its final merge step in a
solo-maintainer repository — where the identity performing the merge is the
same identity that authored the pull request — can, when operating the
Claude Code CLI, find its merge command denied by that CLI's auto-mode
permission classifier, and today no project documentation tells it what to
do next, so it stalls at the last step of the lifecycle with no in-source
guidance. This specification closes that gap: the project's
branching-and-merge documentation gains a clearly labelled,
Claude-Code-specific note that both tells an agent already hit by the block
how to respond — distinguishing a transient classifier error the agent can
clear on its own from a hard block only the user can clear, treating neither
as a lifecycle failure, and forbidding the agent from asking a sibling agent
to perform a merge it was itself denied — and offers the user optional,
complementary paths to stop encountering the block at all. The note is
headed explicitly as applying to Claude Code, so an agent operating a
different CLI can recognize the guidance does not apply to its session. The
reactive guidance mirrors the response already documented for the matching
situation on the review side of the lifecycle, where the same shared
author-and-reviewer identity blocks an agent from posting its own verdict.

## Requirements

1. `AGENTS.md` → *Branching Strategy* SHALL document that, in a
   solo-maintainer setup where the identity executing the merge equals the
   pull-request author, a `gh pr merge` invocation on that author's own
   pull request can be denied by the Claude Code auto-mode permission
   classifier.
2. The same documentation SHALL distinguish two manifestations of that
   denial: (a) a **hard block** that the merging agent's own repeated
   attempts do not clear, and (b) a **transient classifier error** that a
   single re-attempt of the same command by the same agent clears.
3. For the transient manifestation, the documentation SHALL direct the
   merging agent to re-attempt the same `gh pr merge` command once itself
   before escalating to the user, so that a self-clearing classifier error
   does not become an unnecessary user interruption.
4. For the hard-block manifestation — a denial that persists after the
   single self re-attempt of Requirement 3 — the documentation SHALL direct
   that the merge be carried out by the user (for example through the host
   CLI's in-session `!`-prefixed execution) or gated behind an explicit
   merge-command permission rule, and SHALL state that such a denial is not
   a lifecycle failure.
5. The documentation SHALL forbid the denied agent from asking a sibling
   agent to execute the merge on its behalf, because delegating a denied
   merge launders a permission the agent was refused. This rule SHALL be
   presented as the merge-side counterpart of rung 3 of the `pr-reviewer`
   verdict-posting ladder in
   `artifacts/core/skills/pr-reviewer/SKILL.md` → *Post the review*.
6. The normative guidance of this specification SHALL be scoped to the
   `gh pr merge` action. The documentation MAY note that other `gh`
   invocations can transiently encounter the same classifier flakiness, but
   SHALL NOT impose requirements on those other invocations.
7. `docs/post-merge-flow.md`, whose scope begins after a merge command has
   already executed, SHALL carry a cross-reference to the new
   *Branching Strategy* guidance, so an agent that reaches the post-merge
   documentation from a blocked merge is pointed back to the workaround.
8. The guidance of Requirements 1–7 SHALL be introduced under an explicit
   heading or lead sentence that names Claude Code as the CLI it applies to,
   so that an agent operating a different CLI can recognize the guidance
   does not apply to its session without reading the full passage. The
   guidance SHALL live inline in `AGENTS.md` → *Branching Strategy* as such
   a labelled Claude-Code section or callout, mirroring the established
   pattern in `docs/agent-team-protocol.md`, whose
   *On Claude Code CLI (single implicit session team)* and *On CLIs with no
   multi-agent coordination surface (e.g. Gemini CLI)* sections co-locate
   CLI-scoped guidance in one shared file, each headed by the CLI or CLIs it
   governs. The guidance SHALL NOT be relocated to a separate file, a new
   skill, or a memory space.
9. The documentation SHALL state that the block is a mechanism of the
   Claude Code CLI's own auto-mode classifier — evidenced by the denial
   text itself, which names "the Claude Code auto mode classifier" — and
   that whether Gemini CLI, GitHub Copilot CLI, or Antigravity CLI exposes
   an equivalent classifier is unverified and out of scope for this
   specification. The documentation SHALL NOT generalize this
   Claude-Code-only observation into CLI-agnostic guidance, and SHALL NOT
   assert a negative about the other three CLIs.
10. The documentation SHALL additionally present optional prevention paths a
    user MAY adopt to stop encountering the block entirely. These paths
    SHALL be presented as complementary to — not replacements for — the
    reactive retry-then-handoff behavior of Requirements 3–5, which remains
    the mandatory fallback for any session that has not adopted a prevention
    path. One prevention path SHALL be running the Claude Code session in a
    permission-bypassing permission mode, so that the classifier does not
    gate the merge at all. The documentation SHALL describe this as a
    session-level permission mode (the verified mechanism) and SHALL NOT
    assert the existence of an unverified in-session toggle that would switch
    permission mode without a fresh session.
11. A second prevention path SHALL be adding an explicit Bash permission
    allow-rule for the merge command to the user's Claude Code settings, so
    that the classifier stops gating that specific command going forward —
    the same class of merge-command permission rule that Requirement 4
    offers as a reactive remedy, here adopted proactively. The documentation
    SHALL note that such an allow-rule is addable through the `update-config`
    skill or by a direct edit to the settings file, and SHALL NOT re-specify
    the behavior of the `update-config` skill itself.
12. `docs/cli-matrix.md` SHALL carry a note or row recording this
    Claude-Code-only auto-mode classifier merge-block as a per-CLI
    behavioral asymmetry, cross-referencing the *Branching Strategy*
    guidance, and marking the equivalent status on Gemini CLI, GitHub
    Copilot CLI, and Antigravity CLI as unverified and out of scope for this
    specification.

## Scenarios

**Scenario:** A transient classifier error clears on the agent's own retry

```text
Given a merging agent has been granted authorization to merge its own
      pull request
And   its first `gh pr merge` invocation is denied with a transient
      classifier error
When  the agent re-attempts the same `gh pr merge` command once itself
Then  the merge succeeds
And   no user interruption is raised for the transient error
```

**Scenario:** A hard block is handed to the user without laundering

```text
Given a merging agent whose identity equals the pull-request author
And   its `gh pr merge` invocation is denied by the auto-mode classifier
And   a single same-session re-attempt of the same command is still denied
When  the agent recognizes the denial as a hard block
Then  the merge is handed to the user for in-session `!`-prefixed execution,
      or gated behind an explicit merge-command permission rule
And   the agent does not record the denial as a lifecycle failure
And   the agent does not ask a sibling agent to execute the merge on its
      behalf
```

**Scenario:** Delegating a denied merge to a sibling is forbidden

```text
Given agent A was denied `gh pr merge` on its own pull request
When  agent A considers delegating the merge to sibling agent B
Then  the documented rule forbids the delegation, because it would launder a
      permission A was refused
And   agent A escalates the merge to the user instead
```

**Scenario:** A permission allow-rule prevents the block from recurring

```text
Given a user has added an explicit merge-command Bash allow-rule to their
      Claude Code settings
When  a merging agent later runs `gh pr merge` on the author's own
      pull request
Then  the auto-mode classifier no longer gates the command
And   the reactive retry-then-handoff fallback is not exercised
```

**Scenario:** An agent on a non-Claude CLI recognizes the guidance is not
its concern

```text
Given the *Branching Strategy* solo-merge guidance is headed explicitly as
      Claude-Code-specific
When  an agent operating a CLI other than Claude Code reads that section
Then  the explicit Claude Code label lets it recognize the guidance does not
      apply to its session without reading the full passage
And   it proceeds without acting on a classifier its CLI is not documented to
      have
```

## Out of scope

- Provisioning a second, distinct bot identity that would sidestep both the
  review-self-approval and the merge-self-approval walls at once. This
  larger infrastructure option was already parked out of scope by issue #595
  and is noted here only for cross-reference.
- A true CLI-conditional loading mechanism — a rule file, skill, or content
  block deployed to or loaded by only ONE of the four CLIs. No such
  mechanism exists in this repository today: `setup-claude-interactive.sh`
  and `setup-gemini-interactive.sh` both deploy
  `artifacts/core/rules/60-tools.md` identically, and there is no
  CLI-exclusive artifact anywhere under `artifacts/`. Building one would be a
  large, separate infrastructure ticket, not work for this `small`-tier
  spec; the labelled-inline-callout approach of Requirements 8–9 is chosen
  deliberately over a more surgical exclusion mechanism because the exclusion
  mechanism does not exist and inventing it is out of scope here.
- Broader troubleshooting of auto-mode classifier flakiness beyond the
  `gh pr merge` action — including the observed transient denial of
  read-only `gh` calls. This specification documents the merge workaround
  only; a general classifier-flakiness policy is a separate concern.
- Any change to Claude Code's own auto-mode classifier behavior. The
  classifier is external to this repository and outside its control; this
  specification documents how an agent works within the classifier's
  decisions, not how to change them.
- Independent verification of whether Gemini CLI, GitHub Copilot CLI, or
  Antigravity CLI exposes an equivalent auto-mode classifier. This spec
  scopes its guidance to Claude Code and records the other three CLIs'
  status as unverified (Requirements 9 and 12); proving or disproving an
  equivalent on those CLIs is a separate research effort.
- Any change to the `pr-reviewer` verdict-posting ladder itself. This
  specification mirrors that ladder's rung-3 anti-laundering rule for the
  merge side but does not modify the review-side ladder introduced by
  issue #595 and PR #634.
- Any re-specification of the `update-config` skill. Requirement 11
  references it as the mechanism for adding a permission allow-rule but does
  not alter its behavior.
- New tooling or automated enforcement — for example, a check that detects a
  classifier-blocked merge. This specification amends the written process
  contract and its cross-referenced matrix entry only.

## Open questions

None outstanding. Three decisions were resolved during authoring rather than
left open:

- **Home and labelling.** The primary home for the guidance is `AGENTS.md` →
  *Branching Strategy*, adjacent to the existing merge-authorization mandate
  it qualifies, expressed as an explicitly Claude-Code-labelled section or
  callout (Requirement 8) with `docs/post-merge-flow.md` carrying a
  cross-reference (Requirement 7). This was chosen over placing the
  normative rule in `docs/post-merge-flow.md`, whose scope begins only after
  a merge command has already executed and which therefore cannot naturally
  host guidance about a merge command that was blocked before it ran, and
  over a separate file, a new skill, or a memory space (all rejected because
  no CLI-conditional loading mechanism exists to make a separate artifact
  load on Claude Code only — see *Out of scope*).
- **Mid-session permission-mode toggle.** The prevention path of
  Requirement 10 is grounded on the verified session-level permission-mode
  flag only. Whether Claude Code also exposes an in-session toggle that
  switches permission mode without a fresh session is unverified; the
  documentation is therefore forbidden from asserting one, rather than
  parking an open question that would block exit.
- **CLI-matrix coverage.** Adding a `docs/cli-matrix.md` note or row
  (Requirement 12) is included in this spec's scope rather than deferred to
  a follow-up, because the Claude-Code-only classifier is a genuine per-CLI
  behavioral asymmetry — exactly the class of fact that document exists to
  track, using its established "unverified" status marker — and the addition
  is a single low-cost row well within the `small` tier. `AGENTS.md` is not
  itself on the CLI Matrix Maintenance trigger-path list, so this is a
  deliberate, defended inclusion, not an obligation.
