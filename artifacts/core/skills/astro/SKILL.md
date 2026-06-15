---
name: astro
description: |
  Practitioner-grade reference knowledge for the Astro framework. Covers
  component syntax, islands architecture, file-based routing, Content
  Collections, SSG/SSR modes, integrations (Tailwind, MDX, Sitemap,
  astro:assets), build pipeline, deployment targets, performance patterns,
  and security defaults. Activate when authoring or reviewing .astro files
  or any project with astro in package.json.
type: skill
license: Apache-2.0
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "1.0.2"
compatibility: "Requires Astro >= 4.0 and Node >= 18."
claude:
  allowed-tools:
    - Read
    - Bash
    - Write
    - Edit
  user-invocable: true
---

# Astro

Practitioner reference for building sites and apps with the Astro
framework. Activate whenever the change touches a `.astro` file, an
`astro.config.mjs`, a content collection schema, an Astro integration,
or any project that lists `astro` in its `package.json`.

Astro's defining trait is the **server-first** rendering model with
opt-in client islands. Treat every page as HTML by default; reach for
JavaScript only where the interaction model requires it. The patterns
below are organized around that bias.

## When to activate

- Authoring or reviewing `.astro` components, layouts, and pages.
- Wiring Content Collections, dynamic routes, or `getStaticPaths`.
- Configuring SSG, SSR, or hybrid output and selecting an adapter.
- Installing and tuning integrations (`@astrojs/tailwind`,
  `@astrojs/mdx`, `@astrojs/sitemap`, `astro:assets`).
- Editing `astro.config.mjs`, Vite config, or environment variables.
- Diagnosing build failures, hydration mismatches, or Core Web Vitals
  regressions inside an Astro project.

## 1. Component syntax

An `.astro` file has two parts: a **frontmatter fence** of server-side
TypeScript/JavaScript delimited by `---`, and an HTML-like **template**
that follows. The frontmatter runs once at build time (SSG) or per
request (SSR); never in the browser.

```astro
--- 
// Server-side: runs at build or request time, never in the browser.
import Layout from "../layouts/Base.astro";
import Button from "../components/Button.astro";

interface Props {
  title: string;
  cta?: string;
}

const { title, cta = "Read more" } = Astro.props;
const items = await fetch("https://api.example.com/items").then((r) =>
  r.json(),
);
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
  /* Scoped by default — Astro hashes class names. */
  h1 {
    font-size: var(--font-size-xl);
    color: var(--color-accent);
  }
</style>
```

Key rules:

- **Props** are typed via a `Props` interface and read from
  `Astro.props`. Defaults live in the destructuring assignment.
- **Slots** project children. Use `<slot />` for the default slot and
  `<slot name="foo" />` for named slots; the parent supplies content
  with `slot="foo"`.
- **Imports** in the frontmatter are tree-shaken. Components are
  rendered server-side unless a `client:*` directive is attached.
- **`<style>` blocks** are scoped to the component by default. Use
  `<style is:global>` to opt out, sparingly. Prefer design tokens.
- **`<script>` blocks** are bundled, hoisted, and deferred by default.
  Use `is:inline` only when you have a clear reason (third-party
  shims, JSON-LD).

## 2. Islands architecture

Astro ships zero JavaScript by default. To hydrate a UI framework
component (React, Vue, Svelte, Solid, Preact) you attach a `client:*`
directive. Each directive is a different **hydration strategy** —
choose deliberately.

```astro
--- 
import Counter from "../components/Counter.jsx";
import HeavyChart from "../components/HeavyChart.svelte";
import CartDrawer from "../components/CartDrawer.vue";
import LiveMap from "../components/LiveMap.tsx";
--- 

<!-- Above the fold, must be interactive immediately. -->
<Counter client:load />

<!-- Non-critical; hydrate when the browser is idle. -->
<CartDrawer client:idle />

<!-- Below the fold; hydrate when it scrolls into view. -->
<HeavyChart client:visible />

<!-- Client-only widget — no SSR (e.g. WebGL, browser-only API). -->
<LiveMap client:only="react" />
```

| Directive            | Use-case                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| `client:load`        | Above-the-fold, interactive immediately (header search, primary CTA).    |
| `client:idle`        | Low-priority interactivity that can wait (cart drawer, preferences).     |
| `client:visible`     | Below-the-fold widgets — hydrates via `IntersectionObserver`.            |
| `client:media`       | Hydrates only when a media query matches (mobile menu on narrow screens).|
| `client:only="..."`  | Skip SSR entirely; render only in the browser. Specify the framework.    |

