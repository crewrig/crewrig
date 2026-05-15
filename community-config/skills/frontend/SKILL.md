---
name: frontend
description: |
  Practitioner-grade reference knowledge for modern frontend development.
  Covers HTML semantics, CSS custom properties and design tokens, Tailwind CSS,
  WCAG 2.1 AA accessibility baseline, Core Web Vitals, asset optimisation, and
  framework-agnostic JavaScript baseline. Activate when authoring or reviewing
  HTML, CSS, Tailwind configuration, accessibility audits, performance budgets,
  or any UI implementation concern that is not tied to a specific framework.
type: skill
license: Apache-2.0
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${FEEDBACK_REPO}"
    version: "1.0.0"
compatibility: "No runtime prerequisites; this skill is documentation-only."
claude:
  allowed-tools:
    - Read
    - Bash
    - Write
    - Edit
  user-invocable: true
---

# Frontend

A dense, practitioner-oriented skill for modern frontend work. Read the
relevant section before producing HTML, CSS, or JavaScript output. The
**Accessibility** and **Core Web Vitals** sections are non-negotiable; treat
every deviation as requiring an explicit ADR.

## When to activate

Activate this skill when any of the following is true:

- HTML markup is being authored or reviewed.
- CSS files, `<style>` blocks, or Tailwind configuration are being modified.
- A `tokens.css` or design-token file is being created or updated.
- An accessibility audit is required (WCAG 2.1 AA compliance).
- A Core Web Vitals budget is being set or a performance regression is
  being investigated.
- Asset bundles (images, fonts, scripts) are being optimised.
- Framework-agnostic JavaScript (event handling, DOM manipulation, fetch,
  Web APIs) is being written or reviewed.

Defer to **designer** for upstream decisions about colour palette, typographic
scale, and spacing scale. Defer to **architect** when a change restructures the
component model or the build pipeline. Defer to **security** when a change
touches Content Security Policy, `innerHTML`, or third-party script loading.

## HTML semantics

Well-structured HTML is the foundation of accessibility and SEO.

### Document structure

Every page must have exactly one `<h1>`, a `<main>` landmark, and a
`<nav>` landmark if site navigation is present. Use `<header>`, `<footer>`,
`<aside>`, and `<section>` as landmark roles; accompany each `<section>` with
a heading or an `aria-label`.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Page title — Site name</title>
  </head>
  <body>
    <header>…</header>
    <nav aria-label="Primary">…</nav>
    <main>
      <h1>Page title</h1>
      …
    </main>
    <footer>…</footer>
  </body>
</html>
```

### Semantic element checklist

| Use case | Correct element | Common mistake |
|---|---|---|
| Standalone article/post | `<article>` | `<div class="post">` |
| Supplementary content | `<aside>` | `<div class="sidebar">` |
| Navigation group | `<nav>` | `<div class="menu">` |
| Figure with caption | `<figure>` + `<figcaption>` | `<img>` + `<p>` |
| Action button | `<button>` | `<div onclick>` |
| External link | `<a href>` | `<span onclick>` |
| Data table | `<table>` + `<th scope>` | `<div>` grid |
| Form field label | `<label for>` | Placeholder-only |
| Progress indicator | `<progress>` | `<div>` width animation |

### Forms

- Every `<input>`, `<select>`, and `<textarea>` must have a programmatically
  associated `<label>` (via `for`/`id` or wrapping).
- Group related fields with `<fieldset>` and `<legend>`.
- Mark required fields with `required` and `aria-required="true"`.
- Surface validation errors via `aria-describedby` pointing to an error
  element, not only colour.

## CSS custom properties and design tokens

### Token naming convention

Design tokens live in CSS custom properties on `:root`. Use a three-level
hierarchy: **category** → **variant** → **modifier**.

```css
:root {
  /* Primitive tokens — raw values, not consumed directly by components */
  --primitive-color-blue-500: #3b82f6;
  --primitive-color-blue-600: #2563eb;

  /* Semantic tokens — meaning, consumed by components */
  --color-action-primary:        var(--primitive-color-blue-500);
  --color-action-primary-hover:  var(--primitive-color-blue-600);

  /* Component tokens — optional, scoped to a specific component */
  --button-bg:       var(--color-action-primary);
  --button-bg-hover: var(--color-action-primary-hover);
}
```

Never skip levels: a component must not consume a primitive token directly
unless the token IS the semantic token. This preserves the ability to retheme
without touching component code.

### Responsive custom properties

Use `@media` or `@layer` to evolve tokens at breakpoints rather than
duplicating rules inside components:

```css
:root {
  --spacing-section: 2rem;
}
@media (min-width: 64rem) {
  :root {
    --spacing-section: 4rem;
  }
}
```

### Dark mode

Prefer `prefers-color-scheme` at the `:root` level via token overrides
rather than per-component `@media` blocks:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-action-primary: var(--color-blue-400);
  }
}
```

