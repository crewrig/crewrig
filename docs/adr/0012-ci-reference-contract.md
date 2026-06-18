# ADR 0012 — CI capability reference contract

<!-- crewrig-doc: section=architecture-adr nav_order=120 published=true title="ADR 0012 — CI capability reference contract" -->

**Status:** Proposed (issue #371; keystone of the multi-engine CI/CD parity EPIC #368)

## Context

Multi-engine CI/CD parity (spec 0046, EPIC #368) needs one engine-neutral
description of what the project's CI does *before* any engine's pipeline can
be generated (sub-spec B) or drift-checked (sub-spec C). Today the CI lives
only as GitHub Actions YAML (`.github/workflows/*.yml`); there is no neutral
source of truth, so a second engine could only be hand-translated, with no way
to detect divergence. [Spec 0047](../../specs/0047-ci-capability-reference.md)
requires a single reference (stable id, neutral trigger, portability mark)
plus a normative description of its own shape (R1–R9), and a traceability id
by which any engine's job attributes to exactly one capability (R6) — readable
by the `yq` parser sub-spec C uses.

## Decision

Introduce `ci/ci-capabilities.yml`, a platform-neutral YAML reference: one
entry per CI job, each with a stable `id`, a `trigger` from a closed neutral
vocabulary (`push`, `pull-request`, `tag`, `scheduled`, `manual`) with
portable filters (`branches`, `paths`, `tag-pattern`), a
`portability: portable|specific` mark, and an evidence-backed `exception` per
`specific` entry. Job-to-capability traceability (C2): the capability `id` IS
the pipeline job's YAML key on every engine — read via `yq '.jobs | keys'`
(GHA) or top-level keys-minus-reserved (GitLab), with a trailing key-comment
`# ci-capability: <id>` fallback for engine-reserved job names (GitLab
`pages`). The shape is described normatively in
[`docs/ci-reference-format.md`](../ci-reference-format.md), which pins the
exact extraction expressions. YAML is chosen because `yq` is already a CI
dependency; no new validation toolchain enters. `ci/` is a new top-level
core-layer path, registered in [`docs/layers.md`](../layers.md) and
`.crewrig/core-paths.txt`.

## Alternatives considered

- **C2 as an own-line YAML comment on the job node** — rejected: empirically
  unreadable by `yq` v4.53.3 (`line_comment` / `head_comment` / `foot_comment`
  all return empty on the job node); only reachable via a brittle,
  position-dependent sibling-relative path.
- **C2 as a custom data field in the job map** (`jobs.<id>.ci-capability`) —
  rejected: `actionlint` and GitLab CI lint reject unknown job keywords; the
  only valid variant degrades to a sidecar id→jobs file, a second artifact to
  keep in sync — the exact drift C2 exists to remove.
- **C2 as a trailing key-comment** (`<job>: # ci-capability: <id>`) — proven
  readable (`yq '.<job> | key | line_comment'`), retained only as the fallback
  for engine-reserved job names; not primary because it duplicates the id and
  can silently disagree with the job key.
- **JSON Schema reference instead of YAML + a prose format doc** — rejected:
  introduces a validator toolchain absent from CI today, against the YAML/`yq`
  decision; validity is enforced by sub-spec C's checker against the four spec
  scenarios.
- **Reference under `.github/`** — rejected: frames the neutral contract as
  GitHub-owned, contradicting R9 and the platform-neutrality intent.

## Consequences

- B and C build against a frozen C1/C2: B names each generated portable job by
  its `id` and hand-authors the `specific` jobs; C reads `.jobs | keys` and
  fails closed on undocumented drift or untraceable jobs.
- `id == job key` couples capability rename and job rename into one act — they
  cannot silently diverge; the cost is that a job key is constrained to the id
  charset and the GitLab-reserved-name fallback is needed for `pages`.
- The engine × capability axis is self-documented by the YAML, distinct from
  the CLI × feature matrix; [`docs/cli-matrix.md`](../cli-matrix.md) carries
  one cross-reference row, not an engine sub-table.
- Adding a third engine requires only a new mapping from the neutral
  vocabulary and naming its jobs by the existing ids — no capability
  definition changes (R9).
- `ci/` joining the core manifest means adopters receive the reference on sync
  and `check-core-paths.sh` guards it.
