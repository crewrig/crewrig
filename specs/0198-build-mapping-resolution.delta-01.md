---
id: "0198"
slug: build-mapping-resolution
status: approved
complexity: small
interaction-mode: MINIMAL
related-issue: 1136
version: 1.0.1
---

# Build-time resolution of capability profiles against per-CLI model mappings — delta 01

Authored for issue #1136, follow-up of epic #1100 (recorded in seam (d) part 2's
end-of-seam note on issue #1116).
Narrows Requirement 14 of spec 0198 to the frontmatter reasoning surface scope
established by parent requirement 25 of spec 0197 and implemented in
`scripts/lib/model-resolve.sh`.

**Context and Problem.** Requirement 14 of spec 0198 governs the drop rule for a
declared `reasoning` rung:

> **R14.** A declared `reasoning` rung SHALL be dropped with the reason
> `unsupported-on-model` where the selected offering declares
> `supports-reasoning-surface: false`, and likewise where no offering is
> selected — requirement 25 of spec 0197.

Its cited parent requirement — spec 0197 requirement 25 — states:

> **Spec 0197 R25.** An offering SHALL declare whether the model it names
> supports the target's **frontmatter reasoning surface**. A declared reasoning
> rung SHALL be dropped with the reason `unsupported-on-model` where the
> selected offering declares no such support, and likewise where no offering is
> selected; the drop SHALL be recorded and SHALL NOT raise an error.

In compressing spec 0197 R25, spec 0198 R14 omitted the qualifying anchor to
"the target's frontmatter reasoning surface". Read literally and without that
anchor, R14's wording is wider than intended and contradicts both its parent
requirement and spec 0198's own normative scenario:

1. **Contradiction with normative scenario (*a composite offering carries reasoning through selection*):**
   In spec 0198 lines 529–540, an agent profile declaring `intelligence: medium`
   and `reasoning: high` resolves against `model-mappings/antigravity.yml`. All
   five offerings in `antigravity.yml` declare `supports-reasoning-surface: false`,
   and `antigravity.yml` declares only a guidance surface carrying `[model]`
   (no frontmatter reasoning surface). The normative scenario specifies that the
   resolution selects `gemini-3.8-flash-high` and "no drop record is written for
   the reasoning axis", because the declared reasoning rung is satisfied by
   model selection through the candidate narrowing of requirement 11 (rule e)
   and directed inside the model's native value (per spec 0195 R20, spec 0197
   R22, and decision D11). An un-scoped reading of R14 would instead demand an
   unwanted `unsupported-on-model` drop on this cell.
2. **Targets with no frontmatter reasoning surface:**
   On targets whose mappings declare no frontmatter surface expressing
   `reasoning` (e.g. `antigravity.yml`, or `copilot.yml` where reasoning is
   declared on an `out-of-band` surface `surfaces/copilot-config` and frontmatter
   carries `model` alone), an unserved reasoning rung is dropped under
   requirement 16 with reason `unsupported-on-cli` (rule (g)(3), asserted by
   test C5), never under R14 with `unsupported-on-model`.
3. **Intelligence-absent profiles:**
   Where `intelligence` is absent from the profile, requirement 7 (rule b,
   decision D13) is exhaustive and drops every declared selection axis with
   `unserved-value`, so `reasoning` is settled before item resolution runs and
   never reaches R14.
4. **Empty candidate sets:**
   Where `intelligence` is declared but the candidate set is empty (e.g. a
   mapping declaring `offerings: []`, decision D17), R14's second clause
   ("likewise where no offering is selected") fires only if the target declares
   a frontmatter reasoning surface (rule (g)(4), decision D12, asserted by test
   `D12/D17` on a temporary `claude.yml` copy with empty offerings).

**Resolution and Implementation Alignment.** The implementation in
`scripts/lib/model-resolve.sh` (sub-rule `(g)(4)`, lines 1163–1171) already
realizes this scoped behavior:

```bash
  # (g)(4) — R14, both clauses (D12): the selected offering refuses the
  # surface, or no offering was selected at all.
  if [ "$item" = reasoning ] && [ "$expressed_fm" = true ]; then
    if [ -z "$RESOLVED_OFFERING_ID" ] || [ "$RESOLVED_OFFERING_SRS" != true ]; then
      _diag_drop "$agent" "$target" "metadata.model.reasoning" "$PROF_REASONING" "unsupported-on-model"
      IT_DISPOSED[$idx]=true
      return 0
    fi
  fi
```

And prior to item resolution, the candidate narrowing of requirement 11
(`_narrow_encoded_reasoning`, lines 1089–1092) marks `reasoning` as directed
when encoded in candidate offerings:

```bash
  if [ "${#best_set[@]}" -gt 0 ]; then
    CANDIDATES=(${best_set[@]+"${best_set[@]}"})
    local ridx; ridx=$(_item_idx reasoning)
    IT_DISPOSED[$ridx]=true
    IT_DIRECTED[$ridx]=true
```

The review pass of seam (d) on issue #1116 identified this textual tension
(named as contradiction CF6) and ruled that R14's text should be narrowed in a
follow-up delta-spec rather than gating the implementation.

This delta restores the frontmatter reasoning surface condition to R14 and
clarifies that a reasoning rung directed through the candidate narrowing of
requirement 11 is not dropped, bringing the requirement text into exact
alignment with the merged implementation and test corpus.

**Versioning.** `PATCH` bump (`1.0.0` → `1.0.1`), per `docs/spec-format.md` →
*Delta-spec convention → Versioning*. This delta is a clarification and wording
fix that brings Requirement 14 into alignment with its cited parent requirement
(spec 0197 R25), its own normative scenario, and the merged implementation. It
invalidates no shipped code, introduces no breaking change, and constrains no
previously unspecified case.

## ADDED

### Added Out of Scope

- Any change to the diagnostic drop vocabulary established in spec 0197
  requirement 25 and spec 0195 requirement 21.
- Any change to the resolution logic in `scripts/lib/model-resolve.sh` or the
  test suite `scripts/tests/test-model-resolution.sh` (both already realize the
  scoped rule).
- Any change to committed model mappings under `model-mappings/*.yml`.

## MODIFIED

### Requirement 14 is replaced

- Original R14:

  > **R14.** A declared `reasoning` rung SHALL be dropped with the reason
  > `unsupported-on-model` where the selected offering declares
  > `supports-reasoning-surface: false`, and likewise where no offering is
  > selected — requirement 25 of spec 0197.

- Replacement R14:

  > **R14.** Where the target declares a frontmatter surface expressing the
  > `reasoning` item and the item was not directed by the candidate narrowing of
  > requirement 11, a declared `reasoning` rung SHALL be dropped with the reason
  > `unsupported-on-model` where the selected offering declares
  > `supports-reasoning-surface: false`, and likewise where no offering is
  > selected — requirement 25 of spec 0197.

## REMOVED

- None.
