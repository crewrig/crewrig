# Agent capability-profile migration

<!-- crewrig-doc: section=reference nav_order=110 published=true title="Agent capability-profile migration" -->

The core agent sources declare CLI-agnostic capability profiles
(`metadata.model:`) instead of a Claude Code model alias
(`metadata.claude.model`), per [spec 0200](../specs/0200-core-agent-profile-migration.md)
and [its delta-01](../specs/0200-core-agent-profile-migration.delta-01.md).
This is the HOW record of that change: the per-source translation table,
the adopter-facing migration note, the corrected tiering audit, the
narrowing this change set's own requirement 22 forces on two of the
parent spec's requirements, and the observable diagnostic-stream change.
The authoring-facing account of what a capability profile is and how a
source declares one lives in [`docs/authoring.md`](authoring.md).

## The 23-row translation table

<!-- crewrig-table: agent-profile-baseline -->

| Source | Tier before | Rung after | Claude Code | Gemini CLI | GitHub Copilot CLI | Antigravity CLI |
|---|---|---|---|---|---|---|
| `accessibility-auditor` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-medium` |
| `accessibility-tester` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-medium` |
| `architect` | `opus` | `xhigh` | prose, `opus` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-high` |
| `astro-developer` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-high` |
| `ci-configurator` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-high` |
| `ci-debugger` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-high` |
| `ci-parity` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-high` |
| `copywriter` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-medium` |
| `designer` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-high` |
| `developer` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-high` |
| `doc-writer` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-medium` |
| `frontend-developer` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-high` |
| `pr-logbook` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-medium` |
| `pr-reviewer` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-high` |
| `regression-sentinel` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-medium` |
| `scenario-author` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-medium` |
| `security` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-high` |
| `seo-specialist` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-medium` |
| `spec-author` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-high` |
| `tester` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-high` |
| `visual-regression-tester` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-medium` |
| `web-conformity-checker` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-medium` |
| `harness-curator` | *(none)* | *(none)* | unchanged | unchanged | unchanged | unchanged |

23 rows: 22 migrated sources plus `harness-curator`, the tree's one
profile-less agent source (requirement 5). "prose, `<alias-or-offering>`"
means the compiled `description` gains the sentence naming that alias or
offering, appended after a single space, with no new frontmatter key
(requirements 14 and 18). "unchanged" on GitHub Copilot CLI means the
compiled output is identical to its content at `723ad8f` except for the
`metadata.provenance.version` line every source's requirement 22 bump
reaches (requirement 17 as narrowed by delta-01). `harness-curator`'s four
"unchanged" cells mean byte-identical to `723ad8f` on every target
(requirement 20) — it declares no profile and keeps session-model
inheritance (spec 0195 requirement 3).

## Adopter migration note

An organization that has forked this framework and carries its own agent
sources under `artifacts/community/` or `artifacts/org/` migrates them off
a CLI-namespaced model declaration the same way this change set migrates
the 22 core sources: replace `metadata.claude.model: <alias>` with
`metadata.model.intelligence: <rung>`, using the anchor table of spec 0195
requirement 7 to pick the rung its existing alias corresponds to.

**What changes which model a declared rung resolves to is never an edit to
an agent source.** It is the organization-level override channel of
[spec 0199](../specs/0199-org-model-mapping-override.md) —
`model-mappings/<target>.org.yml`, documented at
[`docs/org-model-mapping-override.md`](org-model-mapping-override.md) —
merged into the mapping in force before a build resolves a source's
profile against it. A fork that wants `medium` to select a different
Claude Code offering than the core mapping's default changes
`model-mappings/claude.org.yml`, never `metadata.model.intelligence` on
any agent source.

**A fork that declares no profile on its own agent sources and populates
no override channel file needs to take no action.** Its own agent sources
keep exactly the behavior they have today — session-model inheritance —
and its own compiled outputs for those sources are unaffected by this
change set synchronizing from upstream. This is the same no-action
property `harness-curator` witnesses in the tree above.

## Corrected tiering audit (requirement 31)

The change set was audited, case-insensitively, for every document that
presents a Claude Code model alias (`haiku`, `sonnet`, `opus`) as the way
to choose an agent's model, over the whole tree (excluding `.git/` only),
`tests/e2e/` included. Seven classes of hit exist, and — the point of the
audit — **none of the seven presents an alias as the way to choose an
agent's model**, beyond the four surfaces requirements 25 through 28 of
spec 0200 already name and correct.

