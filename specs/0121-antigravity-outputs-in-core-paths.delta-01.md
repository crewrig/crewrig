---
id: "0121"
slug: antigravity-outputs-in-core-paths
status: approved
complexity: small
interaction-mode: MINIMAL
related-issue: 1119
version: 2.0.0
---

# Antigravity outputs in core paths — delta 01

Narrows the synchronisation halt of spec 0121 requirement 3 to the built
outputs that remain **strict**, so that no merged requirement obliges a halt the
shipped synchronisation no longer performs. Authored for issue #1119 and
mandated by requirement 44 of
[`specs/0199-org-model-mapping-override.md`](0199-org-model-mapping-override.md)
(`156a206`), which names spec 0121 requirement 3 as a contradicted premise and
assigns its repair to this delta rather than to an edit of the merged body.

This delta records a consequence spec 0199 already decided. It introduces no
design: requirement 42 of spec 0199 defines the **regenerable** policy,
requirement 43 assigns it to the four compiled agent output trees, requirement
45 keeps the compiled skill and command trees **strict**, and requirement 46
states that a regenerable path counts as governed. What follows carries those
decisions into the parent's own text, so a reader of spec 0121 alone is not left
holding a superseded rule.

`MAJOR` bump. Requirement 3's *halt* clause is inverted for four of the trees it
governs: where it obliged an abort, the synchronisation now restores and
reports. The parent's scenario *a locally edited Antigravity output halts the
synchronisation* asserts exactly the case that stops holding, and is replaced
below; requirement 50 of spec 0199 mandates a test asserting the opposite
outcome on that same case. That is an inversion of a shipped assertion, not an
addition to it, so the bump is `MAJOR` even though
`scripts/tests/test-sync-from-upstream.sh` at `156a206` names no compiled agent
output tree and therefore no committed test changes verdict.

Nothing observable changes with this delta. It is normative text only: no
script, no manifest entry and no continuous-integration guard is touched here.
The mechanical change — the fourth policy, the four reclassified entries, the
manifest and the guards — belongs to the change set of spec 0199.

**Vocabulary.** The **regenerable** policy is the fourth synchronisation policy
of spec 0199 requirement 42: it restores a path from upstream exactly as
**strict** restores it, including the orphan cleanup of spec 0064, never aborts
on a local modification, and reports each restored member whose local content
had diverged. *Governed*, *built output* and *core-layer path* carry the
meanings spec 0121 and spec 0020 give them.

Requirement numbering continues the parent's sequence, which ends at requirement
7 — per the precedent of
[`specs/0143-copilot-subagent-model-fallback.delta-01.md`](0143-copilot-subagent-model-fallback.delta-01.md).

## ADDED

1. **R8.** The guarantee requirement 2 requires of every directory the component
   build writes component outputs into is **membership of the governed class** —
   the class of paths carrying **strict**, **adopt-on-edit**, or the
   **regenerable** policy of requirement 42 of spec 0199 — and not an identical
   policy across those directories. Two such directories MAY therefore carry
   different policies, provided no such directory is left ungoverned. A path
   carrying the **regenerable** policy SHALL count as governed for the purpose
   of requirement 2, so that `scripts/check-core-paths.sh` neither fails it as
   ungoverned nor exempts it from resolving at `HEAD`.
2. **R9.** Every directory the component build writes component outputs into
   SHALL carry exactly one synchronisation policy, preserving the *exactly one*
   clause of requirement 8 of spec 0020 unchanged. Reclassifying the compiled
   agent output trees SHALL replace their policy, never layer a second one over
   it.

### Why requirement 2 is clarified rather than replaced

Requirement 2's text already admits the governed-class reading, so no
replacement is owed and none is made — Premise 2 of spec 0199 reaches the same
disposition ("No delta is owed") and requirement 46 states the counting rule
this delta's R8 carries into the parent. Three things settle it.

