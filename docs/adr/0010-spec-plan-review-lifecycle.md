# ADR 0010 — SPECS → PLAN → DEV → REVIEW lifecycle

**Status:** Accepted (issue #166, parent EPIC #165)

## Context

Today, every ticket on CrewRig follows a single contract: the
orchestrator reads the issue, spawns one of the three team templates
defined in `AGENTS.md` → *Agent Team Protocol*, and lets the team drive
straight to a PR. The contract has no explicit *qualification* phase
(what does the user actually want?) and no explicit *planning* phase
(how do we intend to get there?). Both happen implicitly, in the
orchestrator's head, between reading the issue and issuing the first
`TaskCreate`.

Two failure modes recur with enough regularity to be considered
structural rather than incidental:

1. **User drift.** The user's evoked intent and the team's first
   implementation diverge, often subtly. Drift is caught — when caught
   at all — at PR review, by which point the artefacts (branch,
   commits, tests, logbook entries) are sunk cost. The corrective loop
   is expensive: rewind to design, re-spawn the team, re-open the PR
   or close-and-reopen, and reconcile the logbook.
2. **Tech-finding-was-actually-spec-gap.** A reviewer surfaces a
   "technical" finding (`pr-reviewer` flags a behaviour, a missing
   guard, an inconsistent error path). The team fixes it locally; one
   or two iterations later the same finding resurfaces in a different
   shape. Root cause: the underlying specification never decided the
   point, so every fix is locally correct but globally arbitrary, and
   reviewers keep snagging on the absence of a normative answer.

Both modes share a structural cause: there is no place in the current
contract where the *what* (specification) and the *how* (plan) are
written down, reviewed, and merged independently of the code that
realises them. Adding those two artefacts — and a routing rule that
sends review findings back to the correct layer — is what this ADR
defines.

Inspiration: [GitHub spec-kit][spec-kit] (Specify → Plan → Tasks →
Implement) and [OpenSpec][openspec] (Markdown specs with delta-style
proposals). Neither is adopted wholesale; both are referenced as prior
art for the staging discipline and the filesystem-first artefact model.

[spec-kit]: https://github.com/github/spec-kit
[openspec]: https://github.com/Fission-AI/OpenSpec

## Decision

CrewRig adopts a **four-stage lifecycle** for every non-trivial
ticket:

```text
SPECS  ──▶  PLAN  ──▶  DEV  ──▶  REVIEW ──▶  MERGE
                                    │
                                    └── loops back on findings
```

- **SPECS**, **PLAN**, and **DEV** are *linear* stages: each runs
  once per iteration of the lifecycle, in order.
- **REVIEW** is a *looping* stage. Findings produced by REVIEW are
  classified (`tech` / `arch` / `spec`) and routed back to the
  corresponding upstream stage. The lifecycle terminates only when a
  full REVIEW pass produces zero findings across all three classes.

The contract is mode-driven (FULL / INTERMEDIATE / MINIMAL / AUTO,
see *Interaction modes* below): the same four stages run for every
mode, but the user-gating between stages differs.

This ADR defines the **contract**. The artefact formats, the skills,
and the routing engine land in dedicated tickets:

| Concern | Ticket |
|---|---|
| Spec file format and `/specs/` layout | #167 |
| `spec-author` skill + agent | #168 |
| Plan format and plan-review protocol | #169 |
| Dedicated spec-PR workflow | #170 |
| Retroactive routing engine | #172 |
| Interaction modes + complexity tiers (engine) | #173 |
| Multi-CLI build/install of `spec-author` | #174 |
| Migration of in-flight tickets | #175 |

## Stage definitions and transition rules

| Stage | Produces | Artefact location | Entry criteria | Exit criteria |
|---|---|---|---|---|
| **SPECS** | A specification (the WHAT) | Spec file under `/specs/<spec-id>/` (format defined in #167) | A ticket exists with a user-evoked intent | Spec PR is merged on `main` (mode-dependent: see *Interaction modes*) |
| **PLAN** | A plan (the HOW: steps, blast radius, alternatives) | Comment on the logbook issue (format defined in #169) | A merged spec on `main` for this ticket | Plan is approved on the logbook issue (mode-dependent) |
| **DEV** | Implementation diff | Feature branch in a dedicated worktree (per `AGENTS.md` → *Worktree Isolation*) | An approved plan on the logbook | A PR is opened and CI is green |
| **REVIEW** | A verdict + zero or more findings | PR comment (`pr-reviewer` verdict format, per `AGENTS.md`) | An open PR with green CI | Verdict is APPROVE with zero findings of any class |

Normative transition rules:

1. SPECS, PLAN, and DEV SHALL NOT be skipped on first entry, even in
   AUTO mode. AUTO mode collapses the *gating* between stages, not
   the stages themselves.
2. REVIEW SHALL run after every DEV iteration, including iterations
   triggered by the loop.
3. A SPECS or PLAN stage that produces no normative change MUST still
   emit an artefact (an "unchanged" delta spec, or a one-line plan
   confirmation) so the audit trail records that the stage ran.
4. The lifecycle MUST be anchored to a logbook (per `AGENTS.md` →
   *Logbook Issues*). Stage transitions are journalled there.

## Finding classification taxonomy

Every REVIEW finding SHALL be tagged with exactly one of three
classes. Class drives the loop target (see *Routing matrix*); it is
not a severity scale.

### `tech` — implementation defect

The intent and design are correct; the realisation is wrong.

- **Canonical example.** The spec says "retry transient HTTP errors
  up to 3 times with exponential backoff". The code retries once,
  with no backoff. Fix: rewrite the retry block in DEV. No design
  change, no spec change.
- **Borderline.** The code retries 3 times but the backoff multiplier
  is 1.5 instead of 2.0. Still `tech` if the spec mandates the
  multiplier; escalates to `spec` if the spec is silent and the
  multiplier was an implementation choice.

### `arch` — design defect

The spec is correct; the chosen design cannot realise it cleanly, or
realises it at a cost the plan did not acknowledge.

- **Canonical example.** The spec mandates "exactly-once delivery
  across restarts". The plan picked an in-memory queue. REVIEW
  observes that an in-memory queue cannot satisfy the spec under
  restart. Fix: re-do PLAN with a persistent queue option;
  re-implement in DEV.
- **Borderline.** The spec mandates "low-latency reads". The plan
  picked a synchronous fan-out. REVIEW observes p99 doubles under
  load. `arch` if low-latency is normative; `spec` if "low-latency"
  was never quantified and the spec needs to define the SLO before a
  design can be chosen.

### `spec` — specification gap

Neither the design nor the implementation is wrong against the spec;
the spec itself fails to decide a point that REVIEW now cares about.

- **Canonical example.** REVIEW asks "what happens when the input is
  empty?". The spec says nothing. The code returns `null`; the test
  expects an empty list; reasonable people disagree. Fix: amend the
  spec via a delta-spec PR (per #170), then re-do PLAN and DEV.
- **Borderline.** The spec lists "log every state transition" but
  does not specify log level. REVIEW flags a noisy `INFO`. `spec`
  if log level is normative for downstream consumers; `tech` if the
  team's logging conventions already settle it via another normative
  document.

**Disambiguation rule.** When uncertain between two adjacent classes,
escalate to the higher (more upstream) one. `tech` < `arch` < `spec`.
A misrouted `tech` finding wastes one team-respawn; a misrouted
`spec` finding wastes the entire downstream cycle.

## Routing matrix

| Finding class | Loop target | Re-spawn | Spec-PR impact |
|---|---|---|---|
| `tech` | DEV | developer + tester | none |
| `arch` | PLAN | architect → developer + tester | none |
| `spec` | SPECS | spec-author → architect → developer + tester | new delta-spec PR (per #170) |

Normative rules:

1. A single REVIEW pass MAY produce findings of multiple classes. The
   routing engine (#172) SHALL pick the most upstream class present
   (`spec` > `arch` > `tech`) and route the entire pass to that
   stage. Mixing loop targets within a single iteration is
   prohibited.
2. Re-spawn columns are minimums. The orchestrator MAY add roles
   (e.g. `security` per the trigger surface defined in `AGENTS.md` →
   *Agent Team Protocol*).
3. A `spec`-class loop SHALL produce a delta-spec PR, not an edit to
   the original spec on `main`. The original spec is immutable once
   merged; deltas chain via the format defined in #167.
4. The loop SHALL NOT modify the logbook issue's identity. Every
   iteration appends to the same logbook (per `AGENTS.md` → *Logbook
   Issues*, Rule A).

## Interaction modes

Mode controls *user gating*, not stage execution. Every mode runs all
four stages.

| Mode | SPECS | PLAN | REVIEW loop |
|---|---|---|---|
| **FULL** | user interactive + validation | user interactive + validation | user notified at each iteration |
| **INTERMEDIATE** | user interactive + validation | user interactive + validation | autonomous |
| **MINIMAL** | user interactive + validation | autonomous | autonomous |
| **AUTO** | LLM-authored, no user gate | autonomous | autonomous |

Normative rules:

1. The default mode is **INTERMEDIATE**.
2. Mode SHALL be declared in the spec frontmatter (field name and
   schema defined in #167). The orchestrator SHALL read the mode at
   ticket pickup and SHALL NOT change it mid-lifecycle without
   re-entering SPECS.
3. In FULL mode, the orchestrator MUST notify the user at the start
   and end of every REVIEW iteration. "Notify" means a single
   structured message on the logbook issue; it does NOT mean blocking
   for user approval (that would collapse FULL into a synchronous
   step-through, which is not the intent).
4. In AUTO mode, SPECS is authored by the `spec-author` skill (#168)
   with no user interaction. The user can audit after the fact via
   the merged spec PR.

## Complexity tiers and team sizing

The spec SHALL declare a complexity tier. The tier drives team
composition for the DEV stage. The spec reviewer (whoever approves
the spec PR) validates the tier.

| Tier | Team for DEV | Notes |
|---|---|---|
| **trivial** | inline (orchestrator only) | No team spawn, no worktree, no logbook (the issue itself suffices). Reserved for single-file edits with no test surface. |
| **small** | `developer` + `pr-logbook` + `pr-reviewer` | Worktree required. No architect, no tester. |
| **standard** | Templates 1 / 2 / 3 from `AGENTS.md` → *Agent Team Protocol* | Current default. |
| **large** | `architect`-led decomposition into sub-specs, then one standard team per sub-spec | Each sub-spec gets its own spec PR (chained via the delta mechanism). |

Normative rules:

1. The tier SHALL be defendable by the spec content. A "trivial" spec
   that requires more than one file edit fails review.
2. Tier escalation during a lifecycle (e.g. small → standard
   discovered mid-DEV) SHALL be treated as an `arch` finding and
   routed through the PLAN loop with an updated team.
3. Tier de-escalation (standard → small) is prohibited mid-lifecycle.
   The cost of running the larger team is already sunk.

## REVIEW loop termination

The lifecycle terminates at MERGE when, and only when, the following
holds simultaneously:

1. A REVIEW pass completes with verdict APPROVE.
2. The same pass surfaces zero findings of any class (`tech`, `arch`,
   `spec`).
3. CI is green on the head commit reviewed.

Non-termination requires a re-loop per the routing matrix.

**Max-iteration guardrail.** The loop SHALL halt after **5
iterations** (configurable per ticket via the spec frontmatter,
default 5) without termination. On halt:

- The orchestrator SHALL post a structured summary on the logbook
  issue listing every iteration's finding class and current spec /
  plan / branch state.
- The orchestrator SHALL page the user regardless of mode (even
  AUTO).
- The lifecycle pauses at the stage of the next scheduled loop; the
  user decides whether to continue, pivot, or abort.

The guardrail exists to bound runaway autonomous loops in AUTO and
MINIMAL modes. It is not a quality target — most lifecycles SHOULD
terminate in 1–2 iterations.

## Consequences

### Easier

- **User drift is caught at SPECS, not PR.** A misaligned spec costs
  one PR (cheap); a misaligned PR costs a worktree, a team, and a
  logbook (expensive).
- **Review findings have a known destination.** The routing matrix
  removes "where do I put this fix?" from every reviewer's head.
- **Trivial tickets stop paying the team-spawn tax.** The trivial
  tier is a first-class option, not a hack.
- **AUTO mode becomes safe to expose.** The combination of
  classification + termination criterion + max-iteration guardrail
  gives the user a single audit surface (the logbook) for fully
  autonomous runs.

### Harder

- **Every non-trivial ticket gains one extra PR** (the spec PR) and
  one extra structured artefact (the plan comment). The marginal
  cost is real and is the price of buying the two failure modes
  back.
- **Spec-PR / impl-PR ordering** must be respected. Out-of-order
  merges (impl before spec) break the audit chain. Tooling per #170
  enforces this; agents must learn the new ordering.
- **Finding classification is a judgement call.** Agents and humans
  will disagree on borderline cases. The disambiguation rule
  (escalate upstream) protects correctness at the cost of occasional
  over-routing.

### Parity implications (Claude / Gemini / Copilot)

The lifecycle contract is CLI-agnostic — it lives in `AGENTS.md` and
this ADR, both of which are loaded by every CLI. Three downstream
items carry parity load, tracked in their own tickets:

- The `spec-author` skill (#168) ships through `community-config/`
  and is compiled to all three CLIs by `scripts/build-components.sh`
  (#174). No CLI-specific gap is anticipated.
- The retroactive routing engine (#172) is orchestrator-side logic.
  Claude Code's team primitives (`TeamCreate` / `TaskCreate` /
  `SendMessage`) make it directly expressible; Gemini CLI's
  sequential-spawn fallback (per `AGENTS.md` → *On CLIs without team
  support*) requires loop bookkeeping in the orchestrator's
  conversation state. Copilot CLI parity will be assessed in #172.
- The interaction-mode notification surface (#173) reuses the
  logbook issue, which is GitHub-side and therefore CLI-agnostic.

`docs/cli-matrix.md` SHALL be updated as each of #168 / #172 / #173
lands, not as part of this ADR. This PR does not touch the *CLI Matrix
Maintenance* trigger surface defined in `AGENTS.md` (no edits under
`.claude/`, `.gemini/`, `community-config/`, `extensions/`, the
CLI-specific hooks, the `config/` trees, `scripts/build-components.sh`,
the CLI-prefixed scripts, the `claude.yml` / `gemini.yml` workflows,
or the top-level CLI entry-point files), so the obligation to update
the matrix in lockstep does not apply here.

## Appendix — three worked examples

These examples define expected artefacts so downstream tickets
(#167, #169, #172, #173) can use them as fixtures.

### Example 1 — Trivial change

**Ticket.** "Fix typo in `README.md` line 42: `recieve` → `receive`."

| Stage | Artefact | Content |
|---|---|---|
| SPECS | Spec id `2026-T-0001-readme-typo` | Single-line WHAT: "Fix spelling of 'receive' in README.md." Tier: `trivial`. Mode: INTERMEDIATE. |
| PLAN | (skipped for trivial) | — |
| DEV | Inline edit by orchestrator | One-line diff. |
| REVIEW | Self-review by orchestrator | Expected classes: none. |

Expected iterations: 1. No team spawn. Logbook is the ticket itself.

### Example 2 — Standard change

**Ticket.** "Add a `--dry-run` flag to `scripts/build-components.sh`."

| Stage | Artefact | Content |
|---|---|---|
| SPECS | Spec id `2026-S-0042-build-dryrun` | WHAT: flag semantics, exit codes, output format. Tier: `standard`. Mode: INTERMEDIATE. |
| PLAN | Logbook comment, plan section | Steps: locate write sites, gate behind flag, add tests. Blast radius: build script + its tests. Alternatives: env var (rejected). |
| DEV | Feature branch via worktree | Template 1 from `AGENTS.md` (architect → developer → tester → pr-logbook → pr-reviewer). |
| REVIEW | PR comment | Expected classes: `tech` (one or two iterations likely); `arch` possible if dry-run interacts with side-effects discovered late. |

Expected iterations: 1–2. Standard team composition.

### Example 3 — Large change

**Ticket.** "Introduce a credential-vault abstraction shared by the
e2e judge backends and the auth-bundle scripts."

| Stage | Artefact | Content |
|---|---|---|
| SPECS | Parent spec id `2026-L-0007-cred-vault` + delta specs per sub-area | WHAT: vault contract, threat model, migration plan for existing credential stores. Tier: `large`. Mode: FULL (user requested visibility). |
| PLAN | Logbook comment | Decomposition: 3 sub-specs (vault core; judge migration; auth-bundle migration). Sequencing: vault core first; migrations in parallel. |
| DEV | Three feature branches, one per sub-spec, each with its own team | `architect`-led decomposition (per the *large* tier row). |
| REVIEW | One PR review per sub-spec PR | Expected classes: all three plausible. `spec` findings on the vault core are likely to cascade to the migration sub-specs. |

Expected iterations: 2–4 across the family. Each sub-spec PR runs the
loop independently; cross-PR findings escalate to a `spec` loop on
the parent.