| # | Class | Hits |
|---|---|---|
| 1 | The 22 sources being migrated — the `metadata.claude.model` line this change set removes | `artifacts/core/agents/*/AGENT.md`, one each before the change. **After the change: 0** |
| 2 | Mapping-file worked examples in documentation | `docs/model-mapping-format.md:312,347,381,401` (`:347` is `Haiku`, capitalized) and `docs/org-model-mapping-override.md:57,59,64,73,83,86` |
| 3 | E2E LLM-judge backend model ids (versioned API ids, not agent tiers) | `docs/adr/0004-e2e-assertion-libs.md:230`, `docs/adr/0008-judge-oauth-auth-mode.md:130`, `tests/e2e/defaults.toml:119`, `tests/e2e/local.toml.example:57`, `tests/e2e/lib/llm_judge.ts`, `tests/e2e/lib/README.md:77` |
| 4 | The deliberately model-bearing Copilot-routing probe fixture | `tests/e2e/scenarios/05-copilot-model-routing/agent-model-bearing.md.tmpl:4`, with `…/run.ts` and `tests/e2e/lib/probe_spawn_markers.ts` |
| 5 | The Claude GitHub Action's own `model:` input | `.github/workflows/claude.yml:27` |
| 6 | Test suites and fixtures | `scripts/tests/test-model-resolution.sh` (retired in row I2 of spec 0215; it held 37, including the one this change set's own refreshed `C2(b)` literal adds — see the note below), `check-model-mappings-*.test.ts` (replaced `test-check-model-mappings.ts`, 21), `test-e2e-*.sh` (**7** — `test-e2e-probes.sh` 4, `test-e2e-llm-judge-lib.sh` 2, `test-e2e-judge-config.sh` 1), `fixtures/probe-a-transcripts/model-bearing.stdout` (3), `test-setup-antigravity-transcript.sh` (2), `check-agent-profiles-*.test.ts` (replaced `test-check-agent-profiles.ts`, 1), `test-check-component-metadata-keys.sh` (4, new — the mutation fixtures exercising the legacy-key rejection this change set adds) |
| 7 | Specs and mapping files declaring the anchor table or their own offerings | `specs/0200-core-agent-profile-migration.md` (20), `specs/0197-model-mapping.md` (18), `specs/0195-agent-capability-profile.md` (11), `specs/0199-org-model-mapping-override.md` (4), `specs/0198-build-mapping-resolution.md` (3), `specs/0127-copilot-subagent-model-guard.md` (1), `specs/0143-copilot-subagent-model-fallback.md` (1), `model-mappings/claude.yml` (18), `model-mappings/antigravity.yml` (2) — 78 hits across 9 files |

**Conclusion — unchanged from the audit's first pass, and now exhaustively
grounded.** Classes 2 and 6 are mapping and fixture material, class 3 is a
test harness's LLM backend, class 4 is a subject under test, class 5 is a
CI action input, and class 7 is the normative anchor table and the
mappings that declare their own offerings on it — a spec quoting the
anchor table and a mapping declaring its offerings are the two places an
alias legitimately belongs, and neither presents one as an authoring
choice.

**This change set's own footprint.** Two things a re-audit after this
merge will find that were not present before it, both by design, neither
contradicting the conclusion above:

- **`.claude/agents/` goes from 0 to 22 hits.** Every migrated agent's
  compiled Claude description now ends with `Run this agent on the
  <alias> model.` — the resolution's own emission under requirement 14,
  not an authoring instruction. The other three compiled agent trees stay
  at 0 hits: the Antigravity guidance prose names a Gemini offering, not a
  Claude alias. (Spec 0291 later moved that alias to a `model: <alias>`
  frontmatter key and removed the sentence from the Claude description;
  the 22 hits are then the `model:` lines, and the sentence returns under a
  `withheld` guard.)
- **This change set's own new and edited test files add further,
  deliberate alias mentions**, in the same spirit as class 6 above: the
  refreshed `C2(b)` literal of the since-retired `test-model-resolution.sh` now pins
  `architect`'s compiled description verbatim, which itself contains
  `opus`; the new `test-check-component-metadata-keys.ts` declares
  `metadata.claude.model: sonnet` in four fixtures to exercise the legacy-key
  rejection. The migration test suite this change set also adds
  (`scripts/tests/agent-profile-committed.test.ts`, `agent-profile-build.test.ts`) asserts the compiled
  guidance prose of real migrated sources and will add further such
  mentions for the same reason. None of these is a document presenting an
  alias as the way to choose a model — every one is a test asserting what
  the build does, which is exactly class 6's existing category.

Two statements in `docs/cli-matrix.md` are falsified by this change set and
corrected in the same diff as this document: row 33's "nothing in the
repository reads it yet" (requirement 27, part one — false since spec
0198 merged), and the `[GAP]` note asserting that `build-components.ts`
omits `model:` frontmatter from every compiled agent file (requirement
27, adjacent accuracy — narrowed to the two surfaces Copilot CLI actually
reads, `.claude/agents/` and `.github/agents/`, where it stays true).
Neither presents an alias as an authoring choice, so neither is a
requirement-31 hit; both are named here so the audit is not read as having
missed them.

