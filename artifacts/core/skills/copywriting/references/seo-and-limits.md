# SEO and length limits

## Contents

- Numeric limits
- Where the linter looks
- SEO-aware writing
- Internationalisation and length

## Numeric limits

`scripts/lint-copy.ts` is the source of truth for every number: run
`node scripts/lint-copy.ts --help` to read the current limits, and change them in that file
only. At the time of writing:

| Element | Limit | Why |
|---|---|---|
| Headline (first H1) | 70 characters | Longer headlines wrap to three lines on a phone and lose the outcome. |
| CTA label | 25 characters | A button label that wraps stops reading as an action. |
| SEO title | 60 characters | Search engines truncate longer titles. |
| Meta description | 155 characters | Search engines truncate longer ones. |

Two more rules are enforced beyond length. A CTA that names no action ("Click here",
"Submit", "OK", "More", "Read more", "Learn more") is an error, because the label is a
contract with the click. A banned phrase is an error: the default list holds corporate
filler and hollow superlatives ("leverage", "synergy", "best-in-class", "blazingly fast").
A project with its own list passes it with `--banned <file>`, one phrase per line, which
replaces the default list.

## Where the linter looks

| Element | Markdown | HTML |
|---|---|---|
| SEO title | front matter key `title` | `<title>` |
| Meta description | front matter key `description` | `<meta name="description" content="...">` |
| Headline | first `# ` heading outside code fences | first `<h1>` |
| CTA | a link alone on its line (optionally in a list item or bold) | each `<button>`; each `<a>` with `btn`, `button` or `cta` as a word of its class, or `role="button"` |

A link inside a sentence is not a CTA, so write the primary action as its own line. Front
matter values must fit on one line, or use a `>` or `|` block. A missing headline, title or
description is a warning, since a README has no meta description.

## SEO-aware writing

Write for humans first; serve search engines as a side effect. Modern search ranks pages
that satisfy reader intent, and keyword stuffing actively hurts.

- **Keyword placement**: the primary keyword belongs in the page title, the H1, the first
  100 words, and at least one H2. Beyond that, repetition stops helping.
- **Meta description**: treat it as ad copy, one sentence on the value, one on the
  specificity, optional CTA. Stay within the limit above.
- **Heading hierarchy**: one H1 per page (the page topic), H2 for section topics, H3 for
  subsections inside an H2. Skipping levels (H2 to H4) confuses both screen readers and
  crawlers.
- **Internal linking**: link from new pages to related existing pages using descriptive
  anchor text. "See our deployment guide" beats "click here".
- **Image alt text**: describe the image content for screen readers first; keyword
  inclusion is a bonus when it fits naturally.

The SEO and copy conflict resolves cleanly: if a keyword choice makes the sentence worse
for a human reader, the keyword loses.

## Internationalisation and length

Copy that survives translation respects the constraints of every target language from the
start. German runs about 30 % longer than English and Japanese about 50 % shorter, so a
headline that fits the English limit exactly will break in German: leave 20 to 30 % of
headroom under each limit when the page is localised. Avoid idioms ("moving the needle",
"low-hanging fruit"), cultural references, puns and nested conditional sentences; plan a
separate localised headline wherever the headline is a pun. Write copy as if a translator
will rewrite it tomorrow; the discipline makes the English version clearer too.
