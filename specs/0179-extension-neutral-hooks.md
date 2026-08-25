---
id: "0179"
slug: extension-neutral-hooks
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1005
version: 1.0.0
---

# Neutral extension hook declaration and four-CLI translation

## Intent

An extension author declares each hook once — a lifecycle moment, the class of
tool it watches, and the command to run — and every supported command-line tool
receives that hook written in the shape it actually reads, with the wrapper,
the time unit and the path form that tool requires. Where a declared lifecycle
moment or tool class has no counterpart on one of the tools, the author is told
so out loud at build time and the absence is recorded in a reviewable
inventory, rather than being approximated into a neighbouring event or dropped
in silence. The correspondence between the neutral vocabulary and each tool's
own event names is itself a published, evidence-backed artifact that states
where the vocabulary does not reach, and a check keeps that artifact and the
translation from drifting apart. This second sub-spec of the issue #725
redesign turns the hook subject the parent spec named into a subject the
pipeline can actually render.

## Requirements

1. **(Single generic hook declaration site)** An extension SHALL declare every
   hook it provides in the generic `hooks` section of its root manifest, and no
   hook SHALL be declared in a per-CLI section of that manifest nor in a
   hand-authored per-tool hook file inside the extension source tree. An
   extension that provides no hook SHALL omit the section entirely, SHALL
   remain valid, and SHALL render no hook output on any target.
2. **(Enablement follows presence)** The hooks subject SHALL be enabled solely
   by the presence of the generic `hooks` section, per the enablement rule the
   parent spec fixes. A legacy `components.hooks` toggle SHALL NOT enable the
   subject, SHALL NOT be read by any renderer, and SHALL NOT survive in any
   declaration this change leaves behind, so no manifest carries a toggle that
   appears to resolve the subject and does not.
3. **(Hook entry vocabulary)** Each entry of the generic `hooks` section SHALL
   carry a stable hook identifier, exactly one neutral lifecycle event, and one
   command to execute; it MAY carry a neutral tool-class matcher, an execution
   time limit, and a human-readable description. An entry missing the
   identifier, the event, or the command SHALL be a manifest validation error
   that fails the build and names the offending entry.
4. **(Closed, evidence-backed event vocabulary)** The neutral lifecycle event
   names SHALL form a closed enumerated set. A name SHALL be admitted to that
   set only when at least one supported command-line tool demonstrably exposes
   a counterpart and that evidence is recorded; a declared event outside the
   set SHALL be a manifest validation error that names the admissible set.
5. **(Normative correspondence artifact)** The mapping from each neutral
   lifecycle event to each supported tool SHALL be published as a normative
   artifact of the repository. Every cell SHALL state either the target's own
   event name or an explicit no-counterpart marker; no row SHALL be omitted to
   avoid showing a no-counterpart cell; the vocabulary SHALL NOT be presented
   anywhere as expressible on every target. The artifact SHALL record, per
   target column, the hook file that target reads for an extension, the tool
   version the column was grounded against, and the probe method used.
6. **(The artifact and the translation agree, mechanically)** A single check
   SHALL assert that the correspondence artifact and the translation the render
   performs agree, and SHALL fail while naming each disagreeing cell. The check
   SHALL be non-vacuous: changing the artifact alone, and changing the
   translation alone, SHALL each turn it red.
