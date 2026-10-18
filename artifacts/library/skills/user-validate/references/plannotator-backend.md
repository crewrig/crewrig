# Plannotator backend

## Backend: `plannotator` (opt-in, rich review)

1. **Presence check (spec 0080 R4).** Run `plannotator --version`. If it fails
   (binary absent from PATH), **fall back to the `internal` backend for this
   gate AND tell the user** the fallback happened. Do not error out.

2. **Bespoke presentation generation (spec 0189 R1/R5).**
   - When **any** cross-cutting presentation preference is active (`translate=on`
     with non-English preferred language, `pedagogy != simple` such as
     `contextual` or `professor`, `illustration=on`, or custom `theme`), the
     skill SHALL construct a bespoke presentation document (typically a temporary
     HTML file in `/tmp/gate-presentation-*.html`) embodying the active language
     translation, pedagogical context, theme styling, and embedded image assets,
     and pass that file to `plannotator`.
   - Raw passthrough of the repository source file directly to `plannotator` is
     permitted **only** when all cross-cutting enhancements are disabled
     (`translate=off`, `pedagogy=simple`, `illustration=off`, default theme).

3. **Invoke exactly (spec 0080 R6, spec 0189 R1):**

   ```sh
   plannotator annotate <presentation-or-artifact-file> --gate --json
   ```

   Pass the presentation file (or raw artifact file on clean passthrough) as a
   file argument. Run it **detached**, not foreground — human review can far
   exceed a synchronous tool-call budget:

   - **Claude Code (verified).** Launch with the Bash tool
     `run_in_background: true` and consume the re-invocation the harness delivers
     when the process exits. **Never** use a foreground `sleep` to wait (it is
     blocked); when you need to wait on a condition, use the `Monitor` tool with
     an until-loop.
   - **Gemini CLI / Copilot CLI / Antigravity CLI (pending-DEV).** A detach +
     wait-between-polls primitive is not yet verified on these CLIs. Confirm one
     is available at gate time; **if none is feasible, degrade to the `internal`
     backend** and inform the user (same fallback path as R4).

4. **Dual validation (spec 0080 R7).** Treat the decision as complete **only
   when BOTH** the process exit status is `0` **AND** stdout carries a valid
   gate JSON object. A non-zero exit OR absent/malformed stdout is a
   non-approval — do not guess.

5. **Decision mapping (spec 0080 R8).**

   | Observed | Outcome |
   |---|---|
   | exit `0` + `{"decision":"approved"}` | `approved` |
   | exit `0` + `{"decision":"annotated","feedback":"…"}` | `changes-requested`, carrying `feedback` to the upstream stage |
   | `{"decision":"dismissed"}`, OR non-zero exit, OR absent/malformed stdout | `rejected` — surface the situation, return to caller |

### Contrast-safety and theme support for caller-built presentations

**Scope (spec 0099 R2, spec 0174 R6).** This guidance applies **only** when you
build a bespoke HTML presentation of the artifact before handing it to the
review viewer — for example because an active `pedagogy`, `translate`, or
`illustration` option obliges a richer rendering than the raw file. It does
**not** apply when you pass a raw Markdown or plain-text artifact file straight
through (spec 0099 R2/R8, spec 0174 R6): on that passthrough path the viewer's
own renderer owns readability, and you MUST NOT inject inline contrast styling.

**Why (spec 0099 R3, spec 0174).** The review viewer renders the document body
but does **not** reliably honor a `<head>`-scoped `<style>` block. Colors
declared only in `<head>` can surface as unreadable low-contrast content — such
as black-text-on-black-background in dark viewers. Furthermore, users work in
both light and dark desktop environments; presentations must adapt to their
system theme preference or honor explicit theme configuration in
`~/.crewrig/validation.conf` without sacrificing contrast.

**Rules for a caller-built HTML presentation:**

- **Discover the active theme (spec 0174 R1/R2).** Discover `theme` from
  `~/.crewrig/validation.conf` (`auto|system|dark|light`, default: `auto`).
