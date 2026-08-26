---
id: "0183"
slug: extension-model-migration
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1008
version: 1.0.0
---

# Extension model migration — clean break, scaffold rewrite, and release delivery

## Intent

An extension carries only hand-authored files, every file a command-line
tool consumes is produced from the extension's single
declaration, and an adopter who installs a published extension gets the
same working extension a contributor gets from a fresh render. A tree
still written in the shape the redesign replaced stops being read
half-successfully: it fails, says so, and names the tool that converts it.
The scaffold a contributor starts from produces such a tree on the first
try, with no placeholder left standing and no document describing files the
tree does not contain. This last migration sub-spec of the issue #725
redesign closes the distance between the declaration model the four
preceding sub-specs established and the state the repository, the scaffold,
and a published release actually exhibit.

## Requirements

The requirements below fall into six groups: the scaffold template and the
scaffolding tool (1-5), the reference extension and the per-CLI remainder
(6-8), the enforcement that no hand-written tool-designated file survives
in an extension source tree or in the scaffold template container (9-11),
the clean break and its tooling (12-16), release delivery and
install-from-release (17-24), and co-maintenance (25).

1. **(The scaffold declares in the generic schema)** The scaffold
   template's root manifest SHALL declare every subject through the generic
   top-level sections of spec 0173 requirement 1, and SHALL carry no
   subject enablement block of the shape spec 0173 requirement 5 retires. A
   scaffold that declares no subject at all SHALL remain a valid extension,
   and the permitted path for enabling a subject SHALL be the presence of
   its generic section.
2. **(A scaffolded extension renders clean on the first try)** For every
   combination of components the scaffolding tool offers, the tree it
   produces SHALL render for every supported command-line tool and SHALL
   pass the single check capability of spec 0173 requirement 10 as amended
   with no edit by the contributor. Where a scaffolded subject has no
   counterpart on a supported target, the scaffolded tree SHALL ship the
   corresponding declared gap, so the capability passes on a declared gap
   rather than on an absent one.
3. **(Placeholder substitution covers every text-carrying file)** The
   scaffolding tool SHALL substitute every scaffold placeholder in every
   file it emits that carries text, including a file a content-type
   heuristic classifies as data rather than as text — a JSON manifest
   included. A scaffold run SHALL fail, naming the file and the surviving
   placeholder, when any placeholder literal remains anywhere in the
   produced tree. A tree containing no placeholder SHALL pass that
   assertion rather than be reported as unchecked.
4. **(The scaffolding tool writes no tool-designated file)** The
   scaffolding tool SHALL NOT write, copy, or leave behind any file whose
   name designates a specific command-line tool. The permitted path for a
   contributor who needs such a file SHALL be to declare the subject that
   produces it, and an extension needing none SHALL be scaffolded with none.
5. **(Scaffolded documentation describes the scaffolded tree)** Every
   document the scaffolding tool copies into a new extension SHALL name
   only files that tree actually contains. A document that names a build
   output as a committed source file SHALL be a defect of the scaffold, and
   a document that names no file at all SHALL satisfy this requirement
   vacuously rather than fail it.

6. **(The reference extension exercises every subject)** The reference
   extension SHALL declare every generic subject the declaration model
   defines, so that the worked example a contributor copies exercises the
   whole model. A subject-and-target pair the render cannot map SHALL be
   carried as a declared gap; a reference extension whose declarations all
   map SHALL declare no gap.
7. **(Every per-CLI key carries a verdict, none carries a deferral)** Every
   per-CLI manifest key admitted by the change's own admissibility record
   SHALL carry a verdict under spec 0173 requirement 3, recorded with
   evidence. No entry SHALL carry a deferral to this spec after this change
   lands. A key judged reducible SHALL be removed from the record, from
   every committed manifest, and from every reader that consumes it, in the
   same change; a key judged irreducible SHALL keep its entry with a
   non-deferral reason and its evidence.
8. **(A per-CLI section exists only where a key survives the verdict)** An
   extension SHALL carry a per-CLI top-level section only for keys judged
   irreducible under requirement 7. Where every key a tool would carry is
   judged reducible, the section SHALL be absent rather than added for
   symmetry with the tools whose sections survive.

