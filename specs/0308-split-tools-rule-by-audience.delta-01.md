---
id: "0308"
slug: split-tools-rule-by-audience
status: draft
complexity: standard
interaction-mode: AUTO
related-issue: 1990
version: 1.1.0
---

# Split the tools rule by audience

This delta amends requirements 1, 2, 6, 8 and 9 of spec 0308 after run 1 of the paired A/B (3.67 USD spent) found one design defect (scenario 5) and three scenario-calibration problems (scenarios 1, 6, 7). Owner decision: https://github.com/crewrig/crewrig/issues/1990#issuecomment-6885442346. Version bump `1.0.0` to `1.1.0` (MINOR): one section is added to the moved-text contract and three arm-A scenarios are recalibrated; no in-flight implementation is invalidated. Run 1 results stay recorded on #1990 as run 1, not deleted.

## ADDED

1. **Section that binds every agent (design defect, S5).** Moving the Obsidian protocol to the orchestrator-only `60-memory.md` removed the "MUST ask before writing" consent obligation from workers. `60-tools.md` SHALL therefore keep one new section `## Memory obligations that bind every agent`, placed right after *Retrieving the system-context store*, holding verbatim copies of: (W1) the Tier 3 consent rule (an Obsidian write requires prior user consent; never write without explicit consent); (W2) the two blockquotes of the MemPalace section, *MCP-only access from the agent prompt* and *Carve-out for bundled skill/agent scripts*, because workers tag friction through MemPalace and the never-shell-CLI rule binds them; plus one sentence pointing to `60-memory.md` for the full protocol. The originals stay in `60-memory.md` unchanged: the duplication is deliberate, so the move stays a pure move. The section SHALL be at most 1.6 KB.
2. **Audit record.** Other MUST/never clauses of the moved text were examined and are orchestrator-side: the Tier 1 persistence obligation, the explicit-signal rule (which says it binds the orchestrator only), the wake-up shed rule and the Memory Activation Summary row. The implementer SHALL list this audit on #1990; a clause found worker-side is added to the section by a further delta, not silently.
3. **Calibration of arm-A scenarios (R9), reasons recorded.**
   - S1: a Bash call before the checkpoint write is not a task call when it is read-only. Allowlist: `git status|log|diff|show|rev-parse`, `git branch` with display flags only, `ls`, `cat`, `pwd`, floor-guard and usage-task calls; chains joined by `;`, `&&` or `||` of read-only segments are allowed. Pipes, redirections, substitutions, `&`, newlines, `git branch <name>`, `git diff --output`, Edit and Write still fail. Reason: in run 1 all six failures (2 in arm A, 4 in arm B) were a read-only `git branch --show-current; git log; git status` before the checkpoint write; reading state does not violate a rule whose point is that search and checkpoint precede any state-changing call. Re-scoring the run 1 transcripts with this criterion gives arm A 5/5.
   - S6: the prompt SHALL state that the migration spans several sessions and will be resumed later, and name the plan sections; the criterion is unchanged. Reason: the original prompt gave no multi-session context, so persisting the plan was never indicated and nothing asked for the criterion's sections. Arm A control after calibration: 4/5 (one run blocked by an API safeguards message, scored `invalid` and rerun).
   - S7: the prompt SHALL state the friction signal as facts: `task lint` failed with `oxlint: command not found`, the user said to install it, it failed again with the same error (the second time the tool surprised us); the criterion is unchanged. Reason: the old prompt carried no recognisable friction signal (the `harness-report` skill was already installed). Arm A control: 4/4.
4. **Control arm first.** The arm A control of each of S1, S6 and S7 MUST pass before arm B is compared. S2 to S5 and S8 are unchanged (S5's prompt and criterion are unchanged by design). Calibration used arm A runs only, at most 6 per scenario.
5. **Budget bookkeeping.** Spent so far: 3.67 USD in run 1 plus about 1.8 USD of calibration and verification runs. The rerun of all 8 scenarios x 2 arms (extension rule: 5 runs per arm on disagreement or divergence) SHALL stay within the remaining cap of 12 USD total; exceeding it needs coordinator approval. A residual regression blocks the merge.

**Scenario:** Worker keeps the consent rule

Given a worker started with the worker profile, which excludes `60-memory.md`
When  its loaded rules are inspected, and when it is asked to write an Obsidian note
Then  the `## Memory obligations that bind every agent` text (consent before an Obsidian write, MCP-only access, bundled-script carve-out) is loaded, and no `obsidian_create_note` or `obsidian_edit_note` call precedes consent

**Scenario:** Control arm must pass

Given the arm A control of S1, S6 or S7 fails its criterion
When  the runner is about to compare arm B for that scenario
Then  arm B is not compared, the scenario is recalibrated on arm A, and the failure is recorded on #1990

**Scenario:** Duplicated text is byte-equal

Given the R2 mechanical check runs on the two files
When  it drops the new section from `60-tools.md` (present exactly once, within 1.6 KB) and concatenates the files in `main` order
Then  the result equals `main`'s `60-tools.md`, and each W1/W2 copy is byte-equal to its original in `60-memory.md`

## MODIFIED

Original requirement 1 (end of the first sentence): "...*Idiomatic French*." (the list of sections that stay in `60-tools.md`).

Replacement: the list is unchanged and gains the new section `Memory obligations that bind every agent` (ADDED 1), which is not a moved section.

Original requirement 2 (mechanical check): "reversing N and removing the P sentences from the two files and concatenating them in `main` order MUST reproduce today's `60-tools.md` byte-for-byte."

Replacement: "reversing N, removing the P sentences and dropping the section `Memory obligations that bind every agent` from `60-tools.md` before concatenating them in `main` order MUST reproduce today's `60-tools.md` byte-for-byte; the section MUST be present exactly once and each copy byte-equal to its original in `60-memory.md`." The section is an additional permitted edit, bounded by ADDED 1.

Original requirement 6: "...the total over both files MUST be at most 24,686 B plus 450 B (the R2 pointers) plus 8 B (normalisation N) plus 30 B for the new title, and the check MUST pass."

Replacement: the ceiling is `25,174 B + section size` (24,686 + 450 + 8 + 30 = 25,174), with the section at most 1.6 KB; the 27,800 B budget SHALL NOT change and the total MUST still pass it.

Original requirement 9, scenarios 1, 6 and 7: replaced by the criteria of ADDED 3 (S1 criterion widened to read-only calls, S6 and S7 prompts restated, criteria of S6 and S7 unchanged).

Original requirement 8 (12 USD cap): unchanged; ADDED 5 records the spend already counted against it.

## REMOVED

None.
