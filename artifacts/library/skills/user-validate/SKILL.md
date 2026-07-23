---
name: user-validate
description: "Realise a user-gate validation of an artifact (spec, plan, or any
  document) through the configured backend. The single canonical implementation
  of the backend-configurable gate protocol — CrewRig lifecycle stages and any
  external workflow invoke this skill instead of reimplementing a gate inline.
  Backends: `plannotator` (rich browser review, opt-in) and `internal`
  (AskUserQuestion, the default floor)."
type: skill
license: Apache-2.0
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "1.2.0"
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
per-user, machine-local file written by the `setup-*-interactive.sh` scripts,
outside the core layer (spec 0080 R15/R16). Format is `key=value`, one per line;
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

1. **Presence check (spec 0080 R4).** Run `plannotator --version`. If it fails
   (binary absent from PATH), **fall back to the `internal` backend for this
   gate AND tell the user** the fallback happened. Do not error out.

2. **Invoke exactly (spec 0080 R6):**

   ```sh
   plannotator annotate <artifact-file> --gate --json
   ```

   Pass the artifact as a file argument. Run it **detached**, not foreground —
   human review can far exceed a synchronous tool-call budget:

   - **Claude Code (verified).** Launch with the Bash tool
     `run_in_background: true` and consume the re-invocation the harness delivers
     when the process exits. **Never** use a foreground `sleep` to wait (it is
     blocked); when you need to wait on a condition, use the `Monitor` tool with
     an until-loop.
   - **Gemini CLI / Copilot CLI / Antigravity CLI (pending-DEV).** A detach +
     wait-between-polls primitive is not yet verified on these CLIs. Confirm one
     is available at gate time; **if none is feasible, degrade to the `internal`
     backend** and inform the user (same fallback path as R4).

3. **Dual validation (spec 0080 R7).** Treat the decision as complete **only
   when BOTH** the process exit status is `0` **AND** stdout carries a valid
   gate JSON object. A non-zero exit OR absent/malformed stdout is a
   non-approval — do not guess.

4. **Decision mapping (spec 0080 R8).**

   | Observed | Outcome |
   |---|---|
   | exit `0` + `{"decision":"approved"}` | `approved` |
   | exit `0` + `{"decision":"annotated","feedback":"…"}` | `changes-requested`, carrying `feedback` to the upstream stage |
   | `{"decision":"dismissed"}`, OR non-zero exit, OR absent/malformed stdout | `rejected` — surface the situation, return to caller |

### Contrast-safety for caller-built presentations

**Scope (spec 0099 R2).** This guidance applies **only** when you build a
bespoke HTML presentation of the artifact before handing it to the review
viewer — for example because an active `pedagogy` or `illustration` option
obliges a richer rendering than the raw file. It does **not** apply when you
pass a raw Markdown or plain-text artifact file straight through (spec 0099
R2/R8): on that passthrough path the viewer's own renderer owns readability,
and you MUST NOT inject inline contrast styling.

**Why (spec 0099 R3).** The review viewer renders the document body but does
**not** reliably honor a `<head>`-scoped `<style>` block, and it may place the
content on a **dark host surface**. Colors declared only in the head can
therefore surface as unreadable low-contrast content — the black-text-on-black-
background outcome observed during a live spec-approval gate.

**Rules for a caller-built HTML presentation:**

- **Inline every readability-critical declaration (spec 0099 R4).** Each color
  and contrast declaration the presentation's readability depends on SHALL be
  self-contained **inline** — on the content wrapper element **and** on the
  document `<body>` element — never declared only inside a `<head>` `<style>`
  block.
- **Keep supplementary styling in the body (spec 0099 R5).** Any `<style>`
  block used for non-critical, supplementary styling SHALL live inside
  `<body>`, not in `<head>`.
- **Declare a light color-scheme hint (spec 0099 R6).** The document SHALL
  declare `<meta name="color-scheme" content="light only">` so the host does
  not place light-assuming content on a dark surface.

**Compliant example (spec 0099 R7).** Background and text colors are inline on
both `<body>` and the content wrapper, the color-scheme hint is present, and no
readability-critical color lives in the head:

```html
<!doctype html>
<html>
  <head>
    <meta name="color-scheme" content="light only">
  </head>
  <body style="background:#ffffff; color:#111111;">
    <main style="background:#ffffff; color:#111111; padding:1.5rem;">
      <h1 style="color:#111111;">Approve this plan for DEV?</h1>
      <p style="color:#111111;">…artifact content…</p>
    </main>
  </body>
</html>
```

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

**Structured-equivalent gap (non-Claude CLIs).** `AskUserQuestion` is confirmed
on Claude Code. A structured interactive-prompt equivalent on Gemini / Copilot /
Antigravity is not yet verified (`[GAP-confirmation]`, `docs/cli-matrix.md` row
27b). Where no structured prompt exists, use the closest host-CLI interactive
primitive that still avoids a bare prose question, and record the gap — do not
silently downgrade to prose.

## Cross-cutting options

### `translate` (spec 0080 R12)

When `translate=on` and the user's preferred language is not English, translate
**only the transient gate presentation** shown to the user — the artifact copy
displayed, the question, and the option text. The **repository artifact stays in
English**; never write a translated copy back to the repo (`AGENTS.md` →
*Language*). Translation is presentation-only.

### `pedagogy` (spec 0080 R13)

Frame each validation request per the level:

- **`simple`** — brief context plus the user's role in this decision.
- **`contextual`** (default) — the global context, the concerned part, and the
  precise ask.
- **`professor`** — a full pedagogical re-explanation of the arbitration
  situation (what is being decided, why, what each choice implies).

### `illustration` (spec 0080 R14)

Honoured **only when `backend=plannotator` AND a browser image surface is
available** — otherwise **silently ignored** (no error, no note). Because
Plannotator renders the artifact as HTML in a browser it launches itself, image
display is a function of browser availability, not of the driving CLI (uniform
across all four CLIs, not a per-CLI asymmetry — spec 0080 OQ4). When honoured,
generation is **best-effort** via the `nano-banana` skill; if it is unavailable
or fails, proceed with the gate without the illustration.

## Parity posture (spec 0080 R3/R17)

| CLI | `plannotator` detached invocation | `internal` structured prompt | Guaranteed floor |
|---|---|---|---|
| Claude Code | verified | `AskUserQuestion` (verified) | `internal` |
| Gemini CLI | pending-DEV → degrade to `internal` | `[GAP-confirmation]` | `internal` |
| Copilot CLI | pending-DEV → degrade to `internal` | `[GAP-confirmation]` | `internal` |
| Antigravity CLI | pending-DEV → degrade to `internal` | `[GAP-confirmation]` | `internal` |

The `internal` backend is the floor on every CLI: whenever a richer affordance
cannot be proven available at gate time, degrade to `internal` rather than
assert an unverified capability. See `docs/cli-matrix.md` rows 27 / 27b.

## Harness friction tagging

When a recognition signal fires (see `config/TOOLS.md` → *Friction Reporting →
Recognition signals*), invoke the `harness-report` skill
(`artifacts/library/skills/harness-report/SKILL.md`) rather than reimplementing
the protocol inline. Tagging is fire-and-forget; do not block the gate waiting
for an acknowledgment.
