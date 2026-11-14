# ADR-0025: Slim the fixed context of worker and subagent sessions

<!-- crewrig-doc: section=architecture-adr nav_order=250 published=true title="ADR 0025 — Slim the fixed context of worker and subagent sessions" -->

## Status

Proposed

RFC for issue #1932, parent #1930. No implementation in this ADR; each follow-up in *Follow-up work* is its own issue. Builds on [spec 0270](../../specs/0270-slim-always-loaded-rules.md) and its [delta-01](../../specs/0270-slim-always-loaded-rules.delta-01.md), which deferred the behavioural sections of `60-tools.md` "to a later work package that measures its behavioural effect first".

## Context

Every API call of a worker session, and of each subagent it spawns, starts from a fixed context that the work has not yet added to. On the 2026-11-13 run, re-reading that baseline cost about 52 M tokens, roughly half of the workers' 94 M ([#1932 logbook](https://github.com/crewrig/crewrig/issues/1932#issuecomment-6881400798)).

**Baseline** (Claude Code 2.1.323, Sonnet 5.5, fresh `claude -p` from a CrewRig workspace on `main` @ `eec8d994`; first-call input = input + cache read + cache creation, read from the session transcripts). Probe 1 of this ADR reproduced the logbook figures within 50 tokens (73,022 and 59,276 against 73,071 and 59,366).

| Session | First-call context | Target |
|---|---|---|
| Worker (main session) | **73,071** | ≤ 40,000 |
| Subagent (`developer`) | **59,366** | ≤ 30,000 |

**Where the tokens go** (worker; `/context` estimate 54.6k plus about 18k of attachments; the per-component figures below are `/context` estimates and the probe figures of *Options* are first-call API measurements, so they are not additive):

| Component | Tokens | Who controls it |
|---|---|---|
| Harness system prompt and tool definitions | 1.9k + 12.7k, of which about 16k is removable (see O2: `Artifact`, `Workflow`, `ScheduleWakeup`) | Claude Code build, user account |
| Memory files | 22.3k: `60-tools.md` 9.0k, `AGENTS.md` family 6.9k, personal rules 6.1k, `RTK.md` 0.4k | CrewRig (60-tools, AGENTS) and user (personal rules) |
| Skill listing | about 7.5k (30k characters; project, user, plugin, claude.ai-synced, bundled) | mixed |
| Agent listing (main only) | about 5.5k (19.8k characters, web/SEO agents and user plugins included) | mixed |
| Deferred tool names and MCP server instructions | about 6k (15k + 5.3k characters) | user (MCP set) |

A subagent receives the same memory files and skill listing, plus the tool definitions its frontmatter allows, but no agent listing and no MCP server instructions.

Two measurement facts shape the rest of the design:

- **Tool definitions are the largest single block.** The `Artifact`, `Workflow` and `ScheduleWakeup` definitions weigh 16.1k tokens in a worker and 12.1k in a subagent, and a CrewRig worker uses none of them.
- **Tokens are not dollars.** Most of the first-call input is a prompt-cache read, billed at a fraction of the input rate. The issue's targets are in tokens, so this ADR optimises tokens; the dollar saving is smaller than the token ratio.

## Options

Savings are deltas against the baseline of the same session kind, from the probes of the appendix (P-numbers) unless marked *estimated*. "Committable" means CrewRig can ship it in the repository; "user-only" means only a user can set it, in `~/.claude/` or a local settings file or a launcher.

### O1. Subagents drop CLAUDE.md memory (`omitClaudeMd: true`)

