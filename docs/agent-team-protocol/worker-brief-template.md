# Agent Team Protocol — Worker brief template

<!-- crewrig-doc: published=false -->

Reusable brief a coordinator sends to each worker session of a multi-ticket
run (see _Coordinator playbook_ in [`orchestrator.md`](orchestrator.md)). Fill
every placeholder before sending it; a worker never decides a field left open.

```markdown
# Worker brief — <ticket or ticket group>

Implement <issue URL>. The issue body is the contract.

## Sizing (decided by the coordinator, do not re-decide)

- Tier: <trivial | small | standard | large>
- Spec: <none | spec required | delta-spec of <spec id>>
- Interaction mode: <FULL | INTERMEDIATE | MINIMAL | AUTO>
- Branch: <prefix>/<NNNN>-<slug>

## Scope

- You may edit: <paths>
- Out of bounds: <paths, files, and anything that needs a question first>
- If another file must change for consistency, ask the coordinator first.

## Paid-eval budget

- One measurement per changed skill: <N> in total.
- Read the grading output before any re-run.
- Ask the coordinator before going beyond the budget.

## Hygiene rules

The sections _Waiting rules in a worker brief_ and _Output hygiene and
stage-scoped sessions in a worker brief_ of
`docs/agent-team-protocol/orchestrator.md` apply in full. The coordinator
pastes their bullets here verbatim; no paraphrase.

<verbatim bullets of both sections>

## Merge: report merge-ready, never merge

You do not merge. When ALL hold, report the PR as merge-ready and stop:

- the latest review pass has no blocking finding;
- every required check is green (a ghost check counts as resolved);
- the branch is up to date with <target branch>, re-verified in CI.

The coordinator asks the owner for permission, then executes the merge. After
the merge, follow `docs/post-merge-flow.md` and close the issue only if the
coordinator asks you to.

## Final report: evidence list

- PR number and merge SHA.
- Links to each review verdict.
- Tests shown failing before and passing after: command and one-line result.
- Version bumps.
- Paid measurements: count, status, cost.
- Frictions met.
- A PR that cannot become merge-ready (red CI you cannot fix, review cap hit)
  is a failed task: report it with the blocker.
```
