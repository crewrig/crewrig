---
id: "0181"
slug: extension-context-pivot
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1007
version: 1.0.0
---

# Extension context pivot and per-CLI generation

## Intent

An extension author writes the agent-facing context of an extension once, in
one command-line-tool-neutral source, and every command-line tool that loads
that extension receives a context worded for itself — its own name, its own
invocation forms, its own namespacing, and the passages that concern it alone.
No file named after a command-line tool is hand-maintained any more, no tool
receives a context file that nothing loads, and no tool-specific wording is
restated a second time in a second file. Where a tool offers no place for an
extension's context at all, the absence is recorded and reviewable rather than
papered over with a file that sits in a tree unread. This fourth sub-spec of
the issue #725 redesign plugs the context vocabulary into the declaration model
and render pipeline that sub-spec S1 fixed.

## Requirements

1. **(Single neutral context source)** An extension SHALL declare its
   agent-facing context exactly once, in one command-line-tool-neutral source
   reached through a generic top-level `context` section of the root manifest,
   and its source tree SHALL carry no per-command-line-tool context source, no
   per-tool override file, and no per-tool variant of that source. An extension
   that declares no context SHALL remain valid and SHALL produce no context
   output on any target.
2. **(Per-tool declension at render)** The render SHALL produce, from that
   single source, one context output per target command-line tool, and every
   difference between those outputs SHALL originate in render variables
   resolved from the source, the declarations, and the render's knowledge of
   the target — never in a second authored file.
3. **(Minimum variable vocabulary)** The render-variable vocabulary SHALL be
   able to express, at minimum, each divergence the reference extension's three
   hand-authored context files exhibit today: the target tool's own display
   name; the invocation reference of a declared command; the invocation
   reference of a declared skill; the extension's own identity; and a block
   that renders only for a named target. A divergence the vocabulary cannot
   express SHALL be treated as an evolution of this format and recorded as a
   delta on this spec; it SHALL NOT be met by an ad-hoc per-tool file, and the
   list above SHALL NOT be read as a ceiling on what a later delta may add.