- **Mechanism.** The agent build emits `omitClaudeMd: true` in each agent's frontmatter and **inlines the conventions block into every emitted agent body**. The block has **one source file** in the repository, `artifacts/core/fragments/subagent-conventions.md`; nobody edits the block in an agent by hand, and an agent source carries no copy of it.
- **Why that path.** `artifacts/core/system-context/` was considered and rejected: it is installed verbatim to every user home and mirrored into MemPalace drawers as a read-on-demand reference store (`docs/layers.md`), so a build input placed there would ship an unused file to every home and invite the run-time-read misuse rejected below. A `_shared/` directory under `artifacts/core/agents/` would be enumerated by the agent build as an agent without an `AGENT.md`. A new `artifacts/core/fragments/` zone collides with neither; it needs one line in `docs/layers.md` and one in `.crewrig/core-paths.txt`, owned by F2.
- **Saving.** Subagent 59,276 → 36,108 (**−23.2k**, P1, `--agents` JSON). Emitted as file frontmatter in `.claude/agents/<name>.md`, the mechanism works too: two agents with identical bodies, one with the key, measured 30,396 and 14,479 (**−15.9k**, P11). P11 ran in a scratch project that loads no `AGENTS.md`, so its delta is user memory only (`60-tools`, personal rules, `RTK.md`); the extra saving for the project `AGENTS.md` family is the P1 delta minus P11, about **−7.3k**, consistent with its 6.9k estimate. The remaining 36k is harness tools, skill listing and the system prompt, so O1 alone does not reach 30k in a vanilla session (P10: 36,499).
- **Cost.** A subagent no longer sees `AGENTS.md`, `AGENTS.org.md` or any rule file. Rules it still needs must live in its body. The set, deliberately short (about 1.2k characters, probed in P9 and P10):
  1. **Pre-Edit Guard:** edit only with an issue, a feature branch named `<prefix>/<NNNN>-<slug>` (never `main`) and the ticket worktree `.worktrees/<ticket-id>/` as working directory. The tool-boundary worktree guard (cli-matrix row 29) backs the worktree clause mechanically.
  2. **Gitmoji only** for commit, issue and PR titles; no `feat:`/`fix:` prefixes.
  3. **English for project content** (repository files and every GitHub artifact); the user's language for dialogue.
  4. **No merge, no push to `main`;** forge operations go through `gh`; no `git reset --hard`, `git stash` or `git clean` in a shared worktree.
  5. **No secrets or `.env` in the repository;** a change to a shipped skill or agent bumps `metadata.provenance.version`; a change under `artifacts/` runs the build and stages its outputs.
  6. **Report a denied action to the caller** instead of re-running it elsewhere (anti-permission-laundering).
  Everything else in `AGENTS.md` (lifecycle, spec-PR workflow, logbook rules, interaction modes) is orchestrator business: a subagent receives its stage in the brief.
- **Risk.** A subagent that needs a rule outside the set will not know it. Mitigation: briefs already carry the stage and the ticket; the six rules above cover every action a subagent can take that is irreversible or outward-facing.
- **Effect per CLI.** See *CLI parity*. Gemini CLI subagents already run without the memory files (source of 0.28.2), so O1 moves Claude Code toward the Gemini behaviour rather than away from it.

### O2. Worker settings file (`--settings`)

A settings file passed at launch (`claude --settings <file>`, plus `--strict-mcp-config --mcp-config <file>` for MCP) that applies to the worker and to every subagent it spawns. Components, measured one by one against the baseline:

| Component | Setting | Worker | Subagent | Probe |
|---|---|---|---|---|
| W1 Harness tools a worker never uses | `permissions.deny: ["Artifact","Workflow","ScheduleWakeup"]` | **−16.1k** (56,965) | **−12.1k** (47,143) | P4 |
| W2 Personal rules | `claudeMdExcludes` for `00-soul`, `10-level`, `30-profile`, `50-team`, `40-expertise` | **−5.8k** (67,222) | −5.7k (53,533) | P2 |
| W3 Listings unrelated to CrewRig work | `syncClaudeAiSkills: false`, `skillOverrides` (user and web skills `off`), `permissions.deny: ["Agent(<web/SEO/user agent>)"]` | **−6.8k** (66,240) | −3.1k (56,203) | P5 |
| W4 MCP servers | `--strict-mcp-config` with an empty or minimal `--mcp-config` | about −6.1k (*derived* from attachment sizes: 15k + 5.3k characters of tool names and instructions) | included in P6 | P6 |
| W5 Bundled skills | `disableBundledSkills: true` | listing −3.5k, but inflates the `Workflow` definition by 17k characters when `Workflow` is kept (P3: main +2.1k, subagent −4.1k); a free win once W1 denies `Workflow` | | P3, P9 |

Combined (W1+W2+W3+W5, W4 flags), P9: **worker 36,260** (−36.8k), `developer` subagent with memory kept 32,314 (−27.0k).