## Tailwind CSS

### Configuration extension pattern

Never override Tailwind defaults; always extend them via `theme.extend`.
Design tokens from `tokens.css` should map to Tailwind utilities through
`tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'action-primary': 'var(--color-action-primary)',
        'action-primary-hover': 'var(--color-action-primary-hover)',
      },
      spacing: {
        section: 'var(--spacing-section)',
      },
      fontFamily: {
        sans: ['var(--font-family-sans)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
```

### Utility ordering convention

Follow the Prettier Tailwind plugin ordering: layout → flexbox/grid →
spacing → sizing → typography → visual → interaction → responsive/state
prefixes. Enforce with `prettier-plugin-tailwindcss`.

### Arbitrary values

Use `[value]` syntax sparingly and only for values that cannot be expressed
as a design token (e.g., one-off magic numbers in a legacy layout). Every
arbitrary value is a design debt signal; file an issue to promote it to a
token.

### Component variants with `cva` or `@apply`

For reusable multi-variant components, prefer a class-variance-authority
(`cva`) pattern over a long `@apply` chain. `@apply` is acceptable for
small, stable, single-purpose utilities.

## WCAG 2.1 AA baseline

The following are non-negotiable for every shipped UI:

### Colour contrast

| Context | Minimum ratio |
|---|---|
| Normal text (< 18 pt / < 14 pt bold) | 4.5 : 1 |
| Large text (>= 18 pt / >= 14 pt bold) | 3 : 1 |
| UI components and graphical objects | 3 : 1 |
| Disabled state | Exempt |

Verify with automated tooling (axe, Lighthouse) AND manual inspection — tools
miss some failures and flag some false positives.

### Keyboard navigation

- All interactive elements are reachable by `Tab`; logical focus order
  follows reading order.
- Focus indicator is visible at all times; never `outline: none` without
  a custom focus style.
- Modals trap focus while open and return focus to the trigger on close.
- Carousels, date pickers, and custom widgets implement the ARIA Authoring
  Practices Guide (APG) keyboard pattern for their role.

### Screen reader support

- Images have descriptive `alt` text; decorative images use `alt=""`.
- Icon-only buttons have `aria-label` or a visually hidden label.
- Dynamic content updates are announced via `aria-live` regions
  (`polite` for non-urgent, `assertive` for errors).
- Use `role`, `aria-expanded`, `aria-controls`, `aria-selected` only
  when the native HTML element does not convey the semantics.

### Touch targets

Minimum tap target size: 24 x 24 CSS px (WCAG 2.5.8, AA for 2.2).
Recommended: 44 x 44 CSS px (Apple HIG / Material).

### Motion

Respect `prefers-reduced-motion`. Wrap every non-essential animation in:

```css
@media (prefers-reduced-motion: no-preference) {
  .animated { transition: transform 0.2s ease; }
}
```

## Core Web Vitals

### Targets (as of 2025 thresholds)

| Metric | Good | Needs improvement | Poor |
|---|---|---|---|
| LCP (Largest Contentful Paint) | <= 2.5 s | 2.5 – 4 s | > 4 s |
| INP (Interaction to Next Paint) | <= 200 ms | 200 – 500 ms | > 500 ms |
| CLS (Cumulative Layout Shift) | <= 0.1 | 0.1 – 0.25 | > 0.25 |

### LCP

- Set `fetchpriority="high"` on the above-the-fold hero image.
- Preload critical fonts: `<link rel="preload" as="font" crossorigin>`.
- Serve images via a CDN with format negotiation (AVIF -> WebP -> JPEG).
- Avoid render-blocking CSS; inline critical path, lazy-load the rest.

### INP

- Keep long tasks under 50 ms. Break up large JavaScript work with
  `scheduler.yield()` or `setTimeout(fn, 0)`.
