---
id: "0141"
slug: worktree-cwd-reset-guard
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 889
version: 1.0.0
---

# Harden worktree isolation against mid-session Bash cwd resets

## Intent

After this change, a session working inside a ticket worktree can no longer
have a mid-session write silently redirected to the main repository checkout:
the Worktree Isolation guidance states that every Bash command operating on
worktree content — or naming a repository-relative path — is re-anchored to
the ticket worktree before it runs, and states why the rule exists — the
existing one-time cwd-verification step covers only the session's first
mutating call and does not survive a later reset of the Bash tool's working
directory. A reader of the guidance finds the rule as an explicit, followable
instruction rather than the hand-relayed discipline each team lead already
repeats in every brief.

## Requirements

1. This spec SHALL declare `complexity: standard`, not `small`, because the
   change modifies `docs/agent-team-protocol.md` itself — an established
   protocol document that `AGENTS.md` → *Agent Team Protocol* refers every
   team to. `docs/agent-team-protocol.md` → *Standard Team Templates →
   Template 2* mandates inserting `architect` as a DEV-stage step 0 whenever
   "the documentation change modifies an established protocol, convention,
   or contract," and the `small`-tier team composition explicitly excludes
   `architect` ("No `architect` — the spec is its own architectural input"),
   which would suppress that mandatory review for a change to the protocol
   document itself; `standard` is therefore the only tier that does not
   contradict the existing Template 2 clause.
2. `docs/agent-team-protocol.md` → *Worktree Isolation* SHALL state the
   operational rule that every Bash command operating on worktree content,
   or on a repository-relative path, SHALL begin with `cd <abs-worktree> &&`,
   and that no repository-relative path SHALL be used without that prefix.
3. The section SHALL scope the rule of Requirement 2 to commands that
   operate on worktree content or name repository-relative paths, and SHALL
   NOT present it as applying to the ref-based inspection recipes the section
   already provides — the Tier 1 `git fetch` / `git log` / `git show` /
   `git diff` commands that deliberately run against `crewrig/<branch>` from
   the shared checkout and take ref-scoped paths rather than
   repository-relative filesystem paths.
4. The rule SHALL be phrased in the section as an explicit, actionable
   instruction that can be embedded verbatim in a spawned sub-agent's brief
   or a DEV-stage prompt — an instruction to prefix every mutating or
   repository-relative Bash command with `cd <abs-worktree> &&` — not as a
   restatement of the general "treat the main directory as read-only"
   expectation already present in the section.
5. The section SHALL state that the rule binds every agent issuing Bash
   commands against a ticket worktree — every specialist role and the
   orchestrating session alike — and SHALL note that the failure mode it
   closes was observed in both roles in the originating incident (the
   developer session and the team-lead's own DEV brief in issue #889's
   evidence for issue #761). The obligation attaches to operating in a
   worktree, not to a role.
6. The section SHALL present the operational rule as a distinct instruction
   that complements the existing one-time cwd-verification paragraph, and
   SHALL NOT present the two as alternatives: the one-time check covers the
   session's first mutating call, while the rule covers the whole session,
   including a Bash-tool cwd reset that occurs after the check has passed.
7. The rewrite SHALL be scoped to `docs/agent-team-protocol.md` → *Worktree
   Isolation*, touching `AGENTS.md`'s *Agent Team Protocol* summary bullet
   only if needed to keep the two surfaces consistent with each other. It
   SHALL NOT alter the section's other subsections — whole-tree operations
   and claims, stray-file discovery and adjudication, verification recipes —
   or any other section of `docs/agent-team-protocol.md`.
8. This spec SHALL NOT request, imply, or describe any change to the Claude
   Code harness's Bash tool behavior — resetting the working directory to the
   cwd the session was launched in, a louder or more actionable reset notice,
   or any other change to the reset behavior — because this repository does
   not control harness tool behavior.
9. This spec SHALL NOT mandate any tooling that mechanically enforces the
   rule — a `git worktree`-aware guard that makes the main checkout read-only
   while a ticket worktree is open, a wrapper that rewrites or rejects
   unprefixed commands, a pre-commit hook, or a lint rule. The remediation
   qualified here is documentation-only: a stated, agent-followed operational
   rule.

## Scenarios

**Scenario:** a mid-session cwd reset cannot redirect a prefixed command

Given a sub-agent working inside `.worktrees/889/` whose every Bash command
begins with `cd /Users/<login>/devel/perso/genai/framework/crewrig/.worktrees/889/ &&`
per the rule stated in *Worktree Isolation*
When  the Bash tool silently resets the session's working directory to the
main repository checkout mid-session, and the sub-agent's next mutating
command carries the mandated `cd` prefix
Then  the command re-anchors to the worktree before it runs, the write lands
inside `.worktrees/889/`, and the main checkout's files remain untouched

**Scenario:** an unprefixed repository-relative command after a reset lands
in the main checkout

Given a sub-agent that passed the one-time cwd-verification step before its
first mutating call, and the Bash tool later resets the session's working
directory to the main repository checkout
When  the sub-agent runs a repository-relative command such as
`cat >> scripts/lib/common.sh <<'EOF'` without the `cd <abs-worktree> &&`
prefix
Then  the relative path resolves against the main checkout, the payload is
appended to the MAIN checkout's `scripts/lib/common.sh` while the worktree's
copy stays untouched, and the misroute is detectable only by a later diff —
the failure this rule exists to prevent

**Scenario:** a rewrite that drops the rule, or demotes it to an alternative
of the one-time check, is rejected

Given a candidate change to *Worktree Isolation* that presents the
per-command rule as an alternative to the one-time cwd-verification step, or
that removes the "no repository-relative path without the `cd` prefix"
constraint
When  the change is reviewed against this spec
Then  it is rejected, because Requirement 6 requires the two instructions to
coexist as distinct, complementary disciplines and Requirement 2 requires the
rule to be stated in full

## Out of scope

- Any harness-level change to how Claude Code's `Bash` tool resolves or resets
  its working directory — resetting to the cwd the session was launched in, a
  louder or more prominent reset notice, or any other change to the reset
  behavior. That surface belongs to Anthropic, not to this repository.
- Any tooling that mechanically enforces the rule: a `git worktree`-aware
  guard that makes the main checkout genuinely read-only while a ticket
  worktree is open, a wrapper that rewrites or rejects unprefixed commands, a
  pre-commit hook, or a lint rule. The remediation qualified here is a
  documented, agent-followed instruction, not automation.
- Any change to the other subsections of *Worktree Isolation* — whole-tree
  operations and claims, stray-file discovery and adjudication,
  verification-without-touching recipes — or to any other section of
  `docs/agent-team-protocol.md`, beyond the minimal consistency touch
  permitted by Requirement 7.
- Retroactive remediation of the originating incident itself (the roughly 362
  lines appended to the main checkout's `scripts/lib/common.sh` during the
  issue #761 session) — this spec qualifies the go-forward protocol, not a
  one-time cleanup pass.

## Open questions

- None — this is a scoped, narrow addition to one existing paragraph of one
  protocol document; no ambiguity was identified that the Requirements and
  Out of scope sections above do not already resolve.
