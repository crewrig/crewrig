---
id: "0316"
slug: generated-provenance-markers
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 2095
version: 1.0.0
---

# Generated provenance markers on every frictionable artifact

*Amending spec, not a delta-spec: specs `0043` and `0312` are immutable and no `class: spec` finding drives this change (`docs/spec-format.md` → *Delta-spec convention*). It turns the Decision of [ADR-0028](../docs/adr/0028-generate-provenance-markers-on-every-frictionable-artifact.md) (Accepted) into requirements and is the contract of follow-ups #2096, #2097, #2098, #2099 and #2100. Grounding, each point checked in the tree: (a) the manifests a renderer writes per CLI hold a fixed key set: `plugin.json` of Claude has `name`, `description`, `version`, `author` (`scripts/lib/extension/plugin-claude.ts:57-62`); of Copilot and Antigravity `name`, `version`, `description` (`plugin-copilot.ts:54-58`, `plugin-antigravity.ts:54-58`); `gemini-extension.json` has `name`, `version`, `description`, `contextFileName`, `mcpServers`, `themes` (`gemini-render.ts:151-158`); a hook file is a bare event map of `type`, `command` and `matcher` (`hooks-emit.ts:27-47`); an MCP file is `{mcpServers: <native entries>}` (`plugin-common.ts:149-152`). None has a slot for `package`, `canonical` or `feedback`, and the first four carry `name` and `version` only. (b) `scripts/check-skill-versions.ts` delegates to `scripts/lib/governance/skill-versions.ts`, which scans a fixed `PATHSPECS` list of `artifacts/{core,library,community}/{skills,commands,agents}` sources and accepts a file when its diff adds a line matching `^\+[ \t…]+version:[ \t…]*"`; it reads no frontmatter. (c) `artifacts/core/rules/*.md` and `artifacts/core/system-context/*.md` have no frontmatter, and core hooks are the `hooks/*.ts` scripts.*

## Intent

Whoever files a friction against an artifact finds, on that artifact, where it comes from: its package, its owning extension when it has one, its version, the repository that maintains it and the repository that receives feedback on it. This holds for every kind of artifact CrewRig or one of its extensions ships, on all four CLIs, and no contributor writes or keeps in step any of those values by hand beyond the one version a component already declares. A friction filed against an artifact that carries no such marker is still attributed, by a documented fallback, and the issue the curator opens names the package, the extension and the version.

## Requirements

Requirements are tagged with a group. Groups map to follow-ups: **A** and **H** are the shared contract (no implementation of their own); **C** is #2096; **B** and **D** are #2097; **E** is #2098; **F** is #2099; **G** is #2100.

1. **R1 (field set; group A).** A provenance marker SHALL consist of `package`, `extension`, `version`, `canonical` and `feedback`. A field that does not apply SHALL be omitted, never emitted empty. `extension` SHALL be omitted for a canonical artifact (including a core hook) and `package` SHALL be present on every marker.
2. **R2 (one source per field; group A).** Each field SHALL have exactly one source, as follows. For a canonical artifact (`artifacts/**`, rules, system-context files, core hooks): `package` is the `name` of the root `package.json`; `version`, `canonical` and `feedback` are the component's authored `metadata.provenance` values (R12 for files without frontmatter), `${CANONICAL_REPO}` and the `feedback` rule of spec 0030 resolved at build as today. For an extension artifact: `package` is the `name` of the extension's `package.json`; `extension` the `name` of its `extension.json`; `version` the `version` of its `package.json` (spec 0312 R3 stands); `canonical` and `feedback` the keys of R7. No tool SHALL write a value into a source file.
3. **R3 (encodings; group A).** The marker SHALL have two encodings of one field set: the YAML `metadata.provenance` block in frontmatter, and the line `crewrig-provenance: package="…" extension="…" version="…" canonical="…" feedback="…"` on the first body line, in the comment syntax of the host format (`<!-- … -->` in Markdown, `# …` in TOML).
4. **R4 (carrier per kind and CLI; group A).** Carriers SHALL follow the table below on every CLI; a cell that a CLI cannot honour SHALL be recorded as an accepted gap with evidence in `docs/cli-matrix.md`, never left silent.

   | Kind | Claude Code | Gemini CLI | Copilot CLI | Antigravity CLI |
   |---|---|---|---|---|
   | Canonical skill | YAML | YAML | YAML | YAML |
   | Canonical agent | YAML | line `<!-- -->` | YAML | YAML |
   | Canonical command | YAML | line `#` | YAML (as skill) | YAML (as skill) |
   | Rule, system-context file | line `<!-- -->` | line `<!-- -->` | line `<!-- -->` | line `<!-- -->` |
   | Extension skill, agent, context | line `<!-- -->` | line `<!-- -->` | line `<!-- -->` | line `<!-- -->` |
   | Extension command | YAML (as skill) | line `#` | YAML (as skill) | YAML (as skill) |
   | Hook, MCP server | R5 | R5 | R5 | R5 |
   | Bundled script | the owning skill's marker | same | same | same |

