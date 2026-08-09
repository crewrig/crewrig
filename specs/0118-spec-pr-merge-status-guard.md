---
id: "0118"
slug: spec-pr-merge-status-guard
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 766
version: 1.0.0
---

# A merge that would put a draft spec on the base branch is refused

## Intent

`specs/0109-spec-status-invariant-on-main.md` R1 states that no non-delta spec on
`main` may carry `status: draft`. Everything around that invariant is now built
except the one thing that would keep it: the invariant is **detected** after the
fact (the base branch's own build fails, `specs/0109…delta-02.md` R10) and the
blast radius of a violation has been **contained** (delta-02 R9), but nothing
prevents the merge that violates it.

The step that prevents it — the `draft` → `approved` commit that
`docs/spec-format.md` requires inside the spec-PR, before the squash — has been
omitted **twice in twenty-four hours by two different sessions**, each time
putting a `draft` spec on `main` and failing `lint-specs` repository-wide. Two
independent actors missing one step is a property of the step's position in the
procedure, not of either actor's diligence: it sits between "CI is green" and
"merge", the moment a lifecycle feels finished, with nothing standing between
those two acts.

This spec puts something between them. It is **one rule on the surface
`specs/0117-tool-boundary-command-guard.md` defines**, not a mechanism of its own
— which is what that surface's R3 exists to make possible, and the reason this
spec is small.

The rule is stated as what it protects rather than as what it pattern-matches: a
merge is refused when it **would land a non-delta spec carrying `status: draft` on
the base branch**. That is spec 0109 R1, evaluated one moment earlier than the
build that currently catches it.

## Requirements

1. A command that would merge a pull request SHALL be refused before it executes
   when the merge would result in a non-delta spec file carrying `status: draft`
   being present on the pull request's base branch.
2. The condition of requirement 1 SHALL be evaluated against the **head tree of
   the pull request being merged**, not the working tree of the agent issuing the
   command. An agent may merge from any directory, and its working tree may
   legitimately differ from the branch under merge.
3. Delta-specs SHALL be exempt, consistent with `specs/0109` R2 and with the
   deliberate non-decision recorded in that spec's *Out of scope* about what
   status a delta should carry. A rule stricter than the invariant it enforces
   would refuse merges the repository permits.
4. The `status` field SHALL be read through the **same frontmatter reader the spec
   linter uses**, not a second parser written for this rule. Two readers of one
   field is the divergence `specs/0117` R4 forbids: the guard and the linter would
   be able to disagree about whether a spec is a draft, and the guard's answer is
   the one nobody sees until it is wrong.
5. The rule SHALL be expressed as **data on the guard's rule table**, adding no
   branch to the guard's decision path, per `specs/0117` R3. If honouring this
   spec requires editing that decision path, the surface has not satisfied its own
   R3 and the defect is there rather than here.
6. A refusal SHALL name the offending spec file and SHALL state the remedy as the
   procedure that exists: record `status: approved` in a **new commit** on the
   spec-PR branch, push, then merge. A guard that refuses without naming the next
   action converts a missed step into a stuck agent.
7. When the condition of requirement 1 **cannot be determined** — the pull request
   cannot be resolved from the command, its head tree cannot be read, the forge is
   unreachable — the merge SHALL be refused, and the refusal SHALL state that the
   determination failed rather than implying a violation was found. Refusing here
   is the safe direction: the cost is a merge an operator retries or overrides,
   against a silent violation that blocks every open pull request in the
   repository. This is `specs/0117` R6 applied to this rule — an indeterminate
   evaluation denies **only** the merge command it matched, and never any other
   tool call.
8. A merge that satisfies the invariant SHALL be allowed without any additional
   step, prompt, or confirmation. The guard's cost to a conforming merge SHALL be
   its latency alone, within the budget `specs/0117` R7 requires.
9. The rule SHALL be covered by a regression suite with at least one case for each
   of: a merge landing a `draft` non-delta spec refused; the same merge allowed
   once the status is `approved`; a merge landing a `draft` **delta**-spec allowed
   (requirement 3); a merge touching no spec allowed; and an indeterminate
   evaluation refused with the determination-failed reason (requirement 7). Each
   case SHALL fail if the behaviour it covers is removed.
10. `docs/spec-format.md` → *Recording a status transition* SHALL state that the
    merge mechanic is enforced by this rule, so that a reader of the obligation
    learns it is mechanically checked rather than trusted. The mechanic's own
    wording is already correct and SHALL NOT change.

## Scenarios

**Scenario:** the omission that happened twice is now refused

```text
Given a spec-PR whose head tree carries a non-delta spec at status: draft
When  an agent issues the command that would merge it
Then  the merge is refused before it executes
And   the reason names that spec file and the new-commit remedy
```

**Scenario:** the conforming merge is untouched

```text
Given the same spec-PR after status is recorded as approved
When  an agent issues the command that would merge it
Then  the merge proceeds with no additional step
```

**Scenario:** a delta-spec at draft does not block its merge

```text
Given a spec-PR whose head tree carries only a delta-spec at status: draft
When  an agent issues the command that would merge it
Then  the merge proceeds
```

**Scenario:** an indeterminate evaluation refuses the merge and says why

```text
Given a merge command whose pull request cannot be resolved
When  the guard evaluates this rule
Then  the merge is refused
And   the reason states that the determination failed, not that a spec is draft
And   no other tool call is affected
```

## Out of scope

- **The guard surface itself.** `specs/0117-tool-boundary-command-guard.md` owns
  the mechanism, the per-CLI events, the rule-table shape and the latency budget.
  This spec adds a rule and depends on that surface existing; it specifies none of
  it. **Implementation of this spec is therefore blocked until spec 0117 is
  implemented**, which is itself waiting on `scripts/worktree-claim.sh` reaching
  `main` (`#771`, PR #773).
- **The whole-tree git prohibitions of `specs/0114`.** The other rule on the same
  surface, with a different authority. That the two share a surface and share no
  logic is the property `specs/0117` R3 is meant to demonstrate.
- **Changing the `draft` → `approved` mechanic.** It is already correct and has
  been since PR #664; requirement 10 documents that it is now enforced and changes
  no word of it. The defect was never the mechanic's content.
- **Changing spec 0109's invariant, its linter check, or the attribution of
  delta-02.** This rule enforces R1 earlier; it does not restate or amend it.
- **Deciding what status a delta-spec should carry.** Left unresolved by
  `specs/0109` on measured grounds, and requirement 3 inherits that exemption
  rather than settling it.
- **Refusing a merge for any reason other than requirement 1.** The rule is not a
  general merge policy. A merge blocked by CI, by review state, or by branch
  protection is already handled by the forge, and duplicating those checks here
  would put a second answer in front of an existing one.
- **A guard on the moment a spec-PR is *opened*.** A spec-PR under review carries
  `draft` legitimately — `specs/0109` R2 has always exempted it and delta-02 keeps
  it exempt. Only the merge is the wrong moment for `draft`, which is why this rule
  attaches there and nowhere earlier.

## Open questions

None.