9. **(Every committed tool-designated file is charged)** The single check
   capability of spec 0173 requirement 10 as amended SHALL charge every
   committed file whose name designates a supported command-line tool in an
   extension source tree **and in the scaffold template container**, whether
   or not a declaration generates it: a file the render produces SHALL be
   charged for being committed, and a file no declaration generates SHALL be
   charged for having no generating declaration. A tree carrying no such
   file SHALL pass. The permitted paths SHALL be to delete the file or to
   declare the subject that produces it, and the rule SHALL admit no
   exemption for a file serving a purpose other than being loaded by the
   tool its name designates. The one such file the scaffold template
   container commits today — its tool-designated ignore file — SHALL be
   deleted by the change that realizes this spec, so the requirement lands
   over a tree that already satisfies it.
10. **(The interim ends by removal, never by silence)** No file-level or
    key-level interim that spec 0173 requirement 4 as amended grants to a
    not-yet-generalized subject SHALL survive this change: every subject
    the interim named has landed, so the capability SHALL charge every file
    and key the interim spared. An interim clause SHALL be removed rather
    than left in place to apply to nothing.
11. **(The enforcement is non-vacuous, and outlives the deletion)**
    Committing a tool-designated file with no generating declaration into an
    extension source tree, and committing one into the scaffold template
    container, SHALL each turn the capability red. A capability that stays
    green under either injection SHALL NOT be accepted as satisfying
    requirement 9. The deletion requirement 9 mandates is a one-time act;
    the prohibition it leaves behind SHALL remain a standing check over both
    trees rather than be retired with the file, because its subject is the
    class of such files and not that one file — a check whose subject
    survives SHALL NOT be removed with the instance that occasioned it.
    Where an existing assertion of that enforcement states that a
    tool-designated file may be committed because no declaration generates
    it, the assertion SHALL be corrected in the same change rather than left
    to contradict requirement 9; an assertion covering a file whose name
    designates no command-line tool SHALL be left intact rather than swept
    up with it.

12. **(The old shape is enumerated once)** The change SHALL enumerate, in
    one place both the failure message and the migration tool consult, the
    declaration forms that constitute the shape this redesign replaced. A
    form absent from that enumeration SHALL NOT be failed as an old shape,
    and a form present in it SHALL be failed by every reader.
13. **(Every reader fails loudly on the old shape)** Every entry point that
    reads an extension manifest SHALL fail on a declaration of the shape
    requirement 12 enumerates, naming the migration tool and the migration
    note. No entry point SHALL read such a declaration successfully, no
    compatibility window SHALL be granted, and no dual-shape read SHALL
    survive. The permitted path for an adopter SHALL be to run the
    migration tool.
14. **(The manifest-location fallback is removed from every reader)** The
    fallback that lets a reader locate an extension's manifest under the
    name of a tool-specific manifest when the generic root manifest is
    absent SHALL be removed from every reader that carries it, including
    every plugin builder and every install script. An extension with no
    generic root manifest SHALL fail naming the migration tool, rather than
    be read through a tool-specific manifest.
15. **(The migration tool ships with the break)** A migration tool SHALL
    convert an extension source tree written in the old shape into the new
    form, and SHALL land in the same release as the break it remedies. A
    tree already in the new form SHALL be left unchanged and reported as
    already migrated rather than failed. A tree the tool cannot fully
    convert SHALL fail, naming what it could not convert, and SHALL NOT be
    left partly converted.
16. **(The adoption guide carries the migration note)** The adoption guide
    SHALL state what breaks, which tool converts an affected tree, and the
    version at which the break lands. An adopter who owns no extension
    SHALL be told the note does not apply to them, rather than left to
    infer it.

17. **(A published release carries an installable rendered tree)** A
    versioned release of an extension SHALL carry, as its artifact, the
    rendered tree the target tool installs — complete enough to install
    with no further render. An artifact carrying only the extension's
    committed source tree SHALL NOT be published as an extension release.
    An extension that is never published SHALL carry no obligation under
    this requirement.
18. **(Installing from a release equals installing from a fresh render)**
    Installing an extension from its published release SHALL produce, for
    every supported command-line tool that release serves, the same
    installed state as installing the same version from a fresh local
    render. Every resolution step the render deliberately leaves to install
    time SHALL be performed on the release path as well; a tool whose
    render leaves nothing unresolved SHALL require no extra step and SHALL
    still be covered by the equality.