- **Cost.** `claudeMdExcludes` and `deny` live in a settings file the launcher must pass: a project `.claude/settings.json` would apply them to the owner's interactive sessions too (dropping the SOUL and the level profile there, and the `Artifact` tool). Hence a *worker* settings file shipped by CrewRig and a documented launch recipe. How Orca launches a worker (flags, env, settings) is outside CrewRig and is the open question of this ADR.
- **Risk.** A coordinator that spawns workers with `Workflow` or publishes with `Artifact` needs a second profile that keeps them. The deny list is a denylist of tools CrewRig does not use, so a new harness tool defaults to *present*; the check in follow-up F7 catches growth.
- **Scope.** Committable as a file; applying it is user-only (launcher).

### O3. `paths:` frontmatter on rule files

- **Mechanism.** A rule file with `paths:` loads only when Claude reads a matching file.
- **Saving.** A 24.7 KB rule that never matches costs nothing: 67,994 → 58,901 (**−9.1k**, P7, project scope). User scope (`~/.claude/rules/`, where CrewRig deploys `60-tools.md`) is **not verified**: a probe would have needed to edit `~/.claude/`.
- **Cost.** The rules that cost most (`60-tools.md`, `AGENTS.md`) apply to every session regardless of the file touched, so no honest `paths:` glob exists for them. `AGENTS.md` is a memory file, not a rule file, and takes no `paths:`. Realistic use: split its path-bound sections (spec-PR workflow under `specs/**`, CLI matrix under `docs/cli-matrix*` and `scripts/**`, version bump under `artifacts/**`) into `.claude/rules/` files. *Estimated* −2k to −3k, unmeasured, with the risk that a rule loads after the edit it should have guided.
- **Effect per CLI.** Copilot has `applyTo`, Gemini and Antigravity no equivalent found (see *CLI parity*): the split would be Claude-heavy.

### O4. Slim `artifacts/core/rules/60-tools.md`

`60-tools.md` is 24,686 B (9.0k tokens; about 2.74 B per token). Two sub-options:

- **O4a. Move the behavioural sections to the system-context store** (the deferral of spec 0270 delta-01 requirement 2a): *Memory Architecture* (1,406 B), *Sequential Thinking* (1,669 B) and *Memory Activation Summary* (364 B); *Obsidian* is already a 316 B stub. Total 3,439 B, *estimated* **−1.25k** tokens, in every session on every CLI. Not probed: the effect is deterministic in bytes.
- **O4b. Split by audience, not by topic.** The MemPalace protocol (9,309 B), *Memory Architecture*, *Sequential Thinking*, *Obsidian* and the activation summary (about 13.1 KB, *estimated* **−4.8k**) concern the orchestrator; a worker skips the sweep and writes no handoff drawer. Ship them as `60-memory.md`, kept for orchestrators and excluded from the worker profile by O2's `claudeMdExcludes`. Forge access, user-gate, friction reporting, recap and idiomatic French stay in `60-tools.md`.
- **Cost.** The risk spec 0270 named is real: an agent may not follow a rule it reads on demand, or may not have it. O4b removes the rule only from sessions whose protocol says they do not run it, which is a safer cut than O4a's on-demand store. Either way it needs the measurement below before it merges.
- **How the behavioural effect is measured.** A paired A/B on a fixed set of 8 scenarios (orchestrator resume with an open `[TASK:ongoing]` drawer, worker brief with no sweep, handoff write at session end, Pre-Edit Guard on `main`, Obsidian write request, a long reasoning task, a friction event, a PR-merge request). Each scenario runs 5 times per arm (current rules; slimmed rules) under the same model. Pass criteria, scored from transcripts by a deterministic checker: the orchestrator arm still performs the five-step sweep and the checkpoint write, 100% of runs; no worker run writes a handoff drawer; the Obsidian write is refused without consent; guard violations and friction-tag omissions do not exceed the control arm; the long reasoning task still produces the same plan structure; the PR-merge request is still refused without explicit user permission; and the friction event is still tagged. A regression in any criterion blocks the merge. The first-call token delta is recorded with the same runs. The checker and scenarios belong to follow-up F3.
- **Scope.** Committable.

### O5. Skill and agent listings, MCP and plugin allowlist

