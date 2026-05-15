---
name: copywriting
description: "Reference knowledge for product-oriented web copywriting. Covers landing
page anatomy (hero, value proposition, feature sections, social proof, CTA
hierarchy), copywriting frameworks (PAS, BAB, AIDA), tone calibration for
technical-but-accessible and developer-facing audiences, headline patterns,
CTA mechanics, microcopy, SEO-aware writing, and i18n considerations.
Activate when authoring or reviewing web page copy, product landing pages,
marketing content, or any user-facing text that must persuade and convert."
license: Apache-2.0
compatibility: "No runtime prerequisites; this skill is documentation-only."
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "1.0.0"
---


# Copywriting

A practitioner-grade reference for product-oriented web copywriting. Apply
it when authoring landing pages, product pages, feature announcements, or
any copy that must move a reader from awareness to action. Read the relevant
section before writing; treat the **Tone calibration** and **Anti-patterns**
sections as non-negotiable quality gates.

## When to activate

Activate this skill when any of the following is true:

- A landing page, product page, or feature section is being authored or
  reviewed.
- Marketing or growth copy is being evaluated for persuasion effectiveness.
- A developer-facing product (API, SDK, CLI, SaaS) needs copy that is
  technical-but-accessible without veering into jargon overload.
- Headline, CTA, or microcopy options are being compared or A/B tested.
- Existing copy is being audited for clarity, conversion potential, or SEO
  alignment.
- Content must be adapted for multiple locales (i18n).

Defer to **doc-writer** when the output is reference documentation,
API docs, or a README primarily consumed by users who have already
purchased or installed the product. Copy and documentation serve
different jobs: copy converts strangers; documentation retains customers.

***

## Landing page anatomy

A high-converting landing page follows a predictable structure. Readers
scan before they read — the structure must reward both behaviours.

### 1. Hero section

**Purpose:** Capture attention and state the primary value proposition in
under five seconds. This is the only section every visitor sees.

Components:

- **Headline** — one sentence, benefit-first, 8–12 words maximum.
- **Subheadline** — one to two sentences expanding on the headline,
  addressing the reader's primary pain or aspiration.
- **Hero visual** — product screenshot, illustration, or short video loop.
  Avoid stock photography that signals "generic company".
- **Primary CTA** — one button. No competing links at this level.
- **Social proof anchor** — a single trust signal (logo strip, user count,
  press mention) placed immediately below the fold trigger.

Headline formula options:

```text
[Verb] [outcome] [without / in / for] [context]
"Ship faster without breaking production"

[Target audience] [verb] [outcome] [timeframe]
"Developers deploy to production in minutes, not days"

[Bold claim] — [qualifier]
"The CI platform that never lies to you — open source, self-hosted"
```

### 2. Value proposition section

**Purpose:** Answer "why this, not that?" for the reader who is still
evaluating. Typically three to four benefit pillars.

Structure per pillar:

- Icon or small illustration
- Benefit headline (not a feature label)
- Two to three sentence explanation grounding the benefit in a real scenario
- Optional: link to docs or demo

Benefit headline vs. feature label:

| Feature label (avoid) | Benefit headline (use) |
|---|---|
| "Real-time sync" | "Your team sees every change the moment it lands" |
| "Role-based access" | "Grant the right access without opening a ticket" |
| "99.9% uptime SLA" | "Build on infrastructure that does not page you at 3 AM" |

### 3. Feature sections (deep dive)

**Purpose:** Give the already-interested reader the detail they need to
justify the decision. These sections convert researchers, not skimmers.

Guidelines:

- Alternate visual/text layout (text-left/image-right, then invert) to
  create visual rhythm.
- Lead each section with a problem statement, not a capability statement.
- Include a concrete example: a code snippet, a before/after screenshot,
  or a workflow diagram.
- End with a micro-CTA ("See it in action →") that links to a demo or
  docs page — not to the main CTA again.

### 4. Social proof

**Purpose:** Reduce perceived risk by showing that trusted peers have
already made this decision.

Hierarchy of proof (strongest to weakest):

1. **Named case study** — company name, specific metric, named human quote.
2. **Pull quote with photo and title** — "Jane Doe, Staff Engineer at Acme".
3. **Logo strip** — recognisable logos without quotes. Works for brand
   association; contributes nothing to persuasion on its own.
4. **Star rating / review count** — only credible when the count is large
   and the source is third-party (G2, Product Hunt, GitHub stars).
5. **Press mentions** — "As seen in …" only when the publication is known
   to the target audience.

Rules for quotes:

- Always include name, title, and company. Anonymous quotes have zero
  persuasion value.
- Quotes must be specific. "This tool changed everything" → useless.
  "We cut deploy time from 45 minutes to 4" → useful.
- Do not manufacture specificity. If the real quote is vague, ask for
  a more specific one or use a case study instead.

### 5. CTA hierarchy

