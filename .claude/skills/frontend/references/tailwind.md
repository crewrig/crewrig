# CSS, design tokens and Tailwind

## Contents

- [Design tokens](#design-tokens)
- [Token taxonomy](#token-taxonomy)
- [Tailwind configuration](#tailwind-configuration)
- [Apply versus utility-first](#apply-versus-utility-first)
- [Content scanning](#content-scanning)
- [Tailwind plugins](#tailwind-plugins)
- [Container queries](#container-queries)
- [Cascade layers](#cascade-layers)
- [Logical properties](#logical-properties)
- [Fluid typography](#fluid-typography)
- [Dark mode](#dark-mode)

## Design tokens

CSS custom properties are the runtime substrate for design tokens.
They cascade, can be themed at any DOM depth, and respond to media
queries, which `:root`-only Sass variables cannot.

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

## Token taxonomy

Three layers, in this order:

1. **Primitive**: raw values, no meaning. Prefix with
   `--primitive-color-*`, `--primitive-space-*`, `--primitive-font-*`.
   Never reference primitives directly from components.
2. **Semantic**: intent-bound aliases of primitives.
   `--color-accent`, `--color-surface`, `--space-md`,
   `--radius-card`. Components consume only this layer.
3. **Component**: local tokens scoped to a component.
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
tokens to vary a single component. Check every semantic foreground and
background pair with `scripts/check-contrast.ts` before it ships.

## Tailwind configuration

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

Reference CSS custom properties from the config: that keeps Tailwind
utilities theme-aware without rebuilding.

## Apply versus utility-first

Default to utility-first in markup. Reach for `@apply` only when:

- The same utility cluster repeats in three or more places and the
  cluster names a real concept (`.button`, `.card`).
- A third-party component (CMS, email) cannot accept utilities.
- You need a selector that utilities cannot express
  (`:has`, `:nth-child`, complex `@container`).

`@apply` chains longer than about 8 utilities are a smell: extract a
component layer rule instead.

## Content scanning

Tailwind v3+ runs JIT by default; the only knob that matters is
`content`. Misconfigured globs are the number-one cause of "my class
does not apply" reports.

- Include every file extension where class names can appear.
- Avoid dynamic class concatenation (`bg-${color}`): JIT cannot see
  it. Use a safelist or a lookup map of full class names.

## Tailwind plugins

Plugins are the right tool when you need utilities the core does not
ship (focus-visible variants, custom typography, design-system
shortcuts). Stay framework-agnostic: emit CSS, not JavaScript.

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

## Container queries

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

## Cascade layers

Cascade layers let you order origins explicitly and stop specificity
arms races. Declare the order once at the top of the entry stylesheet.

```css
@layer reset, tokens, base, components, utilities;

@layer components {
  .button { /* … */ }
}
```

Tailwind's `base`, `components`, `utilities` map onto this model.

## Logical properties

Use logical properties (`margin-inline`, `padding-block`,
`border-inline-start`, `inset-inline-end`) instead of physical
(`left` / `right`). They flip automatically under
`direction: rtl` and `writing-mode: vertical-rl`.

## Fluid typography

```css
:root {
  --font-size-h1: clamp(2rem, 1.5rem + 2.5vw, 3.5rem);
}
```

`clamp(min, preferred, max)` removes most named breakpoints for
typography. Pair the preferred value with a viewport-relative term so
it scales between the bounds.

## Dark mode

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