| Lever | Setting | Result | Committable? |
|---|---|---|---|
| Hide non-CrewRig user and web skills | `skillOverrides: {<name>: "off"}` | listing 33.4k → 23.5k characters with W3 (P5), about −2.5k | user skills user-only; project web skills committable in a worker file |
| Hide claude.ai-synced skills | `syncClaudeAiSkills: false` | worked from `--settings` (P5); the docs say only `settings.local.json` is honoured, so a committed value may be ignored | user-only |
| Hide web/SEO agents | `permissions.deny: ["Agent(<name>)"]` | agent listing 19.8k → 9.2k characters with W3 (P5), about −3.3k | worker file |
| Move web/SEO agents and web skills out of the project tree | the 11 web/SEO agents of `artifacts/core/agents/` and `astro`, `copywriting`, `frontend`, `web-tester` change from `core` to `library` tier | *estimated* −3.4k main, −1.1k subagent | committable, but a distribution change (ADR-0022): adopters lose them from the project tree |
| Skill descriptions budget | `skillListingBudgetFraction: 0.002` | listing 33.4k → 11.6k characters, **names only** (P6); the value that keeps descriptions is not probed | user-only |
| Plugins | `enabledPlugins: {<plugin>: false}` | **inconclusive**: P5 still listed the `no-panic-content` skills because the same plugin is also installed at project scope on this machine | user-only (plugin names are user-specific) |
| Bundled skills | `disableBundledSkills` | see W5 | worker file |
| MCP and connectors | `--strict-mcp-config` plus a minimal `--mcp-config`; `disableClaudeAiConnectors` (not probed) | deferred tool names 15k → 0.7k characters, instructions gone (P6) | launcher flag, user-only |

CrewRig commits a **worker settings file** and a **doc** naming what an adopter must set locally (plugin names, synced skills, connectors, MCP servers). It does not commit plugin names.

## Path to the targets

| Target | Combination | Measured or estimated | Verdict |
|---|---|---|---|
| Worker ≤ 40,000 | O2 with the adopter-local W3 and W4 parts applied (user skills, plugins, synced skills, connectors, MCP set) | **36,260** (P9, measured on this user home) | reached, margin 3.7k |
| | O2 as CrewRig can commit it: W1 + W2 + W5 + project-level W3 + a minimal strict-MCP recipe, no user-specific names | about 38k (*estimated*: 73.0k − 16.1k − 5.8k − 3.5k − 3.4k − 6.1k; not probed, the probe budget was spent) | reached on paper, margin about 2k |
| | W1 + W2 + W5 only (no listing or MCP work) | about 47.7k (*estimated*) | **misses**: the committed generic profile must include the project W3 and the MCP recipe, not only the three tool and rule levers |
| | plus O4b | about 31.5k (*estimated*) | headroom for the orchestrator profile |
| Subagent ≤ 30,000, inside a worker with the O2 settings | O1 + O2 | **15,281** (P9, measured, with the six-rule body) | reached |
| | O2 alone, memory kept | 32,314 (P9, measured) | misses by 2.3k: O1 is required |
| Subagent ≤ 30,000, in a vanilla session (owner or coordinator without O2) | O1 + a `tools` allowlist that includes `Skill` | **16,769** (P10, measured) | reached, but needs a contract change (below) |
| | O1 alone | 36,499 (P10) | misses by 6.5k |

No target is out of reach, so none is revised. Three reservations:

- **P9's 5,753 is not a usable subagent.** An allowlist without `Skill` removes the skill listing and the `Skill` tool: the agents tell the model to "load the developer skill", so the allowlist must include `Skill` (P10: 16,769).
- **The vanilla-session subagent path changes a contract.** CrewRig emits `tools` only for agents whose classes exclude `execute` and `edit`, because an allowlist withholds `Skill`, MCP tools and `SendMessage` (cli-matrix row 4c, spec 0291 R17). Reaching 30k outside a worker session needs `skill` and `message` classes in the `metadata.tools` vocabulary, a spec delta.
- **Single runs, one model, one machine.** Re-running the baseline gave 73,071, 73,022 and 73,078, so run-to-run noise on the fixed context is below 100 tokens; the deltas above are structural, not statistical. They hold for this user home (skills, agents, MCP set) and will differ for an adopter, which is why W3 and W4 are launcher-side.

## Decision

Adopt, in this order, as follow-up issues (*Follow-up work*):

