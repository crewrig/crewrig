---
id: "0063"
slug: antigravity-extension-formalism
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1005
version: 2.0.0
---

# 0063 — antigravity-extension-formalism (delta-01)

This delta retires spec 0063's per-CLI hook declaration: the `hooks` field of
the manifest's `antigravity` object, and the build step bound to it. Its driver
is the first decision of the approved decomposition of the issue #725 epic
([recorded verbatim](https://github.com/crewrig/crewrig/issues/725#issuecomment-5385379858)),
option A: **one generic root `extension.json`**, in which each declaration
subject is declared once in a generic top-level section and a per-CLI section
carries only what fails to generalize. Spec 0173 fixed that model and granted
the hook subject an interim, naming sub-spec S2 as the point at which the
interim ends. `specs/0179-extension-neutral-hooks.md` is S2, and requirement 1
of that spec forbids exactly the declaration site requirement 1 of this spec
admits.

Spec 0063's model survives intact. The Antigravity CLI is still a first-class
build target, the plugin directory it produces is unchanged in every other
respect, and an extension that declares a hook still receives an Antigravity
`hooks.json` — it is now written from the generic declaration rather than from
a per-CLI key, in the structural form the Antigravity CLI actually requires per
event. What changes is where the author writes the hook, and therefore what the
build step reads.

The build step is **removed** rather than left reading a key that will no longer
exist. That follows the maintainer decision taken at the 2026-08-23 content gate
on issue #1004
([recorded verbatim](https://github.com/crewrig/crewrig/issues/1004#issuecomment-5387545134)):
when a step's subject disappears, the step is removed, not retained in a form
that reports success because there is nothing left to act on. The step as
written today reads `antigravity.hooks` with an empty-object default and emits
no file when the key is absent, exiting clean — precisely the silent
pass-through that decision forbids.

Spec 0063 already carries `status: implemented`; this delta ships no
implementation of its own. Every change it describes is realized by the
implementation of spec 0179 on issue #1005.

## ADDED

Added to `## Requirements`:

- **Requirement 18 — (The Antigravity hook output is produced from the generic
  declaration).** An extension that declares a hook SHALL continue to receive an
  Antigravity `hooks.json` in its build output, produced from the generic hook
  declaration fixed by `specs/0179-extension-neutral-hooks.md` rather than from
  a per-CLI manifest key, and produced in the same change that removes
  requirement 13 — so no interval exists in which an extension can declare a
  hook and receive no Antigravity output. An extension that declares no hook
  SHALL receive no `hooks.json`, as before.
- **Requirement 19 — (Removal, not silent pass-through).** The generation step
  that requirement 13 mandates SHALL be removed in the same change that makes
  the `antigravity.hooks` key inadmissible, and SHALL NOT be retained in a form
  that reads an absent per-CLI key, produces no file, and reports success. A
  retained step of that shape SHALL be a violation of this delta, whether or not
  any extension currently declares the key.
- **Requirement 20 — (The admitting allowlist row goes with the key).** The row
  of the per-CLI key allowlist that admits `antigravity.hooks` by deferral SHALL
  be removed in the same change, so a re-introduced `antigravity.hooks` key is
  rejected as a manifest validation error rather than admitted by a row whose
  deferral has expired.

Added to `## Out of scope`:

- The neutral hook vocabulary itself — the event names, the matcher
  abstraction, the per-target structural translation, the time-unit conversion,
  the extension-root token, and the per-event gap policy — belongs to
  `specs/0179-extension-neutral-hooks.md` (issue #1005). This delta retires the
  per-CLI key and the step bound to it; it does not restate what replaces them.
- The `components.*` toggle references that survive in requirements 8, 9 and
  10 of this spec. Their subject is the enablement model, re-specified by spec
  0173 and cleared by the migration sub-spec S5 (issue #1008), not by this
  delta. This delta leaves them exactly as written.

## MODIFIED

**Requirement 1 — the `antigravity` object's admissible fields lose `hooks`.**

The parent numbers and indents its requirements in a form a blockquote cannot
carry verbatim, so both the original and the replacement are quoted in a code
block, preserving the parent's own layout.

Original:

```text
R1. `extension.json` SHALL accept an optional top-level `antigravity` object
    with the following optional fields: `pluginName` (string), `contextFileName`
    (string), and `hooks` (object following the `hooks/antigravity-transcript-hooks.json`
    schema).
```

Replacement:

```text
R1. `extension.json` SHALL accept an optional top-level `antigravity` object
    with the following optional fields: `pluginName` (string) and
    `contextFileName` (string). A `hooks` field SHALL NOT be admissible in that
    object: hooks are declared once in the generic top-level hook section fixed
    by `specs/0179-extension-neutral-hooks.md`, and a `hooks` key inside the
    `antigravity` object SHALL be rejected as a manifest validation error.
```

## REMOVED

**Requirement 13 — the generation step bound to the per-CLI key.**

Original:

```text
R13. `scripts/build-antigravity-extension.sh` SHALL generate a `hooks.json`
     at the output root when `antigravity.hooks` is defined and non-empty.
```

The requirement's subject is the `antigravity.hooks` key, which the amended
requirement 1 makes inadmissible; a requirement whose only trigger condition can
no longer be satisfied is not a requirement that still holds. It is removed
rather than amended to read a different key, because the generic declaration is
translated by the shared render pipeline of spec 0173 rather than by a per-CLI
build script reading a manifest field of its own — the shape requirement 18
names as the property's carrier.

**The scenario that exercised the removed step.**

Original:

```text
**Scenario:** hooks.json generated from antigravity.hooks

Given an extension with `"antigravity": {"hooks": {"postMessage": [...]}}` defined
When  `scripts/build-antigravity-extension.sh <extension>` is executed
Then  `hooks.json` is written to the output root with the content of
      `antigravity.hooks`.
```

The scenario is removed with the requirement it exercised. Its given clause is
no longer constructible — a manifest carrying `antigravity.hooks` fails
validation under the amended requirement 1 — and its event name `postMessage`
does not exist on the Antigravity CLI, whose complete event set is
`PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation` and `Stop`. The
equivalent coverage over the neutral declaration lives in the scenarios of
`specs/0179-extension-neutral-hooks.md`.

No other requirement line of spec 0063 is deleted by this delta: requirements 2
through 12 and 14 through 17 stand unchanged, and requirement 1 is amended above
rather than dropped.

## Notes

- **Version bump.** MAJOR (`1.0.0` → `2.0.0`): the delta voids a normative
  requirement in force today and narrows the admissible field set of a manifest
  section, so an implementation written against the parent's wording — or an
  extension manifest written against it — is invalidated rather than extended.
- **The removed scenario was never grounded.** The parent's scenario named
  `postMessage` as an Antigravity hook event. The vendor hook contract shipped
  on disk with the installed CLI (`agy` 1.1.19, under the CLI's own
  `builtin/skills/agy-customizations/docs/hooks.md`) enumerates five events and
  `postMessage` is not among them, so the scenario described a build that could
  never have fired. Recorded here because it is evidence for requirement 18's
  insistence that the replacement translation be grounded per target rather than
  written by analogy, not as a defect claim against the parent's other lines.
- **Interaction mode.** Spec 0063 was qualified under `AUTO`; this delta is
  qualified under `INTERMEDIATE`, the mode declared by its own ticket, issue
  #1005. The field records the mode each artifact was qualified under, and a
  delta qualified under a different mode from its parent is established practice
  in this repository.
- **No implementation of its own.** Every change this delta describes is
  realized by the implementation pull request for spec 0179 on issue #1005 — the
  same change that moves the hook declaration into the generic section, removes
  the per-CLI build step, and drops the allowlist row.
- **Reading order.** This delta is cumulative on spec 0063 and depends on
  `specs/0179-extension-neutral-hooks.md` for the declaration site and the
  translation it points at. Read spec 0179 first; the two ship as separate
  one-file spec-PRs, alongside the companion delta on spec 0065.