19. **(Install-time resolution locates its target and asserts it)** Where a
    target tool performs no rewriting of its own at install and resolves no
    token, the install path SHALL resolve the token after the tool's own
    install has run, SHALL locate the installed directory through the
    identity the tool itself reports rather than through the name of the
    directory it was installed from, and SHALL fail naming the expected
    file when that file is absent after install rather than proceeding as
    if the resolution had succeeded.
20. **(The published form is pinned with evidence before it is documented
    as default)** Before the install-from-release path is documented as the
    default operating mode, the archive form the target tool demonstrably
    accepts — its internal layout, the location of that tool's own manifest
    within it, and the asset naming the tool resolves — SHALL be pinned
    with recorded evidence obtained from the installed tool against a
    published artifact, and the tool's version and the probe method SHALL
    be recorded with it. A form for which such evidence cannot be obtained
    SHALL NOT be documented as supported.
21. **(The release driver writes exactly the committed manifest set)** The
    release driver SHALL write an extension's next version into exactly the
    set of manifests that extension commits, and SHALL carry no arm over a
    file that is never committed. An arm whose subject has disappeared
    SHALL be removed rather than retained in a form that reports success
    because it found nothing to write. An extension committing a single
    manifest SHALL receive a single write.
22. **(The published artifact declares the released version)** The
    tool-facing manifest inside a published release artifact SHALL declare
    the version that release declares, so the lockstep spec 0044
    requirement 5 establishes holds at the moment of publication and not
    only at render time. An extension that is never published SHALL satisfy
    this requirement vacuously; an artifact whose manifest disagrees with
    the release SHALL NOT be published.
23. **(Any second release path conforms or is removed)** A release-creation
    path other than the primary driver SHALL either produce an artifact
    conforming to requirement 17 or SHALL be removed. It SHALL NOT be left
    in place in a form that would publish a non-conforming archive, and its
    never having run SHALL NOT be accepted as evidence that it is harmless.
24. **(The release change is proven by a rehearsal before it publishes)**
    The change to the release driver SHALL be proven by a rehearsal that
    exercises the full publication path without creating a tag, a release,
    or a commit, and the rehearsal's observed outcome SHALL be recorded.
    A rehearsal that cannot exercise a step SHALL name that step as
    unexercised rather than be reported as a full pass.

25. **(Documentation co-maintenance)** The change that realizes
    requirements 1 through 24 SHALL update, in the same change, the
    extension format document, the CLI-matrix rows naming the removed
    fallbacks and the release and install paths, the layer classification
    touched by the publication path, the version-bump convention page, and
    every contributor-facing document describing the scaffold. A document
    that names a mechanism this change removes, or a file this change
    de-commits, SHALL be corrected in that same change rather than left to
    a follow-up.

## Scenarios

**Scenario:** A freshly scaffolded extension renders and passes with no edit

```text
Given a contributor scaffolds a new extension selecting every offered
      component
When  the single check capability runs against the scaffolded tree
Then  the render succeeds for every supported command-line tool
And    the capability passes
And    no placeholder literal remains anywhere in the scaffolded tree
```

**Scenario:** A placeholder surviving in a data-classified file fails the scaffold

```text
Given the scaffold template carries a placeholder inside a manifest a
      content-type heuristic classifies as data rather than as text
When  the scaffolding tool runs
Then  the run fails, naming the file and the surviving placeholder
And    no partly substituted extension is left behind
```

**Scenario:** A hand-written tool-designated file with no declaration is charged

```text
Given an extension source tree commits a file whose name designates a
      supported command-line tool, and no declaration of that extension
      generates it
When  the single check capability runs
Then  the capability fails and names the file
And    the failure states that the permitted paths are to delete the file or
      to declare the subject that produces it
```

**Scenario:** The scaffold template container is charged like an extension tree

```text
Given the change that realizes this spec has landed, so the template
      container commits no file whose name designates a command-line tool
When  a later change commits such a file into the template container
Then  the single check capability fails and names the file
And    the capability is still in force over the container, rather than
      having been retired with the file the migration deleted
```

**Scenario:** A reducible per-CLI key leaves the record, the manifests, and the readers

```text
Given a per-CLI manifest key is judged reducible under the irreducibility
      test
When  the change that records the verdict lands
Then  the key is absent from the admissibility record, from every committed
      manifest, and from every reader that consumed it
And    no entry of that record carries a deferral to this spec
```

