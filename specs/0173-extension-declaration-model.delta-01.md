---
id: "0173"
slug: extension-declaration-model
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1004
version: 2.0.0
---

# 0173 — extension-declaration-model (delta-01)

This delta replaces spec 0173's committed-generated dispatch with a
render-at-publication model, on the maintainer decision taken at the 2026-08-23
arbitration gate on the issue #725 epic
([recorded verbatim](https://github.com/crewrig/crewrig/issues/725#issuecomment-5387117119)):
**no generated file is committed on the primary branch, for any command-line
tool.** The tool that loads an extension in place is served by publication
instead — a versioned release carrying the rendered tree as the default
operating mode, the project's own install script, and a development link pointed
at the build directory for debugging — and a native install performed by that
tool against the primary branch becomes a documented unsupported path. The
parent's four decomposition decisions (one generic root manifest, the
warning-plus-durable-gap-record policy, single-source variables, clean break
plus tooling) stand unchanged; what changes is where every rendered file lives
and, consequently, what the single continuous-integration capability asserts.

The change inverts the parent's central guard. With nothing generated committed,
there is no committed output to compare against a fresh render, so requirement
10 stops asking "does the committed output still match its declaration?" and
starts asking "is any generated output committed at all, and does the render
still produce the declared file set?". Requirement 13's gap report can no longer
be a committed-generated artifact for the same reason, and this delta
re-specifies where the gap inventory lives so that the warning-plus-durable-record
intent survives the move.

This delta also carries the requirement 4 file-level interim clause minted by
the PLAN review of issue #1004: the parent grants an interim to per-CLI manifest
*keys* belonging to not-yet-generalized subjects but grants none to *files*,
while deliberately sparing four hand-authored context files whose subject is
sub-spec S4's. Requirement 4 is relaxed to match that scoping.

## ADDED

Added to `## Requirements`:

- **Requirement 18 — (Reading rule, a generated output is a build output).**
  Every reference in the parent spec to a "committed-generated" output, and
  every clause of the parent that treats a generated file as living in a
  committed source tree, SHALL be read as naming a build output produced into an
  extension's build directory. No generated output SHALL be committed on the
  primary branch for any command-line tool.
- **Requirement 19 — (Reading rule, the requirement 10 capability).** Every
  reference in the parent spec to "the drift guard of requirement 10" SHALL be
  read as a reference to the single continuous-integration capability as amended
  by this delta, and no such reference SHALL be read as reinstating a comparison
  against a committed generated output.
- **Requirement 20 — (Supported delivery paths for the in-place tool).** The
  rendered tree for the command-line tool that loads an extension in place SHALL
  reach an adopter through exactly one of three paths, and through no other: a
  versioned release artifact carrying the rendered tree, which SHALL be the
  default operating mode for an install; the project's own extension install
  script, installing the rendered tree from the build directory; or a
  development link pointed at the build directory through a dedicated task of
  the project's extension task surface, which SHALL be documented as a debugging
  path and SHALL NOT be presented as an install path.
- **Requirement 21 — (Documented unsupported native path).** An extension
  install performed by the target tool's own install command directly against
  the project's primary branch SHALL be documented as unsupported, with the
  maintainer decision of 2026-08-23 recorded as the evidence for the choice, and
  no requirement of this spec SHALL be read as obliging that path to work.
- **Requirement 22 — (Release-side boundary).** The render SHALL emit into the
  build directory a tree complete enough to be installed or packaged with no
  second render, so that publication is a packaging step; the publication of
  that tree as a versioned release artifact and the install-from-release
  experience SHALL be specified by the migration sub-spec S5 (issue #1008)
  rather than here. This spec SHALL NOT foreclose that specification, and S5
  SHALL NOT omit it.

Added to `## Scenarios`:

**Scenario:** A release artifact carries the rendered tree

```text
Given a versioned release carries the rendered tree of an extension
When  an adopter installs that extension from the release artifact
Then  the tool loads the extension from the rendered tree
And    no file of the generated output class was read from the primary branch
```

**Scenario:** The debugging link points at the build directory

```text
Given a contributor has rendered an extension into its build directory
When  the contributor runs the dedicated development link task
Then  the tool loads the extension from the build directory
And    the task is documented as a debugging path and not as an install path
```

**Scenario:** A native install against the primary branch is unsupported

```text
Given an adopter points the target tool's own install command at the project's
      primary branch
When  the tool fetches the extension source tree
Then  the extension lacks the files that tool needs, because none is committed
And    the documentation names that path as unsupported, cites the maintainer
      decision as its evidence, and names the supported paths instead
```

**Scenario:** An interim hand-authored context file is not charged

```text
Given an extension commits a hand-authored context file whose name designates a
      specific command-line tool, for a declaration subject no sub-spec has
      generalized yet
When  the requirement 10 capability runs
Then  the capability passes
And    the file stays outside the generated output class
```

Added to `## Out of scope`:

- The four hand-authored context files of the reference extension
  (`extensions/core/hello-world/CLAUDE.md`, `GEMINI.md`,
  `copilot-instructions.md`, `.geminiignore`) and the skeleton's equivalents —
  their subject is the context declaration vocabulary of sub-spec S4 (issue
  #1007). They stay hand-authored and committed under the requirement 4 interim
  until S4 lands, and the requirement 10 capability does not charge them.

## MODIFIED

**Requirement 4 — the committed carve-out is void, and a file-level interim is
granted.**

Original:

> **4. (A CLI-named file is a build output)** A file inside an extension source
> tree whose name designates a specific command-line tool SHALL be a build
> output produced from the declarations, never a hand-authored source; the only
> legitimate committed instance of such a file SHALL be a committed-generated
> output covered under the drift guard of requirement 10.

Replacement:

> **4. (A CLI-named file is a build output)** A file inside an extension source
> tree whose name designates a specific command-line tool SHALL be a build
> output produced from the declarations, never a hand-authored source, and SHALL
> NOT be committed on the primary branch. A committed, hand-authored file of
> that shape whose subject is a declaration subject this spec does not yet
> generalize SHALL remain admissible until that subject's sub-spec lands —
> mirroring the interim the parent grants to per-CLI manifest keys in its *Out
> of scope* — and the capability of requirement 10 SHALL NOT charge it while the
> interim holds; requirement 4 binds it from the moment that sub-spec lands.

**Requirement 7 — every output is ephemeral, and delivery replaces the committed
form.**

Original:

> **7. (Committed or ephemeral dispatch)** The pipeline SHALL dispatch each
> output, per target tool, to exactly one of two forms: a committed-generated
> file for a tool that loads the extension tree in place, or an ephemeral build
> output for a tool that builds a plugin — matching how each tool demonstrably
> loads extensions.

Replacement:

> **7. (Ephemeral dispatch, delivery by publication)** The pipeline SHALL
> dispatch every output, for every target tool, to one form only: an ephemeral
> build output written into a build directory outside the committed source tree.
> For the tool that loads the extension tree in place, the build directory SHALL
> hold the complete installable tree — the rendered files together with every
> file the source tree carries — and that tool's adopters SHALL be served
> through the delivery paths of requirement 20 rather than through a committed
> rendered file.

**Requirement 9 — the Gemini manifest is a build output.**

Original:

> **9. (Generated Gemini manifest)** `gemini-extension.json` SHALL be a
> committed-generated output derived from the generic root manifest, and a hand
> edit to it SHALL surface as drift under requirement 10.

Replacement:

> **9. (Built Gemini manifest)** `gemini-extension.json` SHALL be a build output
> derived from the generic root manifest and SHALL NOT be committed on the
> primary branch, and a committed instance of it — hand-authored or a copied
> render — SHALL fail the capability of requirement 10.

**Requirement 10 — the single capability inverts.**

Original:

> **10. (Generalized drift guard, one CI capability)** A single check mode SHALL
> verify that every committed-generated output of every extension matches a
> fresh render of its declarations, SHALL fail while naming each drifted or
> stale file, and SHALL run as exactly one continuous-integration capability
> covering all committed-generated extension outputs, including those later
> subjects introduce.

Replacement:

> **10. (No-committed-generated-output guard, one CI capability)** A single
> check mode SHALL assert, for every extension, that (a) no file of the
> generated output class is committed anywhere in the extension's source tree,
> (b) a fresh render of the extension's declarations succeeds, and (c) that
> render produces exactly the file set the declarations declare — no declared
> output missing, no undeclared output produced. It SHALL fail while naming each
> offending file or extension, and SHALL run as exactly one
> continuous-integration capability covering every extension and every subject
> later introduced. The capability SHALL be non-vacuous: committing a file of
> the generated output class, and a render that omits a declared output, SHALL
> each turn it red.

**Requirement 11 — lockstep is asserted on the built manifest.**

Original:

> **11. (Version lockstep preserved)** The generated `gemini-extension.json`
> SHALL declare the same version as the extension's single authoritative version
> declaration, and a release-time version bump SHALL leave the generated
> manifest drift-clean, so the existing manifest-version guard (spec 0044) and
> the drift guard stay green simultaneously.

Replacement:

> **11. (Version lockstep preserved on the built manifest)** The built
> `gemini-extension.json` SHALL declare the same version as the extension's
> single authoritative version declaration at the moment it is rendered, and the
> lockstep assertion SHALL be made against the built manifest — at release time
> included, so that a release-time version bump yields a built manifest that
> agrees with the authoritative declaration. The assertion SHALL be
> non-vacuous: a built manifest whose version disagrees with the authoritative
> declaration SHALL fail it. The change that realizes this requirement SHALL
> carry that assertion, because the existing manifest-version guard's
> committed-sibling arm (spec 0044) goes silent for `gemini-extension.json` the
> moment the file stops being committed, and a property that is merely unchecked
> SHALL NOT be reported as green.

**Requirement 13 — the gap inventory is a declaration, not a generated file.**

Original:

> **13. (Durable gap report)** The gap report SHALL be a durable
> committed-generated artifact covered under the drift guard of requirement 10,
> so the gap inventory is reviewable in diffs rather than ephemeral in logs; an
> extension whose declarations all map on every target SHALL carry no gap entry,
> and a stale gap entry SHALL surface as drift.

Replacement:

> **13. (Durable gap inventory, declared not generated)** The gap inventory
> SHALL be a hand-authored, committed declaration of the gaps an extension's
> maintainers have accepted, and the render SHALL emit the gap set it actually
> observes as a build output. The capability of requirement 10 SHALL compare the
> emitted set against the committed declaration and SHALL fail while naming
> every gap observed but undeclared and every declared gap no longer observed,
> so the inventory stays reviewable in diffs rather than ephemeral in logs. An
> extension whose declarations all map on every target SHALL declare no gap. The
> render itself SHALL still warn and SHALL NOT fail, per requirement 12: the
> comparison is an assertion of the requirement 10 capability, not a render
> outcome.

*Trade-off, recorded rather than hidden.* A declared inventory is the only shape
that keeps all three properties the epic's second decision asked for — durable,
reviewable in a diff, never silent — once nothing generated may be committed.
Its cost is that a legitimately unmappable declaration must be acknowledged
twice: the render observes the gap, and a human records it. Until the record
lands, the requirement 10 capability is red. That is the "never silent" arm
paying for itself, and it deliberately trades a moment of red continuous
integration for the guarantee that no gap reaches the primary branch unreviewed.
The residual risk is the mirror image: a human can accept a gap that should have
been treated as a defect, which a generated report would have shown without
endorsing. The rejected alternative — emitting the gap report into the build
directory and publishing it with the release — keeps the render simpler but
makes the inventory reviewable only by downloading an artifact, which is the
diff-reviewability the decision explicitly asked to keep.

**Requirement 14 — the path form is probed against the built tree.**

Original:

> **14. (Path form pinned with evidence)** The generated `gemini-extension.json`
> SHALL carry path values in the one form the target tool demonstrably resolves
> when loading a committed manifest in place, and that form SHALL be pinned with
> recorded evidence from the installed tool before the first generated manifest
> is committed.

Replacement:

> **14. (Path form pinned with evidence from the built tree)** The built
> `gemini-extension.json` SHALL carry path values in the one form the target
> tool demonstrably resolves when loading an extension installed from a rendered
> build tree, and that form SHALL be pinned with recorded evidence obtained from
> the installed tool against a rendered tree installed from a local path, before
> the first built manifest is delivered through any path of requirement 20.

**Requirement 15 — conformance is proved build against build.**

Original:

> **15. (Commands conformance proof)** The commands subject SHALL be produced
> through the shared pipeline with outputs unchanged relative to the current
> render — the committed Gemini command form byte-identical and the plugin-side
> renders identical — and any command declaration a target tool cannot express
> SHALL be recorded through the requirement 12 policy rather than silently
> omitted.

Replacement:

> **15. (Commands conformance proof, build against build)** The commands subject
> SHALL be produced through the shared pipeline with outputs unchanged relative
> to the current render, proved by comparing the tree the pipeline builds
> against the tree the pre-change render produces from the same declarations —
> byte-identical for the in-place tool's command form, identical for the
> plugin-side renders. No committed command form serves as the baseline, since
> the companion delta on spec 0042 de-commits it. Any command declaration a
> target tool cannot express SHALL be recorded through the requirement 12 policy
> rather than silently omitted.

**Requirement 17 — the documentation surfaces follow the model.**

Original:

> **17. (Documentation co-maintenance)** The change that realizes requirements 1
> through 16 SHALL update the extension format documentation, the CLI-matrix
> rows describing the extension build scripts and per-CLI manifests, and the
> layer classification of committed-generated extension files in the same
> change, so the documented model and the enforced model do not drift.

Replacement:

> **17. (Documentation co-maintenance)** The change that realizes requirements 1
> through 22 SHALL update, in the same change, the extension format
> documentation; the CLI-matrix rows describing the extension build scripts, the
> per-CLI manifests, and the extension install and link task surface; the layer
> classification of generated extension outputs, recording that the class is
> produced into a build directory and committed nowhere; and the supported and
> unsupported delivery paths of requirements 20 and 21 — so the documented model
> and the enforced model do not drift.

**Scenario "One declaration yields every CLI-native file" — outputs land in the
build directory.**

Original:

```text
Given an extension declares its whole surface once in the generic root manifest
When  the shared pipeline renders the extension
Then  the tool that loads the tree in place receives committed generated files
      inside the source tree
And    each tool that builds a plugin receives ephemeral outputs in its build
      directory
And    no CLI-named file inside the source tree was hand-authored
```

Replacement:

```text
Given an extension declares its whole surface once in the generic root manifest
When  the shared pipeline renders the extension
Then  every output lands in a build directory outside the committed source tree
And    the build directory holds a complete installable tree for the tool that
      loads an extension in place
And    the committed source tree gains no generated file
```

**Scenario "The commands re-route is behavior-preserving" — build against
build.**

Original:

```text
Given the reference extension's commands are declared in the generic manifest
When  the generalized pipeline renders the commands subject
Then  the committed Gemini command files are byte-identical to the previous
      render
And    the plugin-side command renders are identical to the previous render
```

Replacement:

```text
Given the reference extension's commands are declared in the generic manifest
When  the generalized pipeline renders the commands subject
Then  the Gemini command files it builds are byte-identical to the ones the
      pre-change render builds from the same declarations
And    the plugin-side command renders are identical to the previous render
```

**Scenario "The generated manifest stays version-locked across a release" — the
assertion moves to the built manifest.**

Original:

```text
Given gemini-extension.json is generated from the generic root manifest
When  a release bumps the extension's authoritative version
Then  the generated manifest declares the new version
And    the manifest-version guard and the drift guard both pass
```

Replacement:

```text
Given gemini-extension.json is built from the generic root manifest
When  a release bumps the extension's authoritative version
Then  the built manifest declares the new version
And    the lockstep assertion runs against the built manifest and passes
And    it fails when the built manifest and the authoritative declaration
      disagree
```

**Scenario "A hand edit to a generated manifest is caught as drift" — a
committed generated output is caught by its presence.**

Original:

```text
Given gemini-extension.json is a committed-generated output
When  a contributor hand-edits it and the drift guard runs
Then  the guard fails and names the drifted file
And    the failure message points at regeneration from the declaration
```

Replacement:

```text
Given gemini-extension.json is a build output committed nowhere
When  a contributor commits a copy of it in an extension source tree and the
      requirement 10 capability runs
Then  the capability fails and names the committed file
And    the failure message points at the delivery paths of requirement 20
      rather than at regenerating a committed file
```

**Scenario "An unmappable declaration warns and lands in the gap report" — the
emitted set is compared against the declaration.**

Original:

```text
Given an extension declares a subject entry with no expressible counterpart on
      one declared target tool
When  the pipeline renders the extension
Then  the build succeeds with a warning
And    the gap report gains a durable entry naming the declaration and the
      target
And    nothing is silently dropped
```

Replacement:

```text
Given an extension declares a subject entry with no expressible counterpart on
      one declared target tool
When  the pipeline renders the extension
Then  the build succeeds with a warning
And    the emitted gap set names the declaration and the target
And    the requirement 10 capability fails until that gap is recorded in the
      extension's committed gap declaration
And    nothing is silently dropped
```

**Scenario "A stale gap entry is drift" — a stale declared gap fails the
capability.**

Original:

```text
Given a gap report carries an entry whose gap no longer exists
When  the drift guard runs
Then  the guard fails and names the stale gap report
```

Replacement:

```text
Given a committed gap declaration carries an entry the render no longer observes
When  the requirement 10 capability runs
Then  the capability fails and names the stale declared gap
```

**Out of scope — the release-side machinery is named, not dropped.**

Original:

> - Full skeleton and reference-extension migration, the clean-break removal of
>   the previous manifest shape, the migration tooling, and the removal of the
>   dual-shape manifest fallback chains in the plugin builds — S5. Until S5
>   lands, the previous shape remains readable where the interim requires it.

Replacement:

> - Full skeleton and reference-extension migration, the clean-break removal of
>   the previous manifest shape, the migration tooling, and the removal of the
>   dual-shape manifest fallback chains in the plugin builds — S5. Until S5
>   lands, the previous shape remains readable where the interim requires it. S5
>   also owns the publication of the rendered tree as a versioned release
>   artifact and the install-from-release experience, per requirement 22: this
>   spec's implementation stops at a complete installable tree in the build
>   directory, the install script that consumes it, and the debugging link task.

## REMOVED

**The parent's `## Open questions` conclusion that no delta on spec 0042 ships
in this wave.**

Original:

> - [SPEC-RELATION] The issue #725 decomposition flagged a likely delta-spec on
>   spec 0042 (…). No normative line of spec 0042 is invalidated, so no
>   delta-spec ships in this wave; if DEV proves a 0042 line invalidated after
>   all, `specs/0042-extension-pivot-render.delta-01.md` ships as its own
>   one-file spec-PR at that point. No residual question.

The condition that bullet named has been met — earlier than it anticipated, and
by a different route. The maintainer decision de-commits the rendered command
form that spec 0042's requirement 3 describes as an in-place native form, so the
conclusion is retired and the bullet's own escape clause is taken:
`specs/0042-extension-pivot-render.delta-01.md` ships alongside this delta as
its own one-file spec-PR.

## Notes

- **Spec 0044 relation.** The manifest-version guard of spec 0044 checks
  `gemini-extension.json` as a committed sibling, so de-committing that file
  makes the guard's Gemini arm pass by absence. Requirement 11 as amended keeps
  the property enforced by asserting it on the built manifest inside this spec's
  own change, which is why no spec 0044 delta is a precondition here. The
  re-specification of the spec 0044 guard and of the release driver stays with
  S5 (issue #1008), where the parent's *Out of scope* already placed it. Should
  a reviewer read spec 0044's guard requirement as a standing obligation over a
  *committed* sibling rather than over the property itself, the remedy is a
  one-file `specs/0044-extension-versioning-manifest.delta-01.md`, not a change
  to this delta.
- **Task surface.** The dedicated development link task of requirement 20 joins
  the Gemini extension task family renamed by issue #1002 and merged as pull
  request #1021 (`install-gemini-extension`, `install-gemini-extensions`,
  `link-gemini-extensions`, `unlink-gemini-extensions`, alongside the cross-CLI
  `install-extension-all`). Its name is the plan's to choose; requirement 20
  fixes only that the surface exists, that it targets the build directory, and
  that it is documented as a debugging path.
