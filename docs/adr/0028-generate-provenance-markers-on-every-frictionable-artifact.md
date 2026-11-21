# ADR-0028: Generate provenance markers on every frictionable artifact

<!-- crewrig-doc: section=architecture-adr nav_order=280 published=true title="ADR 0028 — Generate provenance markers on every frictionable artifact" -->

## Status

Proposed

Answers issue #2078. No spec yet: the decision below supersedes parts of specs 0043 and 0312, so the implementation is preceded by one amending spec (see *Follow-ups*).

## Context

A friction is attributed to the artifact that caused it, and the curator routes the issue it opens by the payload's `canonical` (`artifacts/library/skills/harness-curator/scripts/curate.py:357-371`). Only part of what agents run says where it comes from:

- Canonical components built from `artifacts/**` get `metadata.provenance` (`version`, `canonical`, `feedback`) spliced into the frontmatter on every CLI (`scripts/lib/build-components/write.ts:104`, `emit-skills.ts:37-42`), except Gemini agents, which get an HTML comment (`emit-agents.ts:88`), and Gemini commands, which get a TOML comment (`scripts/lib/render-command.ts:115`). No field names the package.
- Extension skills and agents carry a hand-written carrier on their first body line (`extensions/core/hello-world/skills/greeter/SKILL.md:5`); spec 0312 R4-R6 adds `extension` and a package `version`, rewritten by the release step (`scripts/lib/packaging/sync-manifests.ts:44`) and held by a lockstep guard.
- Rules, system-context files, extension commands (`extensions/core/hello-world/commands/hello.md` has none), extension context, hooks and MCP servers carry nothing.

The premise of the extension carrier is stale. `artifacts/FORMAT.md:544-552` and spec 0043 assume extensions are consumed in place with "no render seam". In the tree, every install path renders first: `install-extension.ts link` calls the renderer, then links the *build directory* (`scripts/lib/install/extension.ts:69-79`). The Gemini renderer copies the extension into that directory (`scripts/lib/extension/gemini-render.ts:137`), and the Claude, Copilot and Antigravity plugin renderers copy skills (`scripts/lib/extension/plugin-common.ts:143`, `:225-227`). So a write seam exists on all four CLIs, and it does not touch the source.

## Framing

- **Goal.** Every frictionable artifact, on all four CLIs, carries a marker naming its package, its owning extension (when any), its version, `canonical` and `feedback`, written by a tool, with one source of truth per field.
- **Constraints.** No silent CLI asymmetry. Gemini CLI 0.42+ rejects frontmatter keys other than `name` and `description` on in-place extension sources (`artifacts/FORMAT.md:553-556`), and a TOML file cannot hold an HTML comment (`docs/cli-matrix/rows/5b.md:7-8`). The `feedback` equals `canonical` invariant of upstream tiers (spec 0030, spec 0043 R5) stands. A fork's routing through `${CANONICAL_REPO}` stays unchanged.
- **Non-goals.** Markers on third-party tools (`gh`, the CLIs themselves, MCP servers that no extension ships). Per-component versions inside an extension (rejected by spec 0312). Changing the clustering of the curator.

## Decision

### 1. Frictionable kinds and carriers

An artifact is *frictionable* when CrewRig or one of its extensions ships it and an agent either reads its text or sees its behaviour under a name. There are two carrier families. A text artifact carries the marker in its own bytes. An executable artifact is attributed through the manifest of the unit that owns it, because an agent never reads a hook's or a server's source.

The marker has one field set and two encodings. One is the YAML form `metadata.provenance` in frontmatter. The other is the line form `crewrig-provenance: package="…" extension="…" version="…" canonical="…" feedback="…"`, placed on the first body line inside the comment syntax of the host format (`<!-- … -->` in Markdown, `# …` in TOML). A field that does not apply is omitted, not left empty.

