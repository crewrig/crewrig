---
name: copywriting
description: "Practitioner-grade reference knowledge for product-oriented web copywriting.
Covers landing page anatomy, copywriting frameworks (PAS, BAB, AIDA), tone
calibration, headline patterns, CTA mechanics, microcopy, i18n considerations,
and SEO-aware writing. Activate when authoring or reviewing page content,
marketing copy, README prose, or UX microcopy."
license: Apache-2.0
compatibility: "No runtime prerequisites; this skill is documentation-only."
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "1.0.2"
---


# Copywriting

Practitioner reference for product-oriented web copy. Use this skill
when writing or reviewing landing pages, marketing prose, README
introductions, or UX microcopy. It encodes the patterns that
distinguish copy that converts from copy that decorates.

## When to activate

- Drafting or revising a landing page (hero, features, social proof,
  CTA blocks).
- Writing README introductions or project taglines.
- Editing UX microcopy: buttons, empty states, error messages, tooltips.
- Reviewing copy authored by someone else and looking for specific
  weaknesses (vague headlines, weak CTAs, jargon, translation hazards).

Defer to a designer for layout and visual hierarchy. Defer to a
product manager for positioning and target-audience selection — this
skill assumes those decisions are already made.

## Landing page anatomy

A product landing page is a sequence of decisions the reader makes.
Each section answers exactly one question; the order is not arbitrary.

1. **Hero** — answers *what is this and why should I care?*. Composed
   of a headline (the outcome), a subheadline (the specificity), and
   one primary CTA. No secondary distractions above the fold.
2. **Value proposition** — answers *what changes for me if I adopt
   this?*. State the user-visible benefit, not the implementation
   detail.
3. **Feature sections** — answers *how does it do that?*. One feature
   per block, each tied back to a benefit. Features without benefits
   are filler.
4. **Social proof** — answers *why should I trust this?*. Testimonials,
   logos, metrics, GitHub stars, download counts. Specificity beats
   superlatives ("12k weekly downloads" beats "loved by developers").
5. **Objection handling** — answers *what about my edge case?*. FAQ,
   comparison table, or a "who this is not for" section. Naming
   objections out loud disarms them.
6. **Final CTA** — repeats the primary action of the hero. The reader
   who scrolled this far is the closest to converting; do not make
   them scroll back up.

Each section should be removable without breaking the page. If a
section cannot be removed, it is doing two jobs and needs to be split.

## Copywriting frameworks

### PAS — Problem / Agitate / Solution

Use when the reader may not yet recognize they have the problem.
Name the problem, dwell on its cost, then introduce the solution as
relief.

```text
Problem:  Your CI pipeline takes 18 minutes per push.
Agitate:  That's 90 minutes of context-switching per developer per day.
Solution: Cached builds cut that to 3 minutes. Here's how.
```

PAS is high-friction — the agitation step risks feeling manipulative
if the audience is technical and already skeptical. Use sparingly with
developer audiences; lean on it harder for non-technical buyers.

### BAB — Before / After / Bridge

Use when the reader already feels the problem. Paint the current
state, paint the desired state, then make the product the bridge.

```text
Before: Manual deploys, broken Friday afternoons, rollback panic.
After:  One-click deploys, green dashboards, time back for real work.
Bridge: Our pipeline gives you both — preview environments and
        automatic rollback on health-check failure.
```

BAB works well for developer tools because the "before" state is
shared lore — readers recognize themselves immediately.

### AIDA — Attention / Interest / Desire / Action

Use for long-form pages where the reader needs convincing in stages.
Attention is the headline, Interest is the value prop, Desire is the
features+social-proof block, Action is the CTA.

AIDA is more of an outline than a tactic — most landing pages
implicitly follow it. Useful as a checklist: if you cannot point at
each of the four moments, a section is missing.

## Tone calibration

Tone is decided once per project and applied consistently. The
default register for developer-facing open-source tools is
**technical-but-accessible**:

- **Precise** — name things by their real names. "Build cache" not
  "magic speed thing".
- **Confident, not boastful** — state what the tool does without
  superlatives. "Runs in 200 ms" beats "blazingly fast".
- **Human** — contractions are fine ("we're", "you'll"). Avoid
  corporate filler ("leverage", "synergy", "best-in-class").
- **Honest about limits** — say what the tool does *not* do. This
  builds more trust than feature inflation.

For consumer products the register shifts: shorter sentences, more
metaphor, fewer specifics. For enterprise sales pages the register
shifts again: more nouns, more compliance vocabulary, longer
sentences. Calibrate to the audience and hold the line.

## Headline patterns

The headline carries more weight than every other line on the page
combined. A weak headline cannot be rescued by strong body copy
because most readers will not reach the body.

Strong headline patterns:

