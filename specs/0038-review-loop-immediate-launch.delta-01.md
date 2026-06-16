---
id: "0038"
slug: review-loop-immediate-launch
delta: "01"
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 315
version: 1.0.0
---

# Delta-spec 01 — Fix R4 parenthetical and relax R5 to permit Initial label amendment

## Intent

Two defects were surfaced during the REVIEW loop on the implementation PR (#335):

1. **Spec 0038 R4 carries an incorrect parenthetical.** R4 states the `iter:1`
   label must be applied before spawning "(per the existing iteration-counter rule
   in `retroactive-loop.md`)". The cited rule says the opposite — "apply the
   label at the moment the first verdict is consumed, not at PR open time." The
   parenthetical cites a contradicting authority, creating a self-defeating
   reference.

2. **Spec 0038 R5 is too narrow.** R5 prohibits modifying any section of
   `retroactive-loop.md` other than the new launch-trigger section. This
   inadvertently blocked the fix for the contradiction above: the `Initial label`
   paragraph in `## Iteration counter — GitHub label` describes timing that
   conflicts with R4, but R5 prevented the implementation from amending it.

This delta-spec corrects R4 and relaxes R5 so the implementation can resolve
the contradiction by amending the `Initial label` paragraph.

## Requirements

1. **R4 correction.** Spec 0038 R4 SHALL be superseded by this delta. The
   revised rule reads:

   > The `iter:1` label SHALL be applied to the implementation PR **before**
   > spawning the first reviewer. This is the authoritative timing for the first
   > iteration label.

   The parenthetical "(per the existing iteration-counter rule in
   `retroactive-loop.md`)" is removed; R4 now cites no prior authority because
   this delta resolves the conflict in its favour.

2. **R5 relaxation.** Spec 0038 R5 SHALL be superseded by this delta. The
   revised constraint reads:

   > The implementation of spec 0038 MAY also amend the `Initial label`
   > paragraph in `## Iteration counter — GitHub label` of
   > `docs/retroactive-loop.md` to align its timing description with the
   > launch-trigger rule. No other section of `retroactive-loop.md` is modified.

3. **`docs/retroactive-loop.md` amendment.** The `Initial label` paragraph in
   `## Iteration counter — GitHub label` SHALL be amended by the implementation
   to replace "at the moment the first verdict is consumed, not at PR open time"
   with language consistent with the launch-trigger rule: the `iter:1` label is
   applied before the first reviewer is spawned.

4. No other requirement of spec 0038 (R1, R2, R3, R5 except as above) is
   changed by this delta.

## Scenarios

**Scenario:** Implementation amends the Initial label paragraph.

Given spec 0038 delta-01 is merged on `main`  
And the implementation PR for #315 is updated  
When a reviewer reads `docs/retroactive-loop.md`  
Then the `## REVIEW launch trigger` section states that the `iter:1` label is
applied before spawning  
And the `Initial label` paragraph in `## Iteration counter — GitHub label`
states the same timing  
And the two descriptions do not contradict each other

## Out of scope

- Changing the label-increment mechanism (`gh pr edit` command).
- Changing the "which PR carries the label" rule.
- Any requirement of spec 0038 other than R4 and R5.

## Open questions

- None.
