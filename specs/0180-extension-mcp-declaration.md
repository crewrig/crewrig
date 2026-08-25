---
id: "0180"
slug: extension-mcp-declaration
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1006
version: 1.0.0
---

# Extension-scoped MCP server declaration

## Intent

An extension author declares the MCP servers an extension offers exactly once,
in the same vocabulary an organization already uses to declare its own servers,
and every supported command-line tool — Claude Code, Gemini CLI, GitHub Copilot
CLI, Antigravity CLI — makes those servers available once the extension is
installed. Today two of the four receive no server declaration at all, and an
extension that ships its own server code reaches only some of them with the
code that server needs in order to run. After this change no supported tool is
left out, a path pointing inside the extension's own directory resolves
wherever the extension ends up installed rather than wherever it happened to be
rendered, and an extension can never take over a server name the framework
manages for itself.

## Requirements

1. **(Single neutral vocabulary)** An extension SHALL declare its MCP servers
   in the `mcpServers` generic top-level section of its root manifest, mapping
   each server name to a transport selector whose admissible values are
   `stdio`, `http`, and `sse`; to a command with optional arguments and
   environment when the transport is `stdio`; and to an endpoint with optional
   headers when the transport is `http` or `sse`. An absent transport selector
   SHALL mean `stdio`. An extension that offers no MCP server SHALL omit the
   section entirely and SHALL remain valid, per spec 0173 requirement 5.
2. **(One vocabulary for one concept)** The vocabulary of requirement 1 SHALL
   be the vocabulary the org-level declaration channel of spec 0091 already
   uses for the same concept, and the neutral-to-native translation SHALL be
   that same translation, so a server name, transport, endpoint, command,
   argument, environment entry, or header means the same thing in an extension
   manifest as in the org channel. A second, extension-only vocabulary for the
   same concept SHALL NOT be introduced.
3. **(Native shapes are derived, never declared)** Each target's native server
   shape SHALL be derived from the neutral declaration. No per-CLI top-level
   section of the root manifest SHALL carry an MCP server key; such a key SHALL
   be a manifest validation error under spec 0173 requirement 3, and the
   permitted path SHALL be to declare the server in the generic section.
4. **(Neutral endpoint, native remote key)** A remote server SHALL be declared
   once under the neutral endpoint key, and each target's own remote key SHALL
   be produced from it — including the target whose native remote key differs
   from the neutral one. A target whose native remote shape cannot express a
   declared transport SHALL follow requirement 15 rather than silently receive
   nothing.
5. **(Clean break, no compatibility window)** A declaration that does not
   conform to requirement 1 SHALL be a manifest validation error; no
   compatibility window, dual-shape read, or fallback chain SHALL be introduced
   for the MCP subject. The permitted path for a non-conforming manifest SHALL
   be to rewrite the declaration in the vocabulary of requirement 1.
6. **(One neutral path token)** An extension SHALL express a path pointing
   inside its own installed directory through exactly one neutral token, SHALL
   NOT be required to name any target-specific token, and SHALL remain free to
   declare a command that names no such path at all.
7. **(Named resolver, named moment)** For each supported command-line tool the
   change SHALL record which party resolves the neutral token of requirement 6
   — the target tool itself when it loads the extension, or the project's own
   install step — and at which moment, and SHALL emit for that tool the form
   that party demonstrably resolves.
8. **(No render-time absolute path)** A rendered MCP declaration SHALL NOT
   carry an absolute filesystem path determined at render time. An absolute
   path materialized on the adopter's own machine at install time SHALL remain
   permitted; a path fixed at render time SHALL NOT, because the tree a release
   carries is installed on a machine other than the one that rendered it.
9. **(Evidence before delivery)** The resolution form chosen for each target
   under requirement 7 SHALL be pinned with recorded evidence obtained from
   that installed tool against a rendered tree, before the first built MCP
   declaration for that tool is delivered through any path of spec 0173
   requirement 20 as amended. A target for which such evidence cannot be
   obtained SHALL be treated as an unmappable declaration under requirement 15,
   never assumed to work.
10. **(Every supported tool receives the declaration)** A declared MCP server
    SHALL reach the MCP configuration of every supported command-line tool with
    no silent parity gap. A tool that receives nothing today SHALL receive the
    declaration after this change, or the omission SHALL be recorded as
    gap-acceptance evidence naming the probe of the installed tool that
    established it, per `docs/cli-matrix-maintenance.md` — never as an
    unexamined "by design".
