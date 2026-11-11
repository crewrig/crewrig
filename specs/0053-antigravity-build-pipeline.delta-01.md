---
id: "0053"
slug: antigravity-build-pipeline
status: draft
complexity: standard
interaction-mode: AUTO
related-issue: 1847
version: 2.0.0
---

# Spec 0053 — Antigravity CLI build pipeline target (delta-01)

This delta supersedes requirement 3 of spec 0053 and, by the explicit statement
of requirement 15 below, the Antigravity agent shape of requirement 13 of
[`specs/0250-component-build-core-typescript.md`](0250-component-build-core-typescript.md).
It is the single delta of this change: the one-file rule of the spec-PR
workflow allows one new file under `/specs/`, so the correction of 0250 R13 is
recorded here rather than in a second delta against 0250.

**Why a delta, and why now.** The compiled Antigravity agent is today the
sub-directory shape `.agents/agents/<name>/AGENT.md`, carrying `license`,
`compatibility`, and `enable_write_tools` / `enable_mcp_tools` /
`enable_subagent_tools` keys. The vendor documentation describes an agent as a
`<name>.md` file, or as `<name>/agent.md` (lowercase), and lists no `enable_*`
key and no `license` or `compatibility` key. Issue #1847 recorded the gap.

**Evidence, and its limits.** A live discovery probe of `agy` 1.5.5 on a
case-sensitive APFS image (a `touch a A` pair confirmed two distinct files) in a
workspace `.agents/agents/` showed that `up/AGENT.md`, `low/agent.md`,
`dirnameB/Agent.md`, and the flat `probe-flat.md` are all discovered, and that
an agent carrying unknown `enable_*` keys is still discovered. The probe
therefore did **not** reproduce the headline risk of the issue (the uppercase
file name failing to be discovered): the CLI matches the file name
case-insensitively. This delta is consequently a **documentation-alignment**
change, not a discovery fix; it is nonetheless a **behavioural change** for any
agent whose output used to carry `enable_*` keys, a risk accepted explicitly by
requirement 27. The runtime effect of the `enable_*` keys could not
be verified, because the `agy` OAuth session was expired and no model turn was
possible; that stays unverified and is tracked by a follow-up (requirement 24).

**Decisions recorded, with rejected alternatives.**

- The flat file `<name>.md` is chosen over the documented lowercase
  `<name>/agent.md`, because a rename that changes only the case of a file name
  aliases on case-insensitive volumes — the macOS default and Windows CI
  runners — so a cleanup of the retired `AGENT.md` could delete the file just
  written. A flat file has no case-only twin and no sub-directory.
- Spec 0201 kept Antigravity nested for three reasons, one of which was that the
  installed CLI itself writes nested lowercase `agent.md` for its own subagents.
  That reason is superseded: the official vendor documentation, which that spec
  could not cite (it found no agent customization type documented), now also
  documents the flat `<name>.md` form, and the live probe discovered the flat
  form. What the CLI writes for its own session scratch space is not a
  documented authoring contract, so it is not the better precedent, and the
  case-alias risk above weighs against copying it.
- Keeping `AGENT.md` is rejected: it is undocumented, and it is found only
  because the CLI happens to match case-insensitively.
- A `tools` list is not emitted. The documented tool names are `view_file`,
  `replace_file_content`, `grep_search`, and `run_command`; a misspelled name
  may hang the subagent, and translating a Claude Code name such as `Bash`
  would invent semantics the vendor never documented.

## ADDED

Added to `## Requirements` (numbering continues from 0053 requirement 10):

- **11. (Flat compiled agent).** When invoked with `--target antigravity` (or
    `--target all`), the build SHALL emit each compiled agent as one regular
    file `<output-root>/.agents/agents/<name>.md`, where `<output-root>` is
    resolved as in requirement 2. No compiled Antigravity agent output SHALL be
    placed in a sub-directory of `.agents/agents/`, and none SHALL be named
    `AGENT.md`, `agent.md`, or any case variant of them.
