# Agent Team Protocol — Templates and Sizing

<!-- crewrig-doc: published=false -->
<!-- markdownlint-disable MD033 -->

<a id="standard-team-templates"></a>

## Standard Team Templates

Every role in the templates below operates inside the ticket worktree as
required by the rule above.

Agents **MUST** use the closest matching template below as the starting team
composition. Adjust by dropping a role only when the ticket's scope explicitly
excludes it, or by adding a role when the change crosses a specialist's
trigger surface (e.g. `security`, `architect`). Either adjustment requires a
one-line rationale in the task handoff comment. Ad-hoc partial crews —
omitting roles without justification — are prohibited.

The templates below describe the **`standard`**-tier composition.
Trivial / small / large tickets follow the tier-specific rules in
*Team sizing by complexity* below; consult that section before
spawning a team.

**Security rule (applies to all templates):** When a change touches the
security skill's trigger surface (authentication, authorization, secrets,
cryptography, input parsing, deserialization, network calls, or dependency
upgrades), insert `security` after `developer` in the applicable template.

<a id="seated-review-passes"></a>

### Seated review passes

Every review pass a template spawns — on the `specs`, `plan` or `review`
surface — is attributed to a **reviewer seat** keyed `<surface>/<ticket>`
and briefed with references only; the definition of that brief is in
[`docs/reviewer-seat.md`](../reviewer-seat.md).

The contract in full, including the seat line every verdict carries and
the bounded reading that applies from a seat's second pass onward, is
[`docs/reviewer-seat.md`](../reviewer-seat.md). It changes no template's
composition and no role's surface; it changes how a pass is briefed and
what its verdict must say. A seated pass's brief carries neither the
`handoff_key` nor the drawer id.

<a id="step-0-spec-author"></a>

### Step 0 — `spec-author` (every non-trivial template)

Templates 1, 2, and 3 below describe the DEV-stage staffing of the
ADR-0010 lifecycle. Before any of them runs, the `spec-author` skill
authors the SPECS-stage artifact: a single Markdown file under
`/specs/` conforming to `docs/spec-format.md`. The skill is invoked
once per ticket, in the mode declared by the parent ticket (default
INTERMEDIATE per ADR-0010).

The skill runs as step 0 for every ticket whose complexity tier is
NOT `trivial` (ADR-0010 → *Complexity tiers and team sizing*). Its
first action is the ticket pickup check of
[`docs/ticket-ownership.md`](../ticket-ownership.md), before it secures
the spec id; a non-zero exit stops the ticket (spec 0244 R15).
`trivial`-tier tickets bypass `spec-author` entirely; the orchestrator
handles them inline per the trivial-tier row of the ADR.

The spec PR SHALL be merged before the team proceeds to PLAN/DEV. The
ordering is enforced by the spec-PR workflow (#170) — agents do not
hand-roll it.

<a id="shared-template-rules"></a>

### Shared rules for Templates 1 to 3

**REVIEW is a looping stage**, not terminal — the orchestrator follows the routing engine documented in [`docs/retroactive-loop.md`](../retroactive-loop.md) until the termination criterion is met.

**Ordering constraint:** `pr-logbook` MUST open the PR (or hand the complete
draft to `team-lead` for opening) before `pr-reviewer` is spawned. The
orchestrator MUST NOT parallelise these two roles — `pr-reviewer` cannot
fulfill its cold-start contract without a valid PR number. `pr-reviewer`
receives the PR number from `pr-logbook`'s result message (see *Team
Communication → Rule 1*).

**Shared-identity workaround:** When the orchestrator and `pr-reviewer` share the same GitHub identity (common in solo-dev setups), GitHub rejects `gh pr review --approve` with "Can not approve your own pull request"; in that case `pr-reviewer` MUST post its verdict as a regular PR comment opening with a `## Verdict: APPROVE` or `## Verdict: REQUEST CHANGES` header. This applies to every template below that includes `pr-reviewer`.

<a id="template-1"></a>

### Template 1 — Feature implementation (results in a PR)

Preceded by step 0 (spec-author) — see the subsection above.

Full pipeline. Every role is mandatory unless explicitly scoped out by the
user.

| Order | Role | Responsibility |
|---|---|---|
| 1 | `architect` | Design review, ADR if needed, blast-radius check |
| 2 | `developer` (×N) | Implementation in the worktree |
| 3 | `tester` | Write / update tests |
| 4 | `pr-logbook` | Draft PR title, body, and logbook entry |
| 5 | `pr-reviewer` | Independent cold review of the diff; verifies CI checks pass before posting verdict |

