# Astro component syntax and islands

## Contents

- [Anatomy of a component](#anatomy-of-a-component)
- [Rules](#rules)
- [Hydration directives](#hydration-directives)

## Anatomy of a component

An `.astro` file has a frontmatter fence of server-side TypeScript between `---` lines, then an HTML-like template. The frontmatter runs once at build time (static output) or per request (server output), never in the browser.

```astro
---
import Layout from "../layouts/Base.astro";
import Button from "../components/Button.astro";

interface Props {
  title: string;
  cta?: string;
}

const { title, cta = "Read more" } = Astro.props;
const items = await fetch("https://api.example.com/items").then((r) => r.json());
---

<Layout title={title}>
  <h1>{title}</h1>
  <ul>
    {items.map((item) => <li>{item.name}</li>)}
  </ul>

  <Button>{cta}</Button>

  <slot name="footer" />
</Layout>

<style>
  /* Scoped by default: Astro hashes class names. */
  h1 {
    font-size: var(--font-size-xl);
    color: var(--color-accent);
  }
</style>
```

## Rules

- Props are typed with a `Props` interface and read from `Astro.props`. Defaults live in the destructuring.
- Slots project children. `<slot />` is the default slot, `<slot name="foo" />` a named one; the parent fills it with `slot="foo"`.
- Imports in the frontmatter are tree-shaken. A component renders on the server unless a `client:*` directive is attached.
- `<style>` blocks are scoped to the component. `<style is:global>` opts out; use it sparingly and prefer design tokens.
- `<script>` blocks are bundled, hoisted and deferred. `is:inline` is for the few cases that need it (third-party shims, JSON-LD) because an inline script skips bundling and processing.

## Hydration directives

Astro ships no JavaScript for a component until a `client:*` directive hydrates it. Each directive is a different strategy, so choose on purpose.

```astro
---
import Counter from "../components/Counter.jsx";
import HeavyChart from "../components/HeavyChart.svelte";
import CartDrawer from "../components/CartDrawer.vue";
import LiveMap from "../components/LiveMap.tsx";
---

<Counter client:load />
<CartDrawer client:idle />
<HeavyChart client:visible />
<LiveMap client:only="react" />
```

| Directive | Use |
|---|---|
| `client:load` | Above the fold and interactive at once (header search, primary call to action). |
| `client:idle` | Low-priority interactivity that can wait (cart drawer, preferences). |
| `client:visible` | Below the fold; hydrates through `IntersectionObserver`. |
| `client:media="(query)"` | Hydrates only when the media query matches (mobile menu). |
| `client:only="react"` | No server render at all; the framework name is mandatory. For code that cannot run on the server (WebGL, browser-only APIs). |

`client:visible` and `client:idle` are the defaults. `client:load` is reserved for real above-the-fold interaction, and `client:only` is an escape hatch. Props passed to an island must be serialisable: functions cannot cross the server-client boundary.