1. **A CrewRig worker settings profile for Claude Code (O2: W1, W2, W3, W5 and a strict MCP flag set), shipped as a committed file with a documented launch recipe.** The measured 36.8k worker saving (P9) includes adopter-local parts (user skills, plugins, synced skills, connectors) that CrewRig cannot commit; the committed generic profile is *estimated* at about 38k and must be re-measured by F1 before the target is claimed. The −27.0k subagent saving (P9) depends on the same profile. It touches no file a user owns. Applying it is the launcher's job; the open question is how Orca passes it.
2. **`omitClaudeMd: true` on every CrewRig agent, with the six-rule conventions block inlined at build time into each body from one source file, `artifacts/core/fragments/subagent-conventions.md` (O1).** It carries the subagent from 32.3k to 15.3k inside a worker and removes the dependency on `AGENTS.md` for subagents, matching Gemini's behaviour.
3. **Split `60-tools.md` by audience (O4b), after the paired measurement of O4.** Worker about 31.5k afterwards. O4a alone (−1.25k) is not worth a spec.

Not adopted now: O3 beyond a documentation note (no honest glob for the heavy rules, user scope unverified), `skillListingBudgetFraction` (names-only degrades skill routing), the tier move of the web agents (an owner call on distribution, listed as F5), and a `tools` allowlist for editing agents (F4, gated on a spec delta).

## Consequences

- Positive: both targets are met on measured numbers on this user home, and the committed generic profile is estimated to meet the worker target with about 2k of margin (F1 re-measures it); the fixed context of a worker falls from 73k to about 36k, and a subagent from 59k to about 15k, per API call.
- Positive: the profile is a file plus a recipe, reversible by not passing the flag.
- Negative: two profiles to maintain (worker, coordinator/owner), and the conventions block, which exists once in source and is duplicated only in generated output; drift is prevented by the build, which is the only writer, and by a check that every emitted body carries the current block.
- Negative: a subagent no longer inherits `AGENTS.md`; a rule outside the six is invisible to it.
- Negative: the 3.7k margin on the worker target is thin if the harness grows its tool definitions; F7 tracks it.
- Neutral: the owner's interactive sessions are unchanged.

## CLI parity

Per `docs/cli-matrix-maintenance.md`, a missing mechanism is recorded as a gap only with concrete evidence; "not found" below is evidence-of-search, not a confirmed gap. Evidence for Gemini CLI and Antigravity CLI is weaker than for Claude Code and Copilot CLI and is marked.

| Option | Claude Code 2.1.323 | Copilot CLI 1.0.109 | Gemini CLI 0.28.2 | Antigravity CLI (`agy` 1.5.5) |
|---|---|---|---|---|
| Baseline | 73,071 / 59,366 | **49.0k** (`↑ 49.0k`, C1) | **not verified**: probe refused, `IneligibleTierError` ("migrate to the Antigravity suite") | **not verified**: `agy -p` demands an interactive Google login |
| O1 subagent memory off | `omitClaudeMd` verified (P1 via `--agents`, P11 as file frontmatter) | no per-agent switch in `copilot --help` or `copilot help config`; `--agent developer` ran at 38.8k against 49.0k (C5), cause not isolated; whether `task` subagents inherit instructions not probed | already off: `buildSystemPrompt` in `agents/local-executor.js` appends only the agent prompt and the directory context (source reading, not a run) | **not verified**; no per-agent frontmatter surface (cli-matrix row 33) |
| O2 worker profile | `--settings` + `claudeMdExcludes` verified (P2, P9) | `--no-custom-instructions` is all-or-nothing: 49.0k → 22.6k (C2), AGENTS.md included; no per-file exclusion found; `COPILOT_HOME` override documented, not probed | rules enrolled per file in `context.fileName` (row 7b); `GEMINI_CLI_SYSTEM_SETTINGS_PATH` read in `settings.js` (source); **not probed** | one concatenated `~/.gemini/config/AGENTS.md` (row 7b): a worker file would be a second build output; `agy --settings` exists in `--help`; **not verified** |
| O3 `paths:` | verified at project scope (P7); user scope **not verified** | `applyTo` frontmatter documented for `*.instructions.md`; **not probed** | no equivalent found in `settings.js`; **not probed** | **not verified** |
| O4 slim 60-tools | source-file change, applies to all four through the same build (`60_TOOLS.md`, `60-tools.instructions.md`, `~/.gemini/config/AGENTS.md`) | same | same | same |
| O5 listings, MCP | settings keys and `--strict-mcp-config` verified (P3 to P6) | `--disable-builtin-mcps --dynamic-retrieval skills=off` 49.0k → 48.1k (C3); `--excluded-tools`, `--disable-mcp-server`, `subagents.disabledSubagents` exist; all instructions off plus those flags 21.3k (C4) | `--allowed-mcp-server-names`, `-e <extensions>` in `--help`; **not probed** | `agy mcp`, `agy plugin disable`; **not verified** |

