---
name: copywriting
description: "Writes and reviews web copy for landing pages, README introductions and UX microcopy: hero, value proposition, headlines, CTA labels, error and empty-state text, SEO title and meta description, with a bundled script that lints headline, CTA, title and meta description length and banned phrases. Use when drafting or critiquing page content, marketing copy, a project tagline, button labels or error messages, or when copy must fit length limits before it is handed to a developer. Trigger terms: landing page, headline, CTA, call to action, microcopy, meta description, SEO title, tagline, PAS, AIDA, banned phrases. Not for HTML or CSS implementation (frontend), Astro pages and components (astro), technical documentation or ADRs (doc-writer) or PR descriptions (pr-logbook)."
license: Apache-2.0
compatibility: "Requires Node.js 24 to run scripts/lint-copy.ts as node scripts/lint-copy.ts; without Node the skill still works as written guidance and the limits are read from references/seo-and-limits.md."
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "2.0.0"
---


# Copywriting

Product-oriented web copy that converts instead of decorating. Positioning and audience
are decisions made before this skill runs; layout and visual hierarchy belong to a
designer. Deliver Markdown with clear section labels and no HTML, styling or layout
decisions in the copy.

## Lint before handing over

Fixed questions (is the headline short enough, does the CTA name an action, did filler
slip in) are settled by a script, not by eye. Run it from this skill's directory on every
page you write or review:

```sh
node scripts/lint-copy.ts <page.md|page.html|-> [--banned <file>] [--format md|html] [--json]
```

It reads front matter `title` and `description`, the first H1 as the headline, and links
alone on their line (Markdown) or `<button>` and button-styled `<a>` (HTML) as CTAs. The
numeric limits live in the script (`--help` prints them) and are explained in
`references/seo-and-limits.md`; do not restate the numbers in your own text.

| Exit | Meaning | What to do |
|---|---|---|
| `0` | No error finding. Warnings (missing headline, title or description) may be listed. | Say which warnings are intended, then hand over. |
| `1` | A length limit, a banned phrase or a CTA with no action. Each finding names the line and the fix. | Rewrite the flagged copy, never the limit, and run again. |
| `2` | Usage error. | Fix the command line. |
| `3` | The input or the `--banned` file cannot be read. | Check the path. |

When the project keeps its own list of forbidden words, pass it with `--banned <file>`
(it replaces the default list). A finding is evidence for a rewrite: quote it in a review
and propose the shorter text.

## When to activate

- Drafting or revising a landing page (hero, features, social proof, CTA blocks).
- Writing README introductions or project taglines.
- Editing microcopy: buttons, empty states, error messages, tooltips.
- Reviewing someone else's copy for vague headlines, weak CTAs, jargon or translation
  hazards.

## Landing page anatomy

A landing page is a sequence of decisions the reader makes. Each section answers exactly
one question, and the order is not arbitrary.

1. **Hero**: *what is this and why should I care?* A headline (the outcome), a subheadline
   (the specificity) and one primary CTA. No secondary distractions above the fold.
2. **Value proposition**: *what changes for me?* The user-visible benefit, not the
   implementation detail.
3. **Feature sections**: *how does it do that?* One feature per block, each tied to a
   benefit. Features without benefits are filler.
4. **Social proof**: *why should I trust this?* Specificity beats superlatives ("12k weekly
   downloads" beats "loved by developers").
5. **Objection handling**: *what about my edge case?* FAQ, comparison table or a "who this
   is not for" section. Naming objections out loud disarms them.
6. **Final CTA**: repeats the hero's primary action, so the reader who scrolled this far
   does not scroll back up.

Each section should be removable without breaking the page. A section that cannot be
removed does two jobs and needs splitting. For the structure of a long page, or when the
reader may not know they have the problem, pick a framework in
`references/frameworks-and-tone.md` (PAS, BAB, AIDA) and the tone register for the audience.

## Headlines

The headline carries more weight than the rest of the page, because most readers never
reach the body.

- **Outcome-focused**: name the result, not the mechanism. "Deploy in under a minute" beats
  "Kubernetes-based deployment platform".
- **Specific**: numbers, time bounds, named comparisons. "Cut build time by 80 %" beats
  "Faster builds".
- **No undefined jargon**: define the term in the subheadline or change the word.
- **Active voice, present tense**: "Ship faster" beats "Shipping is made faster".

A headline that describes what the company *is* rather than what the reader *gets* ("A
modern platform for X") is a positioning statement, not a headline.

## CTAs

A CTA is a contract: clicking it must lead to exactly what the label promises.

- **One primary action per section.** Two equally weighted CTAs make the reader pick neither.
- **Verb-first labels.** "Start free trial" beats "Free trial"; "Read the docs" beats
  "Documentation".
- **Friction reduction.** "Start free, no credit card" lowers the imagined cost of the
  click. Name the next step when it is smaller than the reader expects.
- **Secondary CTAs are subordinate**: a link, not a second button.
- **Repeat the primary CTA** at commitment points (end of the hero, after social proof,
  end of the page) rather than inventing a new one each time.

## Microcopy

Microcopy is the writing inside the UI, where copy stops being marketing and becomes product.

- **Buttons**: verb-first, scoped to the action. "Save changes" beats "OK"; "Delete
  project" beats "Confirm".
- **Error messages**: say what went wrong and what the user can do about it. Never show a
  stack trace or internal code without a human-readable explanation beside it.
- **Empty states**: explain what the screen will show once it has data, and provide the
  action that fills it.
- **Tooltips**: short, factual, one job. Anything that educates belongs in the docs.
- **Confirmation dialogs**: name the consequence in the body and the action in the button
  ("This will permanently delete 12 files." with `[Cancel]` `[Delete 12 files]`). Do not
  make the destructive action the highlighted default.

Read the label out loud as if asking the user to do it; if the sentence feels odd, the
label is wrong.

## Output

For a writing task, deliver the copy as Markdown (front matter `title` and `description`
when the page needs SEO text), lint it, and report the lint result. For a review, return
findings as a list: section, the specific weakness, a concrete rewrite. "The hero feels
weak" is not actionable; a rewrite is.

## References

- `references/seo-and-limits.md`: the numeric limits and how the script finds each element,
  SEO-aware writing, length headroom for translation.
- `references/frameworks-and-tone.md`: PAS, BAB, AIDA, tone calibration.
- `references/shared-friction-reporting.md`: how to report a friction in this skill.