| Kind | Claude Code | Gemini CLI | Copilot CLI | Antigravity CLI | Written by | Change from today |
|---|---|---|---|---|---|---|
| Canonical skill | YAML | YAML | YAML | YAML | component build | adds `package` |
| Canonical agent | YAML | line, `<!-- -->` | YAML | YAML | component build | adds `package` |
| Canonical command | YAML (command) | line, `#` (TOML) | YAML (skill) | YAML (skill) | component build | adds `package` |
| Rule and system-context file | line, `<!-- -->` | line, `<!-- -->` | line, `<!-- -->` | line, `<!-- -->` | setup deploy step | new |
| Extension skill and agent | line, `<!-- -->` | line, `<!-- -->` | line, `<!-- -->` | line, `<!-- -->` | extension renderer | generated, no longer authored |
| Extension command | YAML (skill) | line, `#` (TOML) | YAML (skill) | YAML (skill) | extension renderer | new |
| Extension context | line, `<!-- -->` | line, `<!-- -->` | line, `<!-- -->` | line, `<!-- -->` | extension renderer | new |
| Hook, MCP server | owning manifest | owning manifest | owning manifest | owning manifest | extension renderer | rendered manifest carries the fields |
| Bundled script | owning skill's marker | same | same | same | (inherited) | none |

The line form stays on extension skills and agents on every CLI, Claude included, so that one rendered file body serves all four targets. Today the Claude plugin manifest already carries `name` and `version` (`scripts/lib/extension/plugin-claude.ts:57-64`). For the Gemini, Copilot and Antigravity manifests, that they hold the same pair is an assumption — verify before relying on this. A core hook resolves to `package="crewrig"` with no `extension`.

### 2. Fields and their single source of truth

| Field | Canonical artifact (`artifacts/**`, rules, core hooks) | Extension artifact (any tier) |
|---|---|---|
| `package` | `name` of the root `package.json` (`crewrig`, `package.json:2`) | `name` of the extension's `package.json` |
| `extension` | absent | `name` of `extension.json` (spec 0312 R4) |
| `version` | the component's authored `metadata.provenance.version`, bump-guarded (`docs/version-bump-convention.md`); for a rule, system-context file or core hook, an authored `metadata.provenance.version` is added and guarded by `check-skill-versions` (owner decision, see *Resolved questions*) | `version` of the extension's `package.json` (spec 0312 R3) |
| `canonical` | authored `metadata.provenance.canonical`, `${CANONICAL_REPO}` resolved at build | new `provenance.canonical` key of `extension.json`, a literal (spec 0043 R2) |
| `feedback` | authored `metadata.provenance.feedback`, resolved at build (spec 0030) | `provenance.feedback` of `extension.json`, defaulting to `canonical` |

Spec 0312 rejected a `package` field because a second, hand-kept copy would drift. A generated field read from `package.json` cannot drift, so that objection no longer applies. The field is kept because a third-party extension's package name, possibly scoped, is not derivable from its directory name.

### 3. Where extension markers are generated: the extension renderer

Markers of extension artifacts are written by the extension renderer (`scripts/lib/extension/render-extension.ts:23`) into the copies it produces for each target, from the manifests above. Any carrier found in the source is replaced, never merged. The source carries no provenance field except the `extension.json` keys. A render-output test replaces the lockstep guard for the carrier.

Alternatives weighed:

- **A. Install step stamps the installed copy.** Trade-off: no source change, at the cost of covering only `install` (copy) mode. In `link` mode the target is a symlink to the build directory, so stamping would write through it, and the Claude, Copilot and Antigravity plugin installs would need three more stampers. Rejected: four writers for one value.
- **B. Link step generates.** Trade-off: the same coverage as the renderer, but only for the link path, with a second write site for the install path. Rejected: link already renders first, so the renderer is the shared ancestor of both modes and B is the renderer with fewer callers.
- **C. Committed source field kept in lockstep by a guard (the spec 0312 interim, generalised).** Trade-off: markers are visible in the source and survive a CLI-native install of a raw extension repository. The cost is a release-step rewriter plus a guard per field, and a carrier that the Gemini frontmatter restriction forces into a comment anyway. Rejected as the end state because the renderer seam makes the committed copy redundant. It is kept as the interim (see *Migration*).
- **D. No marker; readers walk from the artifact's real path to the nearest `extension.json`.** Trade-off: zero generation and zero drift, but it needs the file path, which an agent rarely sees for a loaded agent prompt and which Antigravity and Copilot do not expose uniformly. Rejected as primary and adopted as the fallback of §4.