**Scenario:** An old-shape extension fails and is told what converts it

```text
Given an adopter's extension declares its subjects in the shape this
      redesign replaced
When  any entry point reads that extension's manifest
Then  the read fails
And    the failure names the migration tool and the migration note
And    no reader falls back to a tool-specific manifest to keep going
```

**Scenario:** The migration tool leaves an already-migrated tree alone

```text
Given an extension source tree already written in the new form
When  the migration tool runs against it
Then  the tool reports the tree as already migrated
And    the tree is byte-unchanged
```

**Scenario:** A release artifact carries the rendered tree

```text
Given a versioned release of an extension is published
When  an adopter installs that extension from the release artifact
Then  the target tool loads the extension with no further render
And    the artifact carries the tool's own manifest, rendered, declaring the
      version the release declares
```

**Scenario:** A source-only artifact is not a publishable release

```text
Given a candidate release artifact contains only the extension's committed
      source tree
When  the publication path evaluates that artifact
Then  publication fails, naming the rendered outputs the artifact lacks
And    no release is created carrying it
```

**Scenario:** Install-from-release performs the install-time resolution

```text
Given a target tool performs no rewriting at install and resolves no token
      inside a plugin-scoped declaration
When  an adopter installs the extension from its published release
Then  the install path resolves the token after the tool's own install has
      run, against the directory the tool itself reports
And    the installed state equals the state a fresh local render and install
      would produce
```

**Scenario:** A release-driver arm over an absent file is removed

```text
Given the release driver carries an arm that would write a version into a
      file no extension commits any more
When  the driver runs
Then  the arm reports success because it found nothing to write
And    requirement 21 forbids that state: the arm is removed, and the driver
      writes exactly the manifests the extension commits
```

## Out of scope

- **New declaration semantics.** The declaration vocabulary of every
  subject — commands, skills, agents, hooks, MCP servers, context — is
  frozen by specs 0173, 0179, 0180 and 0181. This spec migrates the
  scaffold, the reference extension, the readers and the publication path
  onto that vocabulary; it adds no subject, no key, and no option.