5. **R5 (executable artifacts; settles i1-F2; group A).** The manifests listed in the grounding cannot carry `package`, `canonical` or `feedback`, so a hook or an MCP server of an extension SHALL NOT be marked inside those manifests. Each rendered extension output, on every CLI, SHALL instead contain a generated file `crewrig-provenance.json` at its root holding the R1 fields of the extension, and a friction on a hook or a server SHALL be attributed to the pair (extension, hook `id` or server name) resolved through that file. The manifests' own `name` and `version` SHALL stay equal to the `extension` and `version` of that file. A core hook SHALL be attributed through the authored carrier of R12 in its own script and a package of `crewrig`.
6. **R6 (null cases; group A).** An artifact kind absent from an extension or from the build SHALL produce no marker and no error. An artifact that already carries a marker in its source SHALL have it replaced, never merged or duplicated, by the generated one.

7. **R7 (declaration; group B).** `extension.json` SHALL accept an optional `provenance` object with string members `canonical` (a literal, per spec 0043 R2) and `feedback` (defaulting to `canonical` when absent). The manifest validator SHALL reject a `provenance` that is not an object, or a member that is not a non-empty string, naming the file and the member. For an extension of `extensions/core` or `extensions/library` a missing `provenance.canonical` SHALL fail the render, naming `extension.json` and the member; for any other extension it SHALL produce a warning, and the marker SHALL then carry no `canonical` or `feedback`. The `feedback` equals `canonical` invariant of spec 0043 R5 stands for the upstream tiers.

8. **R8 (component build; group C).** The component build SHALL write the marker of R3/R4 for canonical skills, agents and commands on all four CLIs through one shared writer, adding `package` and changing no other emitted value. A canonical component whose source has no authored `metadata.provenance` SHALL keep today's behaviour of emitting no marker.

9. **R9 (render-time stamping; group D).** The extension renderer SHALL write the marker of each extension skill, agent, command and context file into the copies it produces for each of the four CLIs, from `extension.json` and `package.json` only (R2), and SHALL write `crewrig-provenance.json` of R5. The extension source tree SHALL NOT be modified.
10. **R10 (render-output test; group D).** A test SHALL render at least the `hello-world` extension for all four CLIs and assert, per kind of R4, the exact marker bytes, the absence of any source carrier, and `crewrig-provenance.json`.

11. **R11 (deploy-time stamping; group E).** The setup step SHALL write the line marker as the first line of each deployed rule and system-context file on all four CLIs, with `package` and the authored `version`, `canonical` and `feedback`. A source with no authored version SHALL fail the step, naming the file; there is no default version.
12. **R12 (authored version carrier; settles i1-F1; group E).** A source without frontmatter SHALL carry its authored provenance in one leading comment block (`<!-- … -->` in Markdown, `/* … */` in a hook `.ts` script) holding the YAML keys `provenance:` then, indented, `version`, `canonical` and `feedback`, with `version` as a double-quoted string on its own line. The setup step SHALL read the block and SHALL replace it in the deployed copy by the R3 line.
13. **R13 (bump guard; group E).** `check-skill-versions` SHALL scan, in addition to its current list, `artifacts/core/rules/*.md`, `artifacts/core/system-context/*.md` and `hooks/*.ts`, with the same rule: a modified (status `M`) file fails unless its diff adds an indented `version: "…"` line. Its exit statuses, `FAIL` line format and new-file exemption SHALL be unchanged, and `docs/version-bump-convention.md` and `AGENTS.md` (*Version Bump Convention*) SHALL list the added paths.

14. **R14 (capture; group F).** `harness-report` SHALL copy the offender's marker into the payload, and `friction.ts build` SHALL accept the optional `--package`, `--extension`, `--version` and `--feedback` flags next to the existing ones. For a hook or an MCP server it SHALL resolve the marker through `crewrig-provenance.json` (R5).
15. **R15 (path-walk fallback; group F).** When the offender carries no marker, `harness-report` SHALL walk from its real path to the nearest `extension.json`, read the fields of R2 from that manifest and its sibling `package.json`, and fill the payload. When no manifest is found it SHALL leave the fields empty and keep the existing refusal to route on a guess.
16. **R16 (routing and triage; group F).** The curator SHALL route a cluster to the `feedback` of its payloads when present, else to `canonical`; payloads that carry neither new field SHALL route unchanged. It SHALL write `package`, `extension` and `version` into the issue body and SHALL flag a friction whose `version` is older than the current one as possibly fixed. Clustering SHALL be unchanged.

17. **R17 (retirement; group G).** After R9 and R10 are in force, the change SHALL remove: the authored `crewrig-provenance` carriers of extension skills and agents; the carrier rewrite of the release step; the carrier checks of `check-extension-manifest-version` and of `check-extension-provenance` (the manifest lockstep of `extension.json` and `package.json` stays); and SHALL correct `artifacts/FORMAT.md`, `extension-skeleton/EXTENSION-FORMAT.md`, `docs/version-bump-convention.md` and cli-matrix rows 4b, 5b and 5c (rebuilding `docs/cli-matrix.md`). Until then the interim of spec 0312 SHALL stay in force and agree with the generated markers.

