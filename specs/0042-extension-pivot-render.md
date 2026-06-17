---
id: "0042"
slug: extension-pivot-render
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 347
version: 1.0.0
---

# Extension pivot source and per-CLI render

## Intent

A skill, agent, or command shipped inside an extension is authored exactly
once, in the same pivot source format used by `artifacts/` components, and the
adopter receives it on every supported command-line tool in the shape that tool
actually loads — a plugin form for the tool that builds one, native in-place
files for the tool that reads extensions directly. Where a command-line tool
offers no surface for a given component, the absence is recorded as a documented
gap rather than a silent omission, so an adopter always knows whether a
component is available, unavailable, or unsupported on each tool. This first
child of the extension artifact lifecycle removes today's asymmetry where
extension agents and commands are authored as command-line-tool-native sources
outside the pivot format.

## Requirements

1. **(Pivot authoring)** Every skill, agent, and command shipped inside an
   extension SHALL be authored in the single pivot source format used by
   `artifacts/` components, and SHALL NOT be authored as a
   command-line-tool-native source directly.
2. **(Per-CLI render)** Each pivot-format extension component SHALL be rendered
   into the form that each supported command-line tool consumes, so that one
   authored source yields the component for Claude Code, Gemini CLI, and GitHub
   Copilot CLI without a second hand-authored source.
3. **(Consumed-form fidelity)** The rendered form of an extension component for a
   given command-line tool SHALL match how that tool loads extensions — a built
   form for a tool that builds extensions, an in-place native form for a tool
   that reads extensions directly — rather than a uniform output that a tool
   does not load.
4. **(Documented gap)** Where a supported command-line tool provides no
   extension surface for a component class, that gap SHALL be recorded with
   concrete evidence that the surface does not exist in that tool, consistent
   with the project's command-line-tool parity contract, rather than left as a
   silent omission.
5. **(Carrier safety)** The render of an extension component SHALL carry any
   component metadata that a target command-line tool does not accept in its
   native frontmatter in a form that tool accepts, so that rendering an
   extension component never produces a source the target tool rejects. The
   content of that metadata is governed by a sibling sub-spec and is out of
   scope here.
6. **(Back-fill)** The existing `extensions/core/hello-world` component
   currently authored in a command-line-tool-native source SHALL be migrated to
   the pivot source format in the same change that introduces requirement 1, so
   that no extension component on the primary branch violates requirement 1.
7. **(Enforcement)** A continuous-integration guard SHALL fail the build when a
   skill, agent, or command under an upstream-owned extension tier is authored
   in a command-line-tool-native source instead of the pivot source format.

## Scenarios

**Scenario:** One pivot source renders to every command-line tool's consumed form

```text
Given an extension ships a skill and a command authored once in the pivot source
      format
When  the extension is rendered
Then  Claude Code receives the component in its built plugin form
And    Gemini CLI receives it in the native in-place form Gemini loads directly
And    no component required a second hand-authored command-line-tool-native
      source
```

**Scenario:** The sole native-source fixture is migrated to pivot

```text
Given extensions/core/hello-world ships its command as a command-line-tool-native
      source (commands/hello.toml)
When  the change that introduces pivot authoring lands
Then  the command is authored as a pivot source
And    no component under extensions/ remains authored in a command-line-tool-native
      source
```

**Scenario:** Metadata beyond a tool's accepted frontmatter renders without rejection

```text
Given an extension component carries metadata beyond the keys a target
      command-line tool accepts in native frontmatter
When  the component is rendered for that tool
Then  the metadata travels in a form the tool accepts
And    the rendered component is not rejected by the tool
```

**Scenario:** The guard rejects a native-source extension component

```text
Given a skill, agent, or command is added under an upstream-owned extension tier
      authored in a command-line-tool-native source
When  the continuous-integration guard runs against the change
Then  the guard fails the build and identifies the offending component
```

**Scenario:** An absent extension surface is recorded as a documented gap

```text
Given a supported command-line tool offers no extension surface for a component
      class
When  the parity of the extension render is assessed
Then  the gap is documented with evidence that the surface does not exist in that
      tool
And    it is not presented as a silently missing output
```

## Out of scope

- The content and schema of any `metadata.provenance` block on extension
  components — governed by sibling sub-spec 0041-B (extension provenance and
  harness routing). This spec owns only the carrier that safely transports
  metadata through each command-line tool's render, not what the metadata says.
- Per-component versioning of extension components — governed by sibling
  sub-spec 0041-C (extension versioning and manifest enforcement).
- The render mechanism — whether a dedicated extension build path is added,
  reused, or extended — is HOW, deferred to this sub-spec's PLAN stage.
- Any change to the rendering of `artifacts/` components — their pivot-to-CLI
  compilation is unchanged.
- Building an extension surface for a command-line tool that has none today
  (e.g. a placeholder-only tool) — such a gap is documented per requirement 4,
  not constructed here.
- The per-tier feedback-routing invariant and the early-binding `canonical`
  decision — inherited from spec 0041 and realized by sibling sub-spec 0041-B.

## Open questions

- [GROUNDING:] The only extension component on the primary branch authored in a
  command-line-tool-native source is the `hello-world` command
  (`extensions/core/hello-world/commands/hello.toml`); the `greeter` skill is
  already in pivot `SKILL.md` shape and no extension ships an agent today.
  Back-fill responsibility is resolved: requirement 6 migrates the `hello-world`
  command in the implementation PR for this spec, and the guard introduced by
  requirement 7 prevents regression.
