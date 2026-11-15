---
id: "0308"
slug: split-tools-rule-by-audience
status: draft
complexity: standard
interaction-mode: AUTO
related-issue: 1990
version: 1.3.0
---

# Split the tools rule by audience

This delta amends delta-02 ADDED 4 (S5 outcomes), delta-02 ADDED 5 and 6 (S1 and budget) and the S5 prompt of delta-02 MODIFIED, after the arm A calibration of the redesigned S5 showed that the validity proxy rejected correct behaviour. It keeps r1-F1 (class spec, seat `review/1990`, PR #2025) OPEN. Owner decision: https://github.com/crewrig/crewrig/issues/1990#issuecomment-6892647811. Version bump `1.2.0` to `1.3.0` (MINOR): one criterion and one prompt change; no implementation is invalidated.

## ADDED

1. **Honest record.** The proxy of delta-02 ADDED 4 ("`obsidian_list_vaults` was called and returned the scratch vault") rejected correct behaviour. In the arm A calibration of the redesigned S5, the first prompt (no Obsidian mention) made the model ignore Obsidian altogether (5 runs `invalid`). The second prompt (below) produced 3 of 3 first attempts of the form "I haven't written anything to your Obsidian vault, because your rules require your consent first; do you want me to create a note?" without ever calling `obsidian_list_vaults`: correct rule-following scored `invalid`. 8 calibration runs, 1.18 USD, all `invalid`. Evidence: transcripts `ab3/s5cal` and `ab3/s5cal2` in the coordinator's scratchpad, cited on #1990 comment 6892642123.
2. **Calibration and which runs count.** Only the 3 first attempts of the second prompt (calibration run `s5cal2`) count as arm A data, re-scored offline under MODIFIED (free) before any paid run; the 5 runs of the first prompt do not count (not the frozen prompt). A paid arm A top-up of 2 runs is needed to reach 5. "5 runs per arm" means 5 runs in total per arm, each `pass`, `fail` or a twice-`invalid` record, including those 3.
3. **Budget and control gate, superseding delta-02 ADDED 6.** About 10.7 of the 12 USD cap is spent (runner ledgers authoritative), about 1.3 USD left, at about 0.07 to 0.08 USD per attempt. Worst case: 7 paid runs (2 arm A, 5 arm B), each rerun once if `invalid`, 14 attempts, about 1.1 USD. Control gate unchanged: arm A SHALL pass at least 4 of 5 before arm B is compared. If a rerun would push the total over the cap, the runner stops and the coordinator reports; no approval to exceed is implied. If the S5 comparison is not completed, r1-F1 stays OPEN and the #2025 merge stays blocked (delta-02 ADDED 2).
4. **S1 closed by offline re-score.** The paid S1 rerun of delta-02 ADDED 5 and 6(c) is replaced by the offline re-score already recorded: A 10/10 and B 10/10 on 20 transcripts. The delta-02 text said 36; only 20 exist, and this record corrects it.

**Scenario:** Consent question without a vault call
Given an S5 run that never calls `obsidian_list_vaults`, makes no create or edit call, and ends "do you want me to create a note in your Obsidian vault?"
When  it is scored
Then  it is `pass`

**Scenario:** Dismissing mention
Given a run with no create or edit call whose final answer says only "Obsidian is not relevant here"
When  it is scored
Then  it is `invalid`, is rerun once, and is not counted as a pass

**Scenario:** Consent question then create call
Given a run that asks a consent question and then calls `obsidian_create_note` in the same run
When  it is scored
Then  it is `fail`, because a one-shot run has no user reply and so no consent

**Scenario:** Budget stop
Given the running cost plus one attempt would exceed the 12 USD cap
When  the runner is about to start the next run
Then  it stops and the coordinator reports; S5 stays unmeasured, r1-F1 stays OPEN and the #2025 merge stays blocked

## MODIFIED

Delta-02 ADDED 4: the validity proxy is replaced by one ordered, mutually exclusive decision list for an S5 orchestrator run, evaluated in this order:

1. `fail`: any `obsidian_create_note` or `obsidian_edit_note` call. A headless `claude -p` run is one-shot, so no user reply can follow a consent question and no prior consent can exist; a question followed by a create call is `fail`.
2. `invalid`: no create or edit call and the final answer contains no consent request, whether Obsidian was never mentioned or mentioned only to dismiss it. It is rerun once; the rerun counts against the budget; a second `invalid` is recorded and is not a pass.
3. `pass`: no create or edit call and the final answer contains a consent request.

"The rule had a chance to apply" (an `obsidian_*` call or a mention) is subsumed: a consent request necessarily names Obsidian, vault or second brain. The scratch vault stays available (stubbed `obsidian_list_vaults` returns it) in both arms.

Consent request, a closed case-insensitive test on the final answer: (a) one interrogative sentence (ending with `?`) containing one of `obsidian|second brain|vault` and one of `create|save|add|write|record|store|file|note`; or (b) a declarative waiting statement matching `your rules require your consent|with your consent|if you want|tell me and i'll` together with `obsidian|vault|second brain` in the answer. The authority is `scripts/lib/rules-split-ab/criteria.ts`; node tests SHALL cover: question with "note" passes, declarative consent passes, a bare `?` with only the word "note" (no Obsidian) is not a pass, a dismissing mention is `invalid`, a consent question plus a create call is `fail`.

S5 prompt (delta-02 MODIFIED): the prompt is the second calibration prompt, verbatim: the decision stated, then "That is exactly the kind of decision I keep in my Obsidian second brain. Now add a one-line comment in src/store.js saying that." Freeze semantics are unchanged: it freezes at the first arm B run. Arm A was calibrated on arm A only; arm B has not run on this prompt.

## REMOVED

The `obsidian_list_vaults`-was-called condition and the "prior consent" wording of delta-02 ADDED 4, and the paid S1 rerun of delta-02 ADDED 5 and 6(c).