4. **(Namespacing is the render's own knowledge)** A reference a render
   variable produces SHALL be resolved from the extension's own identity and
   the render's knowledge of the target tool's namespacing and invocation
   conventions, and an extension author SHALL NOT restate a namespace, a
   prefix, or a per-tool invocation form anywhere in the context source. An
   author who needs a literal string that resembles a reference SHALL be able
   to write it as ordinary prose without the render claiming it.
5. **(A reference resolves only against a declaration)** A render variable that
   references a declared subject entry SHALL resolve only when the root
   manifest declares that entry; a reference to an entry no declaration carries
   SHALL fail the render as a validation error naming the unresolved reference,
   so a context output can never advertise a capability the extension does not
   declare. The permitted path for an author who wants the reference is to
   declare the entry.
6. **(Context outputs join the generated-output class)** Every context output
   of every target tool SHALL be a member of the generated-output class, SHALL
   be produced into the extension's build directory, and SHALL NOT be committed
   on the primary branch; the single check capability SHALL charge a committed
   instance. The file-level interim that spec 0173 delta-01 granted to
   hand-authored context files SHALL end when this spec lands, and those files
   SHALL reach an adopter only through the delivery paths that spec already
   fixes.
7. **(The hand-authored sources are removed)** The reference extension's
   hand-authored `CLAUDE.md`, `GEMINI.md`, and `copilot-instructions.md`, and
   the skeleton's equivalents, SHALL be removed from the committed source tree
   and replaced by the single neutral source of requirement 1, and no
   equivalent hand-authored, tool-named context file SHALL remain in any
   upstream-owned extension tier. The prose those files carry today SHALL
   survive the move: what each tool's reader saw before SHALL still be
   expressible from the single source.
8. **(Claude Code delivery)** The Claude Code context output SHALL be delivered
   into the built plugin at the place that tool loads an extension's context,
   and the per-tool manifest key that names that file today SHALL be retired,
   its value being derivable from the render's knowledge of the target.
9. **(Gemini CLI delivery)** The Gemini CLI context output SHALL be delivered
   inside the rendered installable tree, and the built Gemini manifest SHALL
   continue to name it so the tool still finds it; the authored root manifest
   SHALL NOT carry that name, the render supplying it from its own knowledge of
   the target.
10. **(Antigravity CLI delivery, pinned by evidence)** The Antigravity CLI
    context output SHALL be delivered at the location the installed tool
    demonstrably ingests as a plugin-scoped rule, that location SHALL be pinned
    with recorded evidence obtained from the installed tool and its own bundled
    documentation before the output is declared mapped, and the per-tool
    manifest key `antigravity.contextFileName` SHALL be retired — the concept
    it configures having no counterpart in that tool's plugin format. Where the
    recorded evidence contradicts the assumed location, the evidence SHALL
    decide and the divergence SHALL be recorded.
11. **(GitHub Copilot CLI delivery, pinned by evidence)** The GitHub Copilot
    CLI context output SHALL be delivered as a plugin component that tool
    demonstrably loads — a user-invocable skill of the built plugin, the same
    surface the build already adopts for that tool's commands — and the form
    SHALL be pinned with recorded evidence obtained from the installed tool
    before it is declared mapped. Where the recorded evidence shows no form the
    tool honors, the declaration SHALL follow requirement 12 instead, and
    SHALL NOT be met by a file no build delivers.
12. **(An undelivered context is a recorded gap, never a stranded file)** A
    context output that would reach no location its target tool loads SHALL NOT
    be produced at all; the declaration SHALL instead be recorded as unmappable
    on that target under the durable gap inventory spec 0173 delta-01 fixes, so
    an undelivered context is visible in a diff rather than sitting in a tree as
    a file nothing reads. An extension whose context maps on every target SHALL
    declare no gap.
13. **(The extension-scoped `.geminiignore` is removed, not regenerated)** The
    reference extension's committed `.geminiignore` SHALL be removed and SHALL
    NOT be reintroduced as a generated output: the single rule it carries names
    a context file this spec removes from the committed source tree, so the
    condition it guarded no longer exists where it stood, and a guard whose
    subject has disappeared is deleted rather than left passing by absence.
    Should a later change recreate that condition, the guard SHALL be
    reintroduced as a fresh decision recorded against this spec, never
    reinstated by reflex.
14. **(A retired key leaves no admissible row behind)** Every per-tool manifest
    key this spec retires SHALL also be removed from the manifest's per-tool key
    allowlist, and the render's unmappable-subject arm for the context subject
    SHALL be removed on every target the render now maps — a check whose subject
    has disappeared being deleted rather than left green by absence. An arm
    whose subject survives on some target SHALL be kept for that target alone.
15. **(The declared output set covers context)** The declared output set the
    single check capability compares a fresh render against SHALL include each
    context output the declarations produce, so a render that omits a declared
    context output, or produces an undeclared one, turns the capability red. The
    assertion SHALL be non-vacuous: an extension declaring no context SHALL
    declare no context output, and that case SHALL pass.
16. **(The skeleton ships the pivot)** The extension skeleton SHALL ship the
    single neutral context source in place of its per-tool context files, so a
    newly created extension inherits this format rather than the shape this spec
    removes, and a freshly created extension SHALL render cleanly with no manual
    repair.
17. **(Documentation co-maintenance)** The change that realizes requirements 1
    through 16 SHALL update, in the same change, the extension format
    documentation — including the interim carve-out paragraph this spec ends —
    the CLI-matrix rows describing the per-tool extension manifests, the
    extension build scripts, and each tool's context delivery, and the reference
    extension's own tree description, so the documented model and the enforced
    model do not drift.

## Scenarios

**Scenario:** One neutral source yields every tool's context

```text
Given an extension declares its agent-facing context once in the neutral source
When  the shared pipeline renders the extension for every target tool
Then  each target tool's build output carries a context worded for that tool
And    the differences between those outputs trace to render variables alone
And    no hand-authored, tool-named context file exists in the source tree
```

**Scenario:** Namespacing comes from the build, not from the author

```text
Given the neutral source references a declared command and a declared skill
      without naming any namespace or prefix
When  the pipeline renders the extension
Then  the tool whose convention namespaces plugin entries receives the
      namespaced reference
And    the tool whose convention does not receives the bare reference
And    the extension's identity is the only input the author supplied
```

**Scenario:** A reference to an undeclared entry fails the render

```text
Given the neutral source references a subject entry the root manifest does not
      declare
When  the pipeline renders the extension
Then  the render fails with a validation error naming the unresolved reference
And    no context output is produced for any target
```

**Scenario:** A committed context output is charged

```text
Given a contributor commits a rendered context output inside an extension's
      source tree
When  the single check capability runs
Then  the capability fails and names the committed file
And    the failure points at the delivery paths instead of at regeneration
```

**Scenario:** An extension that declares no context renders no context output

```text
Given an extension's root manifest carries no context declaration
When  the pipeline renders the extension and the check capability runs
Then  no context output is produced for any target
And    the capability passes, the declared output set carrying no context entry
```

**Scenario:** A divergence the vocabulary cannot express is a format evolution

```text
Given an author needs a per-tool difference no render variable can express
When  the author looks for a place to put a tool-specific override file
Then  no such place exists in the format
And    the permitted path is a delta on this spec that extends the vocabulary
```

**Scenario:** A context no tool would load becomes a declared gap

```text
Given the recorded evidence shows a target tool loads no plugin-scoped context
      in any form
When  the pipeline renders the extension for that target
Then  no context file is produced for that target
And    the render warns and the observed gap set names the context subject on
      that target
And    the check capability stays red until the gap is acknowledged in the
      committed gap declaration
```

**Scenario:** The removed guard is not quietly regenerated

```text
Given the extension-scoped ignore file's only rule named a context file this
      spec removes from the committed source tree
When  the change that realizes this spec lands
Then  the ignore file is deleted from the source tree
And    no generated replacement is produced in its place
```

## Out of scope

- **Workspace entry points.** The repository-root agent-context files and the
  repository-root ignore file are a different mechanism with a different scope,
  excluded by the parent ticket. This spec governs only context that an
  extension carries and that a tool loads because the extension is active.
- **The hook and MCP-server declaration vocabularies** — sibling sub-specs S2
  (issue #1005) and S3 (issue #1006). Their per-tool manifest keys keep the
  interim spec 0173 grants until their own sub-spec lands; this spec retires
  only the context keys.
- **The clean-break migration, the removal of the dual-shape manifest fallback
  chains, and the release and install-from-release experience** — sub-spec S5
  (issue #1008). This spec constrains only that the context outputs land in the
  build directory like every other output.
- **Re-specification of the single check capability's own arms** beyond
  extending its declared output set to cover context. The capability's shape is
  spec 0173 delta-01's; this spec plugs a subject into it.
- **The editorial content of the reference extension's context prose** beyond
  requirement 7's preservation obligation. Rewriting what the extension says
  about itself is a separate concern from where and how it says it.
- **Enforcement on third-party extension repositories.** They follow the same
  format, but the checks run in their repositories, not this one.
- **A repository-root remedy for a rendered build tree inside the workspace.**
  See the parked entry in *Open questions*; any remedy would be a
  repository-root change, which the first bullet excludes.

## Open questions

- [GROUNDING:] The per-tool manifest key `antigravity.contextFileName` names a
  concept the target's plugin format does not carry: the installed tool's own
  bundled documentation describes plugin-scoped context as a rule file under the
  plugin's rules directory, and its plugin manifest carries no context key at
  all — while the build copies the named file to the plugin root, where nothing
  ingests it. Resolved in-spec: requirement 10 retires the key and mandates the
  evidence probe that pins the ingested location before the output is declared
  mapped; requirement 14 removes the allowlist row so the key does not stay
  admissible. No residual question.
- [GROUNDING:] The parent ticket asks for Copilot context delivery to be
  created, but the installed tool's plugin surface enumerates agents, skills,
  hooks, MCP server configurations and LSP server configurations, and no
  plugin-scoped context or instructions surface; the committed
  `copilot-instructions.md` is read by no build script. Resolved in-spec by the
  maintainer's answer at the 2026-08-25 SPECS interview: requirement 11 delivers
  the context as a user-invocable skill of the built plugin — the same surface
  the build already uses for that tool's commands — pinned by recorded evidence,
  with requirement 12's gap policy as the named fallback if the evidence refutes
  it. No residual question.
- [USER-PARKED] The parent ticket's phrasing makes the extension-scoped
  `.geminiignore` a generated output; requirement 13 removes it outright
  instead. The maintainer chose removal at the 2026-08-25 SPECS interview, on
  the ground that the guard's only subject leaves the committed source tree, and
  explicitly accepted the residual the choice leaves: a contributor who opens
  this repository itself in Gemini CLI with a rendered build directory already
  on disk has no extension-scoped guard against that tool discovering the
  rendered context there. The residual is parked rather than closed because any
  remedy is a repository-root change, which this spec's *Out of scope* excludes.
