---
id: "0291"
slug: agent-model-tools-allowlist
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 2049
version: 1.3.0
---

# Agent frontmatter: the model on Claude Code and a least-privilege tool allowlist

*Delta 03 of `specs/0291-agent-model-tools-allowlist.md`. Source: issue #2049, the follow-up of the live probe of issue #1867. On `agy` 1.5.9 an agent with no `tools` key gets a 9-tool read-only default set (no `run_command`, no file edit or write tool), so every compiled Antigravity agent, `developer`, `tester` and `doc-writer` included, cannot run a command or change a file. This delta makes the Antigravity emitter always write a `tools` key. Version 1.3.0, a MINOR bump: the Antigravity file gains a frontmatter line and the `tools-drop` record of Antigravity changes meaning; no declaration in a source changes meaning. It supersedes the Antigravity part of R12 and the whole of R14 of the parent, and, by the same cross-spec supersession pattern as R15 of `specs/0053-antigravity-build-pipeline.delta-01.md` over 0250 R13, the `tools` exclusion of R12 and the "no `tools` emission" half of R13 of that delta. Every other requirement of the parent and of deltas 01 and 02 is unchanged. Tier `small`, fixed by the coordinator: one mapping table and one default line in an existing emitter, the stream counts, the compiled outputs and the docs they restate; no new script, no new CI surface and no source edited. Grounding is the vendor migration guide embedded in `agy` 1.5.9 (section "`agents/<name>.md` (Claude Code subagents)", read from the binary with `strings`, quoted in the first comment of #2049) and the probe table of the second comment of #2049 (`agy` 1.5.9, signed in, 2026-11-15, tool set read from the model's own listing and from the first model call stored in the conversation database). Residual risk, named in R46: the mapping is pinned to `agy` 1.5.9.*

## ADDED

<!-- markdownlint-disable MD029 -->

37. **R37 (the Antigravity mapping).** The Antigravity emitter SHALL translate the declared classes of an agent that declares `metadata.tools` to the names below, in the vocabulary's order (R28 of delta 01) whatever the order in the source, and SHALL write each name once, at the position of its first occurrence:

    | Class | Antigravity CLI names |
    |---|---|
    | `read` | `read_file` |
    | `search` | `read_file` |
    | `edit` | `edit_file`, `write_file` |
    | `execute` | `run_command`, `manage_task` |
    | `web` | `search_web` |
    | `agent` | `invoke_subagent` |
    | `skill` | none |
    | `message` | `send_message` |

    The grounding rule is: a name comes from the vendor guide or from the probe, and always from the probe, so every emitted name SHALL be one that the probe showed reaching the model. The vendor guide maps `Read`, `Glob` and `Grep` to `read_file`, `Edit` and `MultiEdit` to `edit_file`, `Write` to `write_file`, `Bash` to `run_command` and `manage_task`, and `WebSearch` and `WebFetch` to `search_web`; `invoke_subagent` and `send_message` are absent from the vendor guide's mapping and rest on the probe alone. The probe of #2049 shows each emitted name reaching the model: `read_file`, `edit_file`, `write_file`, `run_command`, `search_web`, `invoke_subagent` and `send_message` were each accepted and each received as a tool, and a subagent given the vendor's "all tools" list created a file with `write_file`, changed it with `edit_file` and ran a command with `run_command`, the three effects checked on disk. `search` therefore has no dedicated name: the vendor maps `Glob` and `Grep` to `read_file`, and `grep_search`, `find_by_name`, `list_dir` and `read_url_content` pass the registry check **silently with no effect** (the name is accepted and no tool reaches the model, as main agent and as subagent; a subagent given `[read_file, grep_search, find_by_name, list_dir]` could not search, find or list). None of those four names SHALL be emitted, and no name that the probe did not show reaching the model SHALL be added to the table. The always-present tools of the probe (`call_mcp_tool`, `list_resources`, `read_resource`, `manage_task`) do not change this, with one explicit exception in the other direction: `manage_task` is always present whatever the list, so its being received proves nothing about the list, and it is emitted for `execute` only because the vendor guide pairs it with `Bash`.
