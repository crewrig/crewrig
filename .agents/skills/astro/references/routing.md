# Astro routing

## Contents

- [File-based routes](#file-based-routes)
- [Dynamic routes and getStaticPaths](#dynamic-routes-and-getstaticpaths)
- [Server output](#server-output)

## File-based routes

Every `.astro`, `.md` or `.mdx` file under `src/pages/` is a route, and the file path is the URL. A `.ts` or `.js` file there is an endpoint. A file or folder starting with an underscore is not routed, which is the place for page-local helpers.

```text
src/pages/
├── index.astro              -> /
├── about.astro              -> /about
├── blog/
│   ├── index.astro          -> /blog
│   └── [slug].astro         -> /blog/:slug      (dynamic parameter)
└── docs/
    └── [...path].astro      -> /docs/*          (rest parameter)
```

## Dynamic routes and getStaticPaths

With static output a dynamic or rest route must export `getStaticPaths()`, which lists the paths to pre-render. Each entry carries `params` (the URL segments) and optionally `props` (data handed to the page, so it is not fetched twice).

```astro
---
import { getCollection, render } from "astro:content";

export async function getStaticPaths() {
  const posts = await getCollection("blog", ({ data }) => !data.draft);
  return posts.map((post) => ({
    params: { slug: post.id },
    props: { post },
  }));
}

const { post } = Astro.props;
const { Content } = await render(post);
---

<article>
  <h1>{post.data.title}</h1>
  <Content />
</article>
```

`getStaticPaths` runs once at build time, in its own scope: it cannot read variables declared in the page frontmatter. The entry identifier is `post.id` with the Astro 5 content layer and `post.slug` with the Astro 4 legacy collections; `render(post)` replaces `post.render()` in Astro 5 (see the content collections reference).

## Server output

Where a route is rendered on demand, `getStaticPaths` is not needed and the parameters come from `Astro.params`. Return a 404 yourself when the parameter matches nothing:

```astro
---
const { slug } = Astro.params;
const product = await lookup(slug);
if (!product) return Astro.redirect("/404");
---
```

Other routing tools: `Astro.redirect()` for redirects, a `redirects` map in `astro.config.mjs` for static redirects, and `src/middleware.ts` for logic that runs before every server-rendered route.