A landing page has one primary CTA and at most two secondary CTAs.

| Level | Example | Placement |
|---|---|---|
| Primary | "Start free — no credit card" | Hero, mid-page, bottom |
| Secondary | "See live demo" | Hero (beside primary), feature sections |
| Tertiary | "Read the docs →" | Footer, post-CTA paragraph |

Never place two primary CTAs in the same viewport. Choice kills conversion.

***

## Copywriting frameworks

### PAS — Problem / Agitation / Solution

Best for: email subjects, short ads, hero sections targeting a known pain.

```text
Problem:    State the pain the reader already feels.
Agitation:  Intensify it. Show the downstream consequences of not solving it.
Solution:   Present the product as the resolution.
```

Example (developer-facing CI product):

```text
Problem:    Your CI pipeline takes 40 minutes. Engineers wait instead of shipping.
Agitation:  Every minute in queue is a context switch. By the time the build
            finishes, you have moved on — and the feedback is stale.
Solution:   [Product] cuts median build time to under 4 minutes by running
            steps in parallel and caching aggressively by default.
```

### BAB — Before / After / Bridge

Best for: case studies, testimonial framing, onboarding copy.

```text
Before:  Describe the reader's current state (painful).
After:   Describe the desired future state (aspirational).
Bridge:  Position the product as the path between the two.
```

### AIDA — Attention / Interest / Desire / Action

Best for: long-form landing pages, email sequences, full-page copy flows.

```text
Attention:  Interrupt the scroll with a bold claim or provocative question.
Interest:   Establish relevance — why should this particular reader care?
Desire:     Build want through benefits, proof, and specificity.
Action:     Remove friction and ask for the next step.
```

Use AIDA to audit copy flow from top to bottom. If a section does not
serve one of these four purposes, cut it.

***

## Tone calibration

### Technical-but-accessible

Target audience: practitioners who are evaluating a tool. They are
intelligent, sceptical, and allergic to marketing vagueness.

Rules:

- **Use precise vocabulary.** "Latency" not "slowness". "Build artifact"
  not "output file". Precision signals that the writer understands the
  domain.
- **Avoid superlatives without evidence.** "Best in class", "blazing fast",
  "seamless" — these are noise. Replace with specifics: "median build time
  4 minutes across 200 open-source projects we benchmarked."
- **Write in active voice.** "The agent runs your tests in parallel" not
  "Tests are run in parallel by the agent."
- **Short sentences for claims; medium sentences for explanations.**
  Alternate to create rhythm.
- **No preamble.** Start with the claim or the problem. Never with "In
  today's fast-paced world…".

### Developer-facing

Additional constraints on top of the above:

- **Show, don't tell.** A code snippet is worth three paragraphs. Include
  runnable examples. Show realistic output, not `your_value_here`.
- **Acknowledge trade-offs.** Developers distrust copy that presents no
  downsides. A sentence like "This approach adds ~200 ms to cold starts —
  here is how we mitigate it" builds more trust than silence.
- **Respect CLI conventions.** When referencing commands, use `monospace`.
  Do not prettify `--flags` or invent flag names that do not exist.
- **Do not infantilise.** Assume the reader can read a YAML file. Skip
  explanations of industry-standard concepts unless the product's
  differentiation depends on reframing them.

***

## Headline patterns

Six patterns that consistently perform well. Pick based on the primary
reader motivation.

| Pattern | Structure | Example |
|---|---|---|
| Outcome-first | [Verb] [outcome] [context] | "Deploy to production in under 10 minutes" |
| Pain-relief | [Stop/Never] [pain] [again] | "Stop waiting for flaky tests to decide your fate" |
| Specificity hook | [Specific number] [claim] | "4× faster builds. No config required." |
| Who it's for | [Audience] [verb] [outcome] | "Platform teams use [Product] to ship infra as code" |
| Contrast | [Status quo] vs [new reality] | "From 45-minute pipelines to 4-minute ones" |
| Bold claim | [Surprising assertion] — [proof hook] | "CI that never lies — here is the benchmark" |

Headline testing heuristic: read the headline in isolation. Does it tell
you (a) what the product does, (b) for whom, and (c) why it matters?
If any of the three is missing, revise.

***

## CTA mechanics

A CTA is a microcopy problem as much as a design problem.

### Button copy

Avoid generic verbs. Map the CTA to the specific action and its
immediate outcome.

| Generic (avoid) | Specific (use) |
|---|---|
| "Submit" | "Get my free report" |
| "Sign up" | "Start building — free forever" |
| "Learn more" | "See how it works →" |
| "Get started" | "Deploy your first pipeline in 5 min" |

Rules:

- First person outperforms third person: "Start my trial" > "Start your
  trial" in most tests.
- State the cost (or absence of cost) when friction is high: "No credit
  card required", "Cancel anytime", "Free for open-source".
- Pair the primary CTA with a secondary escape valve for readers who
  are not ready: "Start free" + "See live demo".

