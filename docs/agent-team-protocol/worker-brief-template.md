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
`docs/agent-team-protocol/orchestrator.md` apply in full. Reference them; do
not paraphrase.

## Merge, pre-authorised by the owner through the coordinator

Squash-merge yourself, without asking, when ALL hold:

- the latest review pass has no blocking finding;
- every required check is green (a ghost check counts as resolved);
- the branch is up to date with <target branch>, re-verified in CI.

This is the `AGENTS.md` merge permission given in advance under these
conditions only. If the merge is denied, retry once, then escalate to the
coordinator. Never delegate it. After merging, follow
`docs/post-merge-flow.md` and close the issue.

## Final report: evidence list

- PR number and merge SHA.
- Links to each review verdict.
- Tests shown failing before and passing after: command and one-line result.
- Version bumps.
- Paid measurements: count, status, cost.
- Frictions met.
- A failure to merge (red CI you cannot fix, review cap hit, permission
  denied twice) is a failed task: report it with the blocker.
```
