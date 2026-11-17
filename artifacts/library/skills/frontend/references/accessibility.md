# Accessibility and HTML semantics

## Contents

- [HTML semantics](#html-semantics)
- [Document outline](#document-outline)
- [Landmark roles](#landmark-roles)
- [Semantic element checklist](#semantic-element-checklist)
- [Forms](#forms)
- [WCAG 2.1 AA](#wcag-21-aa)
- [Focus management](#focus-management)
- [Skip links](#skip-links)
- [ARIA attributes](#aria-attributes)
- [Color contrast ratios](#color-contrast-ratios)
- [Touch targets](#touch-targets)

## HTML semantics

Semantics are the cheapest accessibility win and the foundation every
later layer depends on. Generic `<div>` soup forces you to bolt ARIA
back on; semantic elements come with the correct role, focus
behavior, and assistive-tech mapping for free.

## Document outline

Each page has exactly one `<h1>`, typically the hero title. Heading
levels descend without gaps (`h1 → h2 → h3`). Screen readers expose a
heading tree; gaps and duplicate `h1` tags break that navigation.

## Landmark roles

Wrap the page in landmark elements rather than `<div>`s. Each landmark
appears in the AT rotor and gives keyboard users a skip target.

```html
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header><nav aria-label="Primary">…</nav></header>
  <main id="main">
    <article>
      <h1>Page title</h1>
      <section aria-labelledby="features">
        <h2 id="features">Features</h2>
      </section>
    </article>
    <aside aria-label="Related">…</aside>
  </main>
  <footer>…</footer>
</body>
```

## Semantic element checklist

- `<button>` for in-page actions; `<a href>` for navigation.
- `<nav>` for navigation groups; label with `aria-label` when more than
  one exists on the page.
- `<main>` once per page; everything outside lives in `<header>`,
  `<aside>`, or `<footer>`.
- `<figure>` + `<figcaption>` for images that need attribution or a
  caption.
- `<time datetime="…">` for machine-readable dates.
- `<dl>` / `<dt>` / `<dd>` for definition lists and key/value pairs.

## Forms

- Every input has a `<label for>` (or wraps the input). Placeholders
  are not labels.
- Group related inputs in `<fieldset>` with a `<legend>`.
- Use the right `type` (`email`, `tel`, `url`, `number`, `date`): it
  drives mobile keyboards, validation, and assistive announcements.
- Use `autocomplete` tokens (`name`, `email`, `current-password`,
  `one-time-code`); password managers and AT depend on them.
- Surface validation errors with `aria-invalid="true"` and
  `aria-describedby` pointing to the error message.

## WCAG 2.1 AA

WCAG 2.1 AA is the legal baseline in most jurisdictions and the
practical baseline everywhere else. Treat it as a floor, not a goal.
`scripts/check-html-a11y.ts` covers the static part (alt text, labels,
heading order, landmarks, `lang`); keyboard, focus, motion and contrast
against real backgrounds still need a manual pass.

## Focus management

- Every interactive element has a visible `:focus-visible` style.
  Remove the default outline only if you replace it with something at
  least as legible.
- Focus order follows the visual order. `tabindex="0"` makes a
  non-interactive element focusable; never use positive `tabindex`
  values.
- After a route change or modal open, move focus to the new context
  (the modal title, the page heading).

## Skip links

Provide a skip link as the first focusable element. Style it visible
on focus so it is discoverable.

```css
.skip-link {
  position: absolute;
  inset-block-start: -100px;
  inset-inline-start: 0;
}

.skip-link:focus-visible {
  inset-block-start: 0;
}
```

## ARIA attributes

The first rule of ARIA is: do not use ARIA. Pick the right semantic
element first; reach for ARIA only when no element fits.

- `aria-label` / `aria-labelledby`: accessible name when the visible
  text is missing or ambiguous (icon-only buttons).
- `aria-describedby`: supplementary description (form hints, error
  messages).
- `aria-expanded` / `aria-controls`: disclosure widgets and menus.
- `aria-current="page"`: the active item in a navigation list.
- `aria-live="polite"`: status updates, toast regions.

Do not set `role="button"` on a `<div>` when `<button>` would do.

## Color contrast ratios

| Content                                                    | Minimum |
|------------------------------------------------------------|---------|
| Normal text (under 18 pt, or under 14 pt bold)             | 4.5 : 1 |
| Large text (18 pt+, or 14 pt+ bold)                        | 3 : 1   |
| Non-text UI: icons, focus rings, form borders, separators  | 3 : 1   |
| Decorative / disabled UI                                   | Exempt  |

Verify against the actual background, not the nominal one: gradients
and translucent layers shift the result. `scripts/check-contrast.ts`
computes the ratio of two colors and applies the AA or AAA threshold
(add `--large` for large text and for non-text UI at 3:1).

## Touch targets

Interactive controls have a minimum hit area of **44×44 CSS pixels**
(WCAG 2.5.5 AAA, but practical baseline). When the visible target is
smaller, expand the hit area with padding or a transparent pseudo-
element; do not scale the visible glyph.