11. **(Native plugin-scoped declaration is the delivery path)** Where a
    target's own extension or plugin format carries a plugin-scoped MCP
    declaration, the declared servers SHALL be delivered through that native
    declaration. An extension-declared server SHALL NOT be written into any
    user-level or workspace-level MCP configuration of any tool, so an
    extension can neither displace nor be mistaken for a framework-managed, an
    org-declared, or an operator-added entry in those files.
12. **(Framework-reserved names stay the framework's)** An extension SHALL NOT
    deliver a server under a framework-reserved MCP server name; such a
    declaration SHALL be a manifest validation error naming the extension and
    the reserved name, and the permitted path SHALL be to choose a name outside
    the reserved set. This mirrors the framework-wins rule of spec 0091
    requirement 10; the reserved set itself SHALL NOT change.
13. **(Precedence stated per tool, never assumed uniform)** Because requirement
    11 keeps extension-declared servers out of every user-level configuration,
    the framework-reserved over org-declared over operator-pre-existing order of
    spec 0091 SHALL remain intact and unreachable from an extension. Where a
    target tool resolves a name collision between an extension-declared server
    and a server already configured at another scope, that tool's own
    resolution SHALL be recorded with evidence from the installed tool and
    documented; one order SHALL NOT be asserted across tools that differ.
14. **(Server code layout)** An extension that ships MCP server implementation
    code SHALL keep its sources under one source directory and its executable
    output under one build-output directory, both at the extension root, and a
    declared command SHALL name the executable output rather than a source
    file. An extension that declares only servers it does not itself implement
    SHALL carry neither directory.
15. **(Unmappable declarations warn and are declared)** A well-formed MCP
    declaration with no expressible counterpart on a declared target SHALL
    produce a build warning and an entry in the render's observed gap set,
    SHALL NOT fail the render, and SHALL NOT be dropped silently — the policy
    of spec 0173 requirements 12 and 13 as amended. An extension whose MCP
    declarations all map on every target SHALL declare no MCP gap.
16. **(The named artifacts travel with the declaration)** Every target that
    receives a declaration naming the extension's own build output SHALL also
    receive that build output together with the package metadata its runtime
    needs in order to execute it. A target that receives one without the other
    SHALL be a failure of this requirement, whether what is missing is the
    declaration or the artifacts it names.
17. **(Generated-output class)** Every per-tool MCP file this change introduces
    SHALL be a member of the generated-output class, SHALL NOT be committed
    anywhere in an extension source tree, and SHALL turn the single
    continuous-integration capability of spec 0173 requirement 10 as amended
    red when one is committed.
18. **(Non-vacuous assertions)** The change SHALL carry assertions that turn
    red when a supported tool stops receiving a declared server, when a
    rendered declaration carries a render-time absolute path, when a
    framework-reserved name is delivered, and when a target receives a
    declaration without the artifacts it names. A property this spec asserts
    SHALL NOT be left merely unchecked and reported as satisfied.
19. **(Documentation and scaffold co-maintenance)** The change SHALL update, in
    the same change, the extension format documentation's MCP-server section,
    the extension skeleton's MCP-server scaffold, the per-CLI key allowlist,
    and the CLI-matrix rows describing extension-scoped MCP delivery for each
    of the four tools — so the documented model and the enforced model do not
    drift. The prose authoring guide stays with sub-spec S6 (issue #1009).

## Scenarios

**Scenario:** One declaration reaches all four tools

```text
Given an extension declares one stdio MCP server in its root manifest
When  the shared render runs for every target
Then  each of the four tools' rendered outputs carries that server
And    no target's output was produced from a per-CLI MCP declaration
```

**Scenario:** A remote server takes each tool's own remote key

```text
Given an extension declares one server with a remote transport and an endpoint
When  the render produces each target's output
Then  the target whose native remote key differs from the neutral one carries
      the endpoint under its own key
And    every other target carries it under the key that target reads
And    the endpoint was declared exactly once
```

**Scenario:** An extension-relative path resolves on the adopter's machine

```text
Given an extension declares a stdio server whose command names a path inside
      the extension's own directory
And    the rendered tree is installed on a machine other than the one that
      rendered it
When  each tool loads the installed extension
Then  the server is reached at its installed location
And    no rendered output carried the rendering machine's directory
```

**Scenario:** A render-time absolute path fails

```text
Given a render that resolves the neutral path token to the directory it renders
      into
When  the assertions of requirement 18 run
Then  they fail and name the output carrying the render-time path
```

**Scenario:** A framework-reserved name is refused

```text
Given an extension declares a server under a framework-reserved MCP server name
When  the manifest is validated
Then  validation fails, naming the extension and the reserved name
And    no target's output carries a server under that name
And    the framework-managed server of that name is untouched
```

**Scenario:** A declaration delivered without its artifacts fails

```text
Given an extension declares a stdio server whose command names the extension's
      own build output
When  a target receives the declaration but not that build output
Then  the assertions of requirement 18 fail and name the target
```

**Scenario:** A per-tool MCP file committed in a source tree fails

```text
Given a contributor commits a rendered per-tool MCP file inside an extension
      source tree
When  the single continuous-integration capability runs
Then  it fails and names the committed file
And    the message points at the delivery paths rather than at regenerating a
      committed file
```

**Scenario:** An MCP field with no counterpart warns and must be declared

```text
Given an extension declares an MCP field one target cannot express
When  the render runs
Then  the render succeeds with a warning
And    the observed gap set names the field and the target
And    the requirement 10 capability of spec 0173 fails until that gap is
      recorded in the extension's committed gap declaration
```

**Scenario:** An MCP key inside a per-CLI section is rejected

```text
Given a root manifest carries an MCP server key inside a per-CLI top-level
      section
When  the manifest is validated
Then  validation fails, naming the inadmissible key
```

## Out of scope

- The prose extension-authoring guide — sub-spec S6 (issue #1009). The
  normative layout of the MCP subject is fixed here: the declaration
  vocabulary, the code layout of requirement 14, and what each tool receives.
  The how-to-develop narrative that explains them is S6's.
- The org-level MCP declaration channel (spec 0091) and the setup-time merge
  machinery (spec 0089) — consumed as the precedent for the vocabulary, the
  translation, and the reserved-name rule, and left unmodified. No requirement
  here changes the org channel, the reserved set, or how a setup run writes a
  user-level configuration.
- An install-time fold of extension-declared servers into a user-level MCP
  configuration. The decomposition made this the guaranteed fallback for a tool
  whose plugin format carries no MCP declaration of its own; the probes
  recorded under `## Open questions` establish that both tools in question do
  carry one, so requirement 11's native path covers all four and no fallback is
  specified. A future tool whose plugin format lacks one is a fresh ticket, not
  a dormant clause here.
- Authorization extras beyond the neutral headers of requirement 1 — a target's
  own authentication-provider or OAuth block. A server needing one is declared
  with the headers the neutral vocabulary carries, or its gap is recorded under
  requirement 15.
- Compiling an extension's MCP server sources. The render delivers the build
  output requirement 16 names; producing that output remains the extension's
  own build step.
- Validating, health-checking, deduplicating, or normalizing a declared server
  — declared servers are delivered as declared and never audited, mirroring
  spec 0091.
- The hook declaration vocabulary (sub-spec S2, issue #1005), the context
  declaration vocabulary (sub-spec S4, issue #1007), and the skeleton and
  reference-extension migration together with release publication (sub-spec S5,
  issue #1008).
- Changing the set of framework-reserved MCP server names, or introducing new
  framework-managed servers.
- Enforcement on third-party extension repositories — they follow the same
  contract, enforced in their own continuous integration.

## Open questions

- [GAP-confirmation] **Antigravity CLI 1.1.19 does carry a plugin-level MCP
  declaration.** Probed against the installed tool on 2026-08-25: the vendor
  documentation it ships at
  `~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/plugins.md`
  lists `plugins/<plugin_name>/mcp_config.json` as an optional plugin member
  ("MCP servers exposed by the plugin"), and `docs/mcp_servers.md` names
  `plugins/<plugin_name>/mcp_config.json` as a first-class location alongside
  the global `~/.gemini/config/mcp_config.json`, with stdio
  `command`/`args`/`env` and remote `serverUrl`. A live materialized instance
  exists on disk at
  `~/.gemini/config/plugins/gemini-cli-security/mcp_config.json`. Resolved
  in-spec: requirement 11's native path applies, and the user-level fold is
  retired in `## Out of scope`. No residual question.
- [GAP-confirmation] **GitHub Copilot CLI 1.0.80 does carry a plugin-level MCP
  declaration, and the file is `.mcp.json` at the plugin root.** Probed
  empirically on 2026-08-25 against an isolated `HOME`: a plugin directory
  carrying five candidate filenames simultaneously
  (`.mcp.json`, `mcp-config.json`, `mcp.json`, `mcp_config.json`,
  `.github/mcp.json`) was registered in the tool's own installed-plugin
  registry, and `copilot mcp list --json` returned exactly the server declared
  in `.mcp.json`, tagged `"source": "plugin"`, and ignored the other four.
  `copilot mcp --help` independently names a `Plugin` configuration source,
  described as "Installed plugins with MCP servers", alongside the user-level
  `~/.copilot/mcp-config.json` and the workspace-level files. Resolved
  in-spec: requirement
  11's native path applies to Copilot too, closing the hole the decomposition
  identified. No residual question.
- [GROUNDING:] **The decomposition's precedence phrasing does not survive
  contact with the installed tools, and requirement 13 replaces it.** Issue
  #1006 asks that extension servers be slotted "below org, above
  operator-pre-existing". Gemini CLI 0.46.0's own bundled reference
  (`extensions/reference.md`) states the opposite for its scope pair: "If both
  an extension and a `settings.json` file define an MCP server with the same
  name, the server defined in the `settings.json` file takes precedence" — and
  `settings.json` is exactly where spec 0091 writes both the org-declared and
  the operator-pre-existing entries, so an extension there ranks *below* the
  operator, not above. Antigravity's `plugins.md` states a third behaviour
  again (plugin tools "namespaced if necessary to prevent collisions").
  Reconciled in-spec: requirements 11 and 13 keep extension servers out of every
  user-level configuration — which makes the spec 0091 order unreachable from an
  extension by construction, satisfying the "never over reserved" arm without
  asserting a cross-tool order that the evidence contradicts — and require each
  tool's own resolution to be recorded with evidence rather than assumed
  uniform. The reviewer of this spec is the right place to confirm that
  substitution.
- [GROUNDING:] **The Claude plugin build resolves the neutral path token at
  render time today, which requirement 8 forbids.**
  `scripts/build-claude-plugin.sh` substitutes `${extensionPath}` with its own
  output directory while generating `.mcp.json`, so the delivered declaration
  carries the absolute path of the machine that rendered it — harmless while
  the plugin was only ever built and installed on one machine, wrong the moment
  a release artifact carries the tree elsewhere (spec 0173 delta-01
  requirements 20 and 22). Claude Code 2.1.241 resolves `${CLAUDE_PLUGIN_ROOT}`
  itself at load time from the installed plugin directory — evidenced by the
  official marketplace plugin `discord/.mcp.json` on disk and by four
  `CLAUDE_PLUGIN_ROOT` substitution entries in the installed changelog — so a
  resolver exists and requirement 7 names it. Back-fill responsibility: the
  implementation change for this spec SHALL replace the render-time
  substitution in the same diff.
- [GROUNDING:] **Copilot's resolution of a plugin-root token inside `args` is
  not yet demonstrated, and requirement 9 is what closes it.** The 2026-08-25
  probe shows Copilot CLI 1.0.80 injecting `PLUGIN_ROOT`,
  `COPILOT_PLUGIN_ROOT`, and `CLAUDE_PLUGIN_ROOT` into the server process
  environment and defaulting `cwd` to `${PLUGIN_ROOT}` — a token the tool
  writes into the effective configuration itself — while `copilot mcp list`
  echoes `args` verbatim, which shows the merged declaration rather than the
  launched process and therefore settles nothing about expansion inside `args`.
  Resolved in-spec: requirement 9 mandates the evidence probe against the
  installed tool before delivery, and requirement 15 catches the case where no
  form resolves. No assumption is carried into the plan.
- [SPEC-RELATION] **No delta-spec on specs 0063 or 0065 ships in this wave.**
  The decomposition flagged both as likely. Assessed against their merged text:
  spec 0063 requirement 12 obliges the Antigravity build to copy the MCP server
  artifacts when `mcpServers` is present, which this spec keeps and extends
  rather than invalidates; spec 0065 requirement 3 enumerates what the Copilot
  build emits as a floor ("containing:"), not a ceiling, so adding an MCP
  declaration and the artifacts it names invalidates no line of it. Both
  specs' CLI-matrix obligations are surfaces requirement 19 updates in the same
  diff. If DEV proves a line of either invalidated after all,
  `specs/0063-antigravity-extension-formalism.delta-01.md` or
  `specs/0065-copilot-plugin-build.delta-01.md` ships at that point as its own
  one-file spec-PR. No residual question.
