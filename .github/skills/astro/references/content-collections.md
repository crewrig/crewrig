# Astro Content Collections

## Contents

- [Defining a collection](#defining-a-collection)
- [Reading entries](#reading-entries)
- [Astro 4 and Astro 5 differences](#astro-4-and-astro-5-differences)
- [Failure modes](#failure-modes)

## Defining a collection

Content Collections give Markdown, MDX, JSON and YAML content typed frontmatter validated by Zod. A schema violation fails the build with the file and the field, so treat collections as the default shape for structured content.

Astro 5 (content layer), in `src/content.config.ts`:

```ts
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
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

Astro 4 (legacy collections), in `src/content/config.ts`:

```ts
import { defineCollection, z } from "astro:content";

const blog = defineCollection({
  type: "content", // "content" for md/mdx, "data" for json/yaml
  schema: z.object({ title: z.string(), pubDate: z.coerce.date() }),
});

export const collections = { blog };
```

Use `z.coerce.date()` for dates written as strings in frontmatter, and `.default()` for optional fields so consumers never branch on `undefined`.

## Reading entries

```ts
import { getCollection, getEntry } from "astro:content";

// Published posts, newest first.
const posts = (await getCollection("blog", ({ data }) => !data.draft)).sort(
  (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
);

// One entry by identifier.
const post = await getEntry("blog", "hello-world");
```

Filter drafts in the `getCollection` callback, not in the template, so a draft cannot leak into a feed, a sitemap or a `getStaticPaths` list that forgot the filter.

## Astro 4 and Astro 5 differences

| Topic | Astro 4 | Astro 5 |
|---|---|---|
| Config file | `src/content/config.ts` | `src/content.config.ts` (the old path still works for legacy collections) |
| Source of entries | folder name equals collection name | a `loader` (`glob`, `file`, or custom) |
| Entry identifier | `entry.slug` | `entry.id` |
| Render body | `await entry.render()` | `await render(entry)` imported from `astro:content` |

## Failure modes

- Entries in `src/content` with no config file: the collection is untyped and warns at build. Add the config.
- A date field typed `z.date()` fails on a string in frontmatter; use `z.coerce.date()`.
- A collection name that does not match a folder (Astro 4) or a `base` that does not exist (Astro 5) produces an empty collection with no error: check the path first when `getCollection` returns nothing.
- Images in frontmatter: use the `image()` helper from the schema context (`schema: ({ image }) => z.object({ cover: image() })`) so they go through `astro:assets`.