The asymmetry this ADR creates is deliberate and bounded: O2 is a Claude Code launcher feature, and Copilot's equivalent is all-or-nothing, so a Copilot worker can only choose between the full rules and none. F8 records the parity probes and the matrix rows.

## Alternatives rejected

- **Exclude the personal rules in the project's `.claude/settings.json`.** Measured effect is the same as W2, but it also strips the SOUL and the level profile from the owner's interactive sessions in the repository, and a project file would have to name files in each user's home. A worker file passed with `--settings` can name them (W2 does), because it belongs to the launcher, which knows the home it runs in.
- **`CLAUDE_CODE_DISABLE_CLAUDE_MDS` for subagents.** Documented, not probed here: it drops `AGENTS.md` for the whole session, so the worker loses the rules O1 deliberately keeps.
- **Cut `AGENTS.md` in place.** Saves up to 6.9k but the orchestrator reads it for the lifecycle; the size is a symptom of one file serving three audiences, which O1 and O4b address by audience instead.
- **`skillListingBudgetFraction` as the listing fix.** The only value probed (0.002) removes every description, so skills stop self-selecting. The listing is cut by hiding unrelated skills instead.
- **Agents read the shared file at run time (a one-line pointer in each body).** The block is about 300 tokens, while a run-time `Read` costs one extra tool round trip that re-reads the subagent's whole context (about 15k tokens), so the pointer is more expensive than the text it avoids. A "read X first" instruction is also followed less reliably than inline text, and the Pre-Edit Guard must hold before the first edit. The mixed variant (critical rules inline, the rest read on demand) is rejected for the same two reasons at a smaller scale: the on-demand part still pays the round trip and may be skipped.
- **Keep the harness tools and raise the target.** Rejected: 16.1k of the 73k is three tool definitions no CrewRig worker calls.

## Follow-up work

Each item is one issue. "Spec" follows ADR-0024: yes when the change alters a deployed surface or a shared contract.

| # | Title | Tier | Spec |
|---|---|---|---|
| F1 | ⚡️ Ship a Claude Code worker settings profile and launch recipe (O2) | small | yes (new deployed surface, cli-matrix row) |
| F2 | ⚡️ Emit `omitClaudeMd` and inline the single-source conventions block (`artifacts/core/fragments/subagent-conventions.md`) from the agent build, with a check that every emitted agent body carries the current block byte for byte, and the `docs/layers.md` and core-paths entries for the new zone (O1) | standard | yes (frontmatter and emitter format) |
| F3 | ⚡️ Split `60-tools.md` by audience, with the paired behavioural measurement (O4b, amends 0270 delta-01 2a) | standard | yes |
| F4 | ⚡️ Add `skill` and `message` tool classes so editing agents can take an allowlist (amends 0291 R17) | small | yes (delta) |
| F5 | 📝 Decide: move the web/SEO agents and four web skills to the `library` tier | small | no (owner decision, then F-issue) |
| F6 | 📝 Document the MCP, plugin and claude.ai-connector allowlist for CrewRig workspaces | trivial | no |
| F7 | ⚡️ Add a fixed-context probe task (method of the appendix) and a regression threshold | small | no (tooling) |
| F8 | 🧪 Probe Copilot (`task` subagents, `applyTo`, `COPILOT_HOME`), Gemini and Antigravity once authenticated; update the matrix rows | small | no |

## Appendix: probes

All Claude Code probes: `claude -p "<prompt>" --model claude-sonnet-5-5 --output-format json --allowedTools Agent` from the CrewRig worktree, unless a scratch directory is named. Prompt for subagent probes: *"Call the Agent tool once with subagent_type developer and the prompt 'Reply with the single word OK'. Then answer DONE."* Settings were passed with `--settings` and agents with `--agents`; no file under `~/.claude/`, `~/.gemini/`, `~/.copilot/` or the repository's `.claude/` was edited. First-call input tokens (input + cache read + cache creation) read from `~/.claude/projects/<project>/<session>.jsonl` and `<session>/subagents/*.jsonl`.