## The narrowing of requirements 17 and 19

[Spec 0200 delta-01](../specs/0200-core-agent-profile-migration.delta-01.md)
is the **normative** source for this narrowing — not a plan reading.
Requirement 22 obliges every source this change set modifies to bump its
`metadata.provenance.version` by a MINOR increment, and that bump reaches
all four of a migrated source's compiled outputs through
`inject_provenance` (three targets) and `gemini_provenance_comment` (the
fourth), which made the parent spec's original requirements 17 and 19
unsatisfiable in conjunction with requirement 22. Delta-01 replaces both:

- **Requirement 17, replaced.** Each migrated source's compiled GitHub
  Copilot CLI output SHALL be identical to its content at `723ad8f` except
  for the `metadata.provenance.version` line requirement 22 obliges, and
  SHALL differ in no other byte. Measured on this change set: **22/22**
  `.github/agents/*.md` outputs differ from `723ad8f` by exactly that
  line; **0/22** carry any other changed line.
- **Requirement 19, replaced.** The compiled body of every agent output on
  every target SHALL be byte-identical to its content at `723ad8f`, the
  **provenance carrier** excluded from the body for this purpose — the
  `metadata.provenance` block on Claude Code, GitHub Copilot CLI and
  Antigravity CLI, and the `<!-- crewrig-provenance: … -->` line on Gemini
  CLI. Measured: **0/22** compiled agent bodies differ on each of the four
  trees once the carrier is excluded; without the exclusion, **22/22**
  differ on `.gemini/agents/` (the carrier there sits between the closing
  frontmatter fence and the body) and 0/22 on the other three (the carrier
  there sits inside the frontmatter, outside "body" under any reading).

**Decision 6's third clause is corrected.** The parent spec's rationale
originally read "the four GitHub Copilot CLI agent outputs stay
byte-identical to `723ad8f`" — the migration covers 22 sources, each
producing one compiled GitHub Copilot CLI output, so the correct count is
22, not four (four is correct for `harness-curator`'s per-target output
count, one per target across four targets, which is a different
quantity the original clause's `four` appears to have been carried over
from). The corrected clause: the 22 GitHub Copilot CLI agent outputs stay
identical to `723ad8f` except for the `metadata.provenance.version` line
requirement 22 obliges, and differ in no other byte.

## The diagnostic stream

Re-measured at spec 0291 (the guard lift and `metadata.tools`) with all four targets built (run `node scripts/lib/node-floor-guard.js` first, as a separate step; the build needs Node.js 24 or newer, and `js-yaml` comes from the setup dependency step):

