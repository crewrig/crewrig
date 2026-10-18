---
id: "0269"
slug: progressive-disclosure-skills
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 1726
version: 1.1.0
---

# Progressive disclosure for skills and agents

This delta amends requirement 12 of spec 0269 for the `harness-report` skill
only. Measured on the implementation of #1726, `harness-report/SKILL.md` is
5,036 B and its always-loaded reference `references/identify-and-route.md` is
1,643 B, so the combined count is 6,679 B against the 5,120 B (5 KB) epic #1724
acceptance criterion. The reference holds steps 1 and 2 and the step-3 payload,
which every tag needs, so it is read at step 1 of every activation. The
combined rule of requirement 12 therefore cannot be met without breaking
requirement 14.

Version bump: `1.0.0` to `1.1.0` (MINOR). The delta changes how one budget is
measured and adds a ceiling; it keeps all four budgets and invalidates no
in-flight implementation, since the measured implementation already satisfies
the amended text.

## ADDED

13a. The combined size of `harness-report/SKILL.md` and its unconditionally
loaded reference `references/identify-and-route.md` SHALL be at most 7,168 B,
measured with `wc -c`. The size-budget test `scripts/tests/skill-size-budgets.test.ts`
SHALL assert this ceiling and fail when it is exceeded, so growth of the
reference is bounded.

**Scenario:** Always-loaded reference grows past the combined ceiling

Given `harness-report/SKILL.md` measures 5,036 B and `references/identify-and-route.md` grows to 2,200 B
When  `scripts/tests/skill-size-budgets.test.ts` runs
Then  the combined 7,236 B exceeds 7,168 B, the test fails, and the reference is trimmed or split before merging

## MODIFIED

Original requirement 12:

> Requirement 12: after this spec is implemented, the `SKILL.md` body sizes SHALL be at most
> 12 KB for `spec-author`, 10 KB for `pr-reviewer`, 8 KB for `user-validate`
> and 5 KB for `harness-report`, measured with `wc -c`. Any reference file
> loaded unconditionally at activation, rather than at a later step or
> under a condition, SHALL count toward its skill's budget.

Replacement:

> Requirement 12: after this spec is implemented, the `SKILL.md` body sizes SHALL be at most
> 12 KB for `spec-author`, 10 KB for `pr-reviewer`, 8 KB for `user-validate`
> and 5 KB (5,120 B) for `harness-report`, measured with `wc -c`. For
> `spec-author`, `pr-reviewer` and `user-validate`, any reference file loaded
> unconditionally at activation, rather than at a later step or under a
> condition, SHALL count toward its skill's budget, unchanged. For
> `harness-report`, the budget SHALL be measured on the `SKILL.md` body alone;
> its reference `references/identify-and-route.md` is an explicitly documented
> unconditionally loaded reference, read at step 1 of every activation, and is
> bounded by the combined ceiling of requirement 13a instead.

Decision record (AUTO):

- Measured: `SKILL.md` 5,036 B; reference 1,643 B; combined 6,679 B.
- Rejected: dropping or paraphrasing rules to fit 5,120 B combined, because it violates requirement 14.
- Rejected: raising the `harness-report` cap, because it loosens the epic acceptance criterion.
- Rejected: merging the reference back inline, because it saves nothing.
- Risk: the reference could grow without bound while escaping the body budget. Mitigation: the combined ceiling of requirement 13a, asserted by `scripts/tests/skill-size-budgets.test.ts`.

## REMOVED

None.
