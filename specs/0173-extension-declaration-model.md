---
id: "0173"
slug: extension-declaration-model
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1004
version: 1.0.0
---

# Extension declaration model and shared render and drift pipeline

## Intent

An extension author declares everything an extension offers — its identity and
each declaration subject: commands, skills, agents, hooks, MCP servers, context
— exactly once, in one generic root manifest, and every file a specific
command-line tool consumes is produced from that single declaration: committed
next to its source for the tool that reads the extension tree in place,
ephemeral for the tools that build a plugin. A file named after a command-line
tool is always a build output, never a hand-maintained source, and one guard
proves on every change that each committed generated file still matches its
declaration. Where a well-formed declaration has no counterpart on a target
tool, the absence surfaces as a build warning and a durable, diff-reviewable
gap record — never as a silent omission and never as a broken build. This
first sub-spec of the issue #725 redesign (second child family of the spec
0041 lifecycle) fixes the declaration model and the shared machinery; the
per-subject vocabularies plug in behind it.

## Requirements

1. **(Single generic root manifest)** An extension SHALL declare its entire
   cross-CLI surface in exactly one generic root manifest, `extension.json`,
   at the extension root, and each declaration subject — commands, skills,
   agents, hooks, MCP servers, context — SHALL be declared as a generic
   top-level section of that manifest, never inside a per-CLI section.
2. **(Irreducible per-CLI remainder)** A per-CLI top-level section of the root
   manifest SHALL carry only keys that pass the irreducibility test of
   requirement 3; a key whose meaning generalizes across command-line tools
   SHALL live in a generic section.
3. **(Normative irreducibility test)** A manifest key SHALL be admissible in a
   per-CLI section only when it is irreducible: the concept it configures
   exists on that one command-line tool alone, or its value cannot be derived
   from the generic sections, the extension's identity, or knowledge the
   render already holds about the target tool. A per-CLI key that fails the
   test SHALL be rejected as a manifest validation error, so per-CLI sections
   do not re-accrete.
4. **(A CLI-named file is a build output)** A file inside an extension source
   tree whose name designates a specific command-line tool SHALL be a build
   output produced from the declarations, never a hand-authored source; the
   only legitimate committed instance of such a file SHALL be a
   committed-generated output covered under the drift guard of requirement 10.
5. **(Enablement follows presence)** The generic schema SHALL NOT carry a
   subject enablement toggle: a declaration subject SHALL be enabled solely
   through the presence of its generic top-level section, an absent section
   SHALL mean the subject is absent, and subject-scoped options SHALL live
   inside the subject's own section. The current `components.*` toggle block
   SHALL NOT survive in the generic schema, and an extension declaring no
   subject at all SHALL remain valid, rendering only its per-CLI manifests.
6. **(Shared render pipeline)** One shared render entry point SHALL walk an
   extension's declarations and produce every CLI-native file for all four
   supported command-line tools — Claude Code, Gemini CLI, GitHub Copilot
   CLI, and Antigravity CLI — and the addition of a new declaration subject
   SHALL NOT require a second entry point or a second drift guard.
7. **(Committed or ephemeral dispatch)** The pipeline SHALL dispatch each
   output, per target tool, to exactly one of two forms: a committed-generated
   file for a tool that loads the extension tree in place, or an ephemeral
   build output for a tool that builds a plugin — matching how each tool
   demonstrably loads extensions.
8. **(Validation failure versus mapping gap)** The pipeline SHALL distinguish
   a manifest validation error — a malformed declaration or an inadmissible
   per-CLI key, which SHALL fail the build — from an unmappable declaration —
   a well-formed declaration with no expressible counterpart on a declared
   target tool, which SHALL follow the policy of requirement 12 and SHALL NOT
   fail the build.
9. **(Generated Gemini manifest)** `gemini-extension.json` SHALL be a
   committed-generated output derived from the generic root manifest, and a
   hand edit to it SHALL surface as drift under requirement 10.
10. **(Generalized drift guard, one CI capability)** A single check mode SHALL
    verify that every committed-generated output of every extension matches a
    fresh render of its declarations, SHALL fail while naming each drifted or
    stale file, and SHALL run as exactly one continuous-integration
    capability covering all committed-generated extension outputs, including
    those later subjects introduce.
11. **(Version lockstep preserved)** The generated `gemini-extension.json`
    SHALL declare the same version as the extension's single authoritative
    version declaration, and a release-time version bump SHALL leave the
    generated manifest drift-clean, so the existing manifest-version guard
    (spec 0044) and the drift guard stay green simultaneously.
12. **(Unmappable-declaration policy)** A well-formed declaration with no
    expressible counterpart on a declared target tool SHALL produce a build
    warning and an entry in a generated gap report; it SHALL NOT fail the
    build and SHALL NOT be dropped silently.
13. **(Durable gap report)** The gap report SHALL be a durable
    committed-generated artifact covered under the drift guard of requirement
    10, so the gap inventory is reviewable in diffs rather than ephemeral in
    logs; an extension whose declarations all map on every target SHALL carry
    no gap entry, and a stale gap entry SHALL surface as drift.
14. **(Path form pinned with evidence)** The generated `gemini-extension.json`
    SHALL carry path values in the one form the target tool demonstrably
    resolves when loading a committed manifest in place, and that form SHALL
    be pinned with recorded evidence from the installed tool before the first
    generated manifest is committed.
15. **(Commands conformance proof)** The commands subject SHALL be produced
    through the shared pipeline with outputs unchanged relative to the current
    render — the committed Gemini command form byte-identical and the
    plugin-side renders identical — and any command declaration a target tool
    cannot express SHALL be recorded through the requirement 12 policy rather
    than silently omitted.