- **12. (Frontmatter shape).** The frontmatter of a compiled Antigravity agent
    SHALL consist of `name`, `description`, and the `metadata` provenance block
    of requirement 5, in that order, and nothing else. `description` SHALL be the
    source description followed by one space and the resolved capability-profile
    prose of spec 0197 when there is such prose, exactly as for the other three
    CLIs. The output SHALL carry no `enable_write_tools`, `enable_mcp_tools`,
    `enable_subagent_tools`, `license`, `compatibility`, `tools`, `model`,
    `mainAgent`, or `subagent` key.
- **13. (No `enable_*` input, no `tools` emission).** The build SHALL NOT read any
    `antigravity.enable_*` key of an agent source: a source that still declares
    one SHALL build without error, warning, or effect on the output. The build
    SHALL NOT derive any key of the output from the Claude Code `allowed-tools`
    list, `Bash` included. The runtime effect of the formerly emitted
    `enable_*` keys, the vendor defaults of `tools`, `subagent`, and `mainAgent`,
    and the Antigravity plugin layout are recorded as **unverified** (requirement
    24), each with a follow-up to be opened without blocking this change.
- **14. (Retired-layout cleanup in write mode).** In write mode, for each agent it
    emits, the build SHALL remove the retired directory
    `<output-root>/.agents/agents/<name>/` when, and only when, that directory
    holds nothing but a single file named `AGENT.md` that is
    provenance-carrying (requirement 26). When the directory holds anything else (another file, a nested
    directory, an `AGENT.md` without provenance), the build SHALL leave it
    untouched and print a warning naming the path. The removal SHALL be a silent
    no-op when no such directory exists, so a second run changes nothing and
    prints no removal. The build SHALL NOT touch a directory whose name is not
    that of an agent it emits.
- **15. (Supersession of 0250 R13).** Requirement 13 of spec 0250 states that the
    Antigravity agent file is `.agents/agents/<name>/AGENT.md` with the keys
    `name`, `description`, `license`, `compatibility`, the three `enable_*` keys
    and the directed lines. Requirements 11 and 12 of this delta supersede that
    Antigravity agent clause entirely. Every other clause of 0250 requirement 13
    (skills, commands, and the Gemini CLI, Claude Code, and Copilot CLI agent
    files) is unchanged. A reader of 0250 R13 SHALL treat this delta as
    prevailing for the Antigravity agent, per the delta-spec cumulative rule.
- **16. (Drift in check mode).** In `--check` mode the build SHALL report as drift,
    and exit non-zero for, both a missing `<name>.md` output and the presence of
    the retired directory `<output-root>/.agents/agents/<name>/` for an agent it
    emits, naming each path. The `--check` run SHALL NOT modify the tree.
- **17. (Layout guard).** The repository SHALL ship a guard, extending the existing
    compiled-agent layout guard (the module that implements spec 0201
    requirements 6 to 9 for `.claude/agents`), that fails with a non-zero exit
    status when a committed `.agents/agents/` directory holds any entry that is
    not a regular file whose name ends in `.md` directly inside it, naming every
    offending path. It SHALL exit zero when the directory holds only such files,
    holds none, or is absent. It SHALL run in continuous integration on the same
    triggers as the `.claude/agents` guard, extended to the compiled Antigravity
    agent tree, and SHALL ship with a test suite, registered in the
    continuous-integration wiring, that fails when the guard is mutated to accept
    a sub-directory. No assertion of that suite SHALL depend on whether the
    file system is case-sensitive.
- **18. (Setup installs flat files).** The Antigravity setup SHALL install each
    compiled agent of an installed tier as one regular file
    `~/.gemini/config/agents/<name>.md`, SHALL verify that the file exists and is
    a regular file before printing `Installed agent: <name>`, and SHALL keep the
    accounting of spec 0123 requirements 4 to 6 unchanged (no `Installed` line
    for an absent file; a run that places none of the staged agents reports the
    discrepancy and does not complete as though installed).
- **19. (Setup migration).** For each agent name installed in the run, the setup
    SHALL remove a same-name directory `~/.gemini/config/agents/<name>/` when,
    and only when, it holds nothing but a single provenance-carrying `AGENT.md`
    (requirement 26), and SHALL print `Migrated away: <path>` for each removal. When that
    directory holds anything else, the setup SHALL leave it and print a warning
    naming the path. The setup SHALL NOT touch any entry whose name is not that
    of an agent installed in the same run. This rule is stated on its
    own and refines spec 0123 requirements 8 and 9: framework-installed content
    at the superseded location goes, content the framework did not install
    stays.
