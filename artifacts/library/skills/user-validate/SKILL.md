---
name: user-validate
description: 'Realise a user-gate validation of an artifact (spec, plan, any document) through the configured backend: `plannotator` (browser review, opt-in) or `internal` (AskUserQuestion, default). The canonical gate implementation; invoke it instead of reimplementing a gate inline.'
type: skill
license: Apache-2.0
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "1.7.1"
claude:
  allowed-tools:
    - Read
    - Bash
  user-invocable: true
---

# User Validate

The one skill every workflow invokes when it needs a **user-gate validation**
of an artifact — a spec, a plan, or any document. It is the sole implementation
of the backend-configurable gate protocol (spec 0080 R9): lifecycle stages and
external workflows call `user-validate` rather than open-coding a gate, so the
backend choice, the fallback rule, and the three cross-cutting options live in
exactly one place.

The skill is a **pure one-shot function**: one invocation, one of three
outcomes, control returned to the caller. It never loops, never auto-re-prompts,
and never decides what to do with a non-approval — that is the caller's policy.

## Invocation contract

Per invocation (spec 0080 R10):

- **Inputs:**
  1. the **artifact or element** to validate — a file path (preferred, e.g.
     `specs/0080-….md`) or an inline element the caller wants arbitrated;
  2. the **precise ask** — the one decision the user is being asked to make
     (e.g. *"Approve this plan for DEV?"*).
- **Output:** exactly one structured outcome:
  - `approved` — proceed;
  - `changes-requested` — do not proceed; carries a `feedback` string routed to
    the upstream stage for revision;
  - `rejected` — do not proceed; the situation is surfaced to the user and
    control returns to the caller.

The skill does **not** re-prompt on `rejected`. A `dismissed` decision, a
non-zero exit, or malformed output all collapse to `rejected` (see *Decision
mapping*); the caller re-drives under its own mode-specific retry / halt / page
policy (this closes spec 0080 OQ3 — no in-skill loop).

## Configuration discovery

Read the active configuration from **`~/.crewrig/validation.conf`** — a
per-user, machine-local file written by the four setup entries
(`node scripts/setup-<cli>-interactive.ts`, run after
`node scripts/lib/node-floor-guard.js` as a separate step), outside the core layer
(spec 0080 R15/R16). Format is `key=value`, one per line;
ignore blank lines and lines beginning with `#`. Keys:

| Key | Values | Default |
|---|---|---|
| `backend` | `internal` \| `plannotator` | `internal` |
| `translate` | `on` \| `off` | `off` |
| `pedagogy` | `simple` \| `contextual` \| `professor` | `contextual` |
| `illustration` | `on` \| `off` | `off` |

**If the file is absent, or a key is missing, use the default** — most
importantly `backend=internal`. Never fail the gate because the config file is
missing; the `internal` backend is the guaranteed floor on every CLI.

## Backend: `plannotator` (opt-in, rich review)

Read `references/plannotator-backend.md` **only when `backend=plannotator`** was
discovered in *Configuration discovery* (presence check, invocation, decision
mapping, fallback, caller-built presentations). Otherwise skip it.

## Backend: `internal` (default floor)

Realise the gate through **`AskUserQuestion`** (or the host CLI's equivalent
structured interactive prompt) — **never as a prose question**. This preserves
and does not weaken
`specs/0037-validation-gate-must-use-askuserquestion.md`.

The `internal` feature set is a deliberate subset of `plannotator`:

- Present the precise ask as a structured question whose options map to the
  three outcomes — e.g. *Approve* → `approved`, *Request changes* →
  `changes-requested` (then collect the feedback text), *Reject* → `rejected`.
- Apply `translate` and `pedagogy` framing (below) to the question and option
  text.
- `illustration` is **not** honoured here (see R14) — there is no browser image
  surface on the `internal` path.

**Structured-equivalent (non-Claude CLIs).** `AskUserQuestion` is verified on
Claude Code. A structured interactive-prompt equivalent is verified on Gemini
and Copilot (using `ask_user`) and on Antigravity (using `ask_question`). The
gate realizes the structured question without downgrading to prose.

## Cross-cutting options

### `translate` (spec 0080 R12, spec 0189 R3)

When `translate=on` and the user's preferred language is not English, translate
**only the transient gate presentation** shown to the user — the artifact copy
displayed, the contextual commentary, the question, and the option text. The
**repository artifact stays in English**; never write a translated copy back to
the repo (`AGENTS.md` → *Language*). Translation is presentation-only.

### `pedagogy` (spec 0080 R13, spec 0189 R1/R2)

Frame each validation request per the level:

- **`simple`** — brief context plus the user's role in this decision.
- **`contextual`** (default) — the global context, the concerned part, and the
  precise ask.
- **`professor`** — a full pedagogical re-explanation of the arbitration
  situation (what is being decided, why, what each choice implies) alongside
  complete substance embedding.

### `illustration` (spec 0080 R14, spec 0189 R4, spec 0189 delta-01 R6/R7)

`illustration` is honoured only when `backend=plannotator` and an image surface exists,
otherwise silently ignored; full text in `references/plannotator-backend.md` (read only
when `backend=plannotator`).

### `theme` (spec 0174 R1/R2)

Tune the presentation styling when building a bespoke HTML document for
`plannotator`:

- **`auto`** (or **`system`**, default) — adaptive styling using body-scoped CSS
  custom properties and `@media (prefers-color-scheme: dark)` to automatically
  match the user's OS theme in both light and dark modes with WCAG AA contrast.
- **`dark`** — forces explicit dark theme styling (`<meta name="color-scheme"
  content="dark only">`, dark background, light text).
- **`light`** — forces explicit light theme styling (`<meta name="color-scheme"
  content="light only">`, light background, dark text).

## Parity posture (spec 0080 R3/R17)

| CLI | `plannotator` detached invocation | `internal` structured prompt | Guaranteed floor |
|---|---|---|---|
| Claude Code | verified | `AskUserQuestion` (verified) | `internal` |
| Gemini CLI | verified | `[GAP-confirmation]` | `internal` |
| Copilot CLI | verified | `[GAP-confirmation]` | `internal` |
| Antigravity CLI | verified | `[GAP-confirmation]` | `internal` |

The `internal` backend is the floor on every CLI: whenever a richer affordance
cannot be proven available at gate time, degrade to `internal` rather than
assert an unverified capability. See `docs/cli-matrix.md` rows 27 / 27b.

## Harness friction tagging

When a recognition signal fires (see `config/TOOLS.md` → *Friction Reporting →
Recognition signals*), invoke the `harness-report` skill
(`artifacts/library/skills/harness-report/SKILL.md`) rather than reimplementing
the protocol inline. Tagging is fire-and-forget; do not block the gate waiting
for an acknowledgment.