- Avoid layout thrash: batch DOM reads before writes.
- Debounce resize/scroll handlers.

### CLS

- Always specify `width` and `height` on `<img>` elements so the browser
  can reserve space before the image loads.
- Use `aspect-ratio` for responsive embeds.
- Avoid inserting content above existing content on user interaction.
- Font `size-adjust` or `font-display: optional` to prevent layout shift
  from web font swap.

## Asset optimisation

### Images

- Format hierarchy: AVIF > WebP > JPEG for photos; SVG for icons and
  illustrations; PNG only when transparency is required and AVIF/WebP
  are unavailable.
- Always provide `<img srcset>` and `sizes` for responsive images.
- Lazy-load below-fold images: `loading="lazy"`.
- Use `decoding="async"` on non-critical images.

### Fonts

- Subset fonts to the character sets in use (`pyftsubset` / Fontsquirrel
  generator).
- Host fonts locally or use `font-display: swap` with a fallback stack
  that prevents invisible text (FOIT).
- Limit web font families to two; every additional family is a budget hit.

### Scripts

- Ship ES2020+ modules; let the bundler transpile only for the actual
  supported browser baseline.
- Code-split at route boundaries; lazy-import heavy libraries.
- Set `defer` or `type="module"` on every `<script>` tag to prevent
  render blocking.

### Build pipeline expectations

| Asset | Target size | Tooling |
|---|---|---|
| Critical CSS | < 14 KB (gzipped) | PurgeCSS, Lightning CSS |
| Hero image | < 200 KB | Squoosh, sharp |
| First JS chunk | < 100 KB (gzipped) | Rollup, esbuild, Vite |
| Web fonts per family | < 50 KB per weight | pyftsubset |

## JavaScript baseline (framework-agnostic)

### Fetch and async patterns

```js
// Prefer async/await over raw Promise chains.
async function fetchUser(id) {
  const res = await fetch(`/api/users/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
```

- Never swallow errors silently. Surface them to the UI via an `aria-live`
  error region.
- Abort long-running fetches with `AbortController` on component teardown.

### DOM manipulation

- Prefer `element.textContent` over `innerHTML` when inserting untrusted
  content — `innerHTML` is an XSS vector.
- Batch reads (`getBoundingClientRect`, `offsetHeight`) before writes
  (`style.transform`, `classList.add`) to avoid layout thrash.

### Event handling

- Delegate events to a stable ancestor when binding to many dynamic
  children.
- Use `{ passive: true }` on `scroll` and `touchstart` listeners unless
  `preventDefault()` is required — improves scroll performance.
- Remove event listeners on teardown (use `AbortSignal` in modern code).

### Browser support baseline

Target the last two major versions of Chrome, Firefox, Safari, and Edge.
Use `@supports` for progressive enhancement. Do not polyfill features
that degrade gracefully.

## Quick recipes

### Responsive image with AVIF/WebP fallback

```html
<picture>
  <source type="image/avif" srcset="hero.avif 1x, hero@2x.avif 2x" />
  <source type="image/webp" srcset="hero.webp 1x, hero@2x.webp 2x" />
  <img
    src="hero.jpg"
    srcset="hero.jpg 1x, hero@2x.jpg 2x"
    alt="Descriptive alt text"
    width="800"
    height="450"
    fetchpriority="high"
    decoding="async"
  />
</picture>
```

### Accessible icon button

```html
<button type="button" aria-label="Close dialog" class="icon-btn">
  <svg aria-hidden="true" focusable="false" width="24" height="24">
    <use href="#icon-close" />
  </svg>
</button>
```

### Focus-visible custom style

```css
/* Remove default outline everywhere; restore it for keyboard users */
:focus { outline: none; }
:focus-visible {
  outline: 2px solid var(--color-action-primary);
  outline-offset: 2px;
}
```

### Reduced-motion safe animation

```css
.card {
  /* Instant by default — safe for vestibular disorders */
}
@media (prefers-reduced-motion: no-preference) {
  .card {
    transition: box-shadow 0.15s ease, transform 0.15s ease;
  }
  .card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-lg);
  }
}
```

When in doubt, consult the WCAG 2.1 specification, the ARIA APG, or the
Web.dev Core Web Vitals documentation before writing final output. This
skill is the working surface; authoritative specifications take
precedence.