| Invocation | Lines | Shapes |
|---|---|---|
| `node scripts/build-components.ts --target all` | **23** | 22 `model-drop … copilot metadata.model.intelligence <rung> unsupported-on-cli` (one per migrated agent, requirement 21) + 1 `tools-drop … antigravity metadata.tools <classes> unsupported-on-cli` (one per agent that declares `metadata.tools`: `seo-specialist`, spec 0291 R14). No `guard-withheld` line: the guard is `directed` (spec 0291 R1, R5). The plain run builds the library tier as well; `harness-curator` declares no rung and adds none |
| `node scripts/build-components.ts --target all --check` | **23** | the same stream: `--check` does not run the assembly suite (spec 0250 R33, (c)) |
| the 22-core-source root of `agent-profile-build.test.ts` | **23** | the same 22 + 1, counted from the sources (22 `model-drop`, plus one `tools-drop` per declaring source, plus 22 `guard-withheld` only while the committed guard is `withheld`) |
| the assembly suite's synthetic root, added | **+4** | `model-note developer <target> no-mapping …` — one per target, for the single agent of `scripts/tests/build-assembly-routing.test.ts`'s root, which holds no `model-mappings/`: **27** lines when counted together with the stream above (spec 0291 R7) |

Before spec 0291 the first two rows read **44** and **48**: 22 `model-note … claude guard-withheld …` lines were part of the stream, because the guard was `withheld` and every Claude Code agent kept the sentence in its description. An organization that re-withholds the guard (`docs/org-model-mapping-override.md`) gets those 22 `guard-withheld` notes back, one per Claude Code agent (spec 0197 R32).

**Mechanism.** The 4 `no-mapping` notes belong to the assembly suite
(`scripts/tests/build-assembly-routing.test.ts`), which builds a second,
smaller root under a fresh `mktemp -d`: it holds no `model-mappings/` and
only the `developer` skill and agent of `core` plus the fixture overlay, so
the resolution finds no mapping in force and emits a `no-mapping` note for
that one profiled agent on each of the four targets. Until issue #1432 that
root held the whole `core` and `library` trees, which made the figure 88.
This is a property of that suite's own synthetic build, not of "the migrated
tree" requirement 21 binds, and no requirement of spec 0200 binds that
root: giving it one would change the root every assembly assertion runs
against, a blast radius wider than this change set.

## Decoupling record (requirements 32-34)

No requirement of spec 0200 is conditioned on the outcome of probe C of
issue #1113, and no source this change set declares carries a `reasoning`
axis, so every verdict of that probe is absorbable by a change to a
mapping file alone (requirement 32). Retiring a target's guidance surface
in the future requires no change to any migrated source either: the
sources declare needs, and the mapping in force decides the surface a
need is stated on (requirement 33).

This change set lands in the **nested** `.claude/agents/<name>/AGENT.md`
compiled layout. Seam (g) of epic #1100 — the flat `.claude/agents/<name>.md`
layout — is a later, separate ticket; when it lands, it moves the files
this change set regenerates to a new path and regenerates the same
content there. It re-decides no profile this change set declares
(requirement 34).

**Follow-up (spec 0201, issue #1127).** The move requirement 34 anticipated
has happened: seam (g) landed the flat `.claude/agents/<name>.md` compiled
layout, regenerating the same 22 sources' content at the new path rather
than re-deciding any profile. An adopter who deployed the retired nested
layout into `~/.claude/agents/<name>/` before this move has the stale
directory removed automatically, with no manual action, at their next
assisted Claude Code setup — the setup's `install_tier_to_home` now installs
each agent as a flat `<name>.md` file and removes any same-name directory
already present. A synchronizing fork lands on the new layout without
acting either: the compiled agent trees carry the `regenerable` policy
(`.crewrig/core-paths.txt`), so the next `scripts/sync-from-upstream.ts` run
restores the new flat files, removes the retired nested ones as orphans, and
reports rather than aborts on any member a fork had locally diverged.

**Follow-up (spec 0053 delta-01, issue #1847).** The compiled Antigravity
agent is now the flat `.agents/agents/<name>.md`, like the other three CLIs,
carrying only `name`, `description` and the `metadata` provenance block
(the `enable_*`, `license` and `compatibility` keys are no longer emitted).
An adopter who installed the retired `~/.gemini/config/agents/<name>/AGENT.md`
has that directory removed at their next Antigravity setup (`Migrated away:
<path>`), but only when it holds nothing except a provenance-carrying
`AGENT.md`; a directory with any other content is left in place with a
warning. A synchronizing fork lands on the new layout without acting: the
`.agents/agents` tree carries the `regenerable` policy, so the next
`scripts/sync-from-upstream.ts` run restores the flat files and removes the
retired nested ones as orphans.
