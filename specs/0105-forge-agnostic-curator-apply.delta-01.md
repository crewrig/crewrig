---
id: "0105"
slug: forge-agnostic-curator-apply
status: draft
complexity: small
related-issue: 671
version: 1.1.0
---

# 0105 — forge-agnostic-curator-apply (delta-01)

This delta resolves a `class: spec` finding raised by a cold PLAN review:
an internal contradiction in spec 0105 between its Requirement 1 and its
`## Out of scope` section over how a self-hosted GitLab host is recognized.
R1's third forge-selection clause is a normative `SHALL` — *"a host
configured as a self-hosted GitLab instance selects `glab`"* — yet the
second `## Out of scope` bullet excludes *"ambiguous-host resolution beyond
the deterministic host rule in R1 (including an optional self-hosted-GitLab
host override)"*. A reader cannot tell whether recognizing a self-hosted
GitLab host is a required behavior (per R1) or an excluded one (per the
parenthetical), which is the tie the review flagged.

The correction blesses one deterministic realization of R1's third clause
and narrows the exclusion to match. R1's third clause is satisfied by a
**deterministic, default-unset, environment-configured allowlist of
self-hosted GitLab host names** — a host present in that allowlist is
treated as GitLab and selects `glab`, with no interactive prompt and no
heuristic host probing involved. This is exactly the shape spec 0103
delta-01 R9 already established for the manual write-lock fallback ("a host
the environment is already configured to treat as a self-hosted GitLab
instance"), so the automated apply step and the manual fallback now recognize
self-hosted GitLab hosts the same way. The `## Out of scope` bullet is
narrowed so it excludes only **non-deterministic** host resolution
(auto-probing an unrecognized host to guess its forge, or interactive
ambiguous-host resolution) and no longer sweeps the deterministic allowlist
into the exclusion; the misleading "(including an optional
self-hosted-GitLab host override)" parenthetical that caused the tie is
removed.

The version bump is **MINOR** (`1.0.0` → `1.1.0`). This delta adds one
clarifying requirement (R9) and narrows an out-of-scope exclusion — both
additive with respect to the parent's normative content: R9 constrains a
case the parent left under-specified, and narrowing an exclusion brings a
previously-ambiguous behavior into scope rather than removing anything. No
existing requirement is modified in a breaking way, and there is no in-flight
implementation to invalidate — spec 0105 has not yet reached DEV — so the
MAJOR trigger of `docs/spec-format.md` → *Delta-spec convention → Versioning*
("requirement modified … in a way that invalidates an in-flight
implementation") does not apply. Every other requirement of spec 0105 — R1
through R8 — remains in force unchanged; in particular R1's first, second,
and fourth clauses (the `github.com`, `gitlab.com` / `gitlab.`-prefix, and
`tea`-default rules) are untouched. No open questions are introduced by this
delta.

## ADDED

1. **New requirement — R1's third clause is realized deterministically from
   environment configuration.** The following requirement SHALL be added to
   spec 0105's `## Requirements` (numbered R9, continuing the parent's R1–R8
   list):

   > **R9.** R1's third forge-selection clause — a host configured as a
   > self-hosted GitLab instance selects `glab` — SHALL be realized
   > deterministically from environment configuration: a default-unset
   > allowlist of self-hosted GitLab host names, supplied to the apply step
   > out of band, whose presence marks a host as GitLab. A canonical
   > repository URL whose host appears in that allowlist SHALL select `glab`;
   > no interactive prompt and no heuristic host probing (auto-detecting an
   > unrecognized host's forge kind) is implied or required by R1's third
   > clause. When the allowlist is unset — its default — no host is treated
   > as a self-hosted GitLab instance on this basis, and R1's remaining
   > clauses (the `github.com`, `gitlab.com`, and `gitlab.`-prefix rules,
   > then the `tea` default) decide the tool unchanged. This mirrors spec
   > 0103 delta-01 R9's "a host the environment is already configured to
   > treat as a self-hosted GitLab instance" and stays consistent with
   > `AGENTS.md` → *Forge Access*. The concrete environment mechanism — the
   > variable name and how it is parsed — is an implementation detail owned
   > by the plan and DEV stages, not fixed by this spec.

## MODIFIED

1. **The second `## Out of scope` bullet is replaced** to exclude only
   non-deterministic host resolution and to place the deterministic,
   environment-configured allowlist of R9 explicitly in scope.

   - Original bullet:

     > - Multi-login disambiguation when several authenticated logins exist
     >   for the same forge kind, and ambiguous-host resolution beyond the
     >   deterministic host rule in R1 (including an optional
     >   self-hosted-GitLab host override). The manual path's "prefer the
     >   already-established login" is agent judgment (spec 0103 R9) and does
     >   not apply to this automated, deterministic path.

   - Replacement bullet:

     > - Multi-login disambiguation when several authenticated logins exist
     >   for the same forge kind, and **non-deterministic** host resolution
     >   — auto-probing an unrecognized host to guess its forge kind, or any
     >   interactive or otherwise ambiguous host resolution — remain out of
     >   scope. The manual path's "prefer the already-established login" is
     >   agent judgment (spec 0103 R9) and does not apply to this automated,
     >   deterministic path. The deterministic, default-unset,
     >   environment-configured self-hosted-GitLab host allowlist that R9
     >   blesses is **in scope** and is NOT excluded here: it is a
     >   deterministic input to the R1 host rule, not the ambiguous-host
     >   resolution this bullet excludes. The concrete environment mechanism
     >   that carries that allowlist (its variable name and parsing) is an
     >   implementation detail owned by the plan and DEV stages, not fixed by
     >   this spec.

## REMOVED

(None. This delta adds one requirement — R9 — and modifies the second
`## Out of scope` bullet; it removes no requirement, scenario, or
out-of-scope item. Spec 0105's Requirements R1–R8 and all five scenarios
remain in force unchanged.)