**Chosen: the renderer.** It is the only seam that every CrewRig-driven install path on all four CLIs already crosses, and it writes nothing into the source. The one path it misses is a CLI-native install of a raw extension repository (for example `gemini extensions install <url>`). That path falls back to D.

### 4. How harness-report and the curator use markers

- **harness-report.** It identifies the offender as today (`references/identify-and-route.md:9-11`), then copies the offender's marker verbatim into the payload. `friction.ts build` gains the optional flags `--package`, `--extension`, `--version` and `--feedback`. When no marker exists, it walks the real path to the nearest manifest (D). Failing that, it leaves the fields empty, keeping the "routing failure beats a wrong target" rule (`SKILL.md:63-65`).
- **Routing.** The curator routes to `feedback` when the payload has it, else to `canonical` (`curate.py:357-371` today). Old payloads keep routing unchanged. `canonical` stays the artifact's identity (where it is maintained); `feedback` is the routing target, as spec 0030 already defines for builds.
- **Triage.** The curator writes `package`, `extension` and `version` into the issue body. A friction whose `version` is older than the current one is flagged as possibly fixed. Clustering is unchanged.

### 5. Migration from today's carriers

1. **Now (spec 0312 interim).** Authored extension carrier with four fields, release-step rewrite, lockstep guard. Nothing is removed until step 3.
2. **Component build and setup.** One shared marker writer (built from `scripts/lib/build-components/provenance.ts`) emits `package` for canonical artifacts. Setup stamps rules and system-context files.
3. **Renderer.** It reads `extension.json` and `package.json`, stamps every extension text artifact, and replaces source carriers. The renderer's output and the 0312 carrier agree, which the lockstep guard proves, so no installed byte changes for `greeter` beyond adding `package`.
4. **Retire the interim.** Remove the source carriers. Remove the carrier rewrite from `sync-manifests.ts` and the carrier checks from `ext-manifest-version.ts` and `ext-provenance.ts`, replacing them with a render-output test. Correct `artifacts/FORMAT.md`, `extension-skeleton/EXTENSION-FORMAT.md` and cli-matrix rows 4b, 5b and 5c.

## Consequences

- Positive: every text artifact names its package, extension and version on all four CLIs, and no contributor edits a version by hand outside the authored component version.
- Positive: the spec 0312 lockstep machinery (one rewriter and two guards) shrinks to one render-output test.
- Negative: an extension installed natively from a raw repository has no marker and depends on the path-walk fallback.
- Negative: a small context cost, one marker line per rule file loaded in every session (ADR-0025 budget), to be measured in the implementing plan.
- Neutral: canonical `artifacts/**` components keep their authored version and their YAML carrier; only `package` is added.
- Neutral: spec 0043 R1, R4, R7 and R8 and spec 0312 R4-R8 are superseded by the amending spec. Their intent (self-contained origin, `feedback` equals `canonical`) carries over unchanged.

### Follow-ups (not created by this ADR)

1. Amending spec: the field set, the `extension.json` `provenance` keys, generation at render, superseding 0043 and 0312 as listed.
2. Shared marker writer and `package` in the component build (step 2), with cli-matrix row 4b.
3. Extension renderer stamping, all four targets, plus the render-output test (step 3), with rows 5b and 5c.
4. Setup stamps rules and system-context files.
5. `harness-report`: marker capture, new flags, path-walk fallback; curator: route by `feedback`, version in the issue body.
6. Retire the interim: source carriers, release-step carrier rewrite, carrier guards, `FORMAT.md` and `EXTENSION-FORMAT.md` corrections (step 4).

## Resolved questions

Settled by the owner on 2026-11-21, before acceptance:

1. **Version of a rule, system-context file or core hook.** Each one gets its own authored `metadata.provenance.version`, guarded by `check-skill-versions` like skills and agents. This keeps one source of truth that is known on a source checkout, at the cost of a bump on every modification. Rejected: the framework release version (`crewrig-<version>.tgz`, spec 0288 R8), unknown on a source checkout and changing when the file does not.
2. **Where an extension declares `canonical` and `feedback`.** In a `provenance` key of `extension.json`, the crewrig-owned manifest already validated by schema, which can tell `feedback` from `canonical`. Rejected: `package.json` `repository.url`, the npm-standard field, which names a single repository and cannot carry a distinct feedback target without a non-standard extension.
