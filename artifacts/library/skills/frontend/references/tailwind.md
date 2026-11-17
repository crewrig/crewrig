# CSS, design tokens and Tailwind

## Contents

- [Design tokens](#design-tokens)
- [Token taxonomy](#token-taxonomy)
- [Color palette and contrast](#color-palette-and-contrast)
- [Typographic scale](#typographic-scale)
- [Spacing scale](#spacing-scale)
- [Shadow scale](#shadow-scale)
- [Border-radius scale](#border-radius-scale)
- [Tailwind configuration](#tailwind-configuration)
- [Mapping semantic tokens into Tailwind](#mapping-semantic-tokens-into-tailwind)
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
/* tokens.css: primitives */
:root {
  --primitive-color-white:     #ffffff;
  --primitive-color-blue-400:  #60a5fa;
  --primitive-color-blue-500:  #3b82f6;
  --primitive-color-blue-600:  #2563eb;
  --primitive-color-blue-700:  #1d4ed8;

  --primitive-color-slate-50:  #f8fafc;
  --primitive-color-slate-900: #0f172a;

  --primitive-space-1:  0.25rem;
  --primitive-space-2:  0.5rem;
  --primitive-space-3:  0.75rem;
  --primitive-space-4:  1rem;
  --primitive-space-6:  1.5rem;
  --primitive-space-8:  2rem;
  --primitive-space-12: 3rem;
  --primitive-space-16: 4rem;
}

/* tokens.css: semantic (light) */
:root {
  --color-accent:        var(--primitive-color-blue-600);
  --color-accent-hover:  var(--primitive-color-blue-700);
  --color-accent-soft:   var(--primitive-color-blue-400);
  --color-on-accent:     var(--primitive-color-white);
  --color-surface:       var(--primitive-color-slate-50);
  --color-text:          var(--primitive-color-slate-900);

  --space-xs: var(--primitive-space-1);
  --space-sm: var(--primitive-space-2);
  --space-md: var(--primitive-space-4);
  --space-lg: var(--primitive-space-8);
  --space-xl: var(--primitive-space-16);
}

/* tokens.css: semantic (dark override) */
@media (prefers-color-scheme: dark) {
  :root {
    --color-accent:       var(--primitive-color-blue-500);
    --color-accent-hover: var(--primitive-color-blue-400);
    --color-surface:      var(--primitive-color-slate-900);
    --color-text:         var(--primitive-color-slate-50);
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

## Color palette and contrast

Required primitive blues for the accent ramp:

| Token                        | Hex       | Typical use                     |
|------------------------------|-----------|---------------------------------|
| `--primitive-color-blue-400` | `#60a5fa` | Accent on dark surfaces         |
| `--primitive-color-blue-500` | `#3b82f6` | Hover, secondary accent         |
| `--primitive-color-blue-600` | `#2563eb` | Primary accent (light surfaces) |
| `--primitive-color-blue-700` | `#1d4ed8` | Pressed, focus ring on light    |

Extend with neutral, success, warning, danger and info ramps as the
scope requires. Each ramp is a primitive: never reference these hexes
from components.

Every semantic color pair MUST meet WCAG 2.1 AA contrast:

- **Normal text**: at least 4.5:1 against its background.
- **Large text** (18 pt or more, or 14 pt or more in bold) and **UI
  components** (icons, focus rings, form borders): at least 3:1.

Document the verified ratio next to each text and background pairing
in the design rationale. A pair that passes at one weight but fails at
another is not acceptable: use the worse case.

## Typographic scale

Use a modular scale and document the **base size** and the **ratio**.
Default: base `1rem` (16 px), ratio `1.25` (major third).

| Token         | Size (rem) | Px @16 | Line-height | Typical use    |
|---------------|------------|--------|-------------|----------------|
| `--text-xs`   | 0.75       | 12     | 1.4         | Captions, meta |
| `--text-sm`   | 0.875      | 14     | 1.5         | Secondary body |
| `--text-base` | 1          | 16     | 1.5         | Body           |
| `--text-lg`   | 1.125      | 18     | 1.5         | Lead           |
| `--text-xl`   | 1.25       | 20     | 1.4         | H4             |
| `--text-2xl`  | 1.5        | 24     | 1.3         | H3             |
| `--text-3xl`  | 1.875      | 30     | 1.25        | H2             |
| `--text-4xl`  | 2.25       | 36     | 1.2         | H1, hero       |

For fluid hero typography, see [Fluid typography](#fluid-typography).

## Spacing scale

Choose **base-4** (4 px rhythm) or **base-8** (8 px rhythm) and keep
it. Base-4 suits dense interfaces; base-8 suits marketing and consumer
surfaces. Mixing the two breaks the visual rhythm.

| Token        | rem  | Px @16 |
|--------------|------|--------|
| `--space-xs` | 0.25 | 4      |
| `--space-sm` | 0.5  | 8      |
| `--space-md` | 1    | 16     |
| `--space-lg` | 2    | 32     |
| `--space-xl` | 4    | 64     |

## Shadow scale

Five steps, neutral hue, never pure black:

```css
:root {
  --shadow-xs: 0 1px 2px 0 rgb(15 23 42 / 0.05);
  --shadow-sm: 0 1px 3px 0 rgb(15 23 42 / 0.10),
               0 1px 2px -1px rgb(15 23 42 / 0.06);
  --shadow-md: 0 4px 6px -1px rgb(15 23 42 / 0.10),
               0 2px 4px -2px rgb(15 23 42 / 0.06);
  --shadow-lg: 0 10px 15px -3px rgb(15 23 42 / 0.10),
               0 4px 6px -4px rgb(15 23 42 / 0.05);
  --shadow-xl: 0 20px 25px -5px rgb(15 23 42 / 0.10),
               0 8px 10px -6px rgb(15 23 42 / 0.04);
}
```

## Border-radius scale

```css
:root {
  --radius-sm:   0.25rem;  /*  4 px: chips, badges */
  --radius-md:   0.5rem;   /*  8 px: inputs, buttons */
  --radius-lg:   0.75rem;  /* 12 px: cards */
  --radius-xl:   1rem;     /* 16 px: modals */
  --radius-full: 9999px;   /* pills, avatars */
}
```

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

## Mapping semantic tokens into Tailwind

Tailwind extends; it does not replace. Map **semantic** tokens into
`theme.extend`, and never expose primitive token names through
utilities: that defeats the abstraction.

```js
// tailwind.config.js
export default {
  content: ['./src/**/*.{html,js,ts,astro,jsx,tsx,md,mdx}'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: 'var(--color-accent)',
          hover:   'var(--color-accent-hover)',
          soft:    'var(--color-accent-soft)',
        },
        surface: 'var(--color-surface)',
        text:    'var(--color-text)',
      },
      spacing: {
        xs: 'var(--space-xs)',
        sm: 'var(--space-sm)',
        md: 'var(--space-md)',
        lg: 'var(--space-lg)',
        xl: 'var(--space-xl)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
      },
      fontSize: {
        xs:   ['var(--text-xs)',   { lineHeight: '1.4'  }],
        sm:   ['var(--text-sm)',   { lineHeight: '1.5'  }],
        base: ['var(--text-base)', { lineHeight: '1.5'  }],
        lg:   ['var(--text-lg)',   { lineHeight: '1.5'  }],
        xl:   ['var(--text-xl)',   { lineHeight: '1.4'  }],
        '2xl':['var(--text-2xl)',  { lineHeight: '1.3'  }],
        '3xl':['var(--text-3xl)',  { lineHeight: '1.25' }],
        '4xl':['var(--text-4xl)',  { lineHeight: '1.2'  }],
        hero: ['var(--text-hero)', { lineHeight: '1.1'  }],
      },
    },
  },
};
```

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
  --text-hero: clamp(2.25rem, 1.5rem + 3vw, 3.5rem);
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