| Probe | Variation | Worker | Subagent(s) | Cost (USD) |
|---|---|---|---|---|
| P1 | no settings; `--agents` adds `probe-dev` (`omitClaudeMd: true`, body of one line) | 73,022 | `developer` 59,276; `probe-dev` **36,108** | 0.41 |
| P2 | `claudeMdExcludes` for `00-soul`, `10-level`, `30-profile`, `50-team`, `40-expertise` | **67,222** | `developer` 53,533 | 0.27 |
| P3 | `disableBundledSkills`, `syncClaudeAiSkills: false`, 13 user skills `off` | 75,118 | `developer` 55,160 | 0.34 |
| P4 | `permissions.deny: [Artifact, Workflow, ScheduleWakeup]` | **56,965** | `developer` 47,143 | 0.32 |
| P5 | `syncClaudeAiSkills: false`, `enabledPlugins` off, 19 skills `off`, 16 `Agent(...)` denies | **66,240** | `developer` 56,203 | 0.21 |
| P6 | `skillListingBudgetFraction: 0.002`, `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` | **59,951** | `developer` 48,600 | 0.07 |
| P7 | scratch project outside the repository, `.claude/rules/tools.md` = copy of `60-tools.md` | 67,994 | none | 0.17 |
| P8 | same, with `paths: ["nothing-matches-this/**"]` frontmatter | **58,901** | none | 0.14 |
| P9 | combined: P2 + P4 + P5 + `disableBundledSkills` + strict MCP; agents `probe-dev` (`omitClaudeMd`, six-rule body) and `probe-dev2` (same + `tools` without `Skill`) | **36,260** | `developer` 32,314; `probe-dev` **15,281**; `probe-dev2` 5,753 (no `Skill`, unusable) | 0.23 |
| P10 | no settings; agents `probe-dev` and `probe-dev3` (`omitClaudeMd`, six-rule body, `tools` incl. `Skill`) | 73,078 | `probe-dev` 36,499; `probe-dev3` **16,769** | 0.30 |
| P11 | scratch project outside the repository (no project `AGENTS.md`), two file agents `fm-keep` and `fm-omit` in `.claude/agents/`, identical six-rule bodies and `tools` incl. `Skill`; only `fm-omit` has `omitClaudeMd: true`; no settings | 59,064 | `fm-keep` 30,396; `fm-omit` **14,479** | 0.26 |

Total: 11 Claude Code runs, **2.72 USD**; the 11th was approved by the coordinator after the first ten exhausted the budget.

Structural observations from the transcripts (attachment and request-shape sizes, deterministic):

- Skill listing 33,384 characters (baseline), 19,921 (P3), 23,495 (P5), 11,616 (P6, names only).
- Agent listing 19,878 characters (baseline), 9,183 (P5).
- Deferred tool names 14,962 characters (baseline), 715 (P6); MCP instructions 5,311, none in P6.
- Tool definitions, main session: 15 tools, 69,336 characters (baseline) against 12 tools, 21,654 (P4). In P3 the `Workflow` definition grew from 5,520 to 22,939 characters.

Other CLIs (no Claude Code budget used):

| Run | Command | Result |
|---|---|---|
| C1 | `copilot -p "Reply with the single word OK." --allow-all-tools` | `↑ 49.0k` |
| C2 | C1 + `--no-custom-instructions` | `↑ 22.6k` |
| C3 | C1 + `--disable-builtin-mcps --dynamic-retrieval skills=off` | `↑ 48.1k` (7.9k cached) |
| C4 | C2 + C3 flags + `--excluded-tools web_fetch` | `↑ 21.3k` |
| C5 | C1 + `--agent developer` | `↑ 38.8k` |
| G1 | `gemini -p "Reply with the single word OK." -o json` | no run: `IneligibleTierError`, account migrated to Antigravity |
| A1 | `agy -p "Reply with the single word OK." --output-format json` | no run: asks for an interactive Google login |

Unverified Claude Code claims, none relied on: `CLAUDE_CODE_DISABLE_CLAUDE_MDS`, `disableClaudeAiConnectors`, `paths:` at user scope. `omitClaudeMd` as file frontmatter is verified (P11); F2 still carries a test that the built `.claude/agents/` output keeps the key.