38. **R38 (the `tools` line and its position).** The Antigravity emitter SHALL write the names as a one-line flow sequence `tools: [a, b]`, the names separated by a comma and a space, as the Copilot and Gemini emitters write theirs (R11 of the parent). The line SHALL sit after `description` and before the `metadata` provenance block, so the frontmatter is `name`, `description`, `tools`, `metadata`, in that order. This supersedes the `tools` exclusion of the sentence of R12 of `specs/0053-antigravity-build-pipeline.delta-01.md` that lists the keys the output SHALL NOT carry, and the clause "no `tools` emission" of the title and body of its R13: the build still reads no `antigravity.enable_*` key and still derives nothing from `claude.allowed-tools`, `Bash` included; only the `tools` line, now derived from `metadata.tools` or from R40, is written. A reader of those two requirements SHALL treat this delta as prevailing for the `tools` key, as R15 of that delta says of 0250 R13. The `model`, `license`, `compatibility` and `enable_*` keys stay unemitted by the rule of R12 of that delta, which this delta narrows only for `tools`; `mainAgent`, `subagent` and `inheritCustomizations` stay unemitted by R44.
39. **R39 (a class with no name is dropped, and the build fails when nothing is left).** A declared class that has no Antigravity name (`skill`) SHALL be omitted from the line, and the Antigravity emitter SHALL emit one `tools-drop` line for the agent (R7 grammar of the parent, target `antigravity`, path `metadata.tools`, declared the omitted classes comma-joined, reason `no-equivalent-on-cli`) on standard error and in the `--diagnostics` file, as R29 of delta 01 does for Copilot. When omitting classes leaves the agent no name (an agent declaring only `[skill]`), the build SHALL fail as R10 does, as a `BuildFailure` naming the source file, the key, the value and the CLI (`Antigravity CLI`) and the reason (no name on that CLI), and no empty list SHALL be written; `noToolName` in `scripts/lib/build-components/agent-tools.ts` SHALL accept `antigravity` as it accepts `gemini` and `copilot`. An agent that omits nothing (for example `[read, search]`, whose two classes both resolve to `read_file`) SHALL emit no `tools-drop` line, even though `search` is narrower than on the other CLIs; R45 records that narrowing in the docs. The `unsupported-on-cli` record of R14 of the parent SHALL no longer be emitted for Antigravity.
40. **R40 (an agent without `metadata.tools` gets the vendor's all-tools line, with its two effects accepted).** An agent source with no `metadata.tools` SHALL produce, for Antigravity, the line `tools: [read_file, edit_file, write_file, run_command, manage_task, search_web]`, the vendor guide's rendering of "no `tools` (meaning all tools)", and no `tools-drop` line. This supersedes the Antigravity part of R12 of the parent (an agent with no declaration is no longer byte-identical on Antigravity: its file gains this line, and nothing else changes); the Claude Code, Copilot CLI and Gemini CLI parts of R12 are unchanged, and so is the validity check of R10, which still runs for every agent whichever CLI is selected. The line is written because an omitted key gives the read-only default of the probe, and the vendor guide says to always write the key. The line is the vendor's own rendering of "all tools", but its two effects differ from the omitted key and SHALL both be stated, not hidden behind that name. It **broadens**: every agent with no `metadata.tools` (core `security`, the library agents that declare none, and every adopter agent) gains `run_command`, `edit_file` and `write_file`, which the omitted key withheld, so a review-only agent such as `security` can now run commands and write files on Antigravity. It **narrows**: the omitted key's default tools `schedule`, `generate_image` and, as main agent, `send_message` (a subagent keeps it as in the probe) are no longer received. Both effects are accepted, with the rationale that this is the vendor's own "all tools" line, and that no CrewRig agent uses `schedule` or `generate_image`, nor `send_message` as a main agent. The line itself is unchanged by this acceptance; an agent that must not write declares `metadata.tools` explicitly.
41. **R41 (the key is written whichever target is selected).** A build of `--target antigravity` alone SHALL write the `tools` line, with R39 and R40 applying, exactly as `--target all` does, and the validity check of R10 SHALL still run first.
42. **R42 (the diagnostic stream and its counts).** The plain `node scripts/build-components.ts --target all` SHALL emit one Antigravity `tools-drop` line per agent that declares `skill`, instead of one per declaring agent. Derived from `artifacts/*/agents/*/AGENT.md` on 2026-11-15, twelve agents declare `metadata.tools` (ten core, two library) and ten of them declare `skill` (`architect`, `ci-configurator`, `ci-debugger`, `ci-parity`, `developer`, `doc-writer`, `pr-logbook`, `pr-reviewer`, `spec-author`, `tester`, all core); `accessibility-auditor` (`[read, search]`) and `seo-specialist` (`[read, search, web]`) declare none. The Antigravity count therefore falls from 12 to 10 over the real tree and stays at 10 over the 22-core-source root of `agent-profile-build.test.ts`; the lines of the other targets (R29 of delta 01) and the `model-drop` lines are unchanged. These counts are derived, not measured (the build could not be run when this delta was drafted), and SHALL be re-measured at implementation. `docs/agent-profile-migration.md` (the stream-count table) and the stream assertions of `scripts/tests/agent-profile-build.test.ts`, whose line pattern admits the reason `unsupported-on-cli` for `antigravity`, SHALL state the new counts and the new reason.
43. **R43 (tests).** Automated tests SHALL compare bytes of the compiled Antigravity file, as R15 of the parent does for the other emitters, and SHALL cover: each class alone; all eight classes together (`tools: [read_file, edit_file, write_file, run_command, manage_task, search_web, invoke_subagent, send_message]`); the de-duplication (`[read, search]` yields `tools: [read_file]`); the reversed source order; the absent case of R40; a source declaring only `[skill]` (the build fails with the message of R39 and writes no file); a source declaring `[read, skill]` (one `tools-drop` line with declared `skill`, line `tools: [read_file]`); and the `--target antigravity` alone case of R41. The names SHALL be pinned literally in the expectations, and the four registry-accepted names with no effect of R37 SHALL be asserted absent from every output. The cases SHALL run on fixture agents written into a throwaway tree, never on a shipped agent, and SHALL be hermetic: no live CLI, no model call, no network (R15 and R27 of the parent hold). The tests whose expectation encodes the absence of a `tools` key or the `unsupported-on-cli` reason for Antigravity SHALL be updated, including `scripts/tests/agent-profile-build.test.ts` and the Antigravity emitter and committed-output suites.
44. **R44 (what stays unemitted).** The Antigravity emitter SHALL keep writing no `mainAgent`, no `subagent` and no `inheritCustomizations` key; the vendor defaults of the probe (an omitted `subagent` or `mainAgent` behaves as `true`) make that safe. The vendor guide recommends `subagent: true` and `mainAgent: false` for migrated subagents; whether CrewRig should emit them is not decided here (Open questions).
45. **R45 (docs and CLI matrix).** The Antigravity cell of row 4c in `docs/cli-matrix/rows/4c.md` SHALL lift the `[GAP-confirmation]` of R14 of the parent and SHALL record: the mapping of R37 with the grounding of the vendor guide and of the probe; the silent-acceptance trap (`grep_search`, `find_by_name`, `list_dir` and `read_url_content` pass the registry check and reach the model as nothing, so a name that the registry accepts is not proof that it works); the narrowing of `search` and of the `web` fetch half to `read_file` and `search_web`; the all-tools default line of R40; the drop of `skill`; and the version `agy` 1.5.9 and the date 2026-11-15 of the probe. The two Antigravity entries of `docs/cli-matrix/parity-gaps.md` (the `[GAP-confirmation]` entry on the Antigravity `tools` allowlist, and the `[GAP, intentional]` entry on the compiled agent shape) SHALL be updated: the first becomes a record of the lifted gap with its residual risk of R46, and the second no longer says that no tool restriction is emitted nor that every compiled agent is read-only; the entry of `skill` and `message` on Copilot CLI is unchanged. `docs/cli-matrix.md` SHALL be regenerated (`task cli-matrix:build`, checked by `task cli-matrix:check`). The documentation sweep SHALL cover every statement that R38 and R40 make false, at least: `artifacts/FORMAT.md` line 202 (a source that declares nothing gets no `tools` key on any CLI); `docs/authoring.md` line 159 (the same claim, and the Antigravity omission); `docs/cli-matrix/rows/4c.md` line 5 (the Antigravity file carries `name`, `description` and the `metadata` block only); `docs/cli-matrix/rows/4.md` line 19 (the same shape claim for the compiled agent); and `docs/agent-profile-migration.md` line 252 (the Antigravity file without `tools`). Row 4 (`docs/cli-matrix/rows/4.md`) is explicitly in scope: `task cli-matrix:check` only compares the generated `docs/cli-matrix.md` with its row sources and does not catch a stale row, so a stale row 4 would pass the check, and the implementer SHALL grep the repository for the old claims rather than rely on that check. The `tools-drop` comment and the header of `scripts/lib/build-components/emit-agent-antigravity.ts` SHALL stop saying that no key is written.
46. **R46 (compiled outputs, versions, and the residual risk).** Every compiled `.agents/agents/*.md` changes (the line of R38 or R40), so the committed dist outputs SHALL be rebuilt and committed in the implementation PR, and the committed-output check SHALL pass. No `AGENT.md` source is edited, so no `metadata.provenance.version` is bumped and `scripts/check-skill-versions.ts` has nothing to flag. The residual risk SHALL be named in the implementation PR body and in the record of R45: the mapping is pinned to `agy` 1.5.9. A future rename of a tool would fail loudly, because the registry check refuses an unknown name at agent start (`unknown component: tool "<name>" not found in registry`, as main agent in seconds and as subagent), whereas a name that becomes a silent no-op, as the four names of R37 are today, would not fail and would silently narrow an agent. Lifting that risk means re-probing the table of R37 on each Antigravity CLI bump; no automatic check is added by this delta. The risk of R27 of `specs/0053-antigravity-build-pipeline.delta-01.md` (a compiled agent that cannot write) is closed by this delta for every agent that declares `edit` and `execute`.

### Scenarios

**Scenario:** each class maps to its names, in vocabulary order, once

```text
Given a throwaway tree with an agent declaring metadata.tools [message, execute, search, read, edit, web, agent]
When  the component build runs for the antigravity target
Then  the file's frontmatter is name, description, tools, metadata, in that order
And   the tools line is "tools: [read_file, edit_file, write_file, run_command, manage_task, search_web, invoke_subagent, send_message]"
And   read_file appears once although read and search both map to it
And   the file contains none of grep_search, find_by_name, list_dir and read_url_content
And   the stream carries no tools-drop line for the agent
```

**Scenario:** a class with no Antigravity name is dropped, and said

```text
Given a throwaway tree with an agent declaring metadata.tools [read, skill]
When  the component build runs for the antigravity target
Then  the file carries "tools: [read_file]"
And   the stream and the --diagnostics file carry one line "tools-drop<TAB><agent><TAB>antigravity<TAB>metadata.tools<TAB>skill<TAB>no-equivalent-on-cli"
And   the stream carries no line with the reason unsupported-on-cli for that agent
```

**Scenario:** omitting the only class leaves no name

```text
Given a throwaway tree with an agent declaring metadata.tools [skill]
When  the component build runs for the antigravity target
Then  the build fails with status 1
And   the error names the source file, the key metadata.tools, the value skill and Antigravity CLI
And   no .agents/agents/<agent>.md is written and no empty tools list appears anywhere
```

**Scenario:** an agent without metadata.tools gets the vendor's all-tools line

```text
Given a throwaway tree with an agent that declares no metadata.tools
When  the component build runs with --target antigravity alone
Then  the file carries "tools: [read_file, edit_file, write_file, run_command, manage_task, search_web]" between description and metadata
And   the stream carries no tools-drop line for the agent
And   the Claude Code, Copilot CLI and Gemini CLI files of the same agent are byte-identical to the build before this delta
```

**Scenario:** the stream counts after the change

```text
Given the real tree, where ten agents declare skill and two other agents declare tools without it
When  a plain build runs with --target all
Then  the stream carries 10 tools-drop lines for antigravity, each with the reason no-equivalent-on-cli, instead of 12 with the reason unsupported-on-cli
And   the counts documented in docs/agent-profile-migration.md and asserted in agent-profile-build.test.ts state the re-measured total
```

## MODIFIED

- **R12 of the parent (opt-in, byte-identical when absent), first sentence and second sentence.** Original: "An agent source with no `metadata.tools` SHALL produce no `tools` key on any CLI. Its compiled Gemini, Copilot and Antigravity files SHALL be byte-identical to those the same source produced before this change, and its compiled Claude file SHALL differ only by R1 and R2." Replacement: "An agent source with no `metadata.tools` SHALL produce no `tools` key on Claude Code, Copilot CLI and Gemini CLI; its compiled files for those CLIs are byte-identical to those the same source produced before 0291 (Claude: but for R1 and R2). On Antigravity CLI it SHALL produce the line of R40 of delta 03." The explanatory sentence "This holds because the emitters assemble frontmatter from ..." stays true for the other three CLIs only.
- **R14 of the parent (Antigravity, non-silent gap)**, whole requirement. Original: "The Antigravity emitter SHALL write no `tools` key, consistent with spec 0053 delta-01 R12 and R13, and SHALL emit, for each agent that declares `metadata.tools`, one `tools-drop` line (R7 grammar, target `antigravity`, declared classes comma-joined, reason `unsupported-on-cli`) ... The gap SHALL be recorded as `[GAP-confirmation]` in `docs/cli-matrix/parity-gaps.md` and in the Antigravity cell of row 4c ..." Replacement: R37 to R41 and R45 of this delta; the condition that lifts the gap (each class's exact name established by a probe on a named ticket) is met by the probe of #2049, with the exception of `skill`, which has no name and is dropped by R39.
- **R7 of the parent (diagnostic stream), the sentence about the Antigravity `tools-drop` line, and the `unsupported-on-cli` part of the `tools-drop` grammar for Antigravity.** Original: "plus one `tools-drop` line per declaring agent for Antigravity". Replacement: one `tools-drop` line, reason `no-equivalent-on-cli`, per agent that declares a class with no Antigravity name (R42).
- **R15 of the parent (golden tests), the Antigravity part.** Original: "...and SHALL cover R10 (each invalid shape), R13, R14 and the `--target antigravity` alone case." Replacement: the Antigravity cases are those of R43 of this delta; the R14 case (no key, one `unsupported-on-cli` line) no longer exists.
- **R29 of delta 01, the sentence on Antigravity.** Original: "The Antigravity emitter is unchanged (R14: no `tools` key, one `tools-drop` line with the declared classes, `unsupported-on-cli`)." Replacement: the Antigravity emitter follows R37 to R41 of delta 03.
- **R12 of `specs/0053-antigravity-build-pipeline.delta-01.md`, the list of keys the output SHALL NOT carry**, the word `tools`. Original: "The output SHALL carry no `enable_write_tools`, `enable_mcp_tools`, `enable_subagent_tools`, `license`, `compatibility`, `tools`, `model`, `mainAgent`, or `subagent` key." Replacement: the same sentence without `tools`, and the file consists of `name`, `description`, `tools` and the `metadata` provenance block, in that order (R38). Spec 0053 is not edited; the supersession is by this delta, as R15 of that delta did for 0250 R13.
- **R13 of `specs/0053-antigravity-build-pipeline.delta-01.md`, the title and the clause "no `tools` emission".** Original title: "(No `enable_*` input, no `tools` emission)". Replacement: no `enable_*` input and no derivation from `claude.allowed-tools`; the `tools` line is emitted from `metadata.tools` or R40. The sentence recording the vendor defaults of `tools`, `subagent` and `mainAgent` as **unverified** is superseded for `tools` (verified, issue #1867) and for `subagent` and `mainAgent` (verified, issue #1867; still unemitted, R44).
- **R22 of the parent (CLI matrix), row 4c.** Extended by R45: the Antigravity cell is rewritten as R45 states.

## REMOVED

- The `tools-drop` record with the reason `unsupported-on-cli` for Antigravity (R14 of the parent): no Antigravity agent emits it after this delta. The reason stays admitted by the grammar for any future use, and `docs/agent-profile-migration.md` and the stream pattern of `agent-profile-build.test.ts` stop expecting it.
- The `[GAP-confirmation]` on the Antigravity `tools` allowlist in `docs/cli-matrix/parity-gaps.md` and in row 4c, as a gap: it becomes a lifted record with the residual risk of R46.
- The byte-identity of an agent with no `metadata.tools` on Antigravity (R12 of the parent): replaced by R40.

## Out of scope

- Emitting `mainAgent`, `subagent` or `inheritCustomizations` on Antigravity (R44); the vendor guide's recommendation is an open question.
- Any change to the Claude Code, Copilot CLI or Gemini CLI emitters, to the vocabulary of eight classes, to R10 or to the checker (R17 of the parent).
- Declaring or editing `metadata.tools` on any agent source, and any version bump of a shipped component (R46).
- A dedicated Antigravity name for `search`, for fetching a URL or for listing a directory: none reaches the model on `agy` 1.5.9 (R37). A later CLI version that adds one needs its own probe and its own delta.
- An automatic guard that re-probes the table on a CLI bump (R46 names the manual re-probe only).
- The Antigravity setup scripts and the extension-plugin packaging, which copy compiled agents as they are.
- Running `agy` in any test: the tests are hermetic (R43).

## Open questions

- [AUTO-PARKED] Should the Antigravity emitter write `subagent: true` and `mainAgent: false`, as the vendor guide recommends for migrated Claude Code subagents? The probe shows that omitted keys behave as `true`, so every compiled agent is both invocable as a subagent and selectable through `agy --agent`; `mainAgent: false` would remove the second route (`agy --agent <name>` exits with `unknown agent`), a behaviour change for any user who starts a session as `developer`. R44 leaves both keys unemitted; the owner decides in the spec PR whether a later delta emits them.