18. **R18 (supersession; group H).** This spec supersedes, without editing them: spec 0043 R1 (a block authored in the extension source; now R1, R2, R9), R4 (preserve on install; now R6 and R9 regenerate), R7 (presence guard; now R7 and R10) and R8 (back-fill, spent); and spec 0312 R4 (four-field authored carrier), R5 (lockstep guard), R6 (release rewrite), R7 (provenance guard) and R8 (migration), the last four taking effect at R17. Every other requirement of both specs stands, including 0043 R2, R3, R5 and R6 as amended by 0312, and 0312 R1–R3 and R9–R13.
19. **R19 (status records; group H).** Both superseded specs stay in force in part, so neither SHALL change `status` nor receive `superseded-by` (`docs/spec-format.md` → *Lifecycle states*, which reserves `superseded` for a full replacement). The partial supersession SHALL be recorded in this spec only; this spec reaches `implemented` in the PR of the last follow-up it covers.
20. **R20 (corrected anchors; group H).** ADR-0028 cites two wrong anchors, left unedited because the one-file rule forbids it here. The marker injection is `scripts/lib/build-components/provenance.ts:56` (`injectProvenance`), not `emit-skills.ts:37-42`. The routing choice is `pick_target_repo` at `artifacts/library/skills/harness-curator/scripts/curate.py:351-370`, not `:357-371`. Implementers and reviewers SHALL use these.

## Scenarios

**Scenario:** Extension skill stamped on every CLI

Given `hello-world` with `package.json` `hello-world-extension` `2.1.1` and `extension.json` `provenance` `canonical` set,
When  the extension is rendered for all four CLIs,
Then  each output's `greeter` skill starts with one `crewrig-provenance` line carrying `package`, `extension`, `version="2.1.1"`, `canonical` and `feedback`, and the source file is unchanged.

**Scenario:** Hook attributed through the sidecar

Given a rendered extension output with a hook `shell-logger`,
When  `harness-report` files a friction on it,
Then  the payload carries the fields of `crewrig-provenance.json` and the pair (`hello-world`, `shell-logger`).

**Scenario:** Rule stamped at setup

Given `60-tools.md` with an authored comment block whose `version` is `"1.2.0"`,
When  setup deploys it for any CLI,
Then  the deployed file's first line is the marker with `package="crewrig"`, `version="1.2.0"` and no `extension`, and the authored block is absent.

**Scenario:** Core rule modification without a bump

Given a rule file on `main` modified in a branch with no added `version: "…"` line,
When  `check-skill-versions` runs,
Then  it prints `FAIL <file> — metadata.provenance.version not bumped` and exits 1.

**Scenario (failure):** Missing `provenance` key on a core extension

Given an extension under `extensions/core` whose `extension.json` has no `provenance`,
When  it is rendered,
Then  the render fails, naming `extension.json` and `provenance.canonical`, and writes no marker.

**Scenario (failure):** Rule without a version

Given a rule whose leading comment block has no `version`, or no block,
When  setup runs,
Then  it exits non-zero naming the file and deploys no marker for it.

**Scenario (failure):** Stale source carrier

Given an extension skill whose source still holds an authored carrier with `version="1.0.0"` while the package says `2.1.1`,
When  the extension is rendered,
Then  the rendered skill holds one marker with `2.1.1` and no trace of `1.0.0`; before R17 lands, the lockstep guard still fails on that source.

**Scenario (edge):** Extension installed natively, not rendered

Given an extension installed by a CLI's native command from a raw repository, with no marker on its skill,
When  `harness-report` files a friction on that skill,
Then  it walks from the skill's real path to `extension.json`, fills `package`, `extension`, `version`, `canonical` and `feedback` from it and its `package.json`, and attributes the friction.

**Scenario (edge):** Curator routing

Given two payloads of one cluster with `feedback` set and one old payload with `canonical` only,
When  the curator picks the target,
Then  it routes to the `feedback` repository, the old payload routes by `canonical` alone, and the issue body names `package`, `extension` and `version`.

## Out of scope

- Markers on third-party tools (`gh`, the CLIs themselves, MCP servers no extension ships), and per-component versions inside an extension.
- Changing the clustering of the curator, and the `feedback` equals `canonical` invariant.
- A fork's routing through `${CANONICAL_REPO}`, unchanged.
- Editing ADR-0028 (R20 records the anchor corrections here), and editing specs 0043 or 0312.
- Using the framework release version as the version of a rule, system-context file or hook (rejected by the owner, ADR-0028 *Resolved questions*).
- Measuring the context cost of one marker line per rule (ADR-0025 budget): owned by the implementing plan of #2098.
- Marking `extensions/org` and third-party extensions beyond what R7 states.

## Open questions

- Should `crewrig-provenance.json` also be deployed beside core hook wiring (`hooks/*.json`) so that core and extension hooks resolve the same way, instead of the script's authored carrier (R5)? Resolved here as the authored carrier, the lighter option; revisit if the plan of #2098 finds hook paths unreadable at friction time.
