---
id: "0036"
slug: scannable-recap-format
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 313
version: 1.0.0
---

# Scannable recap format rule in core rules

## Intent

Situation recaps and progress updates produced by agents and orchestrators
follow a scannable structure — decision or outcome first, followed by tight
bullets — so the user can extract the key information without parsing dense
prose. The rule lands in the framework-level core rules file
(`artifacts/core/rules/60-tools.md`) so it applies to every agent reading
the deployed rules.

## Requirements

1. `artifacts/core/rules/60-tools.md` SHALL gain a **Scannable Recap Format**
   section that applies to all situation recaps and progress updates directed
   at the user.
2. The section SHALL mandate leading with the **decision or outcome in one
   short sentence** before any supporting detail. The first sentence must be
   self-sufficient: a user who reads only the first sentence SHALL understand
   what happened or what was decided.
3. Supporting detail SHALL be presented as **tight scannable bullets** — one
   idea per bullet, no stacked parentheticals inside a bullet, no more than
   one em-dash per sentence.
4. Recap **paragraphs** SHALL be capped at two sentences. When a summary
   requires more than two sentences of prose, the agent SHALL convert the
   additional content into bullets instead.
5. The section SHALL enumerate the **anti-patterns** to avoid:
   - Long sentences with embedded parentheticals (e.g. `"The merge (which
     required resolving the conflict in X (introduced by Y)) succeeded"`).
   - Multiple em-dashes in a single sentence.
   - Heavy consecutive inline emphasis (`**word1** … **word2** … **word3**`
     in the same sentence).
   - Burying the decision or outcome inside a sub-clause of a long sentence.
6. The rule applies to **situation recaps, status updates, and progress
   messages** directed at the user. It does NOT apply to repository-bound
   artifacts (commit messages, PR bodies, spec files, plan comments) — those
   follow their own format conventions.

## Scenarios

**Scenario:** Orchestrator reports a CI failure without stacking parentheticals.

Given a CI check has failed  
And the orchestrator is composing a status update in French  
When it writes the update  
Then the first sentence states the outcome directly (`"CI failure on PR #N:
lint-specs fails."`)  
And the root cause and next step appear as separate bullets  
And no sentence contains stacked parentheticals or multiple em-dashes

**Scenario:** Agent summarizes a completed lifecycle stage.

Given the REVIEW stage has completed with APPROVE verdict  
And the agent is composing a final recap  
When it writes the recap  
Then the first sentence is the verdict (`"APPROVE — no findings."`)  
And any supporting notes (CI status, findings count) are one bullet each  
And the entire recap fits within three lines

## Out of scope

- Applying recap format rules to repository-bound content (PR bodies, plan
  comments, commit messages) — those have their own format conventions.
- Changing recap format in skill-specific contexts where a different structure
  is contractually mandated (e.g., the structured verdict format in the
  `pr-reviewer` skill — that format is a contract, not a recap).

## Open questions

- None. The format prescription (decision first, bullets, cap paragraphs) is
  settled from the evidence in issue #313.