- **20. (Resolver collision key).** The install-target key that the shared
    component resolver emits for an Antigravity agent SHALL be
    `.agents/agents/<name>.md`, the `.crewrig/plan-components.txt` entry for
    compiled Antigravity agents (today the glob `.agents/agents/*/` mapped to
    `agent:*`) SHALL name that flat shape, and the set of name
    collisions the build reports SHALL be unchanged by this edit.
- **21. (Committed outputs and fork sync).** The 22 committed compiled Antigravity
    agent outputs SHALL be present at the path of requirement 11 and absent at
    the retired path in the same change set that changes the emission, and
    `bash scripts/build-components.sh --target all --check` SHALL exit zero on
    the resulting tree. A synchronization of a fork from upstream SHALL remove a
    retired `.agents/agents/<name>/AGENT.md` and land the flat file, and the
    upstream-synchronization suite SHALL retain a fixture that places a compiled
    Antigravity agent at the retired path and asserts that removal.
- **22. (Description-length coverage).** The compiled-description length cap SHALL
    cover the flat Antigravity agent outputs: the glob `.agents/agents/*.md`
    replaces `.agents/agents/*/AGENT.md` in the list of capped compiled outputs,
    and a description above the cap in such a file SHALL fail the check.
- **23. (Documentation and parity record).** `docs/cli-matrix/rows/4.md` and the
    Antigravity cells of rows 28, 30, and 38 SHALL name the flat path,
    `docs/cli-matrix.md` SHALL be rebuilt from them, the parity-gaps record and
    the adopter note of `docs/agent-profile-migration.md` SHALL be updated, all
    in the implementation diff. The record SHALL state that all four CLIs now
    compile an agent as a flat `<name>.md`; that the intentional asymmetries are
    the absence of tool restriction, the absence of a `model` field, and the fact
    that the extension-plugin packaging copies agent directories whole; and that
    the change is documentation-driven, with discovery verified live (`agy`
    1.5.5, case-sensitive file system: `AGENT.md`, `agent.md`, `Agent.md`, and
    the flat form all discovered) and runtime semantics **not** verified because
    no signed-in session was available.
- **24. (Unverified items and follow-ups).** The record of requirement 23 SHALL
    list as unverified: the runtime effect of the removed `enable_*` keys; the
    vendor defaults of `tools`, `subagent`, and `mainAgent`; and the Antigravity
    plugin layout for agents. Each SHALL be tracked by a follow-up issue opened
    separately from this change; this delta cites them by description, not by
    number.
- **25. (Case-independence and portability).** No assertion added or changed by the
    implementation of this delta SHALL depend on whether the file system
    distinguishes letter case: tests that create the retired `AGENT.md` and the
    flat `<name>.md` SHALL do so at different base names, and SHALL read back by
    exact directory listing rather than by a case-sensitive existence check on a
    case-only twin. Shell code added SHALL run on bash 3.2.

- **26. (Provenance-carrying, defined).** A file is *provenance-carrying* when
    its leading frontmatter (and only the frontmatter) holds, under a `metadata`
    mapping, a `provenance` mapping with a non-empty `canonical` value. The build
    and the setup SHALL share one helper implementing exactly that
    frontmatter-scoped check. The existing `hasProvenance` of the Antigravity
    migration module (`scripts/lib/antigravity-migrate.ts`) is today a line-level
    test (an indented `provenance:` line followed by a `canonical:` value) that
    does not verify the `metadata` parent; where it differs, it SHALL be aligned
    to the shared helper, and the shared helper SHALL NOT be weaker than it. The presence of the text `provenance` in the
    body, or a `provenance` key without a `canonical` value, SHALL NOT qualify.
- **27. (Risk acceptance for the `enable_*` removal).** The removal of
    `enable_write_tools`, `enable_mcp_tools`, and `enable_subagent_tools` from
    compiled output is **accepted as documentation-driven**, with its runtime
    effect unverified. The residual risk is named: if `agy` honours
    `enable_write_tools`, an agent that declared it (at present `pr-reviewer`,
    whose Claude Code tool list includes `Bash`) loses write ability, because the
    vendor default of `tools` is not verified. The change set SHALL be
    accompanied by a follow-up issue, opened separately, to probe that effect in
    a signed-in session, and the implementation PR body SHALL state this risk and
    cite the follow-up. This delta does not make the probe a merge precondition.
