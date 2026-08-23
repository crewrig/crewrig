---
id: "0174"
slug: validation-gate-theme-support
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1000
version: 1.0.0
---

# Support System and Configurable Themes for User-Validate Gate Presentations

## Intent

When a validation gate runs through the `plannotator` backend with options requiring a bespoke HTML presentation (such as `pedagogy=professor`, `translate=on`, or `illustration=on`), the reviewing user expects the presentation to respect their desktop theme preferences (dark or light mode) while remaining contrast-safe and legible. Previously, Spec 0099 mandated explicit light-only inline styling (`<meta name="color-scheme" content="light only">`) to avoid unstyled black-on-black text bugs in dark host viewers. This specification introduces support for system theme preference (`prefers-color-scheme`) and user-configurable theme overrides (`theme=auto|dark|light`) in `~/.crewrig/validation.conf`, while ensuring all generated styling remains body-scoped and contrast-safe.

## Requirements

1. **Configurable Theme Setting:** `~/.crewrig/validation.conf` SHALL support an optional `theme` key with accepted values `auto` (or `system`), `dark`, and `light`. If the key is absent or empty, `theme=auto` SHALL be the default.
2. **Runtime Discovery:** The `user-validate` skill SHALL discover the active `theme` setting from `~/.crewrig/validation.conf` at runtime alongside `backend`, `translate`, `pedagogy`, and `illustration`.
3. **Color-Scheme Metadata:** When building a bespoke HTML presentation:
   - When `theme=auto` (or `theme=system`), the document SHALL declare `<meta name="color-scheme" content="light dark">`.
   - When `theme=dark`, the document SHALL declare `<meta name="color-scheme" content="dark only">` (or `dark`).
   - When `theme=light`, the document SHALL declare `<meta name="color-scheme" content="light only">` (or `light`).
4. **Contrast Safety & Adaptive Styling:**
   - In `auto` / `system` mode, presentations SHALL use CSS custom properties (variables) defined within a `<body>`-scoped `<style>` block with a `@media (prefers-color-scheme: dark)` block, ensuring that background, text, card surfaces, borders, and diff excerpts maintain a minimum contrast ratio conforming to WCAG AA across both light and dark themes.
   - In explicit `dark` mode, presentations SHALL inline dark theme background (e.g. `#0d1117` / `#1e1e1e`), text (e.g. `#e6edf3` / `#f0f0f0`), and border styling directly on `<body>` and content wrappers.
   - In explicit `light` mode, presentations SHALL inline light theme background (`#ffffff`), text (`#111111`), and border styling directly on `<body>` and content wrappers.
5. **Body-Scoped Stylesheets:** All `<style>` blocks defining CSS variables, classes, or `@media` queries SHALL live inside `<body>` (never in `<head>`), preserving compatibility with review viewer environments that discard or do not parse the document `<head>`.
6. **Raw Passthrough Exemption:** The theme injection requirements SHALL NOT apply when passing raw Markdown or plain-text artifact files directly to the review viewer, as the viewer's native renderer is responsible for displaying raw Markdown according to its internal theme.
7. **Rule and Skill Documentation:** `artifacts/core/rules/60-tools.md` and `artifacts/library/skills/user-validate/SKILL.md` SHALL be updated to document the `theme` option in `validation.conf`, explain the resolution mechanism, and provide compliant HTML template examples for adaptive (`auto`), explicit `dark`, and explicit `light` presentations.
8. **Supersession of Light-Only Constraint:** This specification supersedes Requirement 6 of Spec 0099 by allowing adaptive (`light dark`) and explicit dark color scheme hints, while maintaining the requirement that all critical contrast declarations remain body-scoped and legible.

## Scenarios

**Scenario:** User with system dark mode views an adaptive auto presentation

```text
Given `~/.crewrig/validation.conf` has `theme=auto` (or no `theme` key)
And   a validation gate builds a bespoke HTML presentation for Plannotator
When  the user opens the presentation on a desktop configured with dark mode
Then  the presentation renders with a dark background and high-contrast text
And   all headings, prose, cards, and diff excerpts are legible and contrast-safe
```

**Scenario:** User overrides theme to explicit dark mode in validation.conf

```text
Given `~/.crewrig/validation.conf` contains `theme=dark`
When  a validation gate generates a bespoke HTML presentation
Then  the presentation declares `<meta name="color-scheme" content="dark only">`
And   the presentation inlines dark mode background and text colors on `<body>` and wrapper elements
And   the presentation displays in dark mode regardless of the host system's light/dark setting
```

**Scenario:** User overrides theme to explicit light mode in validation.conf

```text
Given `~/.crewrig/validation.conf` contains `theme=light`
When  a validation gate generates a bespoke HTML presentation
Then  the presentation declares `<meta name="color-scheme" content="light only">`
And   the presentation inlines light mode background and text colors on `<body>` and wrapper elements
```

**Scenario:** Raw Markdown file passed to Plannotator

```text
Given a validation gate passing a raw Markdown artifact file directly to Plannotator
When  the gate executes `plannotator annotate <file> --gate --json`
Then  no HTML wrapping or theme style injection is performed
And   the viewer renders the Markdown using its built-in styling
```

## Out of scope

- Modifying the upstream `plannotator` binary or its internal UI stylesheets.
- Custom custom-theme CSS authoring tools or runtime CSS injection engines beyond static template structures.

## Open questions

None.
