---
id: "0042"
slug: extension-pivot-render
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1004
version: 2.0.0
---

# 0042 — extension-pivot-render (delta-01)

This delta de-commits the rendered command form that spec 0042 introduced. Its
driver is the maintainer decision taken at the 2026-08-23 arbitration gate on
the issue #725 epic
([recorded verbatim](https://github.com/crewrig/crewrig/issues/725#issuecomment-5387117119)),
whose fifth precision assumes exactly this reopening: **no generated file is
committed on the primary branch, for any command-line tool**, so the Gemini
command form joins the ephemeral model with every other rendered output.

Spec 0042's model survives intact — one pivot source per component, rendered
into the form each tool actually consumes. What changes is where the rendered
form for the tool that loads an extension in place lives: a build directory
instead of a committed sibling in the source tree, delivered by a versioned
release artifact, by the project's install script, or by a debugging link, per
the amended dispatch of spec 0173 (`specs/0173-extension-declaration-model.delta-01.md`,
requirements 7 and 20). The drift check that kept the committed sibling honest
against its pivot loses its subject and is retired in favour of that spec's
single inverted capability.

Spec 0042 already carries `status: implemented`; this delta ships no
implementation of its own. Every change it describes is realized by the
implementation of spec 0173 on issue #1004, which is where the committed
`commands/*.toml` sibling is deleted.

## ADDED

Added to `## Requirements`:

- **Requirement 8 — (The rendered in-place form is a build output).** The
  rendered form of an extension component for a command-line tool that loads an
  extension in place SHALL be produced into a build directory and SHALL NOT be
  committed in the extension source tree, and it SHALL reach an adopter through
  the delivery paths fixed by spec 0173 as amended rather than by being present
  on the primary branch.
- **Requirement 9 — (The committed-sibling drift check is retired).** The check
  that compared a committed rendered command form against its pivot source
  SHALL be retired, because a de-committed form leaves it no subject; the
  property it protected — that no rendered form diverges from its declaration,
  and that none is committed — SHALL be carried by the single
  continuous-integration capability of spec 0173 requirement 10 as amended, and
  SHALL NOT be left unchecked in the interval.
- **Requirement 10 — (The committed sibling is removed by the spec 0173
  change).** The committed `extensions/core/hello-world/commands/hello.toml`
  SHALL be removed by the implementation pull request that realizes spec 0173
  on issue #1004, in the same change that moves the render to a build
  directory, rather than by a separate change that would leave the repository
  transiently inconsistent.

Added to `## Out of scope`:

- Where a rendered form is delivered from — a versioned release artifact, the
  project's install script, or a debugging link pointed at the build directory —
  is fixed by spec 0173 as amended (requirements 20 and 22) and by the migration
  sub-spec S5 (issue #1008), not here. This spec owns only that the rendered
  form is a build output and not a committed file.

## MODIFIED

**Requirement 3 — the in-place form is rendered into a build directory, not
committed in place.**

Original:

> **3. (Consumed-form fidelity)** The rendered form of an extension component for
> a given command-line tool SHALL match how that tool loads extensions — a built
> form for a tool that builds extensions, an in-place native form for a tool
> that reads extensions directly — rather than a uniform output that a tool does
> not load.

Replacement:

> **3. (Consumed-form fidelity)** The rendered form of an extension component for
> a given command-line tool SHALL match how that tool loads extensions — a built
> form for a tool that builds extensions, and for a tool that reads an extension
> tree directly the native form that tool loads, produced into a build directory
> and delivered from there rather than committed in the source tree — rather than
> a uniform output that a tool does not load.

**Scenario "One pivot source renders to every command-line tool's consumed
form" — the native form arrives from the rendered tree.**

Original:

```text
Given an extension ships a skill and a command authored once in the pivot source
      format
When  the extension is rendered
Then  Claude Code receives the component in its built plugin form
And    Gemini CLI receives it in the native in-place form Gemini loads directly
And    no component required a second hand-authored command-line-tool-native
      source
```

Replacement:

```text
Given an extension ships a skill and a command authored once in the pivot source
      format
When  the extension is rendered
Then  Claude Code receives the component in its built plugin form
And    Gemini CLI receives it in the native form it loads directly, from the
      rendered tree it installs rather than from a committed sibling
And    no component required a second hand-authored command-line-tool-native
      source
```

## REMOVED

No normative line of spec 0042 is deleted by this delta: its requirement 1
(pivot authoring), requirement 2 (per-CLI render), requirement 4 (documented
gap), requirement 5 (carrier safety), requirement 6 (back-fill, already
discharged) and requirement 7 (the authoring-shape enforcement guard) all stand
unchanged, and requirement 3 is amended above rather than dropped.

What is removed is the artifact the amended requirement 3 no longer permits: the
committed `extensions/core/hello-world/commands/hello.toml`, deleted by the
change named in requirement 10.

## Notes

- **Logbook anchor.** The `related-issue` field names issue #1004, the ticket
  whose plan-validation gate produced the maintainer decision and whose
  implementation carries every change this delta describes. Spec 0042's own
  parent ticket, issue #347, is closed and implemented; this delta is not its
  work.
- **Reading order.** This delta is cumulative on spec 0042 and depends on
  `specs/0173-extension-declaration-model.delta-01.md` for the delivery paths it
  points at. Read that delta first; the two ship as separate one-file spec-PRs
  and both are preconditions for cutting the issue #1004 implementation branch.
