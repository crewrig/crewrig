# Astro output modes, build and deployment

## Contents

- [Output modes](#output-modes)
- [Adapters](#adapters)
- [Build configuration and environment](#build-configuration-and-environment)
- [Deployment targets](#deployment-targets)

## Output modes

Choose static output unless a feature needs a server (authenticated routes, form handling, on-demand image transforms): pre-rendering is the cheapest, fastest and safest default.

```js
import { defineConfig } from "astro/config";
import netlify from "@astrojs/netlify";

export default defineConfig({
  // "static": pre-render every page at build time (default).
  // "server": render every page on demand.
  output: "server",
  adapter: netlify(),
});
```

- Astro 4 also had `output: "hybrid"` (server by default, pages opt in to pre-rendering).
- Astro 5 removed `hybrid`: `static` output with an adapter lets a page opt out with `export const prerender = false`, and `server` output lets a page opt in with `export const prerender = true`.

```astro
---
export const prerender = true;
---
```

## Adapters

| Target | Adapter |
|---|---|
| Node.js server | `@astrojs/node` |
| Netlify | `@astrojs/netlify` |
| Vercel | `@astrojs/vercel` |
| Cloudflare | `@astrojs/cloudflare` |

## Build configuration and environment

`astro.config.mjs` is the single source of truth; extend Vite through the `vite` key.

```js
import { defineConfig, envField } from "astro/config";

export default defineConfig({
  site: "https://example.com",
  base: "/",
  trailingSlash: "ignore",
  build: {
    format: "directory", // /about/index.html rather than /about.html
    assets: "_assets",
  },
  env: {
    schema: {
      PUBLIC_ANALYTICS_ID: envField.string({ context: "client", access: "public" }),
      API_TOKEN: envField.string({ context: "server", access: "secret" }),
    },
  },
  vite: {
    ssr: { noExternal: ["some-esm-only-pkg"] },
  },
});
```

Two rules for environment variables:

- `import.meta.env` exposes what `.env` declares, but only names prefixed `PUBLIC_` are inlined into client bundles. Everything else is server-only.
- `astro:env` (Astro 5) is a typed schema: each variable declares `context` (`client` or `server`) and `access` (`public` or `secret`), and misuse fails the build.

```ts
// Safe in a client island.
import { PUBLIC_ANALYTICS_ID } from "astro:env/client";

// Safe only in frontmatter and server-only modules.
import { API_TOKEN } from "astro:env/server";
```

## Deployment targets

Pick the adapter first; the rest follows.

- **GitHub Pages**: static output. Set `site` to `https://<user>.github.io` and `base` to `/<repo>` for a project page (no `base` for a user or organisation page or a custom domain). Set Pages to the GitHub Actions source in the repository settings. For the workflow itself (pinned actions, minimal `permissions`, `pages: write` and `id-token: write` on the deploy job only, the official `withastro/action`), use the `github-actions` skill instead of copying a template: it checks pinning and permissions.
- **Netlify**: install `@astrojs/netlify`; functions are emitted automatically for server output.
- **Vercel**: install `@astrojs/vercel`; the adapter options choose the runtime.
- **Cloudflare**: install `@astrojs/cloudflare`. The Workers runtime has no Node built-ins by default; use `platformProxy` in development for parity.
- **Self-hosted Node**: `@astrojs/node` in `standalone` mode produces a runnable `dist/server/entry.mjs`; put it behind a reverse proxy that sets the security headers.