### Placement cadence

On a long landing page, place a CTA:

1. Above the fold (hero).
2. After the first value prop section.
3. After the social proof section.
4. At the bottom of the page.

Do not repeat CTAs within the same viewport. The repetition should feel
like a natural checkpoint, not a hard sell.

***

## Microcopy

Microcopy is the small-form copy that surrounds interactive elements:
form labels, error messages, tooltips, empty states, confirmation screens.
It is the most underrated conversion lever on most products.

### Principles

- **Be specific in errors.** "Something went wrong" → useless.
  "We could not verify your email — check for typos and try again" → useful.
- **Reduce perceived risk at friction points.** A form asking for a credit
  card should say "You will not be charged until day 14" next to the field,
  not in the fine print below the button.
- **Empty states are opportunities.** "No pipelines yet" → waste.
  "Create your first pipeline — it takes about 5 minutes" → action.
- **Confirmation screens should recap the action.** "Your pipeline is live
  at yourname.example.com — here is what happens next" beats "Success!"
- **Placeholder text is not a label.** Placeholders disappear on focus;
  use visible labels. Reserve placeholders for format hints: "e.g.
  jane@company.com".

***

## SEO-aware writing

Copy and SEO are not in conflict when approached correctly.

### Structural signals

- The H1 (page headline) must contain the primary keyword phrase once.
  Do not keyword-stuff; the phrase should read naturally.
- H2s structure the semantic outline of the page. Search engines use
  them to understand topic coverage. Each H2 should represent a
  distinct sub-topic, not a rephrasing of the H1.
- Meta description (150–160 characters): one sentence that restates the
  primary benefit and includes the primary keyword. It does not directly
  affect ranking but drives click-through rate from SERPs.

### Keyword integration

- Target one primary keyword phrase per page. Attempting to rank for
  five concepts on one page dilutes topical authority.
- Use semantic variants naturally in body copy — do not force exact-match
  phrases. Modern search engines understand synonyms and related concepts.
- Internal links use descriptive anchor text: "learn how caching works"
  not "click here".

### Performance note

Page weight and Core Web Vitals affect ranking. When specifying images or
video in copy briefs, flag format and size constraints:
`[hero image: WebP, max 200 KB, 1440 × 900]`. The copywriter controls
alt text; the developer controls delivery.

***

## i18n considerations

Copywriting for international audiences introduces constraints that must
be factored in at brief stage, not at translation stage.

### Text expansion

Most European languages expand 20–30% from English. Spanish and French
regularly reach 30%. German can reach 40%. Headlines designed at exactly
the character limit for English will overflow in German.

Rule of thumb: leave 30% visual space headroom in hero headlines and
button labels for translated variants.

### Idiomatic expressions

Idioms, wordplay, and culture-specific references do not translate. When
copy relies on a pun or a cultural reference (sports metaphor, regional
slang), flag it in the copy brief so the translator can localise rather
than translate literally.

### Date, number, and currency formats

Avoid hardcoding locale-specific formats in copy templates. "Free for
14 days" is safe. "$29/month" is not — the currency symbol and number
formatting conventions differ by locale. Use a placeholder:
`[price]/[period]` and let the localisation pipeline inject the correct
value.

### RTL considerations

Arabic and Hebrew read right-to-left. Copy designed for RTL layouts must
be shorter on average — dense left-aligned blocks reflow poorly in RTL
contexts. Flag any copy intended for RTL markets at brief stage so the
visual designer can adapt the layout.

***

## Anti-patterns

The following patterns reliably reduce conversion or damage brand trust.
Treat each one as a disqualifier during copy review.

| Anti-pattern | Why it fails | Fix |
|---|---|---|
| **"Best-in-class"** | Unverifiable, expected, ignored | Replace with a specific benchmark |
| **"Seamless integration"** | Every product claims this | Show the integration: a code snippet or a 30-second GIF |
| **"Powerful and flexible"** | Content-free adjectives | Name one specific power and one specific flexibility |
| **Wall of features** | Readers evaluate, not absorb | Prioritise top three; link to full list |
| **Passive voice throughout** | Feels distant, bureaucratic | Rewrite in active voice; subject does the action |
| **Multiple primary CTAs in hero** | Kills decision momentum | One primary CTA; one secondary escape valve |
| **Anonymous testimonials** | Zero credibility signal | Full name, title, company — always |
| **"Learn more" everywhere** | Non-descriptive, lazy | Specifiy the destination: "See pricing →", "Read the case study →" |
| **"Get started for free today!"** | Exclamation marks signal desperation | Remove exclamation from CTAs; let the offer speak |
| **Missing social proof** | Risk remains unaddressed | Add proof at every decision point |

***

When in doubt about a copy decision, return to the reader's primary
question at that point in the page journey: "What do I need to believe
to take the next step?" Write the sentence that answers that question.
Everything else is noise.