- **28. (Related specs, effect).** Specs 0265, 0121 delta-01, 0200, 0197
    delta-01, and 0201 name the nested Antigravity path `.agents/agents/<name>/AGENT.md`
    as illustration or context (0265 in an assembly row and a test line, 0121
    delta-01, 0200 and 0197 delta-01 in scenarios, 0201 in the statement that
    0053 R3 was live and honoured). For Antigravity the path literals in those
    specs are superseded by requirement 11 of this delta; no behaviour those
    specs require changes, and none of them is edited. Spec 0201's decision to
    leave Antigravity nested is superseded by the reasoning in the preamble.
- **29. (Surfaces and orphans).** The implementation SHALL update, in the same
    diff: `.crewrig/plan-components.txt`; the setup golden fixtures for
    Antigravity (`scripts/tests/fixtures/setup-golden/antigravity/**` and
    `setup-declarations/antigravity.txt.golden`) wherever they name an agent
    path. The probe-antigravity sentinels
    (`scripts/lib/probe-antigravity/sentinels.ts`) SHALL be left unchanged,
    because they exercise both the nested and the flat form. A retired
    directory `.agents/agents/<name>/` for an agent that is **no longer
    emitted** (removed from the sources) is out of scope for the build cleanup
    and for `--check`: it is left alone by them, and is flagged only by the
    layout guard of requirement 17 when committed.

Added to `## Scenarios`:

**Scenario:** Emission of a flat agent

```text
Given a core agent source `artifacts/core/agents/developer/AGENT.md`
When  `bash scripts/build-components.sh --target antigravity` runs
Then  `.agents/agents/developer.md` is a regular file
And   its frontmatter keys are exactly `name`, `description`, `metadata`
And   no directory `.agents/agents/developer/` exists
```

**Scenario:** Regression for issue #1847 — stale directory cleaned, twice

```text
Given a tree holding `.agents/agents/developer/AGENT.md` with a provenance block and no other file in that directory
When  the build runs in write mode
Then  `.agents/agents/developer/` is gone and `.agents/agents/developer.md` is present
When  the build runs a second time
Then  the tree is byte-identical to its state after the first run and no removal is printed
```

**Scenario:** `Bash` source yields neither `enable_*` nor `tools`

```text
Given the `pr-reviewer` source, whose Claude Code `allowed-tools` includes `Bash`
When  the build emits its Antigravity output
Then  `.agents/agents/pr-reviewer.md` carries no `enable_write_tools`, no `enable_mcp_tools`, no `enable_subagent_tools` and no `tools` key
```

**Scenario:** A source still declaring `enable_*` builds

```text
Given an agent source declaring `antigravity.enable_write_tools: true`
When  the build runs for Antigravity
Then  it exits zero with no warning about that key and the output carries no `enable_*` line
```

**Scenario:** Stale directory with an extra file is left, with a warning

```text
Given `.agents/agents/developer/AGENT.md` with provenance and a second file `.agents/agents/developer/NOTES.txt`
When  the build runs in write mode
Then  the directory and both files remain untouched
And   a warning names `.agents/agents/developer`
And   `--check` reports the directory as drift and exits non-zero
```

**Scenario:** Layout guard

```text
Given a committed `.agents/agents/` holding `a.md` and a directory `b/` containing `AGENT.md`
When  the guard runs
Then  it exits non-zero and names `.agents/agents/b` and `.agents/agents/b/AGENT.md`
Given a directory holding only regular `*.md` files, or none, or absent
Then  the guard exits zero
Given the guard mutated to accept a sub-directory
Then  its test suite fails
```

**Scenario:** Setup migration of an installed agent

```text
Given `~/.gemini/config/agents/developer/AGENT.md` with provenance, alone in its directory, and an unrelated `~/.gemini/config/agents/mine/agent.md`
When  the Antigravity setup installs the `developer` agent
Then  `~/.gemini/config/agents/developer.md` exists and `Installed agent: developer` is printed after that check
And   `Migrated away: <home>/.gemini/config/agents/developer` is printed and the directory is gone
And   `mine/agent.md` is untouched
```

