# Plannotator backend

Read this only when `gate-config.ts` reported `backend=plannotator`.

## Contents

- Presence check
- Passthrough or presentation
- Running the review
- Decision mapping
- Building a presentation
- Illustration

## Presence check

```sh
node scripts/plannotator-gate.ts check --json
```

Exit `3` means plannotator is not installed or does not start. Do not fail the gate: run it on the
`internal` backend and tell the user that the fallback happened.

## Passthrough or presentation

When `raw_passthrough_allowed` is true, hand the artifact file to the viewer as it is: its own renderer
shows the whole artifact, so no presentation is needed and none should add inline styling. Otherwise
(any of translation, a pedagogy other than `simple`, illustration or a non-default theme is active)
build a presentation document and hand that file over.

## Running the review

```sh
node scripts/plannotator-gate.ts run <presentation-or-artifact-file> --json
```

The script runs `plannotator annotate <file> --gate --json`. Human review can last far longer than a
tool call, so start it detached.

- **Claude Code:** launch it with the Bash tool and `run_in_background: true`, and act on the
  re-invocation the harness delivers when it exits. A foreground `sleep` is blocked; to wait on a
  condition use the `Monitor` tool with an until-loop.
- **Gemini CLI, Copilot CLI, Antigravity CLI:** a detach-and-poll primitive is not verified. Confirm one
  exists at gate time; if none does, fall back to `internal` and tell the user.

## Decision mapping

A decision counts only when the process exits `0` and standard output holds a gate JSON object. Anything
else is a non-approval, because guessing an approval from a broken run would let a stage proceed on no
decision.

| Observed | Outcome | Script exit |
|---|---|---|
| exit 0 and `{"decision":"approved"}` | `approved` | 0 |
| exit 0 and `{"decision":"annotated","feedback":"…"}` | `changes-requested`, with the feedback | 0 |
| `{"decision":"dismissed"}`, a non-zero exit, absent or malformed output | `rejected` | 1 |
| plannotator missing or unable to start | fall back to `internal` | 3 |

`data.outcome` carries the outcome and `data.feedback` the text. To map a result observed some other
way, use `node scripts/plannotator-gate.ts map --exit-code <n> --stdout-file <file|->`.

## Building a presentation

Wrap the body in a page with the bundled renderer:

```sh
node scripts/render-gate-html.ts --title "<the ask>" --body-file body.html --theme <theme> --out gate.html
```

It writes the page with the theme-safe skeleton: `auto` (also `system`) adapts to the OS theme with
body-scoped variables and a dark-mode media query, `dark` and `light` force the scheme. The viewer
ignores colours declared only in `<head>`, which shows up as black text on a black background, so the
renderer keeps every colour inline or inside the body.

You write the body fragment, and it carries the judgement:

- **Embed the real substance.** A presentation that only describes the change (a title, a one-line
  summary, the previous reviewer's verdict) leaves the user unable to judge it. Put the changed prose
  or a diff excerpt in the body, verbatim, with the context and the implication of each choice. For a
  decision over a change set, show enough of it for the user to judge independently of any earlier
  review verdict.
- **Translate the embedded substance** when `translate=on`; the repository file stays English.
- **Inline images as `data:` URIs.** Browsers block `file://` images in pages the viewer opens.

## Illustration

Honoured only with this backend and a browser image surface; otherwise ignored without a note. Use it
for pedagogical diagrams only (architecture, boundaries, sequences, trade-offs), never decoration, and
prefer inline SVG to a generated raster image. When a raster image is needed, generate it best-effort
with the `nano-banana` skill and continue without it if that fails.
