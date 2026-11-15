---
id: "0308"
slug: split-tools-rule-by-audience
status: implemented
complexity: standard
interaction-mode: AUTO
related-issue: 1990
version: 1.1.0
---

# Split the tools rule by audience

This delta amends requirements 1, 2, 6 and 9 of spec 0308 after run 1 of the paired A/B (3.67 USD spent) found one design defect (scenario 5) and three scenario-calibration problems (scenarios 1, 6, 7). Requirement 8 is not amended: its 12 USD cap and extension rule stand, and ADDED 5 only records spend against it. Owner decision: https://github.com/crewrig/crewrig/issues/1990#issuecomment-6885442346. Version bump `1.0.0` to `1.1.0` (MINOR): one section joins the contract and three scenarios are recalibrated; no in-flight implementation is invalidated. Run 1 results stay recorded on #1990 as run 1, not deleted. Every size below is in decimal bytes, as `wc -c` counts.

## ADDED

1. **Section that binds every agent.** Moving the Obsidian protocol to the orchestrator-only `60-memory.md` removed the consent obligation from workers, who no longer load it. `60-tools.md` SHALL keep one new section `## Memory obligations that bind every agent`, right after *Retrieving the system-context store*, holding: (W1) a one-line Obsidian lead-in plus the Tier 3 Write bullet pair, from "User-controlled only" to "explicit consent.", copied byte-equal from *Memory Architecture* in `60-memory.md`; (W2) the two blockquotes of the MemPalace section, *MCP-only access from the agent prompt* and *Carve-out for bundled skill/agent scripts*, byte-equal (workers tag friction through MemPalace, so the never-shell-CLI rule binds them); and one sentence pointing to `60-memory.md`. Originals stay in `60-memory.md` unchanged: the duplication is deliberate, so the move stays a pure move. The implemented section measures 1,475 B; the cap is 1,600 B.
2. **Audit.** Other MUST/never clauses of the moved text were examined and are orchestrator-side: the Tier 1 persistence obligation, the explicit-signal rule (it says it binds the orchestrator only), the wake-up shed rule, the Memory Activation Summary row, and *Memory Activation Protocol* step 2 "persist continuously" (a worker persists nothing but friction tags, which W2 covers; scenario 2 requires workers to write no drawer). The implementer SHALL list the audit on #1990; a worker-side clause found later is added by a further delta.
3. **Scenario 1 criterion, exact and closed.** A Bash call before the checkpoint write is not a task call only if every segment, split on `;`, `&&` and `||`, is exactly one of: `git status`, `git log`, `git diff`, `git show`, `git rev-parse`, `git branch` (alone, or with only `--show-current`, `-a`, `-r` or `--list`), `ls`, `cat`, `pwd`, each with only flags from a closed per-command set, or `node scripts/lib/node-floor-guard.js` alone. Anything else fails: pipes, redirections, substitutions, `&`, newlines, `git branch <name>`, `--output`, `--ext-diff`, `--textconv`, `-c`, `-C`, `--exec-path`, any global option before the subcommand, any `usage-task` form (`set` writes a declaration), Edit and Write. Reason: in run 1 all six failures (2 in arm A, 4 in arm B) were a read-only `git branch --show-current; git log; git status` before the checkpoint write; reading state does not violate a rule whose point is that search and checkpoint precede any state-changing call. The rescore of both arms' run 1 transcripts under this criterion is recorded on #1990 before the rerun, so the change is visibly not chosen to remove an arm B gap. The per-command closed flag sets are held by `scripts/lib/rules-split-ab/criteria.ts`, which is the authority and is frozen with the criteria.
4. **Scenarios 6 and 7, prompts restated, criteria unchanged.** S6: the prompt states that the migration spans several sessions and will be resumed later, and names the plan sections; the original gave no multi-session context, so persisting the plan was never indicated. Arm A control after calibration: 4/5 (one run blocked by an API safeguards message, scored `invalid`, rerun). S7: the prompt states the friction signal as facts (`task lint` failed with `oxlint: command not found`, the user said to install it, it failed again with the same error: the second time the tool surprised us); the old prompt carried no recognisable friction signal. Arm A control: 4/4. S2 to S5 and S8 are unchanged. Calibration used arm A runs only, at most 6 per scenario.
5. **Thresholds and freeze.** The control arm (A) SHALL pass at least 4 of 5 runs of each of S1, S6 and S7 (all runs when fewer ran, none `fail`) before arm B is compared. Criteria and prompts are frozen when this delta merges; any later change needs a new delta spec-PR.
6. **Budget.** Spent: 3.67 USD in run 1 plus about 1.8 USD of calibration and verification, leaving approximately 6.5 USD of the 12 USD cap; the runner ledger is authoritative. The rerun of all 8 scenarios x 2 arms (extension: 5 runs per arm on disagreement or divergence) SHALL fit it; exceeding the cap needs coordinator approval. A residual regression blocks the merge.
7. **Scenario 5, observed and not assumed fixed.** Run 1 result: arm B created an Obsidian note without consent in 3 of 5 runs, although S5 scores orchestrator arms only and arm B loaded both files, so the consent text was present in the failing arm. No mechanism is established, and the duplication cannot be shown to cure this divergence. The section of ADDED 1 is a design requirement in its own right (worker obligations must be visible to workers), decided by the owner. S5's prompt and criterion are unchanged; its divergence on the rerun is measured, and if it persists it is a regression that blocks the merge.

**Scenario:** Worker keeps the consent rule

Given the worker profile `worker.settings.json` and the rules of `artifacts/core/rules/`
When  a node test (no model call) computes the worker's loaded rule set from the profile excludes and reads `60-tools.md`
Then  `60-tools.md` is loaded, `60-memory.md` is excluded, and `60-tools.md` holds the W1 and W2 texts byte-equal to their originals in `60-memory.md`

**Scenario:** Control arm must pass

Given the arm A control of S1, S6 or S7 passes fewer than 4 of 5 runs
When  the runner is about to compare arm B for that scenario
Then  arm B is not compared, and the failure is recorded on #1990 for a new delta

**Scenario:** Mechanical check with the new section

Given the two rule files after the split
When  the R2 check drops the new section from `60-tools.md` (present exactly once, at most 1,600 B) and concatenates the files in `main` order
Then  the result equals `main`'s `60-tools.md`, and the total passes the R6 ceiling

## MODIFIED

Original requirement 1 (list of sections that stay in `60-tools.md`, ending "*Idiomatic French*."): unchanged and gains `Memory obligations that bind every agent` (ADDED 1), which is not a moved section.

Original requirement 2 (mechanical check): "reversing N and removing the P sentences from the two files and concatenating them in `main` order MUST reproduce today's `60-tools.md` byte-for-byte."

Replacement: "reversing N, removing the P sentences and dropping the section `Memory obligations that bind every agent` from `60-tools.md` before concatenating them in `main` order MUST reproduce today's `60-tools.md` byte-for-byte; the section MUST be present exactly once, at most 1,600 B, with W1 and W2 byte-equal to their originals."

Original requirement 6: "...the total over both files MUST be at most 24,686 B plus 450 B (the R2 pointers) plus 8 B (normalisation N) plus 30 B for the new title, and the check MUST pass."

Replacement: the ceiling is `25,174 B + section size`, at most 25,174 + 1,600 = 26,774 B; the implemented total is 26,414 B. The 27,800 B budget does not change and the check MUST pass.

Original requirement 9, scenarios 1, 6 and 7: replaced by ADDED 3 and 4 (criteria of S6 and S7 unchanged).

## REMOVED

None.