- **Declare appropriate color-scheme metadata (spec 0174 R3, supersedes spec
  0099 R6).**
  - When `theme=auto` (or `system`), declare `<meta name="color-scheme" content="light dark">`.
  - When `theme=dark`, declare `<meta name="color-scheme" content="dark only">` (or `dark`).
  - When `theme=light`, declare `<meta name="color-scheme" content="light only">` (or `light`).
- **Inline or body-scope every readability-critical declaration (spec 0099 R4/R5, spec 0174 R4/R5).**
  Each color, background, and contrast declaration SHALL be self-contained
  inline on the content wrapper and `<body>`, or defined via body-scoped CSS
  custom properties inside `<body><style>`. Never place critical styles in
  `<head>`.
- **Adaptive styling for `auto` / `system` mode (spec 0174 R4).** Define CSS
  variables on `:root` within a `<body><style>` block with a `@media
  (prefers-color-scheme: dark)` override, ensuring WCAG AA contrast for text,
  backgrounds, cards, and diff excerpts across both light and dark modes.

**Compliant examples (spec 0174 R7):**

*1. Adaptive template (`theme=auto`, recommended default):*

```html
<!doctype html>
<html>
  <head>
    <meta name="color-scheme" content="light dark">
  </head>
  <body style="margin:0; padding:1.5rem; background:#ffffff; color:#111111;">
    <style>
      :root {
        --bg: #ffffff;
        --card-bg: #f6f8fa;
        --text: #111111;
        --border: #d0d7de;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0d1117;
          --card-bg: #161b22;
          --text: #e6edf3;
          --border: #30363d;
        }
      }
      body { background: var(--bg) !important; color: var(--text) !important; }
      .card { background: var(--card-bg); border: 1px solid var(--border); }
    </style>
    <main class="card" style="padding:1.5rem; border-radius:8px;">
      <h1>Decision title</h1>
      <p>Artifact content…</p>
    </main>
  </body>
</html>
```

*2. Explicit dark template (`theme=dark`):*

```html
<!doctype html>
<html>
  <head>
    <meta name="color-scheme" content="dark only">
  </head>
  <body style="margin:0; padding:1.5rem; background:#0d1117; color:#e6edf3;">
    <main style="background:#161b22; color:#e6edf3; border:1px solid #30363d; border-radius:8px; padding:1.5rem;">
      <h1 style="color:#e6edf3;">Decision title</h1>
      <p style="color:#e6edf3;">Artifact content…</p>
    </main>
  </body>
</html>
```

*3. Explicit light template (`theme=light`):*

```html
<!doctype html>
<html>
  <head>
    <meta name="color-scheme" content="light only">
  </head>
  <body style="margin:0; padding:1.5rem; background:#ffffff; color:#111111;">
    <main style="background:#f6f8fa; color:#111111; border:1px solid #d0d7de; border-radius:8px; padding:1.5rem;">
      <h1 style="color:#111111;">Decision title</h1>
      <p style="color:#111111;">Artifact content…</p>
    </main>
  </body>
</html>
```

### Substance-embedding for caller-built presentations

**Scope (spec 0104 R2).** This guidance applies **only** when you build a
bespoke presentation of the artifact before handing it to the review viewer —
for example because an active `pedagogy`, `translate`, or `illustration` option
obliges a richer rendering than the raw file. It does **not** apply on the raw-
passthrough path (see the *Raw passthrough* rule below): there the viewer's own
renderer already displays the full artifact.

**Why (spec 0104 R3/R4).** A caller-built presentation that only *describes* the
change — a title, a one-line summary, and the prior reviewer's verdict — leaves
the reviewing user unable to judge what is actually being decided. That is the
summary-only merge-authorization outcome observed during a live gate:
translation and professor-level pedagogy were active, yet the user never saw the
modified content itself. "Professor" framing means *showing the work*, not
narrating it.

