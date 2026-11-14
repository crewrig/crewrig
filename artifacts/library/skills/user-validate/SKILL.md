---
name: user-validate
description: 'Puts an artifact (a spec, a plan or any document) to the user for a validation decision and returns exactly one outcome: approved, changes-requested or rejected. Runs on the configured backend, `plannotator` (browser review, opt-in) or `internal` (structured prompt, the default). Use when a workflow stage needs the user''s approval, sign-off or go/no-go before it proceeds, or when the user must arbitrate between options. Trigger terms: user gate, validation gate, approval, sign-off, approve this plan, plannotator review. Not for reviewing a pull request (pr-reviewer), writing a spec (spec-author) or annotating a file on the user''s own initiative (plannotator).'
type: skill
license: Apache-2.0
compatibility: Requires Node.js 24 or later for the bundled scripts. The plannotator backend also needs the plannotator binary on PATH; without it the gate runs on the internal backend, which needs only the host CLI's structured question tool.
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "2.0.0"
claude:
  allowed-tools:
    - Read
    - Bash
  user-invocable: true
---

# User Validate

Workflows call this skill instead of open-coding a gate, so the backend choice, the fallback and the
presentation options live in one place. One invocation is one question and one outcome, then control
returns to the caller. The skill never loops and never decides what a non-approval means: the caller
owns that policy.

## Invocation contract

- **Inputs:** the artifact to validate (a file path preferred, or an inline element) and the one
  decision asked, such as "Approve this plan for DEV?".
- **Output:** exactly one of
  - `approved`: the caller proceeds;
  - `changes-requested`: the caller does not proceed and routes the `feedback` text upstream;
  - `rejected`: the caller does not proceed; the situation goes to the user and control returns to
    the caller, which re-drives under its own retry or halt policy.

## Step 1: read the configuration

```sh
node scripts/gate-config.ts --json
```

It reads `~/.crewrig/validation.conf` and prints the effective `backend`, `translate`, `pedagogy`,
`illustration` and `theme`, plus `raw_passthrough_allowed`. A missing file, a missing key or an invalid
value gives the default, so the gate never fails for a configuration reason: `internal` is the floor on
every CLI. Exit `0` always carries usable settings (warnings name an ignored key or value); exit `2` is a
usage error.
<!-- crewrig-repo-only:start -->
CrewRig repository only: the file is written by `node scripts/setup-<cli>-interactive.ts`, run after
`node scripts/lib/node-floor-guard.js` as a separate step.
<!-- crewrig-repo-only:end -->

## Step 2: realise the gate on the backend

### `internal` (the default)

Use `AskUserQuestion`, or the host CLI's structured question tool (`ask_user` on Gemini CLI and Copilot
CLI, `ask_question` on Antigravity CLI). A plain prose question is not a gate: the user can answer it
ambiguously and the caller gets no outcome to branch on.

- Ask the one decision, with options that map to the outcomes: Approve is `approved`, Request changes is
  `changes-requested` (then collect the feedback text), Reject is `rejected`.
- Apply `translate` and `pedagogy` (below) to the question and option text.
- `illustration` does not apply: this path has no image surface.

### `plannotator` (opt-in)

Read `references/plannotator-backend.md`, then follow it. In short: check the binary with
`node scripts/plannotator-gate.ts check` (exit `3` means fall back to `internal` and tell the user),
build a presentation when any option is active, and run the review detached with
`node scripts/plannotator-gate.ts run <file> --json`. The script maps the result to an outcome.

## Presentation options

- **`translate=on`** with a non-English user language: translate only what the user sees (the artifact
  copy, the commentary, the question, the options). The repository artifact stays in English and a
  translated copy is never written back.
- **`pedagogy`** frames the request: `simple` is brief context plus the user's role; `contextual`
  (default) is the global context, the concerned part and the precise ask; `professor` re-explains what
  is decided, why, and what each choice implies, with the real content embedded.
- **`illustration=on`** and **`theme`** matter only to the `plannotator` backend; see its reference.

## Friction

When something here misleads or blocks you, tag it with the `harness-report` skill; the shared rule is
in `references/shared-friction-reporting.md`.
