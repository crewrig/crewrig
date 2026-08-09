---
id: "0109"
slug: spec-status-invariant-on-main
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 768
version: 2.1.0
---

# 0109 — spec-status-invariant-on-main (delta-03)

Spec 0109 exists to remove one failure mode: a check whose green does not mean it
checked. Its own implementation reproduces that failure mode. Run the linter from
a subdirectory and the base-branch `status: draft` check finds **no offenders at
all** — not skipped with a notice, not reported as an environment fault, but
`Linting passed!` and exit `0` while the violation sits on the base branch.

Measured on `main` at `dca7f6d`, one throwaway repository, one non-delta spec
present on the base branch carrying `status: draft` under `sub/specs/`:

| Working directory | Result |
|---|---|
| `sub/` (which carries its own `.markdownlintrc`) | `Linting passed!`, exit **0** — the offender is not reported |
| the repository root | the offender is named, exit **1** |

Same repository, same spec, same base ref. The cause is that both sets the check
derives are resolved against the **process working directory**:

- `baseBranchPaths()` passes repo-root-relative paths as pathspecs to
  `git ls-tree`, which resolves a pathspec relative to the current directory
  unless `--full-name` is given. From a subdirectory it matches nothing and
  returns an empty set, so no file is ever identified as present on the base
  branch.
- `changedPaths()` runs `git diff --name-only`, which is root-relative under
  default configuration but becomes cwd-relative — and silently omits files
  outside the current directory — when `diff.relative=true`.

**Nothing exotic is required.** No unusual git configuration, no code change, no
CI change: a `.markdownlintrc` beside a nested `specs/` directory is enough. That
is a plausible adopter layout rather than a contrived one — nested spec
directories are an established pattern in this repository (`specs/org/`, per
`specs/0071-org-specs-lint-exclusion.md`).

**What was believed before this was measured, recorded because the belief is the
interesting part.** Issue #768 was filed — by the author of delta-02, immediately
after it merged — asserting this hazard was *unreachable*, on the reasoning that
`spec-linter.js` passes `-c .markdownlintrc`, that this path is cwd-relative, and
that therefore any run outside the repository root aborts before the check
executes. Every step of that is true. The conclusion does not follow, because it
assumes the only `.markdownlintrc` in existence is the one at the repository root.
The lesson generalises past this spec: *unreachable* is a claim about every path,
and a sketch covering the paths one thought of is not a proof of it.

The version bump is **MINOR** (`2.0.0` → `2.1.0`). Working-directory independence
was previously unspecified rather than specified differently, so this delta
constrains a previously unconstrained case and modifies no existing requirement.

## ADDED

**Requirements.**

1. **Requirement 14 — the derivations are working-directory independent.** Every
   set the base-branch check derives from the repository SHALL be identical
   regardless of the working directory the linter process runs in, and regardless
   of any repository-local or user-local git configuration that changes how git
   reports paths. A spec present on the base branch carrying `status: draft` SHALL
   be identified from any working directory inside the work tree, exactly as it is
   from the root.
2. **Requirement 15 — the mechanism is structural, not per-call.** The means by
   which Requirement 14 is achieved SHALL be structural: a git invocation added to
   the linter afterwards SHALL inherit the correct working directory **without its
   author having to recognise that invocation as path-sensitive**. Per-invocation
   flags satisfy Requirement 14 for the invocations that carry them and leave the
   next author to remember, which is the precise fragility that produced this
   defect — two path-sensitive invocations, neither recognised as such by two
   separate authors. One invocation is necessarily exempt: the one that
   **discovers** the work tree must be resolved against the caller's directory,
   since it is what answers which repository the run is about.
3. **Requirement 16 — the fix is covered, and the coverage is falsifiable.**
   Requirement 14 SHALL be covered by the spec linter's own test suite, by at least
   one case that runs the linter from a subdirectory of a repository whose linted
   specs and whose markdownlint configuration both sit under that subdirectory —
   the configuration being what makes the run reach the check at all. The case
   SHALL fail if the mechanism of Requirement 15 is removed. No change to the
   linter's module interface is needed to satisfy this: the defect is reachable
   through the linter's ordinary command-line entry point, so the case is an
   ordinary invocation rather than a unit test of an exported helper.

**Scenarios.**

*Scenario:* an offender is identified from a subdirectory

```text
Given a non-delta spec present on the base branch carrying status: draft
And   that spec and a markdownlint configuration both sit under a subdirectory
When  the spec linter runs with that subdirectory as its working directory
Then  it reports a violation naming that file and exits non-zero
```

*Scenario:* git configuration cannot exempt a change from attribution

```text
Given a non-delta spec present on the base branch carrying status: draft
And   a repository configured with diff.relative=true
And   a change under test that modifies that spec
When  the spec linter runs
Then  it reports a violation naming that file and exits non-zero
```

*Scenario:* discovering the work tree still follows the caller

```text
Given a repository nested inside another directory
When  the spec linter runs with a subdirectory of that repository as its
      working directory
Then  it resolves the base branch of that repository, not of any other
```

**Out of scope,** extending the parent spec's list:

- **Making the linter as a whole working-directory independent.** The markdownlint
  invocation resolves `-c .markdownlintrc` against the working directory, and this
  delta does not change that. Requirement 14 is about the check's *derivations*
  being trustworthy wherever it runs, not about the linter gaining a new supported
  invocation style. Changing the configuration lookup is a separate concern with
  its own blast radius across the test suite's non-git fixtures, and it would have
  to land with Requirement 14 rather than before it — doing it first would widen
  the reach of the very defect being fixed.
- **Asserting that the working directory is the repository root and failing
  loudly otherwise.** It would remove the silence, and was rejected: it codifies a
  constraint instead of removing one, and leaves the check's correctness dependent
  on another subsystem's behaviour, which is the property this delta exists to end.
- **Adding a module interface to `scripts/lib/spec-linter.js`** so its helpers can
  be unit-tested. Considered while this was believed untestable through the CLI,
  and unnecessary once it was not. It remains a reasonable future change on its
  own merits and is not one this delta needs.
- **The invariant of Requirement 1, the attribution of Requirements 9 through 11,
  and every other requirement of spec 0109 and its earlier deltas.** All unchanged
  and in force. This delta makes the existing check trustworthy from any working
  directory; it changes nothing about what the check decides.

## MODIFIED

(None. Working-directory independence is an additive constraint on how the check
derives its sets, orthogonal to what any existing requirement states. In
particular Requirement 3 — that the set be derived from the repository at check
time rather than from a recorded figure — is about provenance and is satisfied
today; this delta adds that the derivation must also be independent of where the
process runs. No scenario of the parent or of delta-01 or delta-02 changes.)

## REMOVED

(None. This delta adds three requirements, three scenarios and four out-of-scope
items; it removes no requirement, scenario, or out-of-scope item. Spec 0109 has no
open question, and this delta introduces none.)
