# Astro integrations

## Contents

- [Registering integrations](#registering-integrations)
- [Tailwind](#tailwind)
- [MDX](#mdx)
- [Sitemap](#sitemap)
- [Image optimization](#image-optimization)

## Registering integrations

Integrations are registered in `astro.config.mjs` and add framework support, build steps or runtime helpers. `npx astro add <name>` installs the package and edits the config.

```js
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://example.com",
  integrations: [mdx(), sitemap()],
});
```

`defineConfig` is imported from `astro/config`, and `envField` too.

## Tailwind

- Tailwind 4 uses the Vite plugin (`@tailwindcss/vite` in `vite.plugins`) and a CSS `@import "tailwindcss"`; `@astrojs/tailwind` is the Tailwind 3 integration and is deprecated for new projects.
- With `@astrojs/tailwind`, the `tailwind.config.{js,cjs,mjs}` file is detected automatically. Set `applyBaseStyles: false` when you ship your own reset.

## MDX

`@astrojs/mdx` enables `.mdx` files with component imports and JSX inside Markdown. MDX executes JSX, so it is code: never feed it untrusted input (see the performance and security reference).

## Sitemap

`@astrojs/sitemap` writes `sitemap-index.xml` and `sitemap-0.xml` at build time and requires the top-level `site` option. Without `site` the integration cannot build absolute URLs, which is why the project checker reports it.

## Image optimization

Built in, nothing to install. `<Image>`, `<Picture>` and `getImage()` optimise images at build time. `alt` is required.

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
  alt=""
  formats={["avif", "webp"]}
  widths={[400, 800, 1200]}
/>
```

Import local images from `src/` so Astro knows their dimensions; images in `public/` are served untouched. A decorative image takes `alt=""`, not a missing attribute. Remote images need their domain in `image.domains` (or a pattern in `image.remotePatterns`) and explicit `width` and `height`.