- **The extension-authoring documentation surface under `docs/`** —
  sub-spec S6 (issue #1009). Requirement 25 obliges only the same-change
  correction of documents this change's own removals falsify; the new
  authoring home and the MCP-server development guide are S6's.
- **Re-specifying the manifest-version guard's committed-manifest scope.**
  Spec 0044 as amended by its first delta already fixes that scope to the
  set of manifests an extension commits, and the arm over the de-committed
  tool manifest is already gone. Requirement 21 governs the release driver,
  which that delta's own out-of-scope routed here; it does not restate the
  guard.
- **Compiling an extension's own server or command sources.** The
  publication path packages what the render and the extension's own build
  produce; producing them remains the extension's build step, as spec 0180
  already records.
- **Any change to the extension tier model.** Which tier an extension lives
  under, which tiers the upstream sync guards, and which tiers a script
  walks are spec 0024's, preserved unchanged by every script this spec
  rewrites.
- **Enforcement on third-party extension repositories.** They follow the
  same contract, enforced in their own continuous integration.

## Open questions

- [GROUNDING:] The scaffold template's root manifest still declares
  `commands`, `skills` and `agents` through the enablement block spec 0173
  requirement 5 retires, and the scaffolding tool flips that block's
  booleans; the reference extension has already migrated to the generic
  sections. Resolved in-spec: requirement 1 moves the template onto the
  generic sections and requirement 13 makes the retired shape a loud
  failure rather than a readable fallback, so the divergence between
  template and reference ends by removal.
- [GROUNDING:] The admissibility record for per-CLI keys carries five
  entries deferred to this spec — three on the Claude section and one
  plugin-name key on each of the Copilot and Antigravity sections, the
  latter two recorded as reducible from the extension's own name. Resolved
  in-spec: requirement 7 obliges a recorded verdict for each and forbids a
  deferral from surviving, and requirement 8 answers the parent ticket's
  conditional — a per-CLI section is added for a tool only where a key
  survives the verdict, so a tool whose only key is reducible receives no
  section.
- [GROUNDING:] The published artifact of the most recent reference-extension
  release (`hello-world-v1.7.0`, asset `hello-world-extension-1.7.0.tgz`,
  4501 bytes, downloaded and listed on 2026-08-25) contains the committed
  source tree only: it carries none of the four outputs a fresh render
  produces for the in-place tool. Installing from that release therefore
  cannot work, while the maintainer decision of 2026-08-23 names
  install-from-release the default operating mode. Resolved in-spec:
  requirements 17, 18 and 22 oblige the artifact to be the rendered tree
  declaring the released version, and requirement 24 obliges the rehearsal
  that proves it before it publishes.
- [GROUNDING:] The installed in-place tool's own bundled documentation
  (version 0.46.0) states that an archive attached to a release must be
  fully self-contained with the tool's manifest at the archive root, and
  enumerates the asset-naming forms it resolves; the current asset is an
  npm package whose contents sit under a wrapper directory. This is vendor
  documentation, not a live probe, and the project's own record shows
  vendor documentation getting a per-tool detail wrong more often than not.
  Resolved in-spec: requirement 20 obliges the form to be pinned with
  evidence from the installed tool against a published artifact before the
  path is documented as the default.
- [GROUNDING:] A second release-creation path exists, triggered by the tag
  the primary driver creates; no run of it is recorded, consistent with a
  tag pushed under the automation's own credential not triggering a
  workflow. It would package the committed source tree, so a run would
  publish a non-conforming archive. Resolved in-spec: requirement 23
  obliges it to conform or be removed, and forbids its never having run
  from being read as evidence that it is harmless.
- [GROUNDING:] The enforcement's own test suite carries a paired negative
  asserting that a committed tool-designated ignore file and a committed gap
  declaration both pass the committed-file arm, on the ground that neither
  belongs to the generated-output class. Requirement 9 charges on the name
  axis rather than on class membership, so the first half of that pair
  becomes false while the second stays true. Resolved in-spec: requirement
  11 obliges the first half to be corrected in the same change and the
  second to be left intact, so the suite does not ship an assertion
  contradicting the requirement it exists to enforce.
- [USER-DECIDED] The scaffold template container commits one
  tool-designated file, `extension-skeleton/.geminiignore`, whose single
  `*` rule keeps the container out of that tool's file discovery in this
  repository's own workspace; the draft placed it outside requirement 9's
  subject on the ground that the container is not an extension source tree.
  Decided by the maintainer at the 2026-08-25 content gate: the file is
  deleted and the rule admits no exemption, so requirement 9 now reaches
  the container and mandates the deletion. Noted consequence of that
  decision: the template container loses that file-discovery exclusion, so
  a contributor's tool may surface the template's placeholder-bearing files
  when searching this repository. No residual question.
- [ABSORPTION] Issue #1010 reports that the scaffolding tool's placeholder
  substitution skips files a content-type heuristic classifies as data,
  leaving placeholder literals standing in scaffolded manifests; the same
  defect was independently re-found during the preceding sub-spec's
  implementation. Reproduced on 2026-08-25 against this branch's own tree
  on macOS 26.5.1 with `file` 5.41, which reports the committed manifests as
  data rather than as text. Resolved in-spec: requirement 3 obliges
  substitution to cover every text-carrying file including a data-classified
  manifest and adds the surviving-placeholder assertion the report asks for,
  so issue #1010 is absorbed by this spec rather than fixed separately.
- [SPEC-RELATION] No requirement line of spec 0044 is invalidated by this
  spec. Its first delta already narrowed the divergence guard to the
  committed manifest set, already removed the arm over the de-committed
  tool manifest, and already routed the release driver's re-specification
  here rather than to a further delta; the release-and-tagging mechanism
  sits in spec 0044's own out-of-scope. Requirements 21 and 22 therefore
  specify the driver in this spec, and no delta on spec 0044 ships in this
  wave. Should the implementation prove a spec 0044 line invalidated after
  all, `specs/0044-extension-versioning-manifest.delta-02.md` ships at that
  point as its own one-file spec-PR. No residual question.
- [SPEC-RELATION] No requirement line of spec 0024 is invalidated by this
  spec. Its tier model, its strict-and-excluded sync policy, and its
  obligation that the install, create, package, link and unlink scripts
  operate over all three tiers are preserved rather than changed: this
  spec's out-of-scope records the preservation, and the migration tool is
  an addition to that set rather than a change to it. No delta on spec 0024
  ships in this wave, and the same escape applies should the implementation
  prove otherwise. No residual question.
