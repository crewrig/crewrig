---
name: frontend
description: "Practitioner-grade reference knowledge for modern frontend development.
Covers HTML semantics, CSS custom properties and design tokens, Tailwind CSS,
WCAG 2.1 AA accessibility baseline, Core Web Vitals, asset optimization, and
framework-agnostic JavaScript baseline. Activate when authoring or reviewing
HTML, CSS, Tailwind configuration, accessibility audits, performance budgets,
or any UI implementation concern that is not tied to a specific framework."
license: Apache-2.0
compatibility: "No runtime prerequisites; this skill is documentation-only."
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "1.0.2"
---


# Frontend

Practitioner reference for modern, framework-agnostic frontend work.
Activate whenever the change touches HTML, CSS, design tokens, Tailwind
configuration, accessibility, asset delivery, or vanilla JavaScript
concerns that are not bound to a specific framework. Framework wiring
(Astro, React, Vue, Svelte) belongs to its dedicated specialist — this
skill stops at the platform boundary.

## When to activate

- Writing or reviewing HTML markup, including semantic structure and
  forms.
- Authoring CSS, design tokens, or Tailwind configuration.
- Running an accessibility audit against WCAG 2.1 AA.
- Diagnosing Core Web Vitals regressions (LCP, CLS, INP).
- Optimizing fonts, images, or script loading.
- Writing framework-agnostic JavaScript: observers, fetch, ES modules.

## HTML semantics

Semantics are the cheapest accessibility win and the foundation every
later layer depends on. Generic `<div>` soup forces you to bolt ARIA
back on; semantic elements come with the correct role, focus
behavior, and assistive-tech mapping for free.

### Document outline

Each page has exactly one `<h1>` — typically the hero title. Heading
levels descend without gaps (`h1 → h2 → h3`). Screen readers expose a
heading tree; gaps and duplicate `h1` tags break that navigation.

### Landmark roles

Wrap the page in landmark elements rather than `<div>`s. Each landmark
appears in the AT rotor and gives keyboard users a skip target.

```html
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header><nav aria-label="Primary">…</nav></header>
  <main id="main">
    <article>
      <h1>Page title</h1>
      <section aria-labelledby="features">
        <h2 id="features">Features</h2>
      </section>
    </article>
    <aside aria-label="Related">…</aside>
  </main>
  <footer>…</footer>
</body>
```

### Semantic element checklist

- `<button>` for in-page actions; `<a href>` for navigation.
- `<nav>` for navigation groups; label with `aria-label` when more than
  one exists on the page.
- `<main>` once per page; everything outside lives in `<header>`,
  `<aside>`, or `<footer>`.
- `<figure>` + `<figcaption>` for images that need attribution or a
  caption.
- `<time datetime="…">` for machine-readable dates.
- `<dl>` / `<dt>` / `<dd>` for definition lists and key/value pairs.

### Forms

- Every input has a `<label for>` (or wraps the input). Placeholders
  are not labels.
- Group related inputs in `<fieldset>` with a `<legend>`.
- Use the right `type` (`email`, `tel`, `url`, `number`, `date`) — it
  drives mobile keyboards, validation, and assistive announcements.
- Use `autocomplete` tokens (`name`, `email`, `current-password`,
  `one-time-code`) — password managers and AT depend on them.
- Surface validation errors with `aria-invalid="true"` and
  `aria-describedby` pointing to the error message.

## CSS

### Custom properties and design tokens

CSS custom properties are the runtime substrate for design tokens.
They cascade, can be themed at any DOM depth, and respond to media
queries — which `:root`-only Sass variables cannot.

```css
:root {
  --primitive-color-white:    #ffffff;
  --primitive-color-blue-400: #60a5fa;
  --primitive-color-blue-500: #3b82f6;
  --primitive-space-4: 1rem;

  --color-accent:    var(--primitive-color-blue-500);
  --color-on-accent: var(--primitive-color-white);
  --space-md: var(--primitive-space-4);
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-accent:    var(--primitive-color-blue-400);
    --color-on-accent: var(--primitive-color-white);
  }
}
```

### Container queries

Container queries let a component respond to its container, not the
viewport. Prefer them for reusable components that may live in
sidebars, modals, or full-width layouts.