16. **(Orphan manifest removed)** The skeleton's unconsumed Copilot manifest
    file, `extension-skeleton/base/.github/copilot/extension.json`, SHALL be
    removed, and any future native Copilot manifest surface SHALL be delivered
    as a generated output under requirement 4, never as a restored
    hand-authored file.
17. **(Documentation co-maintenance)** The change that realizes requirements 1
    through 16 SHALL update the extension format documentation, the CLI-matrix
    rows describing the extension build scripts and per-CLI manifests, and the
    layer classification of committed-generated extension files in the same
    change, so the documented model and the enforced model do not drift.

## Scenarios

**Scenario:** One declaration yields every CLI-native file

```text
Given an extension declares its whole surface once in the generic root manifest
When  the shared pipeline renders the extension
Then  the tool that loads the tree in place receives committed generated files
      inside the source tree
And    each tool that builds a plugin receives ephemeral outputs in its build
      directory
And    no CLI-named file inside the source tree was hand-authored
```

**Scenario:** The commands re-route is behavior-preserving

```text
Given the reference extension's commands are declared in the generic manifest
When  the generalized pipeline renders the commands subject
Then  the committed Gemini command files are byte-identical to the previous
      render
And    the plugin-side command renders are identical to the previous render
```

**Scenario:** The generated manifest stays version-locked across a release

```text
Given gemini-extension.json is generated from the generic root manifest
When  a release bumps the extension's authoritative version
Then  the generated manifest declares the new version
And    the manifest-version guard and the drift guard both pass
```

**Scenario:** A hand edit to a generated manifest is caught as drift

```text
Given gemini-extension.json is a committed-generated output
When  a contributor hand-edits it and the drift guard runs
Then  the guard fails and names the drifted file
And    the failure message points at regeneration from the declaration
```

**Scenario:** A reducible per-CLI key is rejected

```text
Given a root manifest carries a per-CLI key whose concept generalizes across
      command-line tools, failing the irreducibility test
When  the pipeline validates the manifest
Then  the build fails with a manifest validation error naming the inadmissible
      key
```

**Scenario:** An unmappable declaration warns and lands in the gap report

```text
Given an extension declares a subject entry with no expressible counterpart on
      one declared target tool
When  the pipeline renders the extension
Then  the build succeeds with a warning
And    the gap report gains a durable entry naming the declaration and the
      target
And    nothing is silently dropped
```

**Scenario:** A stale gap entry is drift

```text
Given a gap report carries an entry whose gap no longer exists
When  the drift guard runs
Then  the guard fails and names the stale gap report
```

## Out of scope

- The hook, MCP-server, and context declaration vocabularies and their
  translators — sibling sub-specs S2/S3/S4 of the issue #725 decomposition.
  This spec fixes where subjects are declared and how their outputs are
  dispatched and guarded, not what each subject's declaration says. Existing
  per-CLI manifest keys belonging to those not-yet-generalized subjects
  remain readable until their sub-spec lands; the irreducibility test binds
  them from that point on.
- Per-subject instantiation of the gap policy — which hook events, MCP
  fields, or context divergences are unmappable on which tool — S2/S3/S4.
- Full skeleton and reference-extension migration, the clean-break removal of
  the previous manifest shape, the migration tooling, and the removal of the
  dual-shape manifest fallback chains in the plugin builds — S5. Until S5
  lands, the previous shape remains readable where the interim requires it.
- Re-specification of the release driver and the manifest-version guard for
  the generated-manifest world — the spec 0044 delta, owned by S5. This spec
  constrains only that the generated manifest stays lockstep-clean
  (requirement 11) under the unchanged driver.
- The extension-authoring documentation surface under `docs/` — S6.
- Workspace- and user-level surfaces: the per-CLI transcript hooks and the
  org MCP declaration channel (spec 0091) — consumed as precedents, not
  modified.
- Any change to the rendering of `artifacts/` components — their
  pivot-to-CLI compilation is unchanged.
- Enforcement on third-party extension repositories — they follow the same
  contract, but continuous-integration enforcement runs in their
  repositories, not this one.

## Open questions

- [SPEC-RELATION] The issue #725 decomposition flagged a likely delta-spec on
  spec 0042 ("its committed-generated rule becomes an instance of the general
  one"). Assessed against 0042's merged text: none of its seven requirements
  names the committed-generated form, a dedicated script, or the check
  mechanism — the committed-generated pattern lives in `docs/cli-matrix.md`
  row 5b and the render script's own header, both surfaces the implementation
  PR updates in the same diff (requirement 17). No normative line of spec
  0042 is invalidated, so no delta-spec ships in this wave; if DEV proves a
  0042 line invalidated after all, `specs/0042-extension-pivot-render.delta-01.md`
  ships as its own one-file spec-PR at that point. No residual question.
- [GROUNDING:] The two reference-extension manifests disagree on the MCP path
  form today (`extensions/core/hello-world/extension.json` carries
  `${extensionPath}/dist/index.js`; the hand-maintained
  `gemini-extension.json` carries `dist/index.js`) — the exact ambiguity
  requirement 14 exists to close. Resolved in-spec: requirement 14 mandates
  the evidence probe that pins the correct form before the first generated
  manifest is committed; the interim hand-alignment of the drifted value
  belongs to the standalone fix ticket S0 of the issue #725 decomposition,
  not to this spec.
- [GROUNDING:] Observed toggle usage diverges from the drafted requirement 5:
  `components.hooks` is read by no script, while
  `components.{commands,skills,agents}` options (`enabled`, `location`,
  `convertToSkills`) are read by the three plugin build scripts. Resolved
  in-spec: requirement 5 relocates the read, subject-scoped options into each
  subject's generic section and requirement 15 pins the relocation as
  behavior-preserving; the dead `components.hooks` toggle disappears with the
  block.
