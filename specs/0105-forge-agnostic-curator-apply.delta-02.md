---
id: "0105"
slug: forge-agnostic-curator-apply
status: draft
complexity: small
related-issue: 1273
version: 1.2.0
---

# 0105 — forge-agnostic-curator-apply (delta-02)

This delta is driven by issue #1273, not by a retroactive review-loop
finding against the spec's original ticket (#671) — it is a companion
correction authored alongside spec
[0228](0228-curator-title-gitmoji.md), which changes `curate.py` to prefix
every composed issue title with a per-room Gitmoji. That change is
otherwise silently incompatible with spec 0105's Requirement 5 (unmodified
by [delta-01](0105-forge-agnostic-curator-apply.delta-01.md), which touched
only R1's third clause and the `## Out of scope` section): R5 decides the
`--dedup` skip on the canonical title prefix `Friction cluster: <key> (`,
and `apply.py`'s `_match_existing` currently realizes that decision with an
exact `title.startswith(...)` check anchored at column 0. Once `curate.py`
starts emitting `<emoji> Friction cluster: …` titles, that exact check never
matches a newly-composed title again — dedup fails open for every new
cluster, silently, because a missed match is indistinguishable from "no
duplicate exists" (spec 0105 R6's own fail-open contract for lookup
*errors* masks this different failure mode: a lookup that succeeds but
never matches).

This delta relaxes R5's matching rule so the skip decision also fires
against a Gitmoji-prefixed title, while leaving every other guarantee of R5
— and of R6, R7, R8, R9 — untouched: the skip is still decided purely on
the issue title, still independent of any forge-specific field, and the
trailing `(` (preceded by a space) anchor that disambiguates sibling
cluster keys (`yq` vs `yq-merge`) is still enforced at whichever position
the match is found.

**Version bump: MINOR (`1.1.0` → `1.2.0`).** The relaxation is a strict
superset of the previous matching rule: every title that satisfied the
original exact-prefix check (position (a) below) still satisfies the
revised rule unconditionally — the pre-existing behavior for titles opened
before this change is preserved byte-for-byte, and no scenario that used to
skip a duplicate stops skipping it. The only change is that a second,
narrower condition (position (b)) can now also produce a match, for titles
carrying exactly one leading Gitmoji-and-space token. No existing,
already-implemented behavior of R5 is invalidated by this widening — the
in-flight implementation of R5 (apply.py, already shipped) keeps passing
every case it passed before; it simply also starts passing a new case it
previously missed. This is additive with respect to the parent's normative
content in the same sense delta-01's R9 was additive, so the MAJOR trigger
of `docs/spec-format.md` → *Delta-spec convention → Versioning*
("requirement modified … in a way that invalidates an in-flight
implementation") does not fire; MINOR is the correct bump. Every other
requirement of spec 0105 — R1 through R9 (per delta-01) — remains in force
unchanged. No open questions are introduced by this delta.

## ADDED

(None. This delta modifies Requirement 5 only; it introduces no new
requirement, scenario, or out-of-scope item.)

## MODIFIED

1. **Requirement 5 is replaced** to tolerate an optional leading Gitmoji
   prefix on the matched title, while keeping the skip decision title-only
   and forge-independent.

   - Original text (unmodified by delta-01, quoted verbatim from the
     parent spec):

     > **5.** The duplicate-detection lookup SHALL query open
     > `harness-feedback` issues on the selected forge through that tool's
     > own list or search invocation and SHALL decide the skip on the
     > canonical title prefix `Friction cluster: <key> (`; the skip
     > decision MUST NOT depend on any forge-specific field beyond the
     > issue title.

   - Replacement text:

     > **5.** The duplicate-detection lookup SHALL query open
     > `harness-feedback` issues on the selected forge through that tool's
     > own list or search invocation and SHALL decide the skip on the
     > canonical title prefix `Friction cluster: <key> (`, matched at
     > either of two positions in a candidate title: (a) at the very start
     > of the title — the original, unconditionally-preserved behavior, so
     > every issue opened before this delta keeps matching exactly as
     > before — or, only when (a) does not match, (b) immediately after
     > stripping one leading run of non-word, non-whitespace characters
     > followed by whitespace (an optional single-token Gitmoji prefix,
     > for example `🐛` followed by a space, that spec 0228 now composes
     > into new titles). The trailing `(` (preceded by a space) anchor
     > SHALL be preserved unchanged at whichever position produces the
     > match — it is what prevents a substring collision between sibling
     > cluster keys such as `yq` and `yq-merge`, and relaxing the
     > leading-token position MUST NOT weaken it. The skip decision MUST
     > NOT depend on any forge-specific field beyond the issue title, and
     > MUST NOT depend on the per-forge search or list query string
     > (`_dedup_list_cmd`) matching or excluding the Gitmoji — those query
     > strings are unaffected by this delta and remain unanchored
     > substring/keyword searches.

## REMOVED

(None. This delta modifies Requirement 5 only; Requirements R1–R4 and R6–R9
(the latter per delta-01), and all scenarios of the parent spec, remain in
force unchanged.)
