---
name: frontend
description: "Practitioner reference for framework-agnostic frontend work: semantic HTML, CSS design tokens, Tailwind configuration, WCAG 2.1 AA accessibility, Core Web Vitals, asset loading and vanilla JavaScript, with bundled scripts that compute a WCAG contrast ratio and check static HTML for alt text, form labels, heading order, landmarks and lang. Use when authoring or reviewing HTML, CSS or a Tailwind config, running an accessibility audit, checking color contrast, fixing LCP, CLS or INP, or tuning fonts, images and script loading. Trigger terms: HTML, CSS, Tailwind, design tokens, WCAG, contrast ratio, alt text, Core Web Vitals, LCP, INP. Not for Astro pages or builds (astro), marketing copy (copywriting), browser end-to-end tests (web-tester) or GitHub Actions workflows (github-actions)."
type: skill
license: Apache-2.0
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "2.0.0"
compatibility: "Requires Node.js 24 to run the scripts (node scripts/<name>.ts); the references need nothing. The scripts read local files only and make no network call."
claude:
  allowed-tools:
    - Read
    - Bash
    - Write
    - Edit
  user-invocable: true
---

# Frontend

Framework-agnostic rules for HTML, CSS, accessibility and delivery performance.
The model knows the syntax; this skill holds the decisions it gets wrong and two
checks that settle fixed questions. Framework wiring (Astro, React, Vue, Svelte)
belongs to its own specialist: stop at the platform boundary.

## Where the detail lives

Read only the reference the task needs.

| Task | Reference |
|---|---|
| Semantic HTML, forms, landmarks, focus, ARIA, contrast, touch targets | `references/accessibility.md` |
| Core Web Vitals, fonts, responsive images, script loading | `references/performance.md` |
| Design tokens, token taxonomy, Tailwind config, `@apply`, plugins, modern CSS, dark mode | `references/tailwind.md` |
| ES modules, observers, `fetch` with `AbortSignal` | `references/javascript.md` |

## Scripts

Run them from this skill's directory. They need only Node.js 24, read local
files, and write nothing.

| Script | When | Exit codes |
|---|---|---|
| `node scripts/check-html-a11y.ts <file or ->` | After writing or changing markup, and at the start of an accessibility audit. `-` reads standard input. | `0` no error finding (warnings allowed), `1` an error finding, `2` usage error, `3` unreadable input. |
| `node scripts/check-contrast.ts <fg> <bg> [--large] [--level AA\|AAA]` | For every text or UI color pair you choose or review. Colors are hex or `rgb()`. | `0` the pair meets the threshold, `1` it does not, `2` usage error or an unparseable color. |

Add `--json` for one `{ok, data, findings}` object on standard output.

- `check-html-a11y.ts` reads static markup only. It cannot see what scripts add
  later, and it does not test keyboard use or contrast, so exit `0` is
  necessary, not sufficient. Say which checks you did not run.
- A fragment (no `<html>` element) skips the page-level rules for `lang`, `main`
  and `h1`.
- `check-contrast.ts` checks normal text at 4.5:1 for AA unless you pass
  `--large` (text from 18 pt, or 14 pt bold) or `--level AAA`. Use `--large`
  for icons, focus rings and form borders, which need 3:1.
- Exit `2` or `3` means the call or the input is wrong, not the page: fix the
  command first.

## Quick checklist

```text
[ ] One <h1>, no heading gaps, landmarks in place
[ ] Labels on every input, autocomplete tokens set
[ ] Every <img> has alt (alt="" when decorative)
[ ] Focus visible, skip link, focus order matches visual order
[ ] Contrast >= 4.5:1 normal text, >= 3:1 large text and UI
[ ] Touch targets >= 44x44 CSS px
[ ] Tokens follow primitive -> semantic -> component
[ ] Tailwind content globs cover all class-bearing files
[ ] LCP image preloaded, width/height set, fetchpriority=high
[ ] Fonts: WOFF2, subset, font-display: swap, preloaded
[ ] Scripts: defer by default, async only when independent
[ ] web-vitals reporting LCP, CLS, INP from the field
```

## Decision rules

- Pick the semantic element before ARIA: a `<button>` brings role, focus and
  keyboard handling that `role="button"` on a `<div>` does not.
- Components consume semantic tokens, never primitives, so a rebrand touches
  one layer. Details in `references/tailwind.md` under *Token taxonomy*.
- Prefer utility classes; use `@apply` only for a repeated, named concept.
- Prefer `prefers-color-scheme` token swaps over a `.dark` class unless the
  product needs a user override.
- Never lazy-load the LCP image, and never use `async` for a script that
  depends on another.
- Reserve space (`width` and `height`, or `aspect-ratio`) for every image,
  iframe and embed to protect CLS.
- Hand a change that touches authentication, user input handling or secrets to
  the **security** skill.

## Friction reporting

When something in this workflow misleads or blocks you, tag it with the
`harness-report` skill.
