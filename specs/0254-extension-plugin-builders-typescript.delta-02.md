---
id: "0254"
slug: extension-plugin-builders-typescript
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1868
version: 3.0.0
---

# Extension and plugin builders in TypeScript

*Delta 02 of `specs/0254-extension-plugin-builders-typescript.md`. Source: ticket
1868. It supersedes one clause of requirement 18: the `antigravity` clause of the
agents, "each agent directory copied whole". Every other clause of requirement 18 is
unchanged, and so is every other requirement. The version is a MAJOR bump: the
modified clause changes the plugin output, so an implementation that followed the
parent's wording no longer conforms.*

**Why.** A live probe of `agy` 1.5.9 in an isolated `HOME` (logbook:
<https://github.com/crewrig/crewrig/issues/1868#issuecomment-6924568042>) ran
`agy plugin validate --strict`, `agy plugin install`, `agy plugin list --json` and
`agy agents` over a plugin holding a flat `agents/x.md`, a nested `agents/y/AGENT.md`
and a nested `agents/z/agent.md`; all three agents were discovered, and the install
copied a sibling `notes.txt` of the nested agent into the installed plugin. The vendor
plugin-migration guide embedded in the `agy` 1.5.9 binary prescribes
`agents/<name>.md` as the plugin agent layout, and the binary's discovery globs are
`agents/*.md` and `agents/*/agent.md`.

Rejected alternatives: (a) keep agent directories whole, which is an undocumented
plugin form, ships sibling files, is asymmetric with the Claude and Copilot plugins
and contradicts the flat compiled layout of
`specs/0053-antigravity-build-pipeline.delta-01.md` requirement 11; (b) emit a nested
lowercase `agent.md`, which is a tolerated discovery path and not the documented
plugin format.

## ADDED

**Requirement 31 — Antigravity plugin agents follow the Claude clause.** The
`antigravity` plugin renderer (`scripts/lib/extension/plugin-antigravity.ts`,
`copyAgents`) SHALL behave exactly like the `claude` agents clause of requirement 18:

- each nested `AGENT.md` under the agents location is emitted as `agents/<name>.md`
  at the plugin root, `<name>` being the directory name, and the renderer prints
  `Copied agent (flattened): <name>` indented by two spaces;
- each flat `*.md` under the agents location is emitted as `agents/<name>.md`, and
  the renderer prints `Copied agent: <name>` indented by two spaces;
- a nested directory without an `AGENT.md` SHALL be skipped, and sibling files of a
  nested agent SHALL NOT be copied;
- the output SHALL contain no sub-directory under `agents/`;
- when the agents subject is not declared or its location is not a directory, no
  `agents/` entry is written and no agent line is printed; when the location is a
  directory, `agents/` is created before any agent is examined, so a location that
  holds no agent yields an empty `agents/` directory (the `claude` behaviour).

The log lines SHALL mirror `scripts/lib/extension/plugin-claude.ts` exactly. The agent
file content is copied as it is, with no frontmatter rewriting.

**Requirement 32 — Regression tests.** `scripts/tests/extension-plugin-antigravity.test.ts`
SHALL cover four cases: a nested agent flattened to `agents/<name>.md`; a flat agent
copied under its name; a directory without `AGENT.md` skipped; a sibling file of a
nested agent not copied (and no sub-directory under `agents/`). The existing
assertions that encode the retired clause (the expected output listing holding
`agents/<name>/` and its sibling files, and the test asserting that a flat agent file
is skipped) SHALL be replaced, not kept beside the new cases.

**Requirement 33 — Documentation of the verified layout.** The Antigravity entry of
`docs/cli-matrix/rows/13.md` and the "[GAP, intentional] Antigravity compiled agent
shape" entry of `docs/cli-matrix/parity-gaps.md` SHALL record the verified layout:
the Antigravity plugin carries `agents/<name>.md`. In that entry, the phrase "the
extension-plugin packaging still copies agent directories whole" SHALL be removed or
corrected, and item (3), "the Antigravity plugin layout for agents", SHALL be marked
verified with the evidence above. `docs/cli-matrix.md` SHALL be rebuilt from the rows
with the repository's build command, and its output committed in the same change.

## MODIFIED

**Requirement 18 — agents clause, `antigravity` only.** Original, within the agents
list of the plugin renderers:

> `antigravity`: each agent directory copied whole

Replacement:

> `antigravity`: each nested `AGENT.md` or flat `*.md` as `agents/<name>.md`, a nested
> directory without `AGENT.md` skipped, sibling files never copied (requirement 31 of
> delta-02)

The `claude` and `copilot` clauses and every other part of requirement 18 are
unchanged.

## REMOVED

Nothing is removed.

## Scenarios

Scenario 1 (happy, nested). Given an extension with `agents/reviewer/AGENT.md` and
`agents/reviewer/notes.txt`, when the `antigravity` plugin is built, then the plugin
holds `agents/reviewer.md`, no `agents/reviewer/` directory and no `notes.txt`, and the
log has the line `Copied agent (flattened): reviewer` indented by two spaces.

Scenario 2 (happy, flat). Given `agents/helper.md`, when built, then `agents/helper.md`
exists and the log has the line `Copied agent: helper` indented by two spaces.

Scenario 3 (failure path). Given `agents/stray/README.md` and no `AGENT.md`, when
built, then nothing is emitted for `stray`, the build does not fail, no agent
line is printed for it, and the plugin holds an empty `agents/` directory when
`stray` is the only entry.

## Out of scope

- Copilot `.agent.md` naming.
- The compiled `.agents/agents/` layout (`specs/0053-antigravity-build-pipeline.delta-01.md`).
- Frontmatter rewriting of agents inside plugins.

## Open questions

None.
