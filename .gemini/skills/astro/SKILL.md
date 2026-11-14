---
name: astro
description: "Guides building and reviewing Astro sites: .astro components, islands and client directives, file-based routing and getStaticPaths, Content Collections, static versus server output and adapters, integrations (Tailwind, MDX, sitemap, astro:assets), environment variables, deployment, performance and security, and bundles a script that checks an Astro project for a missing site option, missing collection config, pages without a layout, images without alt and bare client:only. Use when authoring or reviewing .astro files, astro.config.mjs or a project with astro in package.json, or when an Astro build fails. Trigger terms: Astro, .astro, islands, client:load, getStaticPaths, content collections, astro.config, astro:assets. Not for generic HTML or CSS or WCAG audits (frontend), page copy (copywriting), Playwright tests (web-tester) or GitHub Actions workflow authoring (github-actions)."
license: Apache-2.0
compatibility: "Astro 4 or 5 projects; notes say where Astro 5 differs. The bundled script needs Node.js 24 (node scripts/check-astro-project.ts) and reads files only."
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "2.0.0"
---


# Astro

Astro renders pages as HTML on the server and ships JavaScript only for the
components you mark as islands. Every rule below follows from that bias: start from
zero client JavaScript and justify each addition. The model knows the framework
basics; this skill holds the conventions, the Astro 4 versus 5 differences and the
check that settles the fixed questions.

Hand a change to the **security** skill when it adds authentication, a secret or
untrusted Markdown, and to the **frontend** skill for CSS, accessibility or Core Web
Vitals work that is not specific to Astro.

## Decision rules

- **Output mode.** Use `static` unless a feature needs a server (authenticated routes,
  form handling, on-demand image transforms). Astro 5 removed `output: "hybrid"`:
  per-page choice is `export const prerender`.
- **Hydration.** Default to `client:visible` or `client:idle`. `client:load` is for
  above-the-fold interaction, `client:media` for a query-bound widget, and
  `client:only="<framework>"` for code that cannot run on the server; it always names
  the framework.
- **Content.** Structured Markdown, MDX or JSON goes in a Content Collection with a Zod
  schema, not in ad-hoc imports. Astro 5 keeps the config in `src/content.config.ts`
  with a `loader`; Astro 4 uses `src/content/config.ts` with `type`.
- **Dynamic routes.** A static `[param]` or `[...rest]` page exports `getStaticPaths`;
  a server-rendered one reads `Astro.params`.
- **Images.** Use `<Image>` or `<Picture>` from `astro:assets` with a real `alt`
  (`alt=""` when decorative). The LCP image is `loading="eager"` with
  `fetchpriority="high"`; the others stay lazy.
- **Pages.** Every page sits in a layout so `<head>`, `lang` and metadata are shared.
- **Secrets.** Declare variables in the `astro:env` schema; a secret is
  `context: "server"`. Only `PUBLIC_` names reach the browser through `import.meta.env`.
- **`site` and `base`.** Set `site` always; sitemap, canonical URLs and RSS need it.
  Set `base` for a project page on GitHub Pages.

## Script

Run it from this skill's directory on the project root; it reads files and writes
nothing:

```sh
node scripts/check-astro-project.ts <project-dir> [--json]
```

Run it after you write or change pages, components or `astro.config.*`, and when
reviewing a project. It reports `no-config`, `site-missing` (sitemap integration
without `site`), `site-missing-warn`, `collection-config` (entries under
`src/content` with no collection config), `page-no-layout` (warning),
`img-missing-alt` (`<img>`, `<Image>`, `<Picture>`) and `client-only-bare`.

| Exit | Meaning |
|---|---|
| `0` | No error finding. Warnings may be listed; read them. |
| `1` | At least one error finding: fix it and run again. |
| `2` | Usage error: pass exactly one directory. |
| `3` | The directory cannot be read. |

`--json` prints one `{ok, data, findings}` object. The script is a text scan, not a
build: it does not replace `astro check` and `astro build`, so report those as not
run when you did not run them. A page that gets its layout through a wrapper that is
not named like a layout is a false positive of `page-no-layout`.

## References

Read one only when its subject is the task.

- `references/components.md`: component syntax, props, slots, scoped styles, the
  hydration directive table.
- `references/routing.md`: file-based routes, dynamic and rest parameters,
  `getStaticPaths`, server-rendered routes.
- `references/content-collections.md`: schemas, loaders, queries, the Astro 4 and 5
  differences, failure modes.
- `references/integrations.md`: Tailwind, MDX, sitemap, `astro:assets` usage.
- `references/deployment.md`: output modes, adapters, build and `astro:env`
  configuration, per-target deployment; the GitHub Pages workflow is delegated to the
  `github-actions` skill.
- `references/performance-security.md`: images, fonts, scripts, island budget, secrets,
  CSP, MDX and form handling.

## Friction

When something in this skill misleads or blocks you, tag it with the `harness-report` skill.
