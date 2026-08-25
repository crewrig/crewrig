---
id: "0065"
slug: copilot-plugin-build
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1005
version: 2.0.0
---

# 0065 — copilot-plugin-build (delta-01)

This delta retires spec 0065's per-CLI hook declaration: the `hooks` field of
the manifest's `copilot` object, and the build output bound to it. Its driver is
the first decision of the approved decomposition of the issue #725 epic
([recorded verbatim](https://github.com/crewrig/crewrig/issues/725#issuecomment-5385379858)),
option A: **one generic root `extension.json`**, in which each declaration
subject is declared once in a generic top-level section and a per-CLI section
carries only what fails to generalize. Spec 0173 fixed that model and granted
the hook subject an interim, naming sub-spec S2 as the point at which the
interim ends. `specs/0179-extension-neutral-hooks.md` is S2, and requirement 1
of that spec forbids exactly the declaration site requirement 1 of this spec
admits.

Spec 0065's model survives intact. The GitHub Copilot CLI is still a first-class
build target, the plugin directory it produces is unchanged in every other
respect, and an extension that declares a hook still receives a Copilot hook
output — it is now written from the generic declaration rather than from a
per-CLI key, into the file and in the shape the Copilot CLI is demonstrated to
read. What changes is where the author writes the hook, and therefore what the
build script reads.

The generation step is **removed** rather than left reading a key that will no
longer exist. That follows the maintainer decision taken at the 2026-08-23
content gate on issue #1004
([recorded verbatim](https://github.com/crewrig/crewrig/issues/1004#issuecomment-5387545134)):
when a step's subject disappears, the step is removed, not retained in a form
that reports success because there is nothing left to act on. The step as
written today reads `copilot.hooks` with an empty-object default and emits no
file when the key is absent, exiting clean — precisely the silent pass-through
that decision forbids.

Spec 0065 already carries `status: implemented`; this delta ships no
implementation of its own. Every change it describes is realized by the
implementation of spec 0179 on issue #1005.

## ADDED

Added to `## Requirements`:

- **R9 — (The Copilot hook output is produced from the generic declaration).**
  An extension that declares a hook SHALL continue to receive a Copilot hook
  output in its build output, produced from the generic hook declaration fixed
  by `specs/0179-extension-neutral-hooks.md` rather than from a per-CLI manifest
  key, and produced in the same change that removes the hook output of
  requirement 3 — so no interval exists in which an extension can declare a hook
  and receive no Copilot output. An extension that declares no hook SHALL
  receive no hook output, as before.
- **R10 — (Removal, not silent pass-through).** The generation step that the
  hook output of requirement 3 mandates SHALL be removed in the same change that
  makes the `copilot.hooks` key inadmissible, and SHALL NOT be retained in a
  form that reads an absent per-CLI key, produces no file, and reports success.
  A retained step of that shape SHALL be a violation of this delta, whether or
  not any extension currently declares the key.
- **R11 — (The admitting allowlist row goes with the key).** The row of the
  per-CLI key allowlist that admits `copilot.hooks` by deferral SHALL be removed
  in the same change, so a re-introduced `copilot.hooks` key is rejected as a
  manifest validation error rather than admitted by a row whose deferral has
  expired.
- **R12 — (The Copilot hook file is pinned by probe, not by inheritance).** The
  file the Copilot CLI reads for a plugin's hooks, and the shape it expects
  there, SHALL be pinned with recorded evidence obtained from the installed tool
  before any Copilot hook output is delivered, and SHALL NOT be inherited from
  this spec's `hooks.json`-at-the-output-root assumption, which no probe
  recorded in this repository establishes. Where the probe contradicts that
  assumption, the probe governs.

Added to `## Out of scope`:

- The neutral hook vocabulary itself — the event names, the matcher
  abstraction, the per-target structural translation, the time-unit conversion,
  the extension-root token, and the per-event gap policy — belongs to
  `specs/0179-extension-neutral-hooks.md` (issue #1005). This delta retires the
  per-CLI key and the output bound to it; it does not restate what replaces
  them.
- The `components.*` toggle references that survive in requirement 3 of this
  spec. Their subject is the enablement model, re-specified by spec 0173 and
  cleared by the migration sub-spec S5 (issue #1008), not by this delta. This
  delta leaves them exactly as written.

## MODIFIED

The parent numbers and indents its requirements in a form a blockquote cannot
carry verbatim, so both the original and the replacement are quoted in a code
block, preserving the parent's own layout.

**R1 — the `copilot` object's admissible fields lose `hooks`.**

Original:

```text
R1. `extension.json` SHALL accept an optional top-level `copilot` object
    with the following optional fields: `pluginName` (string override for
    the installed plugin name; defaults to the manifest `name` field) and
    `hooks` (object — Copilot hook schema).
```

Replacement:

```text
R1. `extension.json` SHALL accept an optional top-level `copilot` object
    with one optional field: `pluginName` (string override for the
    installed plugin name; defaults to the manifest `name` field). A
    `hooks` field SHALL NOT be admissible in that object: hooks are
    declared once in the generic top-level hook section fixed by
    `specs/0179-extension-neutral-hooks.md`, and a `hooks` key inside the
    `copilot` object SHALL be rejected as a manifest validation error.
```

**R3 — the build output list loses its hook entry.**

Only the final bullet of the requirement changes; every other clause, including
the `components.*` references, is reproduced exactly as the parent writes it.

Original:

```text
R3. A script `scripts/build-copilot-plugin.sh` SHALL accept an extension
    directory or bare extension name as its first argument and an optional
    output directory as its second, resolve the extension source across
    `extensions/core/`, `extensions/library/`, `extensions/org/`, and
    emit a Copilot CLI plugin directory containing:

    - `plugin.json` at the output root with `name`, `version`, and
      `description` fields derived from the manifest (using
      `copilot.pluginName` when present and non-empty, falling back to
      `name`).
    - A `skills/` subtree in `skills/<name>/SKILL.md` form, copied from
      the extension source when `components.skills.enabled` is `true`.
    - Pivot commands rendered as `skills/<cmd>/SKILL.md` entries when
      `components.commands.convertToSkills` is `true` (same render path
      as `build-claude-plugin.sh`, using `scripts/lib/render-command.sh`).
    - An `agents/` subtree in `agents/<name>.agent.md` flat-file form
      (i.e., each `agents/<name>/AGENT.md` source directory is flattened
      to `agents/<name>.agent.md` in the output) when
      `components.agents.enabled` is `true`.
    - A `hooks.json` at the output root generated from `copilot.hooks`
      when that field is non-empty.
```

Replacement:

```text
R3. A script `scripts/build-copilot-plugin.sh` SHALL accept an extension
    directory or bare extension name as its first argument and an optional
    output directory as its second, resolve the extension source across
    `extensions/core/`, `extensions/library/`, `extensions/org/`, and
    emit a Copilot CLI plugin directory containing:

    - `plugin.json` at the output root with `name`, `version`, and
      `description` fields derived from the manifest (using
      `copilot.pluginName` when present and non-empty, falling back to
      `name`).
    - A `skills/` subtree in `skills/<name>/SKILL.md` form, copied from
      the extension source when `components.skills.enabled` is `true`.
    - Pivot commands rendered as `skills/<cmd>/SKILL.md` entries when
      `components.commands.convertToSkills` is `true` (same render path
      as `build-claude-plugin.sh`, using `scripts/lib/render-command.sh`).
    - An `agents/` subtree in `agents/<name>.agent.md` flat-file form
      (i.e., each `agents/<name>/AGENT.md` source directory is flattened
      to `agents/<name>.agent.md` in the output) when
      `components.agents.enabled` is `true`.

    The plugin directory SHALL carry no hook output produced from a
    per-CLI manifest key; an extension's hooks reach the Copilot build
    through the generic declaration, per R9.
```

## REMOVED

**The `hooks.json`-from-`copilot.hooks` output of requirement 3.**

Original:

```text
    - A `hooks.json` at the output root generated from `copilot.hooks`
      when that field is non-empty.
```

The bullet's subject is the `copilot.hooks` key, which the amended requirement 1
makes inadmissible; an output whose only trigger condition can no longer be
satisfied is not an output that still holds. It is removed rather than amended
to read a different key, because the generic declaration is translated by the
shared render pipeline of spec 0173 rather than by a per-CLI build script
reading a manifest field of its own — the shape R9 names as the property's
carrier.

No requirement line of spec 0065 is deleted in full by this delta: requirements
2 and 4 through 8 stand unchanged, and requirements 1 and 3 are amended above
rather than dropped. No scenario is removed: the parent's five scenarios (S1
through S5) cover the plugin directory, agent flattening, command conversion,
the `pluginName` override, and the install invocation — none exercises a hook.

## Notes

- **Version bump.** MAJOR (`1.0.0` → `2.0.0`): the delta voids a normative
  clause in force today and narrows the admissible field set of a manifest
  section, so an implementation written against the parent's wording — or an
  extension manifest written against it — is invalidated rather than extended.
- **The retired output was never grounded, which is why R12 exists.** The
  parent's `hooks.json`-at-the-output-root form was written by analogy with the
  Antigravity plugin layout, not from a probe of the Copilot CLI. The authoring
  probes for spec 0179 could not close that gap either: the installed binary
  (self-reported version 1.0.80) yields no readable hook strings, and the one
  installed plugin on the probing machine declares no hook, so the plugin-level
  hook file placement, the event set a plugin may register, the matcher form,
  the time unit and any extension-root variable all remain ungrounded. The
  repository's committed `hooks/copilot-transcript-hooks.json` is evidence of
  the **user-level** schema only and does not establish the plugin-level one.
  R12 therefore forbids the replacement inheriting the assumption the removal
  discards. Recorded as an evidence gap, not as a defect claim against the
  parent's other lines.
- **Interaction mode.** Spec 0065 and this delta are both qualified under
  `INTERMEDIATE`; the delta's mode is that of its own ticket, issue #1005.
- **No implementation of its own.** Every change this delta describes is
  realized by the implementation pull request for spec 0179 on issue #1005 — the
  same change that moves the hook declaration into the generic section, removes
  the per-CLI build step, and drops the allowlist row.
- **Reading order.** This delta is cumulative on spec 0065 and depends on
  `specs/0179-extension-neutral-hooks.md` for the declaration site and the
  translation it points at. Read spec 0179 first; the two ship as separate
  one-file spec-PRs, alongside the companion delta on spec 0063.
