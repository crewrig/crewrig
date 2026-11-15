# ADR-0026: Allow a standing merge authorisation given in advance

<!-- crewrig-doc: section=architecture-adr nav_order=260 published=true title="ADR 0026 — Allow a standing merge authorisation given in advance" -->

## Status

Accepted

Amends the merge-authorization gate of `docs/interaction-modes.md`
(spec 0101 delta-01, R10 and R13). Spec 0101 delta-02, issue #1984.

## Context

`AGENTS.md` forbids merging a pull request without the owner's permission
just before the merge. On a multi-ticket run that costs one owner round trip
per pull request, and the time and tokens of agent runs are what #1984 aims to
cut. Delta-01 made the gate un-waived outside its one-file spec-PR carve-out,
so an owner who has already approved a batch cannot say so without
contradicting the written rule.

## Decision

An explicit standing merge authorisation, given by the owner in advance and
naming the tickets or batch it covers for the current run only, lets a merge
proceed with no just-before ask. Three conditions always apply and the owner
may add but never remove one: no blocking finding in the latest review pass,
every required check green, the branch up to date with `main`. If one is
unmet, the just-before ask applies. The coordinator relays the authorisation
verbatim in the worker brief; a denied merge is retried once, then escalated
to the owner, never delegated. Without an authorisation the rule is unchanged
in every mode, `AUTO` included. The normative text lives in
`docs/interaction-modes.md`, tool-agnostic.

## Consequences

- Positive: an owner who approved a batch is asked nothing more per PR.
- Negative: the gate now has two carve-outs to keep from drifting into a
  general waiver; nothing enforces the conditions in CI or a hook.
- Neutral: the one-file spec-PR discharge (delta-01 R9) is unchanged.

## Alternatives rejected

- **Per-PR just-before permission only.** Keeps the gate uniform but costs one
  owner round trip per pull request on every multi-ticket run.
- **Batched just-before permission.** One ask per group of merge-ready PRs
  still blocks the run on the owner each time, and does not let the owner
  decide once, up front, for the whole run.