```css
.card-host {
  container-type: inline-size;
  container-name: card;
}

@container card (min-width: 32rem) {
  .card {
    grid-template-columns: 1fr 2fr;
  }
}
```

### `@layer`

Cascade layers let you order origins explicitly and stop specificity
arms races. Declare the order once at the top of the entry stylesheet.

```css
@layer reset, tokens, base, components, utilities;

@layer components {
  .button { /* … */ }
}
```

Tailwind's `base`, `components`, `utilities` map onto this model.

### Logical properties

Use logical properties (`margin-inline`, `padding-block`,
`border-inline-start`, `inset-inline-end`) instead of physical
(`left` / `right`). They flip automatically under
`direction: rtl` and `writing-mode: vertical-rl`.

### Fluid typography with `clamp()`

```css
:root {
  --font-size-h1: clamp(2rem, 1.5rem + 2.5vw, 3.5rem);
}
```

`clamp(min, preferred, max)` removes most named breakpoints for
typography. Pair the preferred value with a viewport-relative term so
it scales between the bounds.

### Dark mode

Prefer `prefers-color-scheme` and token swaps over `.dark` class
toggling unless the product needs an explicit user override.

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-surface: #0b0f17;
    --color-text: #e6edf3;
  }
}
```

When a manual override is required, gate the swap on a
`data-theme="dark"` attribute on `<html>` and persist the choice in
`localStorage`.

## Design systems

### Token taxonomy

Three layers, in this order:

1. **Primitive** — raw values, no meaning. Prefix with
   `--primitive-color-*`, `--primitive-space-*`, `--primitive-font-*`.
   Never reference primitives directly from components.
2. **Semantic** — intent-bound aliases of primitives.
   `--color-accent`, `--color-surface`, `--space-md`,
   `--radius-card`. Components consume only this layer.
3. **Component** — local tokens scoped to a component.
   `--button-bg`, `--button-padding-inline`. Defined inside the
   component scope, defaulted from semantic tokens.

```css
.button {
  --button-bg: var(--color-accent);
  --button-fg: var(--color-on-accent);
  background: var(--button-bg);
  color: var(--button-fg);
}

.button[data-variant="ghost"] {
  --button-bg: transparent;
  --button-fg: var(--color-accent);
}
```

This taxonomy is what makes a design system theme-able. Swap
primitives to rebrand; swap semantics to retheme; swap component
tokens to vary a single component.

## Tailwind CSS

### Configuration extension

Tailwind's defaults are the floor, not the ceiling. Extend with
`theme.extend` so you keep the defaults and add tokens; replace
`theme.colors` only when you have a complete palette.

```js
// tailwind.config.js
export default {
  content: ['./src/**/*.{html,js,ts,astro,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: 'var(--color-accent)',
          fg: 'var(--color-on-accent)',
        },
      },
      spacing: {
        gutter: 'var(--space-md)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
};
```

Reference CSS custom properties from the config — that keeps Tailwind
utilities theme-aware without rebuilding.

### `@apply` vs utility-first

Default to utility-first in markup. Reach for `@apply` only when:

- The same utility cluster repeats in three or more places and the
  cluster names a real concept (`.button`, `.card`).
- A third-party component (CMS, email) cannot accept utilities.
- You need a selector that utilities cannot express
  (`:has`, `:nth-child`, complex `@container`).

`@apply` chains longer than ~8 utilities are a smell — extract a
component layer rule instead.

### JIT and content scanning

Tailwind v3+ runs JIT by default; the only knob that matters is
`content`. Misconfigured globs are the number-one cause of "my class
does not apply" reports.

- Include every file extension where class names can appear.
- Avoid dynamic class concatenation (`bg-${color}`) — JIT cannot see
  it. Use a safelist or a lookup map of full class names.

### Plugin authoring

Plugins are the right tool when you need utilities the core does not
ship (focus-visible variants, custom typography, design-system
shortcuts). Stay framework-agnostic — emit CSS, not JavaScript.

```js
import plugin from 'tailwindcss/plugin';

