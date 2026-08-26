---
id: "0183"
slug: extension-model-migration
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1008
version: 2.0.0
---

# 0183 — extension-model-migration (delta-01)

This delta pins the scope of spec 0183's release delivery: a versioned
release artifact serves the command-line tool that loads an extension in
place, and that tool alone. Its driver is the maintainer arbitration of
2026-08-25 on issue #1008
([recorded verbatim](https://github.com/crewrig/crewrig/issues/1008#issuecomment-5415681029)),
which resolved the `spec`-class plan finding `v1-F1` — the parent's
requirements 17 through 24 admit both a single-tool and a multi-tool reading
— in favour of option (a): the release serves the in-place tool, through the
delivery mechanism `specs/0173-extension-declaration-model.delta-01.md`
requirement 20 enumerates for that tool, while the other three supported
tools keep their local render-and-install paths.

Two measured grounds carried that ruling, recorded here because the
requirement text does not restate them. First, the installed in-place tool
(Gemini CLI 0.46.0) resolves a release's generic asset only when the release
carries exactly one asset; with two or more, and no platform-prefixed match,
it resolves none and falls through to the forge's auto-generated source
tarball. Second, one archive carrying every target's tree makes the parent's
requirement 18 **false** for the in-place tool, whose installed state would
then carry the other tools' inert directories — the seat finding `v2-F4`
([recorded verbatim](https://github.com/crewrig/crewrig/issues/1008#issuecomment-5412672662)).
The multi-tool reading therefore cost a delta on requirement 18 itself; the
single-tool reading costs the one requirement line and the one scenario this
delta changes.

Spec 0183's model survives intact. Requirements 18 through 24 stand exactly
as written, the publication path they specify is unchanged in every other
respect, and the migration, scaffold and enforcement groups (requirements 1
through 16, and 25) are untouched. What changes is which tool the release
is obliged to serve, and — as a consequence — one scenario whose
pre-condition selects a tool it no longer serves.

## ADDED

Added to `## Out of scope`:

- **A published release serving any command-line tool other than the
  in-place one.** The three tools whose extension is installed as a rendered
  plugin directory reach an adopter through the local render-and-install
  paths their own specs already establish. This spec obliges no release
  artifact on their behalf and no install-from-release path for them, and an
  extension whose only published artifact serves the in-place tool is not
  under-published. Should a release later be wanted for one of them, that is
  a new spec question rather than a reading of requirement 17: the in-place
  tool's own asset resolution (Gemini CLI 0.46.0) admits exactly one asset
  per release, so
  serving a second tool is a decision about the archive itself and not an
  addition beside it.

## MODIFIED

The parent numbers and indents its requirements in a form a blockquote
cannot carry verbatim, so both the original and the replacement are quoted
in a code block, preserving the parent's own layout.

**Requirement 17 — the release's served tool is named.**

Original:

```text
17. **(A published release carries an installable rendered tree)** A
    versioned release of an extension SHALL carry, as its artifact, the
    rendered tree the target tool installs — complete enough to install
    with no further render. An artifact carrying only the extension's
    committed source tree SHALL NOT be published as an extension release.
    An extension that is never published SHALL carry no obligation under
    this requirement.
```

Replacement:

```text
17. **(A published release carries an installable rendered tree)** A
    versioned release of an extension SHALL carry, as its artifact, the
    rendered tree the target tool installs — complete enough to install
    with no further render. The target tool SHALL be the command-line tool
    that loads an extension in place, the one tool for which
    `specs/0173-extension-declaration-model.delta-01.md` requirement 20
    enumerates a versioned release artifact as a delivery path; a release
    SHALL carry no obligation toward any other supported command-line tool,
    each of which reaches an adopter through its own local
    render-and-install path, and a release serving the in-place tool alone
    SHALL satisfy this requirement rather than be judged incomplete for the
    others. An artifact carrying only the extension's committed source tree
    SHALL NOT be published as an extension release. An extension that is
    never published SHALL carry no obligation under this requirement.
```

No other requirement of the release group needs the edit, and none is made
here. Requirement 18 already quantifies over "every supported command-line
tool **that release serves**", a set the amended requirement 17 now fixes;
requirement 19's obligation is conditional on an antecedent this delta does
not touch (see `## Notes`); requirement 20's "the target tool" is anaphoric
to requirement 17 and takes its referent from the amended line, so pinning
it there pins it once rather than twice; and requirements 21 through 24 name
no tool at all.

## REMOVED

**The scenario "Install-from-release performs the install-time resolution".**

Original:

```text
**Scenario:** Install-from-release performs the install-time resolution

Given a target tool performs no rewriting at install and resolves no token
      inside a plugin-scoped declaration
When  an adopter installs the extension from its published release
Then  the install path resolves the token after the tool's own install has
      run, against the directory the tool itself reports
And    the installed state equals the state a fresh local render and install
      would produce
```

The scenario's `Given` selects a target tool that performs no rewriting at
install and resolves no token inside a plugin-scoped declaration. In this
repository that description picks out exactly one tool, the Antigravity CLI:
its render ships the neutral extension-root token unresolved, because the
tool's own plugin install copies the directory verbatim with no rewriting of
any kind — recorded live in `docs/runbooks/extension-mcp-token-probe.md`
(question Q3) — and `scripts/install-antigravity-extension.sh` resolves the
token after that install has run. Under the ruling the release does not
serve that tool, so the `Given` and the `When` cannot both hold: the
pre-condition selects a tool for which no install-from-release path exists.
A scenario whose `Given` is no longer constructible is not a scenario that
still holds, and an acceptance criterion that can never be exercised may not
be left standing for a downstream stage to discharge on paper.

It is removed rather than replaced with an in-place-tool equivalent. For
that tool the render rewrites the neutral extension-root token into the
tool's own path token (`ext_mcp_native` in
`scripts/lib/extension-manifest.sh`, applied by the Gemini arm of
`scripts/build-extension.sh`), and the tool resolves that token itself when
it loads the extension in place, so nothing remains for an install path to
resolve on the release path. A restatement shaped for that tool would assert
a resolution step no party performs — coverage in appearance only. The case
is already carried without it: requirement 18's own second sentence states
that a tool whose render leaves nothing unresolved requires no extra step
and is still covered by the equality, and the scenario "A release artifact
carries the rendered tree" exercises the release install for that tool.

The resolve-locate-assert sequence itself is not removed with the scenario:
it remains specified by requirement 19, which this delta leaves exactly as
written, over the install path that requirement already governs. No other
scenario of spec 0183 is removed, and the parent retains both happy-path and
failure-path scenarios after this removal.

## Notes

- **Version bump.** MAJOR (`1.0.0` → `2.0.0`): the delta narrows requirement
  17's obligation to one named tool and deletes an acceptance criterion of
  the approved spec, so an implementation written against the parent's
  broader reading — a release artifact serving every supported tool, with an
  install-from-release dispatcher on their behalf — is invalidated rather
  than extended. This applies the same test the two companion deltas of this
  wave applied (`specs/0063-antigravity-extension-formalism.delta-01.md` and
  `specs/0065-copilot-plugin-build.delta-01.md`): a voided normative line, or
  a narrowed admissible set, is MAJOR however small the diff.
- **Requirement 18 stands intact, and deliberately so.** Its quantifier is
  already relative to what a release serves, so under the ruling it ranges
  over exactly the in-place tool and remains true as written. That truth is
  the arbitration's own premise — the multi-tool option was priced at a
  delta on requirement 18 precisely because it would have made the line
  false — so rewording the line here would falsify the premise instead of
  recording it.
- **Requirement 19 survives unedited, with narrower reach.** Its antecedent
  — a target tool that performs no rewriting of its own at install and
  resolves no token — is false for the in-place tool, whose render leaves
  the tool's own path token for the tool itself to resolve at load. The
  requirement therefore binds nothing on the release path and continues to
  bind the local render-and-install path it already governed, where the
  antecedent is true. That is a change of reach, not of text: the subject
  stays the install path that exists today, and this delta does not move it.
- **Requirement 20 is untouched, and the asset constraint is not promoted to
  a requirement.** The measured one-asset gate is recorded above as the
  ground of the ruling, not as normative text. Requirement 20 obliges the
  archive form, the location of the tool's manifest within it, and the asset
  naming to be pinned with recorded evidence obtained from the installed
  tool before the path is documented as the default; minting an asset-count
  requirement here would settle part of that question ahead of the probe
  requirement 20 exists to demand.
- **No competing version or boundary claim.** This delta names no version at
  which the break lands and no sync boundary for an adopter. Requirement 16's
  migration note is the single place that answers that question, and the
  identifiers it uses are settled by the approved plan
  ([recorded verbatim](https://github.com/crewrig/crewrig/issues/1008#issuecomment-5412575353))
  as amended by the reviewer's pass-2 finding `v2-F3`
  ([recorded verbatim](https://github.com/crewrig/crewrig/issues/1008#issuecomment-5412672662)),
  which struck the merge-commit sha and the predicted version from that step,
  not here.
- **No implementation of its own.** Every change this delta describes is
  realized by the implementation pull request for issue #1008 — the same
  change that adds the release packaging path and rewrites the release
  driver. Spec 0183 carries `status: approved` and its implementation is in
  flight; this delta ships as its own one-file spec-PR and merges before that
  implementation pull request, per the two-PR convention.
- **Interaction mode.** Spec 0183 and this delta are both qualified under
  `INTERMEDIATE`; the delta's mode is that of its own ticket, issue #1008.
- **Reading order.** This delta is cumulative on
  `specs/0183-extension-model-migration.md`; read the parent first, then this
  delta. The delivery-path enumeration it pins against is requirement 20 of
  `specs/0173-extension-declaration-model.delta-01.md`.
