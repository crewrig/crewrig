---
id: "0126"
slug: claim-gate-tree-convergence
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 779
version: 1.0.0
---

# The command a claim wraps runs in the tree the gate certified

## Intent

`scripts/worktree-claim.sh` refuses a whole-tree git operation while the
worktree carries uncommitted work — the gate that `specs/0114-shared-worktree-agent-isolation.md`
requirements 2 and 4 exist to provide. The gate reads one tree. The command
`run` wraps executes in another whenever the two are allowed to differ, because
a wrapped command is a child process and inherits the working directory of
whoever invoked the script, while the gate reads the toplevel named by
`CREWRIG_REPO_DIR`. Point that variable at one tree while standing in another
and the result is a clean bill of health for a tree nobody was about to touch.

This is not hypothetical. It happened during the implementation of #736: the
gate passed against a temporary fixture while `git clean -fdx` ran against the
real `.worktrees/736`. Nothing was lost, and the reason is worth stating
exactly — that worktree happened to carry no untracked or ignored files at that
moment. Luck, not a safeguard.

After this spec, the tree the gate certifies and the tree the wrapped command
acts on are **the same tree, always, with nothing to configure and nothing to
check**. The divergence stops being a condition that must be detected and
becomes a state the mechanism cannot enter.

## Requirements

1. `scripts/worktree-claim.sh run` SHALL execute the wrapped command with its
   working directory set to the toplevel that the clean-tree gate evaluated.
2. Requirement 1 SHALL hold unconditionally: whether or not `CREWRIG_REPO_DIR`
   is set, and whatever working directory the caller invoked the script from. A
   rule that applies only when a divergence is detected is a second code path
   that can itself be wrong; the guarantee is worth more than the compatibility
   it costs.
3. A consequence of requirement 2 SHALL be accepted deliberately: a `run`
   invoked from a subdirectory of the worktree executes its wrapped command at
   the worktree root, so a wrapped command naming a relative path resolves that
   path against the root rather than against the caller's directory. This is a
   breaking change to the `run` contract and SHALL be documented as one.
4. The exit-code contract of `run` SHALL be unchanged — the wrapped command's
   own status propagates, and the refusal codes keep their current meaning.
   This spec changes where the wrapped command executes and nothing else about
   what `run` returns.
5. The subcommands that wrap no command — `take`, `release`, `takeover`,
   `status`, `history` — SHALL be unaffected. They launch no child process, so
   they have no working directory to reconcile, and `CREWRIG_REPO_DIR` keeps its
   present meaning for them: which repository this script inspects.
6. The `Environment` block in the script header SHALL state the contract
   requirements 1 through 3 establish. Its current text describes the divergence
   as a permanent boundary of the mechanism, which will be false once this spec
   is realized, and a header that documents a hazard the code no longer has is
   worse than one that documents nothing.
7. A regression case SHALL cover requirement 1 against a divergence: the
   override naming one repository while the caller stands in another, asserting
   that the wrapped command acted on the certified tree and left the caller's
   tree untouched. The assertion SHALL be a mutation the case observes, not a
   diagnostic string the case reads. This case SHALL fail against the behaviour
   that precedes this spec.
8. A regression case SHALL cover requirement 3: a `run` invoked from a
   subdirectory of the worktree, asserting the wrapped command's working
   directory is the worktree root. The accepted consequence is pinned by a test
   or it is not accepted, only asserted.
9. The existing coverage of `CREWRIG_REPO_DIR` for a subcommand that wraps no
   command SHALL be preserved, so that requirement 5 is held by the suite rather
   than by intention.
10. `docs/agent-team-protocol.md` → *Worktree Isolation* SHALL state the working
    directory a wrapped command runs in, because that document is where an agent
    reads how to invoke the mechanism and it currently says nothing on the
    subject.

## Scenarios

**Scenario:** the divergence that misled an agent no longer exists

```text
Given a repository A that is clean and a worktree B that is clean
And   a caller standing in B with the override naming A
When  the caller runs a wrapped command that creates a file
Then  the file exists in A, the tree the gate certified
And   B is unchanged
```

**Scenario:** the ordinary invocation is unaffected

```text
Given an agent standing at the root of a clean ticket worktree
And   no override set
When  the agent wraps a whole-tree git operation in a claim
Then  the operation runs in that worktree exactly as before
And   the wrapped command's exit code is propagated unchanged
```

**Scenario:** the accepted consequence, pinned

```text
Given an agent standing in a subdirectory of a clean ticket worktree
When  the agent wraps a command that reports its working directory
Then  the reported directory is the worktree root, not the subdirectory
```

**Scenario:** a dirty tree is still refused before anything executes

```text
Given a ticket worktree carrying an uncommitted change
When  an agent wraps any command in a claim
Then  the command does not execute
And   the refusal names the tree it read and exits 5
```

## Out of scope

- **The meaning of `CREWRIG_REPO_DIR` in the eleven other scripts that read
  it.** They default to the repository root derived from their own location and
  mean "which repository to inspect"; none of them launches a child command
  whose working directory could diverge from that answer. This spec changes one
  script's contract, not a repository-wide convention.
- **Refusing a divergence.** An ancestor check that rejects a caller standing
  outside the certified tree was considered and rejected: it leaves the
  divergence reachable as a refusal path, where requirements 1 and 2 leave it
  unreachable. Note for the record that the reason #779 gives for not taking
  that path — that it would break a regression suite driving its fixtures
  through the divergence by design — does not hold: exactly one case in
  `scripts/tests/test-worktree-claim.sh` sets the override, and it wraps no
  command. The path was rejected on the strength of the alternative, not on that
  cost.
- **Announcing the certified tree in the gate's diagnostic.** Also considered
  and rejected. It makes the divergence observable to an operator who reads the
  output rather than impossible, which is the shape of defect this repository
  already carries in several open tickets.
- **Blocking a prohibited command that never goes through this script.**
  `specs/0117-tool-boundary-command-guard.md` (issue #771) owns that surface and
  delegates its decision to this script, which is why this spec is upstream of
  it.
- **The overlap between `run`'s own refusal codes and a wrapped command's exit
  status.** Reported and deliberately not resolved in #773; unchanged here, per
  requirement 4.

## Open questions

None. The one design question the ticket posed — whether `CREWRIG_REPO_DIR` is
a test-harness affordance permitted to diverge from the caller's directory or a
repository override that must agree with it — is answered by requirements 1 and
2: neither. The variable keeps naming the tree, and the tree stops being
something a command can escape.