**Scenario:** Setup leaves a modified stale directory

```text
Given `~/.gemini/config/agents/developer/` holding `AGENT.md` and a user file
When  the setup installs `developer`
Then  the directory is left, a warning names it, and `developer.md` is still installed
```

**Scenario:** Collision key

```text
Given two component sources that resolve to the same Antigravity agent name
When  the component resolver runs
Then  the reported collision key is `.agents/agents/<name>.md`
And   the set of reported collisions is the same as before this delta
```

**Scenario:** Fork synchronization, directory to file

```text
Given a fork whose tree holds `.agents/agents/developer/AGENT.md`
When  it synchronizes from an upstream carrying `.agents/agents/developer.md`
Then  the directory form is removed and the flat file is present
```

**Scenario:** Description-length glob

```text
Given `.agents/agents/x.md` whose description exceeds the cap
When  the description-length check runs
Then  it fails naming `.agents/agents/x.md`
```

**Scenario:** Provenance detection

```text
Given `.agents/agents/x/AGENT.md` whose body mentions provenance but whose frontmatter has no `metadata.provenance.canonical`
When  the build or the setup considers it for removal
Then  it is not provenance-carrying and the directory is left with a warning
```

**Scenario:** Orphaned stale directory

```text
Given a committed `.agents/agents/gone/AGENT.md` for an agent no longer emitted
When  the build runs in write mode and in `--check` mode
Then  neither touches or reports it
And   the layout guard fails naming `.agents/agents/gone`
```

Added to `## Out of scope`:

- **Cleaning orphaned retired directories** of agents no longer emitted, by the
  build, `--check`, or the setup (requirements 14, 19, 29).

- **A `tools` list or any tool restriction for Antigravity agents.** Not emitted
  (see the decisions above); revisited only with verified vendor semantics.
- **A `model`, `mainAgent`, or `subagent` field.** Not emitted.
- **Runtime verification of agent behaviour.** Requires a signed-in `agy`
  session; tracked by the follow-ups of requirement 24.
- **Plugin-packaging layout for Antigravity agents** (the extension-plugin path
  copies agent directories whole). Unchanged; recorded as unverified.
- **The `.agents/skills/` layout.** Unchanged.
- **Opening the follow-up issues.** Done by the orchestrator, not by this spec.

## MODIFIED

Modified in `## Requirements`:

Original (0053 requirement 3):

```markdown
3. When invoked with `--target antigravity`, the build script SHALL emit
   compiled agent outputs to `<output-root>/.agents/agents/<name>/AGENT.md`
   for every discovered agent source, following the same YAML frontmatter shape
   used by the Claude Code target.
```

Replacement:

```markdown
3. When invoked with `--target antigravity`, the build SHALL emit compiled agent
   outputs to `<output-root>/.agents/agents/<name>.md` for every discovered
   agent source, with the frontmatter shape of requirement 12 of delta-01.
```

Original (0053 requirement 7, agent clause):

```markdown
one for a core-tier agent under `$TEMP_REPO/.agents/agents/`
```

Replacement:

```markdown
one for a core-tier agent as `$TEMP_REPO/.agents/agents/<name>.md`
```

Modified in `## Scenarios`:

Original (0053 happy path, assembly-verification test): the assertion of "one
core agent ... under the `.agents/` path" is read as the flat file of
requirement 11.

Replacement: the same scenario, asserting the flat file and the absence of the
retired directory.

## REMOVED

- From the Antigravity agent clause of 0250 requirement 13: the sub-directory
  path `.agents/agents/<name>/AGENT.md` and the keys `license`, `compatibility`,
  `enable_write_tools`, `enable_mcp_tools`, `enable_subagent_tools`, together
  with the rule that `enable_write_tools` falls back to `true` when
  `claude.allowed-tools` holds `Bash` (superseded by requirements 11 to 13 and
  15).
- From 0053 requirement 3: the path `<name>/AGENT.md` and the sentence "same YAML
  frontmatter shape used by the Claude Code target".
