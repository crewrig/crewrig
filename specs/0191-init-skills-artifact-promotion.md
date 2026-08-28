---
id: "0191"
slug: init-skills-artifact-promotion
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1077
version: 1.0.0
---

# Promote init-personal-profile and init-soul to single-source artifact components

## Intent

A newcomer who clones the repository and launches any one of the four supported command-line assistants inside it can run the two bootstrap interviews — the one that writes their personal profile and the one that writes the agent identity file — and each interview behaves identically whichever assistant they launched, because both are described once in the repository rather than re-typed per assistant.

## Requirements

1. `init-personal-profile` and `init-soul` SHALL each be defined by exactly one source file under `artifacts/core/`, and after this change no hand-maintained per-CLI definition of either name SHALL remain committed anywhere in the repository. In particular `.gemini/commands/init-personal-profile.toml`, `.gemini/commands/init-soul.toml`, `.claude/skills/init-personal-profile/SKILL.md` and `.claude/skills/init-soul/SKILL.md` SHALL cease to be hand-maintained files and SHALL exist only as regenerated build outputs of the single sources.
2. Each of the two sources SHALL be declared with `type: command` and SHALL live at `artifacts/core/commands/<name>.md`. The `command` component kind is required rather than the `skill` kind because it is the only kind whose build emits a Gemini CLI native slash-command definition (`.gemini/commands/<name>.toml`), which is the sole carrier of the published `gemini "/init-personal-profile"` invocation; a `skill`-kind source emits `.gemini/skills/<name>/SKILL.md` instead, which Gemini CLI discovers for model-side activation only and never exposes as `/<name>`.
3. `bash scripts/build-components.sh --target all` SHALL emit, for each of the two names, exactly these four project-scoped outputs, and all eight SHALL be regenerated and committed in the same implementation diff: `.gemini/commands/<name>.toml`, `.claude/skills/<name>/SKILL.md`, `.github/skills/<name>/SKILL.md`, `.agents/skills/<name>/SKILL.md`.
4. `bash scripts/build-components.sh --target all --check` SHALL exit zero on the resulting tree, so that every committed output is byte-identical to what the two sources produce.
5. In a fresh clone with no user-level CrewRig installation, with each CLI launched from the repository root, each of the following eight invocations SHALL resolve to the corresponding interview and start it: `claude /init-personal-profile`, `gemini "/init-personal-profile"`, `copilot -i "/init-personal-profile"`, `agy -i "/init-personal-profile"`, and the four `init-soul` equivalents. Each of the eight SHALL be confirmed by a live probe of the CLI concerned; vendor-documentation inference alone SHALL NOT be accepted as evidence that an invocation resolves.
6. Each source body SHALL be a migration of the current `.claude/skills/<name>/SKILL.md` body, not a rewrite: the same interview phases in the same order, the same template read (`config/PROFILE.md.template`, `config/SOUL.md.template`) and the same file written (`config/PROFILE.md`, `config/SOUL.md`). Where the current Claude body and the current Gemini `.toml` prompt describe divergent behavior for the same step, the Claude body's behavior SHALL be the one retained, and the divergent Gemini-only wording SHALL be dropped rather than merged.
7. Each source body SHALL state its interactive-question obligation in a form that is actionable on all four CLIs — naming the structured-prompt facility and admitting the host CLI's equivalent — and SHALL contain no `${…}` token whose key is absent from `crewrig.config.toml`, so that no unresolved build placeholder reaches any of the eight outputs.
8. Each source SHALL declare `metadata.provenance` with `canonical` and `feedback` both set to `"${CANONICAL_REPO}"`, as `artifacts/core` is an upstream-owned tier, and SHALL declare an initial `version` of `1.0.0`.
9. Each source SHALL declare, under `claude.allowed-tools`, the tool set its interview needs, so that the generated Claude Code and GitHub Copilot CLI outputs carry that tool set.
10. `docs/cli-matrix.md` SHALL be updated in the same diff to record that `init-personal-profile` and `init-soul` are `core` command sources reaching all four CLI surfaces, and to correct any cell that names only `init-expertise` and `init-team` as the guided bootstrap components.
11. The `## Quick Start` section of `README.md` SHALL name, for each of the four supported CLIs, the in-project invocation of both components, and SHALL NOT publish an invocation that requirement 5's probe has not confirmed.
12. No `metadata.provenance.version` of any pre-existing component SHALL be bumped by this change: the two sources are new components introduced within the implementation branch and therefore fall under the new-component in-branch exemption of the Version Bump Convention.
13. The built outputs of `init-expertise` and `init-team` SHALL be unchanged by this diff, and no source under `artifacts/core/skills/` SHALL be modified by it.