See [Shared rules for Templates 1 to 3](#shared-template-rules).

Use multiple `developer` agents in parallel when the work decomposes into
independent files or modules; a single developer suffices otherwise.

<a id="template-2"></a>

### Template 2 — Documentation-only change

Preceded by step 0 (spec-author) — see the subsection above.

Lighter pipeline — no code, no tests.

| Order | Role | Responsibility |
|---|---|---|
| 1 | `doc-writer` | Write / update the documentation |
| 2 | `pr-logbook` | Draft PR title, body, and logbook entry |
| 3 | `pr-reviewer` | Independent cold review of the diff; verifies CI checks pass before posting verdict |

See [Shared rules for Templates 1 to 3](#shared-template-rules).

If the documentation change modifies an established protocol, convention, or
contract (e.g. AGENTS.md itself), insert `architect` as step 0.

<a id="template-3"></a>

### Template 3 — Bug fix

Preceded by step 0 (spec-author) — see the subsection above.

Test-first pipeline: the failing regression test is written before the fix
to lock in reproduction.

| Order | Role | Responsibility |
|---|---|---|
| 1 | `tester` | Write a failing regression test that reproduces the bug |
| 2 | `developer` | Implement the fix until the regression test passes |
| 3 | `pr-logbook` | Draft PR title, body, and logbook entry |
| 4 | `pr-reviewer` | Independent cold review of the diff; verifies CI checks pass before posting verdict |

See [Shared rules for Templates 1 to 3](#shared-template-rules).

`architect` is optional: include it only when the root cause exposes a
design flaw rather than a localized defect.

<a id="team-sizing-by-complexity"></a>

## Team sizing by complexity

The complexity tier declared in a spec's frontmatter (per ADR-0010 →
*Complexity tiers and team sizing* and
[`specs/0006-interaction-modes-and-sizing.md`](../../specs/0006-interaction-modes-and-sizing.md)
R4) determines the DEV-stage team composition. The orchestrator reads
the tier once at ticket pickup and spawns the matching team. The four
tiers and their exact compositions:

| Tier | DEV-stage team | Notes |
|---|---|---|
| `trivial` | No team — orchestrator handles the work inline in a single turn. | Bypasses `spec-author` per *Standard Team Templates → Step 0*, so the orchestrator runs the ticket pickup check (`task -x ticket-pickup -- --issue <N>`, [`docs/ticket-ownership.md`](../ticket-ownership.md)) itself before its first authoring action, and stops on any non-zero exit. The artifact-validation gate(s) of the declared interaction mode — realised through the `user-validate` skill — and the distinct merge-authorization gate still apply to inline work. |
| `small` | `developer` + `pr-logbook` + `pr-reviewer`. | No `architect` (the spec is its own architectural input). No `tester` unless the change carries a test surface; when added, slot `tester` between `developer` and `pr-logbook`. The *Security rule* still applies. |
| `standard` | The matching Template (1 / 2 / 3) from *Standard Team Templates* above, unchanged. | Default tier when the frontmatter is silent. |
| `large` | `architect`-led decomposition into one or more sub-specs **before** any `developer` spawn. | Each sub-spec is a separate ticket with its own SPECS-stage entry (a new spec file under `/specs/`, a new spec-PR, a new implementation-PR). The parent ticket coordinates; it does not implement. |

**Selection rule.** The orchestrator SHALL read the `complexity`
field from the merged spec's frontmatter at ticket pickup and SHALL
NOT re-evaluate it mid-lifecycle. Picking up a ticket whose spec is
already merged — at the PLAN or DEV stage — SHALL first run the
ticket pickup check (`task -x ticket-pickup -- --issue <N>`,
[`docs/ticket-ownership.md`](../ticket-ownership.md)) before any branch
or worktree; any non-zero exit stops the pickup (spec 0244 R15). Per ADR-0010, the tier — like the
interaction mode — is immutable once SPECS merges; correcting a
mis-tagged tier requires a delta-spec PR routed through the
retroactive review loop (`class: spec`).

**Independence from interaction mode.** The tier and the interaction
mode are orthogonal axes. Any combination is legitimate
(e.g. `trivial` + `FULL`, `large` + `AUTO`) and the orchestrator
SHALL NOT reject a spec on the basis of an unusual combination
(spec 0006 R1). The mode governs user gating per *Interaction modes →
Behavioral contract per (mode × stage) cell* in AGENTS.md; the tier governs team
composition per the table above.

**Spec-reviewer obligation.** When a spec-PR is cold-reviewed, the
reviewer MUST challenge a tier that appears under-stated relative
to the spec's declared blast radius (the union of
`## Requirements` and the file paths the spec touches). The
challenge is emitted as a `class: spec` finding citing this
section — see
[`artifacts/core/skills/pr-reviewer/SKILL.md`](../../artifacts/core/skills/pr-reviewer/SKILL.md)
→ *Spec-review obligation — tier challenge*. Over-statement is a
non-blocking observation, not a blocking finding. The review is
attributed to the `specs/<ticket>` seat, so the challenge carries an
`s<N>-F<M>` identifier alongside its `class:` field, and a fresh
delta-spec PR is a replaced artifact the seat examines in full while
retaining its dossier — see
[`docs/reviewer-seat.md`](../reviewer-seat.md).
