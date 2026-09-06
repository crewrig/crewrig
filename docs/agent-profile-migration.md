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

## The 23-row translation table

<!-- crewrig-table: agent-profile-baseline -->

| Source | Tier before | Rung after | Claude Code | Gemini CLI | GitHub Copilot CLI | Antigravity CLI |
|---|---|---|---|---|---|---|
| `accessibility-auditor` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-low` |
| `accessibility-tester` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-low` |
| `architect` | `opus` | `xhigh` | prose, `opus` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-low` |
| `astro-developer` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-low` |
| `ci-configurator` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-low` |
| `ci-debugger` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-low` |
| `ci-parity` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-low` |
| `copywriter` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-low` |
| `designer` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-low` |
| `developer` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-low` |
| `doc-writer` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-low` |
| `frontend-developer` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-low` |
| `pr-logbook` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-low` |
| `pr-reviewer` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-low` |
| `regression-sentinel` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-low` |
| `scenario-author` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-low` |
| `security` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-low` |
| `seo-specialist` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-low` |
| `spec-author` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-low` |
| `tester` | `sonnet` | `high` | prose, `sonnet` | `model: gemini-3.1-pro-preview` | unchanged | prose, `gemini-3.1-pro-low` |
| `visual-regression-tester` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-low` |
| `web-conformity-checker` | `haiku` | `medium` | prose, `haiku` | `model: gemini-3.5-flash` | unchanged | prose, `gemini-3.8-flash-low` |
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
| 2 | Mapping-file worked examples in documentation | `docs/model-mapping-format.md:309,344,378,398` (`:344` is `Haiku`, capitalized) and `docs/org-model-mapping-override.md:57,59,64,73,83,86` |
| 3 | E2E LLM-judge backend model ids (versioned API ids, not agent tiers) | `docs/adr/0004-e2e-assertion-libs.md:230`, `docs/adr/0008-judge-oauth-auth-mode.md:130`, `tests/e2e/defaults.toml:119`, `tests/e2e/local.toml.example:57`, `tests/e2e/lib/llm_judge.sh:18,103,119,120`, `tests/e2e/lib/README.md:77` |
| 4 | The deliberately model-bearing Copilot-routing probe fixture | `tests/e2e/scenarios/05-copilot-model-routing/agent-model-bearing.md.tmpl:4`, with `…/run.sh:21,360` and `tests/e2e/lib/probe_spawn_markers.sh:95` |
| 5 | The Claude GitHub Action's own `model:` input | `.github/workflows/claude.yml:27` |
| 6 | Test suites and fixtures | `scripts/tests/test-model-resolution.sh` (37, including the one this change set's own refreshed `C2(b)` literal adds — see the note below), `test-check-model-mappings.sh` (21), `test-e2e-*.sh` (**7** — `test-e2e-probes.sh` 4, `test-e2e-llm-judge-lib.sh` 2, `test-e2e-judge-config.sh` 1), `fixtures/probe-a-transcripts/model-bearing.stdout` (3), `test-setup-antigravity-transcript.sh` (2), `test-check-agent-profiles.sh` (1), `test-check-component-metadata-keys.sh` (4, new — the mutation fixtures exercising the legacy-key rejection this change set adds) |
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
  Claude alias.
- **This change set's own new and edited test files add further,
  deliberate alias mentions**, in the same spirit as class 6 above: the
  refreshed `C2(b)` literal of `test-model-resolution.sh` now pins
  `architect`'s compiled description verbatim, which itself contains
  `opus`; the new `test-check-component-metadata-keys.sh` declares
  `metadata.claude.model: sonnet` in four fixtures to exercise the legacy-key
  rejection. The migration test suite this change set also adds
  (`scripts/tests/test-agent-profile-migration.sh`) asserts the compiled
  guidance prose of real migrated sources and will add further such
  mentions for the same reason. None of these is a document presenting an
  alias as the way to choose a model — every one is a test asserting what
  the build does, which is exactly class 6's existing category.

Two statements in `docs/cli-matrix.md` are falsified by this change set and
corrected in the same diff as this document: row 33's "nothing in the
repository reads it yet" (requirement 27, part one — false since spec
0198 merged), and the `[GAP]` note asserting that `build-components.sh`
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

Measured on the migrated tree with all four targets built:

| Invocation | Lines | Shapes |
|---|---|---|
| `bash scripts/build-components.sh --target all` | **44** | 22 `model-note … claude guard-withheld …` (one per migrated agent, requirement 21) + 22 `model-drop … copilot metadata.model.intelligence <rung> unsupported-on-cli` (one per migrated agent, requirement 21). Nothing else |
| `bash scripts/build-components.sh --target all --check` | **132** | the same 44, plus **88** `model-note <name> <target> no-mapping …` — 22 per target across all four targets |

**Mechanism.** `--check` ends by running a second build under a fresh
`mktemp -d` root (`scripts/tests/test-assembly-verification.sh`) that
holds no `model-mappings/`, so the resolution finds no mapping in force
and emits a `no-mapping` note per profiled agent per target. This is a
property of `--check`'s own second, synthetic build — not of "the
migrated tree" requirement 21 binds — so requirement 21 is satisfied
exactly by the 44-line stream a plain build emits, and the 88 additional
lines are a real, new-since-this-change-set observable on every CI run of
the `component-drift` capability (which invokes `--check`): exit status
stays 0, and `test-assembly-verification.sh` still passes, since it
verifies assembly structure rather than model emissions. No requirement
of spec 0200 binds that suite's synthetic root, and giving it one would
change a check that verifies assembly for every tier and every component
— a blast radius wider than this change set, left to a follow-up ticket
if a reviewer wants it closed.

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