## Scenarios

**Scenario:** Four-CLI in-project probe on a fresh clone

Given a fresh clone of the repository at the merge commit of this change, with no user-level CrewRig installation
When each of `claude`, `gemini`, `copilot` and `agy` is launched from the repository root and asked for `/init-personal-profile`, then for `/init-soul`
Then all eight invocations resolve and the corresponding interview starts, and the probe transcript for each of the four CLIs is recorded as the evidence for requirement 5

**Scenario:** Single source, no dual maintenance

Given the merged implementation
When the repository is searched for a definition of `init-personal-profile` or `init-soul`
Then exactly one source file per name is found under `artifacts/core/commands/`, and every other file bearing either name is a generated output that `bash scripts/build-components.sh --target all --check` reproduces byte-identically

**Scenario:** Interview behavior preserved

Given the interview started from any one of the four CLIs
When the interview runs to completion
Then it reads the same template and writes the same target file as the pre-change Claude Code definition (`config/PROFILE.md.template` → `config/PROFILE.md`, `config/SOUL.md.template` → `config/SOUL.md`), with the same phases in the same order

**Scenario (failure path):** A skill-kind source drops the Gemini slash command

Given a candidate implementation that promotes the two components as `type: skill` sources under `artifacts/core/skills/`
When the build runs and the Gemini CLI probe of requirement 5 is executed
Then `.gemini/commands/init-personal-profile.toml` is absent from the build output, `gemini "/init-personal-profile"` no longer resolves as a slash command, and the candidate implementation is rejected as failing requirement 2 and requirement 5

**Scenario (failure path):** A CLI probe does not resolve

Given the implementation branch with all eight outputs built and committed
When the probe of requirement 5 finds that one CLI does not resolve one of its two invocations
Then the change is incomplete: neither `docs/cli-matrix.md` nor `README.md` states that this CLI can run the component concerned, and the implementation is not merged until the probe passes or the unsupported invocation is removed from both documents

**Scenario (failure path):** A hand-maintained copy is reintroduced

Given the merged implementation
When a later change adds a hand-edited `.claude/skills/init-soul/SKILL.md` or `.gemini/commands/init-soul.toml` that the sources do not produce
Then `bash scripts/build-components.sh --target all --check` reports the drift and exits non-zero

## Out of scope

- The setup-script instruction text tracked in issue #1071. Those printed instructions become true once this change ships, but this spec does not edit the setup scripts.
- The QuickStart panels of the crewrig.org site, tracked in `crewrig/crewrig-website#45` — a separate repository with its own lifecycle.
- Extending `scripts/check-skill-versions.sh` and `scripts/check-feedback-routing.sh` to cover command sources. Both guards key on the filenames `SKILL.md` and `AGENT.md`, and `artifacts/FORMAT.md` → *Version semantics* states its bump rule over those same two filenames, so a source at `artifacts/core/commands/<name>.md` is covered by neither guard nor rule. Requirement 8 has the two new sources declare provenance correctly regardless; closing the enforcement gap for the command kind, and the accompanying `artifacts/FORMAT.md` wording, is a separate ticket that the implementation team SHALL open before this ticket closes.
- Migrating `init-expertise` and `init-team` from the `skill` kind to the `command` kind. `gemini "/init-expertise"` is not a slash command today and this spec does not make it one.
- Correcting `docs/adoption-guide.md`, which describes "all three supported CLIs" and instructs `/init-expertise` without qualifying which CLIs expose it as a slash command. Pre-existing documentation debt, unchanged by this spec.
- User-level installation of the two components (`~/.claude/skills/`, `~/.gemini/commands/`, `~/.copilot/skills/`, `~/.gemini/config/skills/`). Both stay project-scoped: the clone is the delivery surface.
- Any change to the interview questions themselves, to the shape of `config/PROFILE.md` or `config/SOUL.md`, or to their templates.
- Whether GitHub Copilot CLI's discovery of project skills from `.claude/skills/` — the reason it already resolves both components in-project today, contrary to the original framing of issue #1077 — should be relied upon anywhere else in the framework.

## Open questions

(None.)