Rule of thumb: `client:visible` and `client:idle` are the default.
`client:load` is reserved for genuine above-the-fold interactivity.
`client:only` is an escape hatch for code that cannot run server-side.

## 3. File-based routing

Every `.astro`, `.md`, or `.mdx` file under `src/pages/` becomes a
route. The file path is the URL.

```text
src/pages/
├── index.astro              → /
├── about.astro              → /about
├── blog/
│   ├── index.astro          → /blog
│   └── [slug].astro         → /blog/:slug      (dynamic param)
└── docs/
    └── [...path].astro      → /docs/*          (rest param)
```

For static output, dynamic and rest routes must export
`getStaticPaths()` to enumerate the paths to pre-render:

```astro
--- 
import { getCollection } from "astro:content";

export async function getStaticPaths() {
  const posts = await getCollection("blog");
  return posts.map((post) => ({
    params: { slug: post.slug },
    props: { post },
  }));
}

const { post } = Astro.props;
const { Content } = await post.render();
--- 

<article>
  <h1>{post.data.title}</h1>
  <Content />
</article>
```

In SSR mode, dynamic routes are resolved per request and
`getStaticPaths` is not required. Use `Astro.params` to read params.

## 4. Content Collections

Content Collections give Markdown/MDX/JSON content type-safe
frontmatter via Zod. Define a collection in `src/content/config.ts`:

```ts
import { defineCollection, z } from "astro:content";

const blog = defineCollection({
  type: "content", // "content" for md/mdx, "data" for json/yaml
  schema: z.object({
    title: z.string().max(80),
    description: z.string(),
    pubDate: z.coerce.date(),
    draft: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { blog };
```

Read collections from any `.astro` file with type-safe APIs:

```ts
import { getCollection, getEntry } from "astro:content";

// All published posts, newest first.
const posts = (await getCollection("blog", ({ data }) => !data.draft)).sort(
  (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
);

// A single entry by slug.
const post = await getEntry("blog", "hello-world");
```

Schema violations fail the build with a precise error pointing to the
offending file and field. Treat content collections as the default
shape for any structured markdown content.

## 5. SSG vs SSR

Astro supports three output modes set in `astro.config.mjs`:

```js
import { defineConfig } from "astro";
import netlify from "@astrojs/netlify";

export default defineConfig({
  // "static"  → pre-render every page at build time (default).
  // "server"  → render every page on demand.
  // "hybrid"  → server by default, opt pages into pre-render.
  output: "hybrid",
  adapter: netlify(),
});
```

In `hybrid` mode, individual pages opt into pre-rendering:

```astro
--- 
export const prerender = true;
--- 
```

Adapter selection by deployment target:

| Target           | Adapter                |
| ---------------- | ---------------------- |
| Node.js server   | `@astrojs/node`        |
| Netlify          | `@astrojs/netlify`     |
| Vercel           | `@astrojs/vercel`      |
| Cloudflare Pages | `@astrojs/cloudflare`  |

Pick `static` unless a feature genuinely requires server execution
(authenticated routes, dynamic form handling, on-demand image
transforms). Pre-rendering is the cheapest, fastest, safest default.

## 6. Integrations

Integrations are registered in `astro.config.mjs` and add framework
support, build steps, or runtime helpers.

```js
import { defineConfig } from "astro";
import tailwind from "@astrojs/tailwind";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://example.com",
  integrations: [tailwind(), mdx(), sitemap()],
});
```

Common integrations:

- **`@astrojs/tailwind`** — wires Tailwind through Vite; the
  `tailwind.config.{js,cjs,mjs}` is auto-detected. Set
  `applyBaseStyles: false` if you provide your own reset.
- **`@astrojs/mdx`** — enables `.mdx` files with full component
  imports and JSX inside Markdown.
- **`@astrojs/sitemap`** — emits `sitemap-index.xml` and
  `sitemap-0.xml` at build time. Requires the top-level `site`
  option.
- **`astro:assets`** — built-in (no install). Provides `<Image>`,
  `<Picture>`, and the `getImage()` helper for build-time image
  optimization:

```astro
--- 
import { Image, Picture } from "astro:assets";
import hero from "../assets/hero.jpg";
--- 

<Image
  src={hero}
  alt="Product hero shot"
  widths={[400, 800, 1200]}
  sizes="(min-width: 768px) 50vw, 100vw"
  loading="eager"
  fetchpriority="high"
/>

<Picture
  src={hero}
  alt="Decorative banner"
  formats={["avif", "webp"]}
  widths={[400, 800, 1200]}
/>
```