export default plugin(({ addUtilities, theme }) => {
  addUtilities({
    '.text-balance': { 'text-wrap': 'balance' },
    '.focus-ring': {
      'outline': '2px solid transparent',
      'outline-offset': '2px',
      '&:focus-visible': {
        'outline-color': theme('colors.accent.DEFAULT'),
      },
    },
  });
});
```

## Accessibility — WCAG 2.1 AA

WCAG 2.1 AA is the legal baseline in most jurisdictions and the
practical baseline everywhere else. Treat it as a floor, not a goal.

### Focus management

- Every interactive element has a visible `:focus-visible` style.
  Remove the default outline only if you replace it with something at
  least as legible.
- Focus order follows the visual order. `tabindex="0"` makes a
  non-interactive element focusable; never use positive `tabindex`
  values.
- After a route change or modal open, move focus to the new context
  (the modal title, the page heading).

### Skip links

Provide a skip link as the first focusable element. Style it visible
on focus so it is discoverable.

```css
.skip-link {
  position: absolute;
  inset-block-start: -100px;
  inset-inline-start: 0;
}

.skip-link:focus-visible {
  inset-block-start: 0;
}
```

### `aria-*` attributes

The first rule of ARIA is: do not use ARIA. Pick the right semantic
element first; reach for ARIA only when no element fits.

- `aria-label` / `aria-labelledby` — accessible name when the visible
  text is missing or ambiguous (icon-only buttons).
- `aria-describedby` — supplementary description (form hints, error
  messages).
- `aria-expanded` / `aria-controls` — disclosure widgets and menus.
- `aria-current="page"` — the active item in a navigation list.
- `aria-live="polite"` — status updates, toast regions.

Never set `role="button"` on a `<div>` when `<button>` would do.

### Color contrast ratios

| Content                                                    | Minimum |
|------------------------------------------------------------|---------|
| Normal text (under 18 pt, or under 14 pt bold)             | 4.5 : 1 |
| Large text (18 pt+, or 14 pt+ bold)                        | 3 : 1   |
| Non-text UI: icons, focus rings, form borders, separators  | 3 : 1   |
| Decorative / disabled UI                                   | Exempt  |

Verify with a contrast checker against the actual background, not the
nominal one — gradients and translucent layers shift the result.

### Touch targets

Interactive controls have a minimum hit area of **44×44 CSS pixels**
(WCAG 2.5.5 AAA, but practical baseline). When the visible target is
smaller, expand the hit area with padding or a transparent pseudo-
element — do not scale the visible glyph.

## Core Web Vitals

### Targets

| Metric                              | Good     | Needs improvement | Poor     |
|-------------------------------------|----------|-------------------|----------|
| **LCP** — Largest Contentful Paint  | ≤ 2.5 s  | ≤ 4.0 s           | > 4.0 s  |
| **CLS** — Cumulative Layout Shift   | ≤ 0.1    | ≤ 0.25            | > 0.25   |
| **INP** — Interaction to Next Paint | ≤ 200 ms | ≤ 500 ms          | > 500 ms |

INP replaced FID as a Core Web Vital in March 2024. It measures the
worst input latency across the page lifetime, not the first.

### Measurement

- **Lighthouse** in Chrome DevTools — synthetic lab data. Use it for
  before/after diffs.
- **`web-vitals`** library — real-user metrics emitted from the page.

```js
import { onLCP, onCLS, onINP } from 'web-vitals';

onLCP((m) => navigator.sendBeacon('/rum', JSON.stringify(m)));
onCLS((m) => navigator.sendBeacon('/rum', JSON.stringify(m)));
onINP((m) => navigator.sendBeacon('/rum', JSON.stringify(m)));
```

- **Chrome User Experience Report (CrUX)** — field data aggregated by
  Google. Use it for ground truth at a domain level.

### LCP levers

- Preload the LCP image with `<link rel="preload" as="image" fetchpriority="high">`.
- Set `fetchpriority="high"` on the LCP `<img>`.
- Inline critical CSS, defer the rest with `media="print"` + onload swap.
- Eliminate render-blocking third-party scripts above the fold.

### CLS levers

- Reserve space with explicit `width` and `height` attributes on
  `<img>` and `<iframe>`, or `aspect-ratio` in CSS.
- Load custom fonts with `font-display: swap` and a metric-matched
  fallback to keep layout stable during swap.
- Reserve space for ads, embeds, and skeleton states.

### INP levers

- Break long tasks (> 50 ms) with `scheduler.yield()` or
  `requestIdleCallback`.
- Defer non-critical hydration. Ship less JavaScript.
- Debounce input handlers; batch DOM reads and writes.

## Asset optimization

### Fonts

- Self-host critical fonts; third-party font services add a DNS lookup
  and a TCP handshake to the critical path.
- Subset to the glyphs you actually use (`pyftsubset`, `glyphhanger`).
- Serve WOFF2 only. Browsers without WOFF2 support are below relevance.
- Set `font-display: swap` (or `optional` for non-critical faces) to
  prevent invisible text during font load.
- Preload the one or two faces used above the fold:

```html
<link rel="preload" href="/fonts/Inter-Regular.woff2" as="font"
      type="font/woff2" crossorigin>
