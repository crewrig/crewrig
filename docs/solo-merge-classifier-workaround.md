<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# On Claude Code CLI — solo-maintainer self-merge block

<!-- crewrig-doc: published=false -->

Claude-Code-only guidance; agents on other CLIs may skip it. In a
solo-maintainer setup — the merge identity equals the pull-request author — a
`gh pr merge` on the author's own PR can be **denied by the Claude Code
auto-mode permission classifier**. The denial text names "the Claude Code auto
mode classifier", the evidence this is a Claude-Code-specific mechanism; this
project asserts nothing about the other three CLIs, neither that they share nor
that they lack the behaviour.

Two manifestations:

- **Transient classifier error** — clears when the *same* agent re-attempts the
  *same* command once. On the first denial the merging agent SHALL re-attempt
  once itself before escalating, so a self-clearing error is not an unnecessary
  user interruption.
- **Hard block** — persists after that one re-attempt. The merge SHALL then be
  carried out by the user (for example the host CLI's in-session `!`-prefixed
  execution) or gated behind an explicit merge-command permission rule (see
  below). A hard block is **not** a lifecycle failure: only the merge keystroke
  is gated.

**No laundering.** The denied agent SHALL NOT ask a sibling to run the merge —
delegating a refused merge launders a denied permission. This is the merge-side
counterpart of rung 3 ("Posting denied") of the verdict-posting ladder in
`artifacts/core/skills/pr-reviewer/SKILL.md` → *Post the review*. Escalate to
the user, never a peer.

**Scope.** This binds the `gh pr merge` action only; other `gh` invocations MAY
hit the same classifier flakiness but carry no requirement here.

**Optional prevention paths** — complementary to, not replacements for, the
reactive retry-then-handoff above, which stays the mandatory fallback for any
session that has not adopted one:

- **Permission-bypassing session mode.** Launch with
  `claude --permission-mode bypassPermissions`, a verified session-level mode
  (see `docs/research/system-context-sandbox-probe.md`) under which the
  classifier does not gate the merge at all. No in-session toggle that switches
  permission mode without a fresh session is asserted here.
- **Explicit merge-command allow-rule.** Add `"Bash(gh pr merge:*)"` to
  `permissions.allow` in the user's Claude Code settings — the
  `"Bash(<tool>:*)"` pattern from `config/claude/settings.json.template` — so
  the classifier stops gating that command. Addable via the `update-config`
  skill or a direct settings edit.
