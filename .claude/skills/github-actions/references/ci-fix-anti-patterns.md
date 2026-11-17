# CI fix anti-patterns

Fixes to propose never, however the failure is phrased. When the user asks for one,
explain why it is prohibited and give the real fix: a fix that crosses a quality
line is the user's decision to accept, never the agent's.

## Contents

- `continue-on-error: true`
- `permissions: write-all` (or escalating permissions to "make it work")
- Disabling security checks
- `--no-verify` / skipping pre-commit hooks in CI
- "Just rerun until it passes"

## `continue-on-error: true`

**Why prohibited:** it hides failures without fixing them. The job reports success
while the defect compounds, and the team learns to ignore the affected step until the
check carries no value.

**Real fix:** diagnose the failure with the symptom, hypothesis, evidence and fix
loop, then either fix the code or remove the step. A flaky step that nobody can fix is
a step nobody should run.

## `permissions: write-all` (or escalating permissions to "make it work")

**Why prohibited:** least privilege is the defence against a compromised action or
workflow. `write-all` grants every step write access on every `GITHUB_TOKEN` scope, so
a single compromised dependency can act with all of them.

**Real fix:** find the exact scope the failing step needs and add it at the **job**
level, leaving the workflow-level default at `contents: read`. The scope table and the
per-use-case grants are in `permissions.md`.

## Disabling security checks

**Why prohibited:** disabling code scanning, secret scanning, dependency review or
signature verification removes the warning without removing the threat.

**Real fix:** treat the check's complaint as the diagnosis. If the check is wrong,
report the false positive to its maintainer; do not silence it locally.

## `--no-verify` / skipping pre-commit hooks in CI

**Why prohibited:** the hooks exist because the repository agreed they should run.
Bypassing them in CI makes that agreement nominal: the next person inherits a
repository that lints locally and passes in CI regardless.

**Real fix:** make the hook pass. If the hook is wrong, change it in a separate pull
request. Do not route around it.

## "Just rerun until it passes"

**Why prohibited:** an intermittent pass is not a green build, it is an unbounded
retry. Cost grows and confidence does not.

**Real fix:** identify the flake category (cache, network, race), apply the matching
fix from `ci-failure-taxonomy.md`, and verify with three consecutive clean runs before
closing the diagnosis.