```

### Responsive images

```html
<img
  src="/img/hero-800.jpg"
  srcset="/img/hero-400.jpg 400w,
          /img/hero-800.jpg 800w,
          /img/hero-1600.jpg 1600w"
  sizes="(min-width: 64rem) 50vw, 100vw"
  width="1600" height="900"
  alt="Product dashboard showing weekly revenue"
  loading="lazy"
  decoding="async">
```

- Always set `width` / `height` to reserve layout space.
- `loading="lazy"` for below-the-fold images; never for the LCP image.
- Prefer AVIF, fall back to WebP, then JPEG via `<picture>`.

### Script loading

| Attribute            | Effect                                                      |
|----------------------|-------------------------------------------------------------|
| `<script>`           | Blocks parser. Avoid in `<head>`.                           |
| `<script defer>`     | Downloads in parallel, executes after parse, preserves order. |
| `<script async>`     | Downloads in parallel, executes ASAP, order undefined.      |
| `<script type="module">` | `defer` by default. Use for ES modules.                 |

Default to `defer` (or `type="module"`) unless the script genuinely
needs to run before parse completes — which it almost never does.

## JavaScript baseline

Framework-agnostic patterns. Assume an evergreen browser baseline.

### ES modules

```js
// src/components/disclosure.js
export function attach(root) {
  const trigger = root.querySelector('[data-disclosure-trigger]');
  const panel = root.querySelector('[data-disclosure-panel]');
  trigger.addEventListener('click', () => {
    const open = trigger.getAttribute('aria-expanded') === 'true';
    trigger.setAttribute('aria-expanded', String(!open));
    panel.hidden = open;
  });
}
```

Use native ESM (`<script type="module">`); no bundler is required for
small islands of interactivity.

### IntersectionObserver

Use for lazy reveals, infinite scroll, and view-tracking. Cheaper than
`scroll` listeners and runs off the main thread.

```js
const io = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      io.unobserve(entry.target);
    }
  }
}, { rootMargin: '0px 0px -10% 0px' });

document.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));
```

### ResizeObserver

Use for container-aware components when `@container` is not enough.

```js
const ro = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const { width } = entry.contentRect;
    entry.target.dataset.size = width > 600 ? 'lg' : 'sm';
  }
});
ro.observe(document.querySelector('.card-host'));
```

### Fetch and async patterns

```js
async function loadPosts(signal) {
  const res = await fetch('/api/posts', { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const controller = new AbortController();
loadPosts(controller.signal).catch((err) => {
  if (err.name !== 'AbortError') console.error(err);
});
// later, on navigation away:
controller.abort();
```

Always pass an `AbortSignal` to `fetch` so in-flight requests cancel
when the consumer unmounts. Unhandled aborts pollute INP and leak
memory in long-lived SPAs.

## Quick checklist

```text
☐ One <h1>, no heading gaps, landmarks in place
☐ Labels on every input, autocomplete tokens set
☐ Focus visible, skip link, focus order matches visual order
☐ Contrast ≥ 4.5:1 normal text, ≥ 3:1 large/UI
☐ Touch targets ≥ 44×44 CSS px
☐ Tokens follow primitive → semantic → component
☐ Tailwind content globs cover all class-bearing files
☐ LCP image preloaded, width/height set, fetchpriority=high
☐ Fonts: WOFF2, subset, font-display: swap, preloaded
☐ Scripts: defer by default, async only when independent
☐ web-vitals reporting LCP, CLS, INP from the field
```