## 7. Build pipeline

`astro.config.mjs` is the single source of truth. Extend Vite directly
via the `vite` key when needed.

```js
import { defineConfig, envField } from "astro";

export default defineConfig({
  site: "https://example.com",
  base: "/",
  trailingSlash: "ignore",
  build: {
    format: "directory", // /about/index.html vs /about.html
    assets: "_assets",
  },
  env: {
    schema: {
      PUBLIC_ANALYTICS_ID: envField.string({
        context: "client",
        access: "public",
      }),
      API_TOKEN: envField.string({
        context: "server",
        access: "secret",
      }),
    },
  },
  vite: {
    ssr: { noExternal: ["some-esm-only-pkg"] },
  },
});
```

Environment variables follow two rules:

- **`import.meta.env`** exposes anything declared in `.env`. Only
  variables prefixed with **`PUBLIC_`** are inlined into client
  bundles. Everything else is server-only.
- **`astro:env`** (Astro 5+) replaces ad-hoc usage with a typed
  schema. Mark each variable as `context: "client" | "server"` and
  `access: "public" | "secret"`. Misuse fails the build.

```ts
// Safe in a client island.
import { PUBLIC_ANALYTICS_ID } from "astro:env/client";

// Safe only in frontmatter or server-only modules.
import { API_TOKEN } from "astro:env/server";
```

## 8. Deployment

Each target has a canonical adapter and a typical wiring. Pick the
adapter first; the rest of the config follows.

```yaml
# .github/workflows/deploy-gh-pages.yml — static output + GitHub Pages
name: Deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- **GitHub Pages** — use the static output and the workflow above, or
  the `@astrojs/github-pages` helper. Set `site` and `base` to match
  the repo URL.
- **Netlify** — install `@astrojs/netlify`, set `output: "server"` or
  `"hybrid"`. Functions are emitted automatically.
- **Vercel** — install `@astrojs/vercel`. Choose the `serverless` or
  `edge` runtime via the adapter options.
- **Cloudflare Pages** — install `@astrojs/cloudflare`. Workers
  Runtime imposes constraints (no Node built-ins by default); use
  `platformProxy` in dev for parity.

## 9. Performance patterns

Astro's defaults already win most performance battles — keep them.

- **`<Image>` and `<Picture>`** (`astro:assets`) produce responsive
  `srcset`, modern formats (AVIF/WebP), and explicit width/height
  attributes to eliminate CLS. Always pass `widths` and `sizes`.
- **`loading="lazy"`** is the right default for below-the-fold images.
  The LCP image must use `loading="eager"` and
  `fetchpriority="high"`, and ideally a `<link rel="preload">` in the
  layout `<head>`.
- **Font discipline** — self-host, subset to the glyphs you use, serve
  WOFF2, set `font-display: swap`, and preload only the one or two
  faces above the fold.
- **Scripts** — Astro hoists and defers `<script>` tags by default.
  Use `is:inline` only for unavoidable inline payloads (JSON-LD,
  critical CSS).
- **Islands discipline** — every `client:*` directive adds JS to the
  bundle. Audit periodically with `astro build --verbose` and the
  network panel; demote `client:load` to `client:visible` or
  `client:idle` wherever the interaction can wait.
- **View Transitions** — opt in with the `<ClientRouter />` component
  for SPA-style navigations without giving up the server-rendered
  baseline.

## 10. Security defaults

- **Never expose secrets to the client.** Anything readable from a
  client island is public. Use the `astro:env` schema to make this a
  build-time error rather than a leak. Untyped `import.meta.env.X`
  references without the `PUBLIC_` prefix are server-only — keep them
  out of `client:*` components.
- **Content Security Policy** — set CSP headers via the adapter
  (Netlify `_headers`, Vercel `vercel.json`, Cloudflare
  `_headers`) or a middleware (`src/middleware.ts`) for SSR routes.
  Disallow `unsafe-inline`; rely on Astro's hashed scripts and
  styles.
- **MDX sanitization** — MDX executes JSX. Treat untrusted MDX input
  exactly like untrusted code. For user-submitted Markdown, render
  through a sanitized pipeline (e.g. `rehype-sanitize`) and never
  through `@astrojs/mdx` directly.
- **External fetches in frontmatter** run on the server — apply the
  same input-validation, timeout, and error-handling discipline as
  any backend code. Keep API tokens out of the client bundle by
  importing from `astro:env/server`.
- **Form handling** in SSR routes must validate input server-side
  (Zod is already in the toolbox via Content Collections) and apply
  CSRF protection where the adapter does not provide it natively.