- **The requirement's operative clause is the second one.** "…and no such
  directory SHALL be left without one" is the mischief requirement 2 was written
  for (issue #755), where `.agents/skills` and `.agents/agents` appeared in no
  manifest at all. Ungoverned is the state it forbids.
- **The shipped implementation already reads it that way.**
  `dir_is_governed()` in `scripts/check-core-paths.sh` accepts **either**
  `strict` **or** `adopt-on-edit`, so two different policies already satisfy
  requirement 2 today, and `.crewrig/core-paths.txt` already exercises that —
  `config/expertise` is `adopt-on-edit` while `artifacts/core` is `strict`. A
  requirement whose own conformance check has always accepted two policies does
  not need its text changed to accept a third.
- **The alternative reading would be a change, not a clarification.** Read as
  *identical policy*, requirement 2 would forbid the state the repository has
  shipped since spec 0021, which is a stronger claim than the parent ever made.

R8 is therefore recorded as an addition, so a reviewer holding the
identical-policy reading finds the argument rather than reconstructing it. On
its own it would be a `PATCH`-class item; the `MAJOR` bump is owed to the
requirement 3 replacement below, not to it.

### Added scenarios

**Scenario:** a regenerated compiled agent output does not halt the
synchronisation

```text
Given a fork whose org channel file changes what two agents resolve to
And   whose compiled agent outputs under `.agents/agents` and `.claude/agents`
      were regenerated from the declarations in force and committed
When  the adopter synchronises from upstream
Then  the synchronisation does not halt, restores those agent outputs from
      upstream, and reports each restored member whose local content had
      diverged, so the fork knows to regenerate them
```

Mirrors the scenario *A fork with an override completes an upstream
synchronization* of spec 0199, and discharges its requirement 48 on the
Antigravity tree alongside the other three.

**Scenario:** a hand-edited compiled skill output still halts the
synchronisation

```text
Given an adopter has hand-edited `.agents/skills/spec-author/SKILL.md`
When  the adopter synchronises from upstream
Then  the synchronisation halts without restoring anything, and names that
      Antigravity skill output among the core-layer paths carrying local
      modifications, exactly as a hand-edited
      `.claude/skills/spec-author/SKILL.md` makes it name the Claude Code one
```

Mirrors the scenario *A hand-edited compiled skill output still halts the sync*
of spec 0199, under its requirement 45. The parity clause of requirement 3
survives intact here: the Antigravity skill output is treated exactly as the
Claude Code output of the same kind.

## MODIFIED

1. **Requirement 3 is replaced** so that the halt binds the *kind* of built
   output rather than every built output, while the parity across the four
   targets it exists to state is preserved verbatim in force.

   - Original R3:

     > **R3.** A local modification to a built Antigravity component output
     > SHALL halt an upstream synchronisation and name the affected core-layer
     > path, exactly as a local modification to a built Claude Code, Gemini
     > CLI, or GitHub Copilot CLI component output does.

   - Replacement R3:

     > **R3.** A local modification to a built Antigravity component output
     > SHALL be treated exactly as a local modification to the built Claude
     > Code, Gemini CLI, or GitHub Copilot CLI component output of the same
     > kind. Where the output belongs to a compiled **skill** or **command**
     > output tree — the trees that remain **strict** per requirement 45 of spec
     > 0199 — the modification SHALL halt an upstream synchronisation and name
     > the affected core-layer path. Where it belongs to one of the four
     > compiled **agent** output trees — `.claude/agents`, `.gemini/agents`,
     > `.github/agents`, `.agents/agents`, which all carry the **regenerable**
     > policy per requirement 43 of spec 0199 — the synchronisation SHALL NOT
     > halt: the output SHALL be restored from upstream exactly as a **strict**
     > path is restored, and each restored member whose local content had
     > diverged SHALL be reported.

   **Why the agent trees lose the halt.** Under an organization-level mapping
   override, a compiled agent output that differs from upstream's is the correct
   output of the build rather than a hand edit, and
   `scripts/sync-from-upstream.sh` cannot tell the two apart without running the
   component build — which Decision 6 of spec 0199 rejects outright, because it
   would make a hermetic git operation depend on the build. The halt is
   therefore withdrawn for the whole class rather than conditioned on a check
   the synchronisation cannot perform. Hand-editing a compiled agent output
   stays forbidden; it simply stops being the thing the synchronisation guards
   against, and is restored over and reported instead.

   **Why parity is preserved rather than weakened.** Requirement 43 of spec 0199
   moves all four agent trees together, so Antigravity's outputs are still
   treated exactly as the other three targets' outputs of the same kind — which
   is the property requirement 3 exists to state. The replacement binds that
   parity by *kind* on all four targets, where the original bound it by target
   alone; the guarantee Antigravity holds is neither broader nor narrower than
   any sibling's, before or after.

2. **The scenario "a locally edited Antigravity output halts the
   synchronisation" is replaced**, because its `Then` asserts the halt the
   replaced requirement 3 no longer obliges on an agent output. The `Given` and
   `When` are unchanged; only the outcome moves.

   - Original scenario:

     ```text
     Given an adopter has hand-edited `.agents/agents/developer/AGENT.md`
     When  the adopter synchronises from upstream
     Then  the synchronisation halts without restoring anything, and names the
           Antigravity output directory among the core-layer paths carrying local
           modifications, exactly as a hand-edited `.claude/agents/developer/AGENT.md`
           makes it name the Claude Code one
     ```

   - Replacement scenario:

     ```text
     Given an adopter has hand-edited `.agents/agents/developer/AGENT.md`
     When  the adopter synchronises from upstream
     Then  the synchronisation does not halt: it restores that file from
           upstream and reports it among the diverged members it restored over,
           exactly as a hand-edited `.claude/agents/developer/AGENT.md` is
           restored and reported
     ```

Requirement 1 of the parent is **UNCHANGED**: the **regenerable** policy
restores exactly as **strict** restores, so a synchronising fork still comes
away with its Antigravity component outputs at the same upstream revision as its
siblings' — and now does so even where it had diverged. Requirement 2 is
**UNCHANGED** for the reasons recorded under `## ADDED`; R8 states its reading,
it does not alter it. Requirements 4 through 7 are **UNCHANGED**: requirement 4
concerns adopter-local Antigravity state, which is unlisted and untouched by any
policy; requirements 5 and 6 concern the guard over *ungoverned* built-output
directories, and requirement 46 of spec 0199 keeps a **regenerable** path inside
the governed class, so the guard's verdict on every path is unchanged;
requirement 7 concerns the agreement of the two records of the core layer, which
a reclassification preserves by updating both.

The parent's other four scenarios are **UNCHANGED**. *An upstream sync brings a
fork's Antigravity outputs up to date* holds unchanged because **regenerable**
restores as **strict** does. *Adopter-local Antigravity state survives a
synchronisation*, *a built output directory without the guarantee fails the
build*, and *a guard that has stopped detecting the condition fails the build*
are all indifferent to which governed policy a built-output directory carries.
Every `## Out of scope` bullet of the parent is **UNCHANGED**, and its
`## Open questions` section remains `None.`.

## REMOVED

None.
