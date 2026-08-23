---
id: "0044"
slug: extension-versioning-manifest
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1004
version: 2.0.0
---

# 0044 — extension-versioning-manifest (delta-01)

This delta removes one arm of spec 0044's manifest-divergence guard: the arm that
compares a committed `gemini-extension.json` sibling against its extension's
authoritative version declaration. Its driver is the maintainer decision taken
at the 2026-08-23 content gate on issue #1004
([recorded verbatim](https://github.com/crewrig/crewrig/issues/1004#issuecomment-5387545134)):
when a check's subject disappears, **the check is removed**, not left in place to
pass because there is nothing left to compare. The subject disappears because of
the epic decision this wave implements
([recorded verbatim](https://github.com/crewrig/crewrig/issues/725#issuecomment-5387117119)):
no generated file is committed on the primary branch, for any command-line tool,
so `gemini-extension.json` becomes a build output and stops being a committed
sibling.

Spec 0044's model survives intact. `package.json` remains the single
authoritative version declaration of a distributable extension, the component
bump discipline of requirements 1 through 4 is untouched, and the guard keeps
failing the build on a divergent committed manifest. What changes is the guard's
scope: it follows the set of manifests an extension actually commits, and one
member of that set leaves it.

The version property the removed arm asserted is not dropped with the arm. It is
carried, in the same change, by requirement 11 of
`specs/0173-extension-declaration-model.delta-01.md`, which asserts the lockstep
on the *built* manifest — so no interval exists in which the property is merely
unchecked. This delta is the one-file remedy that delta's `## Notes` named as the
correct route should spec 0044's guard be read as a standing obligation over a
committed sibling rather than over the property itself; the content gate settled
that reading, and the remedy ships in the same wave rather than on demand.

## ADDED

Added to `## Requirements`:

- **Requirement 8 — (The Gemini arm is removed, not left silent).** The
  requirement 6 guard's arm over a committed `gemini-extension.json` SHALL be
  removed in the same change that de-commits that file from an extension source
  tree — the implementation of spec 0173 as amended, on issue #1004 — and SHALL
  NOT be retained in a form that passes because its subject is absent. Where an
  extension already commits no `gemini-extension.json`, the obligation is
  discharged by the arm's removal alone and no other change to that extension is
  required.
- **Requirement 9 — (The asserted property is carried, not retired).** The
  property the removed arm asserted — that the Gemini per-extension manifest
  declares the same version as the extension's single authoritative declaration
  — SHALL remain asserted with no interval in which nothing asserts it, carried
  on the built manifest by requirement 11 of
  `specs/0173-extension-declaration-model.delta-01.md` and shipped in the same
  change that removes the arm. No change SHALL remove the arm without that
  assertion in place, and the arm's removal SHALL NOT be read as retiring the
  property.
- **Requirement 10 — (The `extension.json` arm stands).** The requirement 6
  guard's arm over a committed `extension.json` SHALL keep its full force: that
  manifest remains a hand-authored, committed source manifest under the
  declaration model of `specs/0173-extension-declaration-model.delta-01.md`, and
  a committed `extension.json` whose version diverges from its extension's
  authoritative `package.json` declaration SHALL fail the build. An extension
  that commits no `extension.json` SHALL NOT be failed on that arm, and its
  authoritative declaration SHALL still be required by requirement 6.

Added to `## Scenarios`:

**Scenario:** The guard's scope follows the committed manifest set

```text
Given an extension commits package.json and extension.json, and its
      gemini-extension.json is a build output committed nowhere
When  the manifest-version guard runs
Then  the guard asserts the committed extension.json against the authoritative
      package.json version
And    the guard carries no arm for gemini-extension.json
And    the built manifest's version is asserted by requirement 11 of the spec
      0173 delta instead
```

**Scenario:** A divergent committed `extension.json` still fails

```text
Given an extension commits an extension.json whose version differs from its
      authoritative package.json version
When  the manifest-version guard runs
Then  the guard fails the build and names the divergent extension.json
```

**Scenario:** An arm kept after its subject disappears is a violation

```text
Given a change de-commits gemini-extension.json from every extension source
      tree and leaves the guard's arm over that file in place
When  the manifest-version guard runs
Then  the arm reports no failure because it finds no file to compare
And    no check asserts the Gemini manifest's version lockstep, while the guard
      reports green overall
And    requirement 8 forbids that state: the arm is removed, and requirement 11
      of the spec 0173 delta asserts the property on the built manifest in the
      same change
```

Added to `## Out of scope`:

- Re-specifying the manifest-version guard as a whole, and the release driver
  that writes an extension's next version back into each of its manifests at
  release time — the migration sub-spec S5 (issue #1008), where this spec's own
  *Out of scope* already places the release and tagging mechanism. This delta
  removes one arm of one guard; it neither restates the guard nor re-specifies
  which manifests the release driver writes.
- Where the built `gemini-extension.json` gets its version, and the shape of the
  assertion made against it — requirement 11 of
  `specs/0173-extension-declaration-model.delta-01.md`. Cited here as the
  property's carrier, not re-mandated here.

## MODIFIED

**Requirement 6 — the guard's scope is the committed manifest set.**

Original:

> **6. (Divergence guard)** A continuous-integration guard SHALL fail the build
> when a manifest of an extension declares a version divergent from that
> extension's single authoritative version declaration.

Replacement:

> **6. (Divergence guard, over committed manifests)** A continuous-integration
> guard SHALL fail the build when a committed manifest of an extension declares
> a version divergent from that extension's single authoritative version
> declaration. The guard's scope SHALL follow the set of manifests an extension
> actually commits: a manifest that ceases to be committed SHALL have its arm
> removed from the guard in the same change that de-commits it, rather than
> retained in a form that passes because its subject is absent, and the property
> that arm asserted SHALL be carried by another assertion in that same change. A
> manifest that is not committed SHALL be asserted against the authoritative
> declaration where it is produced, not reported as green where it is absent.

## REMOVED

**The `gemini-extension.json` arm of the requirement 6 guard.**

No requirement line of spec 0044 is deleted by this delta: requirements 1
through 5 and requirement 7 stand unchanged, and requirement 6 is amended above
rather than dropped. What is removed is a verification — the guard's comparison
of a committed `gemini-extension.json` sibling against its extension's
authoritative version — which the parent's own grounding record enumerated as
one of three:

Original:

> - [GROUNDING:] The three `extensions/core/hello-world` manifests (`package.json`,
>   `extension.json`, `gemini-extension.json`) currently all declare `0.1.0` and
>   are consistent, so the divergence guard (requirements 5-6) passes as-is and no
>   back-fill of existing manifests is required; the guard prevents future drift
>   rather than repairing a current one.

That enumeration held while all three manifests were committed. Under the
render-at-publication model the third is a build output, so the arm over it has
no subject left, and the content-gate decision is that such a check is removed
rather than kept as a green line reporting a comparison it never made. The
grounding record stands as the historical observation it was; the arm it
enumerated does not survive the de-commit.

## Notes

- **Version bump.** MAJOR (`1.0.0` → `2.0.0`): the delta voids a normative arm
  of requirement 6 that is in force today and asserted by a shipped guard, so an
  implementation written against the parent's wording is invalidated rather than
  extended.
- **No implementation of its own.** Spec 0044 already carries
  `status: implemented`. Every change this delta describes is realized by the
  implementation pull request for spec 0173 on issue #1004 — the same change that
  de-commits `gemini-extension.json`, removes the guard's arm over it, and ships
  the built-manifest assertion of that delta's requirement 11.
- **Reading order.** This delta is cumulative on spec 0044 and depends on
  `specs/0173-extension-declaration-model.delta-01.md` for the render model and
  for the assertion that carries the version property. Read that delta first;
  the two ship as separate one-file spec-PRs.