**Rules for a caller-built presentation:**

- **Embed the real substance (spec 0104 R3, spec 0189 R2).** When
  `pedagogy=professor` and/or `translate=on`, the presentation SHALL embed the
  **concrete changed content itself** — a rendered diff excerpt, or the added or
  changed prose verbatim — alongside pedagogical context and decision implications,
  not only a prose summary describing what changed.
- **Show enough of a change set to judge it independently (spec 0104 R4).** For
  a decision over a change set or diff — a merge-authorization gate, for
  instance — show enough of the actual modified content for the reviewing user
  to judge the change **independently**, rather than relying solely on a prior
  REVIEW verdict.
- **Translate the embedded substance, presentation-only (spec 0104 R5, spec 0189 R3).** When
  `translate=on`, translate the embedded substance itself within the
  presentation, consistent with the `translate` boundary (see *Cross-cutting
  options → `translate`*): the translation is presentation-only and the
  repository artifact stays in English — never written back translated
  (`AGENTS.md` → *Language*).
- **Raw passthrough boundary (spec 0104 R6, spec 0189 R5).** When no translation,
  custom pedagogy levels (`pedagogy=simple`), or illustrations are configured,
  raw artifact passthrough to the validator remains supported without requiring
  a bespoke intermediate presentation document.

**Presentation-only (spec 0104 R7, spec 0189 R3).** This obligation does **not**
modify the invocation command, the dual-validation rule, the decision mapping,
or the defined semantics of the `translate` / `pedagogy` / `illustration`
cross-cutting options; it clarifies how a caller-built presentation applies them.

**Compliant vs thin example (spec 0104 R4).** A compliant merge-authorization
presentation embeds the real change; a thin one summarizes it away:

```text
Compliant — embeds the substance:
  Ask: "Authorize merge of PR #123?"
  Change under decision (added prose, verbatim):
    + The guidance SHALL direct showing enough of the actual modified
    + content for the reviewing user to judge the change independently.
  Prior REVIEW verdict: APPROVE — context, not a substitute for the diff.

Thin — non-compliant:
  Ask: "Authorize merge of PR #123?"
  Summary: "Adds substance-embedding guidance; reviewer approved."
  (no diff, no changed prose — the user cannot judge the change itself)
```

### `illustration` (spec 0080 R14, spec 0189 R4, spec 0189 delta-01 R6/R7)

Honoured **only when `backend=plannotator` AND a browser image surface is
available** — otherwise **silently ignored** (no error, no note). Because
Plannotator renders the artifact as HTML in a browser it launches itself, image
display is a function of browser availability, not of the driving CLI (uniform
across all four CLIs, not a per-CLI asymmetry — spec 0080 OQ4). When honoured,
generation is **best-effort** via the `nano-banana` skill; if it is unavailable
or fails, proceed with the gate without the illustration.

**Pedagogical value requirement (never decorative, spec 0189 delta-01 R6).**
Generated images or graphical assets in validation presentation documents SHALL
be reserved strictly for pedagogical benefit (such as explaining architectural
schemas, component boundaries, sequence flows, or decision trade-offs).
Generating purely decorative illustrations is prohibited as an unnecessary
expense and distraction.

**Inline SVG preference for diagrams (spec 0189 delta-01 R7).** When schematic
diagrams or structural visualizations are needed in a presentation document,
authors SHALL prefer self-contained inline SVG markup over AI-generated raster
images.

**Inline Base64 Data URI Requirement (spec 0189 R4).** When illustrations or
local image assets are referenced in an HTML presentation document passed to
`plannotator`, all image data SHALL be encoded and embedded as self-contained
inline base64 data URIs (`data:image/png;base64,...` or
`data:image/jpeg;base64,...`) rather than local file system path URIs
(`file://`). Modern web browser security sandboxes block loading `file://` URIs
from rendered pages, causing local images to fail to display unless inlined as
data URIs.