7. **(A matcher names a tool class, never a target's tool)** A matcher declared
   on a hook entry SHALL name a neutral tool class drawn from a closed
   enumerated set, and the render SHALL substitute, per target, the tool name
   or pattern that target uses for that class. A target's own tool name or a
   target-specific pattern SHALL NOT be admissible as a neutral matcher value,
   and a matcher naming a class outside the set SHALL be a manifest validation
   error.
8. **(Matcher admissibility follows the event)** A matcher SHALL be admissible
   only on a neutral event whose counterpart accepts one on at least one
   target; a matcher declared on an event that accepts none SHALL be a manifest
   validation error rather than a silently ignored key. An entry that omits the
   matcher on a matcher-accepting event SHALL be rendered, on each target that
   expresses a match-all form, as matching every tool.
9. **(Structural form follows the target, per event)** For each target the
   render SHALL emit each hook in the structural form that target requires for
   that specific event — including a target that requires one form for its
   tool-scoped events and a different form for its lifecycle events — so that a
   valid declaration never yields a hook file the target rejects.
10. **(Time limits are converted, never copied)** A declared execution time
    limit SHALL be expressed in one canonical unit in the generic declaration,
    and the render SHALL emit it in the unit each target's own hook format
    uses, converting where the units differ. The unit each target uses SHALL be
    pinned with recorded evidence. A declaration that omits the limit SHALL
    leave that target's own default in force rather than emitting a synthesized
    value.
11. **(One extension-root token, resolved per target with evidence)** A hook
    command SHALL refer to a file inside its own extension through exactly one
    neutral extension-root token, and the render SHALL emit, per target, the
    form that target demonstrably resolves — the target's own path variable
    where one exists, and where none exists a form that target's documented
    working-directory rule resolves. The form chosen for each target SHALL be
    pinned with recorded evidence obtained from the installed tool before any
    hook output is delivered through a supported delivery path.
12. **(No neutral token survives the render)** The render SHALL leave no neutral
    token unresolved in any emitted hook file, and a check SHALL assert that
    zero neutral tokens survive in every emitted hook output, failing while
    naming each file and each surviving token. The check SHALL be non-vacuous:
    a single un-substituted token SHALL turn it red.
13. **(Hook outputs are build outputs)** Every per-tool hook file the render
    produces SHALL be a build output written into the extension's build
    directory and SHALL NOT be committed on the primary branch; the per-tool
    hook file names SHALL be members of the generated-output class that the
    single continuous-integration capability asserts against, so a committed
    instance of one fails that capability and is named by it.
14. **(Gap policy instantiated at hook granularity)** A hook whose neutral
    event, or whose neutral matcher class, has no counterpart on a declared
    target SHALL produce a build warning and an entry in the render's observed
    gap set, SHALL NOT fail the build, and SHALL NOT be emitted into that
    target's hook file in an approximated form. The entry SHALL name the hook
    identifier, the neutral event, the target, and whether the event or the
    matcher is the unmappable part, so two hooks differing only in event
    produce distinguishable entries.
15. **(The gap is recorded before it reaches the primary branch)** Each observed
    hook gap SHALL be reconciled by the single continuous-integration
    capability against the extension's committed gap declaration, which SHALL
    fail while naming every hook gap observed but undeclared and every declared
    hook gap the render no longer observes. An extension whose hooks all map on
    every declared target SHALL declare no hook gap.
16. **(Retired checks are removed, not left green over nothing)** The blanket
    gap the render records today for the hooks subject, which states only that
    the subject has no renderer yet, SHALL be removed in the same change that
    gives the subject a renderer, and SHALL NOT survive alongside the per-event
    gaps. The per-CLI key allowlist rows that admit a per-CLI hook key by
    deferral SHALL likewise be removed, so a re-introduced per-CLI hook key is
    rejected as inadmissible rather than admitted by a stale row.
17. **(Skeleton scaffold in the neutral dialect)** The extension skeleton's hook
    scaffold SHALL be expressed as a neutral declaration only, SHALL be wired to
    the shared render like any other extension's declaration, and SHALL leave no
    hand-authored per-tool hook file in the skeleton. The scaffold's example
    hook SHALL render on every target on which its declared event has a
    counterpart.
18. **(The reference extension exercises both paths)** The reference extension
    SHALL declare at least one hook whose neutral event has a counterpart on
    every supported target, and at least one whose neutral event has a
    counterpart on some but not all of them, so that one render of the
    reference extension exercises the translation path and the gap path
    together.
19. **(Superseded per-CLI hook requirements are retired)** The merged
    requirements that admit a per-CLI `hooks` key in the extension manifest and
    oblige a build script to render a hook file from it — requirements 1 and 13
    of `specs/0063-antigravity-extension-formalism.md` and requirements 1 and 3
    of `specs/0065-copilot-plugin-build.md` — SHALL be retired by their own
    delta-specs in the same wave as this spec, so no merged requirement obliges
    a manifest shape this spec forbids.
20. **(Documentation co-maintenance)** The change that realizes requirements 1
    through 19 SHALL update, in the same change, the extension format
    documentation so that it describes exactly one hook declaration site, no
    longer carries a per-CLI hook key, and no longer states two different
    surfaces for the in-place tool's extension hooks; the CLI-matrix rows
    describing extension hooks and the extension build scripts; and the layer
    classification of per-tool hook outputs — so the documented model and the
    enforced model do not drift.

## Scenarios

**Scenario:** One hook declaration yields every target's native shape

```text
Given an extension declares one hook in the generic hooks section, naming a
      neutral event that every supported target expresses
When   the shared pipeline renders the extension
Then   each target's build output carries that hook in the file that target
       reads, in the structure that target requires
And    the committed source tree gains no hook file
```

**Scenario:** A tool class becomes each target's own tool name

```text
Given a hook declares the neutral tool class for shell command execution
When   the pipeline renders the extension for every target
Then   each target's emitted hook matches that target's own shell tool
And    no emitted matcher carries the neutral class name verbatim
```

**Scenario:** A time limit is converted into each target's unit

```text
Given a hook declares an execution time limit in the canonical unit
When   the pipeline renders the extension for two targets whose hook formats
       use different time units
Then   each emitted hook carries the limit expressed in that target's own unit
And    a hook that declares no limit emits no limit at all
```

**Scenario:** An event with no counterpart warns and is recorded

```text
Given a hook declares a neutral event that one declared target does not express
When   the pipeline renders the extension
Then   the build succeeds with a warning naming the hook, the event and the
       target
And    the observed gap set gains an entry naming the same three
And    that target's emitted hook file carries no approximation of the hook
```

**Scenario:** An unrecorded hook gap fails the capability

```text
Given the render observes a hook gap that the extension's committed gap
      declaration does not carry
When   the single continuous-integration capability runs
Then   the capability fails and names the observed, undeclared hook gap
```

**Scenario:** A declared hook gap the render no longer observes fails

```text
Given the extension's committed gap declaration carries a hook gap that the
      render no longer observes
When   the single continuous-integration capability runs
Then   the capability fails and names the stale declared hook gap
```

**Scenario:** A per-CLI hook key is rejected

```text
Given a root manifest declares a hook under a per-CLI section
When   the pipeline validates the manifest
Then   the build fails with a manifest validation error naming the inadmissible
       per-CLI hook key
And    the allowlist carries no row that would have admitted it
```

**Scenario:** A matcher on an event that accepts none is rejected

```text
Given a hook declares a neutral matcher on a neutral event that no target
      matches against
When   the pipeline validates the manifest
Then   the build fails with a manifest validation error naming the entry
And    the matcher is not silently ignored
```

**Scenario:** An unresolved neutral token fails the check

```text
Given a rendered hook file retains a neutral extension-root token that the
      render failed to substitute for one target
When   the token check runs
Then   the check fails and names the file and the surviving token
```

**Scenario:** A committed hook output fails the capability

```text
Given a contributor commits a rendered per-tool hook file inside an extension
      source tree
When   the single continuous-integration capability runs
Then   the capability fails and names the committed file
And    the failure message points at the supported delivery paths rather than
       at regenerating a committed file
```

**Scenario:** The correspondence artifact and the translation disagree

```text
Given the published correspondence artifact names a target event that the
      render's translation does not produce for that neutral event
When   the agreement check runs
Then   the check fails and names the disagreeing cell
```

## Out of scope

- Workspace- and user-level transcript hooks (`hooks/*-transcript-hooks.json`)
  and their deployment by the interactive setup scripts. They are the evidence
  base that four dialects exist, not targets of this spec; specs 0116, 0164 and
  0169 continue to govern them unchanged, and nothing here obliges them to be
  re-expressed in the neutral dialect.
- The MCP-server and context declaration vocabularies and their translators —
  sub-specs S3 (issue #1006) and S4 (issue #1007). The per-CLI keys and
  hand-authored context files belonging to those subjects keep the interim the
  parent spec grants them.
- The payload contract between a running hook and its tool — the JSON a hook
  receives on standard input, the fields it may return, the meaning of its exit
  codes, and the flow-control semantics of each event. This spec governs how a
  hook is declared and where it is written, not what it says to the tool once
  it runs.
- Hook execution kinds other than running a command — the HTTP, prompt, agent
  and MCP-tool hook kinds some targets expose. Only command execution is in the
  neutral vocabulary; adding another kind is a later change.
- Adding a neutral event for a lifecycle moment that no supported tool exposes.
  The vocabulary is bounded by what at least one target demonstrably expresses.
- Full skeleton and reference-extension migration beyond the hook subject, the
  clean-break removal of the previous manifest shape, and the removal of the
  dual-shape fallback chains in the plugin builds — S5 (issue #1008).
- Publication of the rendered tree as a versioned release artifact and the
  install-from-release experience — S5, per the parent spec's release-side
  boundary.
- The extension-authoring documentation surface under `docs/` — S6.
- Enforcement on third-party extension repositories: they follow the same
  contract, but continuous-integration enforcement runs in their repositories.

## Open questions

- [GROUNDING:] The reference extension and the skeleton both carry per-CLI hook
  keys today (`gemini.hooks`, `claude.hooks`, and in the skeleton also
  `copilot.hooks` / `antigravity.hooks` by way of its per-CLI sections), and
  `scripts/lib/extension-percli-keys.json` carries four `deferred:S2` rows that
  admit them. Resolved in-spec: requirement 1 moves the declaration to the
  generic section, and requirement 16 removes the four allowlist rows in the
  same change, so the deferral ends by removal rather than by a row left
  passing over an absent subject.
- [GROUNDING:] The Copilot CLI column is the one column this spec's authoring
  probes could not ground. The installed binary (self-reported version 1.0.80)
  yields no readable hook strings, and the one installed plugin declares no
  hook, so the plugin-level hook file placement, the event set a plugin may
  register, the matcher form, the time unit and any extension-root variable
  remain ungrounded — the repository's own deployed user-level manifest is
  evidence of the user-level schema only. Resolved in-spec: requirement 5
  obliges every column of the correspondence artifact to record its tool
  version and probe method, and requirements 10 and 11 oblige the time unit and
  the extension-root form to be pinned with recorded evidence, so the artifact
  cannot ship with this column filled by analogy.
- [GROUNDING:] For Claude Code the vendor documentation states hook time limits
  with a seconds suffix in prose but does not formalize the unit in the schema,
  and its enumerated event list is narrower than the set of event tokens
  present in the installed binary. Resolved in-spec: requirement 10 obliges the
  unit to be pinned with recorded evidence rather than inferred from prose, and
  requirement 5 obliges the probe method to be recorded per column, so a
  divergence between a vendor document and the installed tool is recorded
  rather than silently resolved in favour of one of them.
- [GROUNDING:] The Antigravity CLI exposes no extension-root path variable; its
  documented rule is that a hook handler's working directory is the directory
  holding the hook file — the same rule that made a working-directory
  assumption actively wrong for the workspace-level manifest (`docs/cli-matrix.md`
  row 9). Resolved in-spec: requirement 11 admits a working-directory-resolved
  form as one of the two permitted per-target forms, and obliges it to be
  pinned with evidence from the installed tool rather than assumed.
- [GROUNDING:] The skeleton manifest still carries the whole legacy
  `components.*` block, including `components.hooks`, which no script reads.
  Resolved in-spec: requirement 2 removes the `hooks` toggle in this change;
  the remaining `components.*` entries belong to the clean-break migration
  already scoped to S5 and are untouched here.
- [SPEC-RELATION] Requirements 1 and 13 of spec 0063 and requirements 1 and 3
  of spec 0065 oblige exactly the manifest shape requirement 1 forbids, so
  unlike the parent spec's assessment of spec 0042 this is a direct
  invalidation rather than documentation drift. Resolved in-spec: requirement
  19 obliges both delta-specs to ship in this wave, each as its own one-file
  spec-PR. No requirement of spec 0053 or spec 0058 is invalidated — both name
  hooks only in their out-of-scope sections. No merged spec governs the
  `claude.hooks` key, which predates the lifecycle. No residual question.

## Notes

- **Probe record (authoring-time evidence).** The requirements above oblige the
  implementation to publish an evidence-backed correspondence artifact; the
  table below records what this spec's own probes established, as that
  artifact's starting inputs. It is descriptive, not normative.

  | Target | Version probed | Probe method | Extension hook file | Structure | Matcher | Time unit | Extension-root form |
  |---|---|---|---|---|---|---|---|
  | Claude Code | 2.1.241 | Vendor documentation, plus event and variable tokens found in the installed binary | `hooks/hooks.json` at the plugin root | Event key to array of matcher-plus-handlers groups | Tool name, exact or regex; shell tool is `Bash` | Not formalized in the schema — ungrounded | `${CLAUDE_PLUGIN_ROOT}` |
  | Gemini CLI | 0.46.0 | Documentation shipped in the installed bundle, plus the bundle's own extension-hook loader | `hooks/hooks.json` in the extension directory, explicitly *not* the manifest | Envelope with a `hooks` object, event key to array of matcher-plus-handlers groups | Regex over tool names; shell tool is `run_shell_command` | Milliseconds, default 60000 | `${extensionPath}`, substituted in this file |
  | Antigravity CLI | 1.1.19 | Vendor hook and plugin contract shipped on disk with the CLI | `hooks.json` at the plugin root | Map of named hooks; tool events grouped with a matcher, lifecycle events flat | Regex over tool names; shell tool is `run_command` | Seconds, default 30 | No variable; working directory is the directory holding the hook file |
  | GitHub Copilot CLI | 1.0.80 self-reported | Command-line help only; binary yields no hook strings and no installed plugin declares a hook | Ungrounded | Ungrounded at plugin level; user level uses a camelCase object under a `version` field | Ungrounded | Ungrounded | Ungrounded |

- **The vocabulary is provably not total.** The probed event sets do not
  intersect in a way that would let every neutral event reach every target.
  The Antigravity CLI exposes five events and none of them corresponds to a
  user-prompt submission or to a session boundary, while Claude Code and Gemini
  CLI each express both; conversely Gemini CLI and the Antigravity CLI each
  express a moment around the model invocation that Claude Code does not.
  Requirement 5 exists so
  that this asymmetry is visible in a published table rather than discovered
  by an author whose hook silently never fires.

- **Relation to the parent spec.** This spec instantiates the parent's
  unmappable-declaration policy for one subject; it does not restate it.
  The build directory, the observed gap set, the committed gap declaration, the
  generated-output class and the single continuous-integration capability are
  the parent's, as amended by its first delta, and requirements 13 through 16
  bind the hook subject into them rather than introducing a second mechanism.
