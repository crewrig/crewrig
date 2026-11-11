---
id: "0291"
slug: agent-model-tools-allowlist
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1851
version: 1.0.0
---

# Agent frontmatter: the model on Claude Code and a least-privilege tool allowlist

## Intent

A maintainer who reads a compiled Claude Code agent sees the model it runs on as a frontmatter field, not as a sentence appended to its description, because the hazard that once forced the sentence has been shown, on a recorded probe, not to break the other CLI that reads the same directory. A maintainer can also declare, in an agent's single source, which classes of tool the agent needs, and every CLI that has a tool allowlist receives it in that CLI's own tool names, so an agent that only reviews no longer carries the tools that edit files. An agent that declares nothing behaves exactly as before. A CLI that cannot receive the declaration says so on the build's diagnostic stream and in the CLI matrix instead of staying silent, and a mistyped or unmappable declaration stops the build instead of producing an agent that fails to load or hangs.

## Requirements

1. **R1 (lift).** The Claude Code core mapping SHALL record its `copilot-shared-read` guard in the `directed` state, and every compiled `.claude/agents/<name>.md` of a core agent whose source declares an intelligence rung SHALL carry the `model:` frontmatter key that the mapping resolves for it (one of `haiku`, `sonnet`, `opus`, `fable`), placed after `description` and any `license`/`compatibility` line.
2. **R2 (one carrier at a time).** The `model` item SHALL be directed onto the guidance surface only when it is not directed onto the frontmatter surface: under a `withheld` guard, or when the resolved value is outside the frontmatter key's declared domain. Under a `directed` guard with a readable value, the declination SHALL be carried by the `model:` key alone, and the compiled Claude Code description SHALL NOT contain `Run this agent on the <model> model.`. The `reasoning` item is unchanged. Flipping the guard state alone is not enough: a trial build with the state flipped added `model: sonnet` and left the sentence, because spec 0197 R31 directs the `directed` state "additionally" onto the guidance surface. This requirement supersedes that word of R31 as a resolver rule, and so requires a change in `scripts/lib/model-resolve/resolve-item.ts` (the final `state.gd[idx]` assignment, line 140); the guidance surface and template of `model-mappings/claude.yml` (`carries: [model, reasoning]`) stay unchanged, so rule A20a is untouched. A trial of exactly this change (guard directed, both terms `false`) gave 22 Claude files with `model:` and no sentence, and `check-model-mappings.ts` exit 0. The Antigravity description, whose target has no frontmatter model surface (spec 0197 Premise 1), SHALL keep its sentence unchanged.
3. **R3 (terms agree with the evidence).** The guard SHALL keep exactly two terms, each `holds: false`, each carrying non-empty `evidence` and a `holds` ground of kind `citation`, so that `node scripts/check-model-mappings.ts` exits 0 (rules A14a, A14b, A22, A23 of `scripts/lib/model-mappings/pass-guard.ts`). Term `defect-not-established-fixed` SHALL keep its id and be narrowed in its statement to "on a standard GitHub-hosted account", and SHALL cite the probe of 2026-11-10 on GitHub Copilot CLI 1.0.109 recorded in issue 1851; no term SHALL assert that the defect is fixed for a bring-your-own-key provider (R4). The second term SHALL be replaced by a term whose statement is the hazard itself, that a Copilot CLI reader of `.claude/agents/` fails or silently misroutes a subagent whose `model:` it cannot serve, under the new id `copilot-reader-fails-on-unserved-model`, whose evidence SHALL say how it differs from term 1: term 1 concerns the specific upstream defect (silent misrouting of a subagent on a standard account), term 2 concerns the observable outcome on a Copilot reader whatever the cause (the probe saw a warning and a fallback to the session model, so it does not hold), and an adopter on a bring-your-own-key provider flips term 2, not term 1, because it states what that adopter's Copilot readers may do, which no probe covers for them; the old id `copilot-reader-consumes-claude-surface` states a standing fact that the same probe confirms, so it cannot hold `false`. The guard's `spec` field SHALL cite this spec.
4. **R4 (scope of the evidence, residual risk).** The evidence SHALL state that the probe covers a standard GitHub-hosted account, with `model: sonnet`, `model: claude-sonnet-5-5` and `model: claude-sonnet-4.5` each producing a warning and a fallback to the session model, a subagent spawned through the `task` tool answering on the session model, and the run succeeding; it SHALL state that it does not cover a bring-your-own-key provider, which is where `github/copilot-cli#4437` was reported (Copilot 1.0.79, Ollama), nor an account on which Claude models are served. Spec 0143 delta-01 R8 demands evidence for "BYOK/Ollama providers"; this spec narrows that clause to the standard account and records the bring-your-own-key case as an accepted, unverified residual risk, in the guard evidence, in the guard row of the CLI matrix, and as a `[GAP-confirmation]` bullet in `docs/cli-matrix/parity-gaps.md`.
5. **R5 (an organization can re-withhold).** An organization mapping that sets `guard.state: withheld` and the term `copilot-reader-fails-on-unserved-model` to `holds: true` SHALL pass the checker as the mapping in force, and a build under it SHALL, for every Claude Code agent, write no `model:` key, keep the sentence `Run this agent on the <model> model.` in the description, and emit one `model-note ... guard-withheld` line (spec 0197 R31 withheld clause and R32, unchanged). Those are the only lines the guard drives: apart from the `tools:` line of R11, the R20 body sentence and the version bump of R24 on the sources those requirements edit, each compiled Claude file SHALL be byte-identical to the pre-change build of the same source, which is all 16 unedited core agents in full. A trial of the guard-driven part, run before the source edits of R18 to R24 existed and with the old term id, gave 22 files identical to the committed ones and 22 `guard-withheld` notes. `docs/org-model-mapping-override.md` SHALL document this override as the path for an adopter on a bring-your-own-key provider.
6. **R6 (supersession is stated).** The superseded text SHALL be named where a reader meets the guard, in `docs/model-mapping-format.md` (*Guard*) and in the guard row of the CLI matrix: spec 0143 delta-01 R8 (BYOK clause), spec 0197 R30 (second term), the word "additionally" in R31, R37 (recorded `withheld`) and the scenario "the shared-read guard is directed", spec 0197 delta-02 ("stays withheld"), and the statements in spec 0200 that the guard stays `withheld`. R31's withheld clause, R32 and R35 stay in force. The superseding SHALL NOT edit those specs.
7. **R7 (diagnostic stream).** A drop record has six tab-separated fields, `<kind><TAB><agent><TAB><target><TAB><path><TAB><declared><TAB><reason>`, as `model-drop` already has (for example `model-drop<TAB>accessibility-auditor<TAB>copilot<TAB>metadata.model.intelligence<TAB>medium<TAB>unsupported-on-cli`); `tools-drop` (R13, R14) SHALL use the same six fields with path `metadata.tools`. A plain `node scripts/build-components.ts --target all` SHALL emit no `guard-withheld` line; over the 22 core sources it SHALL emit 22 `model-drop` lines (measured on the trial) plus one `tools-drop` line per declaring agent for Antigravity. The plain run builds the library tier as well as the core tier (the build handles tiers generically, output of the library tier going under `dist/library/`), so over the real tree there are six declaring agents (the five core agents `security`, `architect`, `accessibility-auditor`, `seo-specialist`, `ci-debugger` and the library agent `harness-curator`); `harness-curator` declares no intelligence rung, so it adds a `tools-drop` line but no `model-drop` line (it is absent from today's 44), giving 22 + 6 = 28 lines; over the 22-core-source root of `agent-profile-build.test.ts` it is five, so 27. With `--check`, the four `no-mapping` notes of the assembly test's synthetic root are added: 32 lines over the real tree, against the 44 and 48 that `docs/agent-profile-migration.md` lines 193-194 state today. The `tools-drop` counts are derived, not measured (the emitter does not exist yet), and SHALL be re-measured at implementation. That document and the stream assertions of `agent-profile-build.test.ts` SHALL state the new counts, and its sentence about the compiled description SHALL be updated.

8. **R8 (declaration).** An agent source MAY declare `metadata.tools`, a non-empty YAML list of strings drawn from the closed vocabulary `read`, `search`, `edit`, `execute`, `web`, `agent`, without duplicates. The key is opt-in: it exists on agent sources only, and the declaration is CLI-agnostic, like `metadata.model` (spec 0195). A top-level `tools:` key SHALL NOT be used: `artifacts/FORMAT.md` keeps the root frontmatter to the agentskills.io fields, `metadata:` being the reserved place for the rest.
9. **R9 (key check).** `scripts/check-component-metadata-keys.ts` SHALL admit `tools` beneath `metadata:` on an `AGENT.md` under `artifacts/core/` or `artifacts/library/` and SHALL reject it, naming file and key, on a `SKILL.md` or command source there; its rejection message and `artifacts/FORMAT.md` (which states the admitted set is exactly two keys) SHALL name the new set. This supersedes spec 0200 R8 for `tools` on agents.
10. **R10 (build-time refusal).** The component build SHALL fail, naming the source file, the key, the offending value and the six admitted classes, when `metadata.tools` is not a list, is empty, holds a string outside the vocabulary or holds a duplicate. The check SHALL run for every agent whichever CLI targets are selected, including a build of `--target antigravity` alone, and SHALL be a `BuildFailure` of the kind `emit-agent-antigravity.ts` already raises (lines 40-44).
11. **R11 (mapping).** Each emitter SHALL translate the declared classes to its CLI's names, emitted in the vocabulary's order whatever the order in the source:

    | Class | Claude Code | Copilot CLI | Gemini CLI |
    |---|---|---|---|
    | `read` | `Read` | `read` | `read_file`, `read_many_files`, `list_directory` |
    | `search` | `Grep`, `Glob` | `search` | `grep_search`, `glob` |
    | `edit` | `Edit`, `Write` | `edit` | `write_file`, `replace` |
    | `execute` | `Bash` | `execute` | `run_shell_command` |
    | `web` | `WebFetch`, `WebSearch` | `web` | `web_fetch`, `google_web_search` |
    | `agent` | `Agent` | `agent` | none |

    The names are grounded on documentation read on 2026-11-11, which states no CLI version: the Gemini tool identifiers in the table at <https://geminicli.com/docs/reference/tools/> (all ten, including `read_many_files` and `list_directory`), the Copilot primary names and compatible aliases at <https://docs.github.com/en/copilot/reference/custom-agents-configuration>, and the Claude Code names at <https://code.claude.com/docs/en/sub-agents>; the Gemini strict `tools` key is the one already recorded in row 43 (Gemini CLI 0.28.2, `agentLoader.js`). Claude Code (`.claude/agents/`) SHALL receive `tools: Read, Grep, Glob` (a comma-separated string, the form probed on the shared surface); Copilot CLI (`.github/agents/`) and Gemini CLI (`.gemini/agents/`) SHALL receive a one-line flow sequence such as `tools: [read, search]`. The key SHALL follow the directed lines (`model:`) and precede the provenance block. Antigravity CLI follows R14.
12. **R12 (opt-in, byte-identical when absent).** An agent source with no `metadata.tools` SHALL produce no `tools` key on any CLI. Its compiled Gemini, Copilot and Antigravity files SHALL be byte-identical to those the same source produced before this change, and its compiled Claude file SHALL differ only by R1 and R2. This holds because the emitters assemble frontmatter from `name`, `description`, the `license`/`compatibility` lines (Claude only) and the resolved directed lines alone (`scripts/lib/build-components/emit-agents.ts` lines 43-70).
13. **R13 (the `agent` class on Gemini).** Gemini CLI documents that "subagents cannot call other subagents", even with the `*` wildcard (<https://geminicli.com/docs/core/subagents/>, read 2026-11-11), so the class `agent` has no Gemini name. The Gemini emitter SHALL omit it, SHALL emit one `tools-drop` line for it (R7 grammar, declared `agent`, reason `no-equivalent-on-cli`), and SHALL fail the build, as R10, when omitting it leaves no tool, so that no empty list is ever written.
14. **R14 (Antigravity, non-silent gap).** The Antigravity emitter SHALL write no `tools` key, consistent with spec 0053 delta-01 R12 and R13, and SHALL emit, for each agent that declares `metadata.tools`, one `tools-drop` line (R7 grammar, target `antigravity`, declared classes comma-joined, reason `unsupported-on-cli`) on standard error and in the `--diagnostics` file, like `model-drop`. Antigravity documents the names `view_file`, `replace_file_content`, `grep_search` and `run_command` and warns that a misspelled name may hang the subagent (spec 0053 delta-01, the paragraph beginning "A `tools` list is not emitted"); the class-to-name mapping is unverified and SHALL NOT be guessed. The gap SHALL be recorded as `[GAP-confirmation]` in `docs/cli-matrix/parity-gaps.md` and in the Antigravity cell of row 4c, stating the condition that lifts it: each class's exact Antigravity name established by a probe on a named ticket.
15. **R15 (golden tests).** Automated tests SHALL compare bytes for each emitter: every class alone, all six together, reversed source order, and the opt-in absence of R12, with the ten Gemini names of R11 pinned literally; and SHALL cover R10 (each invalid shape), R13, R14 and the `--target antigravity` alone case. The tests SHALL be hermetic: no live CLI, no model call, no network.
16. **R16 (outside the vocabulary).** `artifacts/FORMAT.md` and `docs/authoring.md` SHALL state that a tool allowlist withholds every tool it does not name, and that on Claude Code this includes MCP tools unless listed, `SendMessage`, `Skill`, `ToolSearch` and `TodoWrite` (<https://code.claude.com/docs/en/sub-agents>, read 2026-11-11. Stated there: `tools` is an allowlist; the restricting example "can't edit files, write files, or use any MCP tools"; MCP tools are available to an allowlisted subagent only when listed (for example `mcp__<server>__*`); a background subagent "keeps every MCP tool but only these built-in tools", a list that includes `SendMessage`, `Skill`, `ToolSearch` and `TodoWrite`. INFERENCE, not stated there: that a `tools` allowlist also withholds `SendMessage`, `ToolSearch` and `TodoWrite`; the page only says an allowlist excludes what it does not name), none of which the six classes can express. An agent whose body requires one of those SHALL NOT declare `metadata.tools` until the vocabulary covers it. On the shared `.claude/agents/` surface the same documentation SHALL state that Copilot treats `Bash`, `Read`, `Edit`, `Write`, `Grep`, `Glob`, `WebFetch`, `WebSearch` and `Task` as aliases, that `Agent` is not an alias and is ignored, and therefore that a declared `agent` class reaches Claude Code but not a Copilot reader of that directory, which fails toward fewer tools.
17. **R17 (honesty about `execute`).** Documentation and agent bodies SHALL NOT call an agent that declares `execute` read-only. They SHALL state that `execute` can still modify files and remote state, so a declaration is a least-privilege reduction, not a sandbox.

18. **R18 (agents).** The sources SHALL declare exactly the classes of the per-agent table below, and no other core or library agent SHALL declare `metadata.tools` in this change.
19. **R19 (`pr-reviewer`).** The `claude:` section of `artifacts/core/agents/pr-reviewer/AGENT.md` (`allowed-tools: [Bash]`), which no agent emitter reads (`allowedToolsLines` is called from `emit-skills.ts` and `emit-commands.ts` only), SHALL be removed. `pr-reviewer` SHALL NOT declare `metadata.tools` in this change, because its body relies on `SendMessage` (lines 57-62), which no class covers; whether an allowlist would withhold `SendMessage` is the inference of R16, so this is the conservative choice: an agent is left unrestricted rather than risking a broken reporting protocol, and the choice is reversible by a later spec once the page or a probe settles it.
20. **R20 (bodies).** The five agents that carry a `harness-report` paragraph and receive an allowlist (`security`, `architect`, `accessibility-auditor`, `seo-specialist`, `harness-curator`) SHALL gain one sentence saying that, when its tool set withholds the MCP tool that records a friction, the agent reports the friction (offender, signal, evidence) in its final reply for the delegating session to tag. `architect` SHALL also state that it returns ADR and RFC drafts in its reply and does not write files, the delegating session persisting them.

21. **R21 (FORMAT and docs).** `artifacts/FORMAT.md` (the agent override table, the `metadata.model` paragraph at lines 116-141 and the agent output examples at lines 295-320), `docs/authoring.md` (*Declaring a model need*, and the Claude rows of the output table at lines 94-115), `docs/model-mapping-format.md` (*Guard*, lines 205-225, and the conventions at 405-414), `docs/org-model-mapping-override.md` (which SHALL also carry a migration note: an organization file that overrides the retired id `copilot-reader-consumes-claude-surface` is addressed by `guard/terms/<id>` as an added third term, which the mapping in force then fails under rule A22 "exactly two terms", so such an adopter SHALL rename the override to `copilot-reader-fails-on-unserved-model`) and `docs/agent-profile-migration.md` SHALL state the behavior of this spec.
22. **R22 (CLI matrix).** The sources of rows 4c, 32, 33, 34 and 43 under `docs/cli-matrix/rows/`, and `docs/cli-matrix/parity-gaps.md`, SHALL be updated and `docs/cli-matrix.md` regenerated (`task cli-matrix:build`, checked by `task cli-matrix:check`). Row 4c SHALL be rewritten for all four CLIs, because every cell is stale: it says Claude Code, Gemini and Copilot take no agent-level tools and that Antigravity maps `Bash` to `enable_write_tools`, which spec 0053 delta-01 R13 retired. Row 33 (the guard) and row 34 SHALL record `directed` and Copilot CLI 1.0.109 as the verified version, with the residual risk of R4. Row 32 SHALL record that the same probe shows Copilot honoring `tools:` in `.claude/agents/`. Row 43 SHALL note that the Gemini 0.28.2 strict schema it cites admits `tools`, now emitted.
23. **R23 (built outputs).** The change SHALL include the outputs regenerated by `node scripts/lib/node-floor-guard.js` then `node scripts/build-components.ts`, staged in the same commit: the 22 `.claude/agents/*.md`, and the four compiled outputs of each changed core source (the five core agents of R18 and `pr-reviewer`; `harness-curator` is a library agent whose outputs are built under `dist/library/` and not committed). `node scripts/build-components.ts --check` SHALL pass.
24. **R24 (version bumps).** Every modified agent source (the six of R18 and `pr-reviewer` for R19) SHALL bump `metadata.provenance.version` in the same diff, MINOR for a source that gains `tools`, PATCH for `pr-reviewer`, and `scripts/check-skill-versions.ts` SHALL pass. The other 16 core agent sources are not modified and SHALL NOT be bumped: the rule applies to a changed source, not to a changed compiled output.
25. **R25 (tests that encode the old state).** Every test whose expectation encodes the `withheld` Claude guard, the two old terms or the guidance `model` sentence SHALL be updated, among them `scripts/tests/agent-profile-build.test.ts` (its 44-line stream), `scripts/tests/agent-profile-committed.test.ts`, `scripts/tests/check-model-mappings-committed.test.ts` and the model-mapping, model-resolve and build-components conformance suites. The suites that failed on a trial flip of the guard state alone, and so are known to encode the old state, include `build-components-conformance.test.ts`, `-conformance-mutation.test.ts`, `-conformance-root.test.ts`, `build-install-scope-build.test.ts`, `check-model-mappings-org.test.ts`, the `model-ci-tooling-model-mappings*.test.ts` files, `windows-model-ci-tooling-models.test.ts`, `model-resolve-cases.test.ts`, `-mapping-access.test.ts`, `-merge-ops.test.ts` and `-select.test.ts`; the resolver change of R2 changes the outcome of the frozen cases that run a `directed` Claude guard. The shell-oracle goldens under `scripts/tests/fixtures/model-resolve-oracle/` are frozen shell output that the host cannot re-record (`scripts/tests/lib/model-resolve-golden-regen.ts` refuses to run off Linux); the PLAN SHALL choose how they stay valid and SHALL NOT edit a golden by hand.
26. **R26 (CI budget).** No new test SHALL add a CI capability or a line to the three CI surfaces (`.github/workflows/build.yml` and `_ci-*.yml`, `ci/ci-capabilities.yml`, `.gitlab-ci.yml`: 9,062 lines against a pin and floor of 9,070 and a hard cap of 9,100, spec 0287 R13). New cases SHALL go into existing files that an existing capability already runs: emitter cases into `scripts/tests/build-components-output-agents.test.ts` (capability `build-components-ts`, run as `task ci:build-components-ts`), profile and stream cases into the `agent-profile-*.test.ts` files (capability `agent-profile-migration`), and checker cases into the files of capability `check-model-mappings`. Before the implementation PR opens, `node scripts/check-ci-parity.ts` and `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/ci-shrink-report.test.ts` SHALL pass locally.
27. **R27 (no live verification).** No step of this change's verification SHALL launch a CLI or call a model. The evidence for the guard is the recorded probe; every other claim is checked by the hermetic tests above.

### Per-agent declaration

Each row was checked against the agent body and the skill it activates (line numbers are in the files on `main` at the time of writing). `execute` appears only where the body or its skill names a command.

| Agent | Classes | Evidence |
|---|---|---|
| `security` | `read`, `search`, `web` | Findings, not patches (`AGENT.md`:24-26). Dependency audit reads the changelog and queries the GitHub Security Advisory database (`security/SKILL.md`:113-115), a fetch. No command is prescribed. |
| `architect` | `read`, `search`, `execute` | Reviews and proposes, defers implementation (`AGENT.md`:22-24). The skill requires a measured `wc -c` on a `sed` range before any savings figure (`architect/SKILL.md`:96-110) and names a GitHub issue as the RFC output (:138). No `edit`: the ADR path (:137) is persisted by the delegating session (R20). |
| `accessibility-auditor` | `read`, `search`, `execute`, `web` | Runs `@axe-core/cli` and Lighthouse (`AGENT.md`:44-50); the input is a locally served or staging site (:36-38). Names no browser-driving tool. |
| `seo-specialist` | `read`, `search`, `web` | Checks that sitemap entries answer 200 and that links have no redirect chain over one hop (`AGENT.md`:97, 105), fetches. No `execute`: the body names no command and forbids running audit tools (:152-153). |
| `ci-debugger` | `read`, `search`, `execute` | `gh run view <id> --log-failed` (`AGENT.md`:59-61), `actionlint` (:236-240), `node scripts/simulate-job.ts` (:323-327). Applying a fix is delegated to `developer` (:360-366), though the frontmatter description says "diagnosing and fixing". |
| `harness-curator` | `read`, `search`, `execute` | Runs `node scripts/curate.ts` and `task harness-curate`, which read the MemPalace library from the script, and opens issues with `gh issue create` (`harness-curator/SKILL.md`:60-63, 128-133). |
| `pr-reviewer` | none | Would need `read`, `search`, `execute` (`gh pr diff`, `gh pr review`, `scripts/check-comment-size.ts`: `AGENT.md`:42-54, 87) plus `SendMessage` (:57-62), which no class covers (R16, R19). |

## Scenarios

**Scenario:** the model is a frontmatter key on the Claude surface

```text
Given the mapping with its guard recorded directed and both terms holding false
When  node scripts/build-components.ts runs
Then  .claude/agents/security.md carries "model: sonnet" after description
And   its description does not contain "Run this agent on"
And   .agents/agents/security.md still carries that sentence
And   no line of the build's stream names guard-withheld
```

**Scenario:** an agent without a declaration is unchanged apart from the model

```text
Given an agent source with a model profile and no metadata.tools
When  it is built for all four CLIs
Then  no compiled file carries a tools key
And   its Gemini, Copilot and Antigravity files are byte-identical to the previous build
And   its Claude file differs by the added model line and the removed sentence only
```

**Scenario:** one declaration, three spellings

```text
Given an agent source declaring metadata.tools: [read, search, web]
When  it is built
Then  the Claude file carries "tools: Read, Grep, Glob, WebFetch, WebSearch"
And   the Copilot file carries "tools: [read, search, web]"
And   the Gemini file carries "tools: [read_file, read_many_files, list_directory, grep_search, glob, web_fetch, google_web_search]"
And   the Antigravity file carries no tools key and the stream carries one tools-drop line for it
```

**Scenario:** a declaration the build cannot map stops the build

```text
Given an agent source declaring metadata.tools: [shell]
When  the build runs, for any target selection
Then  it exits non-zero naming the file, the key, the value "shell" and the six classes
And   no agent file with a guessed tool name is written
```

**Scenario:** the agent class alone has no Gemini name

```text
Given an agent source declaring metadata.tools: [agent]
When  the build runs for Gemini CLI
Then  it exits non-zero rather than writing an empty tools list
And   with metadata.tools: [read, agent] the Gemini file lists the read names only and the stream carries a tools-drop line with reason no-equivalent-on-cli
```

**Scenario:** the key is refused where it does not belong

```text
Given a SKILL.md source under artifacts/core carrying metadata.tools
When  node scripts/check-component-metadata-keys.ts runs
Then  it exits 1 naming the file and the key
```

**Scenario:** a guard that disagrees with its terms is refused

```text
Given a Claude mapping with guard.state directed and one term holding true
When  node scripts/check-model-mappings.ts runs
Then  it exits 1 with rule A23
```

**Scenario:** an adopter on a bring-your-own-key provider re-withholds

```text
Given an organization mapping setting guard.state withheld and the term copilot-reader-fails-on-unserved-model to holds true
When  the build runs
Then  the mapping in force passes the checker
And   no .claude/agents file carries a model key and each description keeps the sentence "Run this agent on the <model> model."
And   each of the 16 unedited core agents' Claude files is byte-identical to its pre-change content
And   the stream carries one model-note ... guard-withheld line per agent
```

**Scenario:** the CI budget holds

```text
Given the change is complete
When  node scripts/check-ci-parity.ts and the ci-shrink-report test run
Then  both pass and the three CI surfaces total no more than 9,070 lines
```

## Out of scope

- `effort`, `maxTurns`, `isolation`, `memory` and `skills` preload on agents (epic 1856).
- Verifying the guard against a bring-your-own-key provider, or against an account on which Claude models are served; R4 records the residual risk and R5 gives adopters the way out.
- A `tools` declaration for `pr-reviewer`, and any seventh class (for MCP, coordination or skill tools): both wait for a vocabulary that can name `SendMessage` and the MCP tools.
- A denylist form (`disallowedTools`): Gemini CLI and Copilot CLI offer allowlists only, and a Claude-only denylist would leave Copilot readers of the shared directory unrestricted.
- Emitting `tools` for Antigravity, and verifying its tool names.
- Editing any `description` (the `ci-debugger` "and fixing" wording stays), and adding a friction paragraph to `ci-debugger`.
- Running a live CLI or model to prove the emitted names (R27).
- Re-recording the frozen shell-oracle goldens by hand.

## Open questions

- [GROUNDING:] `seo-specialist` audits a site that may be locally served (`AGENT.md`:37) and receives no `execute`. Whether `web` can reach a local server depends on the CLI; confirm that this agent is meant to audit staging URLs only, or add `execute` with the command it will run named in the body.
- [GROUNDING:] Spec 0143 delta-01 R8 requires evidence on bring-your-own-key providers; the recorded probe is a standard account. R4 supersedes that clause and accepts the residual risk. A maintainer must confirm that acceptance before approval.
- [GROUNDING:] On Copilot, `model: sonnet` in `.claude/agents/` produced a warning on standard error at each run in the probe ("specifies model ... which is not available; using ... instead"). Which of `.claude/agents/<name>.md` and `.github/agents/<name>.md` Copilot loads when both exist is not established. A maintainer must confirm that a warning per agent for Copilot users is accepted.
- [GROUNDING:] `pr-reviewer` is listed by issue 1851 but is left without `tools` (R19), because `SendMessage` (`AGENT.md`:57-62) is outside the vocabulary. Confirm, or choose to drop the `SendMessage` branch of the reporting protocol, which touches `docs/reviewer-seat.md`.
- [GROUNDING:] `architect` is listed as one that must not edit files, yet its skill names `docs/adr/NNNN-<slug>.md` as an output (`architect/SKILL.md`:137). R20 makes it return drafts for the delegating session to write. Confirm that change of contract.