- **Outcome-focused** — name the result, not the mechanism. "Deploy
  in under a minute" beats "Kubernetes-based deployment platform".
- **Specific** — numbers, time bounds, named comparisons. "Cut build
  time by 80 %" beats "Faster builds".
- **No undefined jargon** — if the term is not industry-standard for
  the target reader, define it in the subheadline or change the word.
- **Active voice, present tense** — "Ship faster" beats "Shipping is
  made faster".

Weak headlines share a tell: they describe what the company *is*
rather than what the reader *gets*. "A modern platform for X" is a
positioning statement, not a headline.

## CTA mechanics

A CTA is a verb the reader is invited to perform. Treat it as a
contract: clicking it must lead to exactly what the label promises.

- **One primary action per section.** If a section has two equally
  weighted CTAs, the reader picks neither.
- **Verb-first labels.** "Start free trial" beats "Free trial".
  "Read the docs" beats "Documentation". "See pricing" beats
  "Pricing".
- **Friction reduction.** "Start free — no credit card" reduces the
  imagined cost of clicking. Name the next step explicitly when it is
  smaller than the reader expects.
- **Secondary CTAs are visually subordinate** — a link, not a second
  button. The eye should never have to choose between two same-weight
  options.
- **Repeat the primary CTA** at logical commitment points: end of the
  hero, after social proof, end of the page. Do not invent a new CTA
  for each — the consistency reinforces the path.

## Microcopy

Microcopy is the writing inside the UI: button labels, error
messages, empty states, tooltips, confirmation dialogs. It is where
copy stops being marketing and starts being product.

- **Button labels** — verb-first, scoped to the action. "Save
  changes" beats "OK". "Delete project" beats "Confirm".
- **Error messages** — name what went wrong, name what the user can
  do about it. Never expose stack traces or internal codes without a
  human-readable explanation alongside.
- **Empty states** — never leave the user staring at a blank screen.
  Explain what the screen will show once it has data, and provide the
  action that fills it.
- **Tooltips** — short, factual, one job. Tooltips that try to
  educate belong in the docs instead.
- **Confirmation dialogs** — name the consequence in the body, name
  the action in the button. "This will permanently delete 12 files."
  / `[Cancel]` `[Delete 12 files]`. Never default the destructive
  action to the highlighted button.

The microcopy heuristic: read the label out loud as if you were
asking the user to do it. If the sentence feels weird, the label is
wrong.

## Internationalisation considerations

Copy that survives translation is copy that respects the constraints
of every target language from the start. The patterns to avoid:

- **Idioms** — "moving the needle", "the elephant in the room",
  "low-hanging fruit" translate poorly or not at all. Use plain
  statements.
- **Cultural references** — sports metaphors, holiday references,
  pop-culture nods are landmines outside their home culture.
- **Tight visual bounds with English-length assumptions** — German
  translations run ~30 % longer, Japanese ~50 % shorter. Headlines
  laid out to perfectly fit the English version will break.
- **Compound sentences with embedded conditionals** — split them.
  Translators (human or machine) handle short, declarative sentences
  more reliably than nested ones.
- **Puns and double meanings** — they never carry across. If the
  headline is a pun, plan a separate localised headline per market.

Write copy as if a translator will rewrite it tomorrow. The discipline
makes the English version clearer too.

## SEO-aware writing

Write for humans first; serve search engines as a side effect.
Modern search ranks pages that satisfy reader intent — keyword
stuffing actively hurts.

- **Keyword placement** — the primary keyword belongs in the page
  title, the H1, the first 100 words, and at least one H2. Beyond
  that, repetition stops helping.
- **Meta description** — 140 to 160 characters. Treat it as ad copy:
  one sentence on the value, one on the specificity, optional CTA.
  Search engines truncate longer ones.
- **Heading hierarchy** — one H1 per page (the page topic). H2 for
  section topics. H3 for subsections inside an H2. Skipping levels
  (H2 → H4) confuses both screen readers and crawlers.
- **Internal linking** — link from new pages to related existing
  pages using descriptive anchor text. "See our deployment guide"
  beats "click here".
- **Image alt text** — describe the image content for screen readers
  first; keyword inclusion is a bonus when it fits naturally.

The SEO/copy conflict resolves cleanly: if a keyword choice makes the
sentence worse for a human reader, the keyword loses. Search engines
catch up to good writing; they do not reward bad writing.

## Output expectations

When this skill drives a writing task, deliver Markdown with clear
section labels. Hand off to a developer or designer for implementation
— do not embed HTML, styling, or layout decisions in the copy itself.

When this skill drives a review, return findings as a structured list:
section name, the specific weakness, a concrete rewrite. Vague
feedback ("the hero feels weak") is not actionable; rewrites are.
