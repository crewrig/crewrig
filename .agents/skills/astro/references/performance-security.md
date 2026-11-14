# Astro performance and security

## Contents

- [Performance](#performance)
- [Security](#security)

## Performance

Astro's defaults already win most performance battles; keep them.

- `<Image>` and `<Picture>` from `astro:assets` produce responsive `srcset`, modern formats (AVIF, WebP) and explicit dimensions, which removes layout shift. Pass `widths` and `sizes`.
- `loading="lazy"` is right for images below the fold. The largest contentful paint image takes `loading="eager"` and `fetchpriority="high"`, and ideally a `<link rel="preload">` in the layout `<head>`.
- Fonts: self-host, subset to the glyphs used, serve WOFF2, set `font-display: swap`, and preload only the one or two faces above the fold.
- Scripts: Astro hoists and defers `<script>` tags. Use `is:inline` only for payloads that cannot be bundled (JSON-LD, critical CSS).
- Islands: every `client:*` directive adds JavaScript to the bundle. Audit with `astro build` output and the network panel, and demote `client:load` to `client:visible` or `client:idle` wherever the interaction can wait.
- View transitions: opt in with the `<ClientRouter />` component (named `<ViewTransitions />` before Astro 5) for single-page navigation on top of the server-rendered baseline.

## Security

- Never expose a secret to the client: anything readable from a client island is public. The `astro:env` schema turns a leak into a build error. A variable without the `PUBLIC_` prefix is server-only, so keep it out of `client:*` components.
- Content Security Policy: set it through the adapter's headers file (Netlify `_headers`, Vercel `vercel.json`, Cloudflare `_headers`) or in `src/middleware.ts` for server routes. Avoid `unsafe-inline`: Astro can hash its scripts and styles.
- MDX executes JSX, so untrusted MDX is untrusted code. For user-submitted Markdown, render through a sanitising pipeline (for example `rehype-sanitize`) and not through `@astrojs/mdx`.
- External fetches in frontmatter run on the server: apply the validation, timeout and error handling of any backend code, and import tokens from `astro:env/server`.
- Forms in server routes validate input on the server (Zod is already available) and need CSRF protection where the adapter does not give it; Astro 5 checks the `Origin` header of form posts on server-rendered routes by default (`security.checkOrigin`), so leave it on.
- Hand a change that touches authentication, sessions or a new secret to the `security` skill.
